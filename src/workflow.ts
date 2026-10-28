import { randomUUID } from 'node:crypto';
import { generateCandidateCharts, type BirthInput, type CandidateSet } from './chartEngine.ts';
import { buildEvidence, getQuestionnaire, validateAnswers, type EvidenceItem, type QuestionnaireAnswers } from './questionnaire.ts';
import { createDeepSeekClient, type DeepSeekResult } from './deepseek.ts';
import { ANALYSIS_SYSTEM, REVIEW_SYSTEM, analysisPayload, reviewPayload, chartReferencePaths, referenceableEvidenceIds } from './prompts.ts';
import { validateAnalysis, validateReview, type ChartReview, type PersonalAnalysis } from './results.ts';
import { AppError, assertNoSecrets, exactKeys, freeze, record, runtime } from './runtime.ts';

export interface ModelEnvelope<T> {
  result: T;
  usage: DeepSeekResult['usage'];
  model: string;
  providerModel?: string;
  requestId?: string;
  durationMs: number;
}
interface Session {
  id: string; createdAt: string; expiresAt: string; expires: number; asOfDate: string; expiryTimer?: NodeJS.Timeout;
  candidateSet: CandidateSet; evidence: EvidenceItem[]; context: EvidenceItem[];
  review?: ModelEnvelope<ChartReview>; reviewPending: boolean;
  analyses: Map<string, ModelEnvelope<PersonalAnalysis>>; analysisPending: boolean;
}
export interface WorkflowOptions {
  client?: ReturnType<typeof createDeepSeekClient>;
  chartGenerator?: typeof generateCandidateCharts;
  now?: () => number;
}

export class Workflow {
  private sessions = new Map<string, Session>();
  private client: ReturnType<typeof createDeepSeekClient>;
  private chartGenerator: typeof generateCandidateCharts;
  private now: () => number;
  private activeModelCalls = 0;

  constructor(options: WorkflowOptions = {}) {
    this.client = options.client ?? createDeepSeekClient();
    this.chartGenerator = options.chartGenerator ?? generateCandidateCharts;
    this.now = options.now ?? Date.now;
  }

  private prune() {
    for (const [id, session] of this.sessions) if (session.expires <= this.now()) this.delete(id);
  }

  private get(id: unknown): Session {
    this.prune();
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new AppError('INVALID_SESSION', '请先提交完整问卷。');
    const session = this.sessions.get(id);
    if (!session) throw new AppError('SESSION_EXPIRED', '会话已清除或过期，请重新提交资料。', 410);
    return session;
  }

  private stillActive(session: Session) {
    if (this.sessions.get(session.id) !== session || session.expires <= this.now()) {
      this.delete(session.id);
      throw new AppError('SESSION_EXPIRED', '会话已清除或过期，本次结果未保存。', 410);
    }
  }

  private enterModel() {
    if (this.activeModelCalls >= runtime.max_concurrent_model_calls) throw new AppError('MODEL_BUSY', '已有模型请求正在处理，请等待完成。', 409);
    this.activeModelCalls += 1;
  }

  create(input: unknown) {
    this.prune();
    if (this.sessions.size >= runtime.max_sessions) throw new AppError('SESSION_LIMIT', '本地会话已达到上限，请清除旧会话后再试。', 429);
    assertNoSecrets(input);
    const request = record(input, '请求'); exactKeys(request, ['birth', 'answers'], '请求');
    record(request.birth, '出生资料');
    const candidateSet = freeze(structuredClone(this.chartGenerator(request.birth as BirthInput)));
    if (!candidateSet.candidates.length) throw new AppError('NO_CANDIDATES', '给定时间范围内未生成有效候选盘。');
    const solarBirthDate = candidateSet.candidates[0]!.features.solarDate;
    if (typeof solarBirthDate !== 'string') throw new AppError('INVALID_CALENDAR_RESULT', '排盘结果缺少公历出生日期。');
    const asOfDate = new Date(this.now()).toISOString().slice(0, 10);
    if (solarBirthDate < getQuestionnaire().limits.minimumDate || solarBirthDate > asOfDate) {
      throw new AppError('BIRTH_DATE_RANGE', '问卷产品支持 1900 年至今天的公历出生日期；农历输入会先转换。');
    }
    const questionContext = { birthDate: solarBirthDate, asOfDate };
    const validation = validateAnswers(request.answers, questionContext);
    if (!validation.valid) {
      const error = new AppError('INCOMPLETE_QUESTIONNAIRE', '请先完成所有适用问题；不知道的项目可以明确选择“不知道”。');
      Object.assign(error, { details: validation.errors }); throw error;
    }
    const { evidence, context } = freeze(buildEvidence(request.answers as QuestionnaireAnswers, questionContext));
    const now = this.now(), expires = now + runtime.session_ttl_ms;
    const session: Session = {
      id: randomUUID(), createdAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString(), expires, asOfDate,
      candidateSet, evidence, context, reviewPending: false, analysisPending: false, analyses: new Map(),
    };
    this.sessions.set(session.id, session);
    session.expiryTimer = setTimeout(() => this.delete(session.id), runtime.session_ttl_ms).unref();
    return structuredClone({ id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt, asOfDate, candidateSet, evidence, context });
  }

  async review(id: unknown) {
    const session = this.get(id);
    if (session.review) {
      const { result: review, ...meta } = session.review;
      return structuredClone({ review, ...meta, cached: true });
    }
    if (session.reviewPending) throw new AppError('REVIEW_IN_PROGRESS', '这份资料正在校盘，请等待结果。', 409);
    const knownIds = referenceableEvidenceIds(session.evidence);
    if (!knownIds.length) throw new AppError('INSUFFICIENT_EVIDENCE', '校盘问题尚无可用事实，暂不发起付费模型请求。可保留候选盘或补充已知经历。');
    const payload = reviewPayload(session.candidateSet, session.evidence, session.asOfDate);
    this.enterModel(); session.reviewPending = true;
    try {
      const { data, ...meta } = await this.client.completeJson({ system: REVIEW_SYSTEM, payload, maxOutputTokens: runtime.review_max_output_tokens });
      const result = validateReview(data, session.candidateSet.candidates.map(chart => chart.id), knownIds);
      this.stillActive(session);
      session.review = freeze({ result, ...meta });
      return structuredClone({ review: result, ...meta, cached: false });
    } finally { session.reviewPending = false; this.activeModelCalls -= 1; }
  }

  async analyze(id: unknown, candidateId?: unknown) {
    const session = this.get(id);
    if (!session.review) throw new AppError('REVIEW_REQUIRED', '请先完成候选盘复核，再进行深入分析。');
    const review = session.review.result;
    const selectedId = candidateId ?? review.recommended_candidate_id;
    if (typeof selectedId !== 'string') throw new AppError('WORKING_CHART_REQUIRED', '当前没有唯一推荐盘，请明确选择一个暂用工作盘。');
    const chart = session.candidateSet.candidates.find(item => item.id === selectedId);
    if (!chart) throw new AppError('INVALID_CANDIDATE', '工作盘必须来自本次计算的候选盘。');
    const cached = session.analyses.get(selectedId);
    if (cached) { const { result: analysis, ...meta } = cached; return structuredClone({ analysis, ...meta, cached: true }); }
    if (session.analysisPending) throw new AppError('ANALYSIS_IN_PROGRESS', '这份资料正在分析，请等待结果。', 409);
    const selectedBy = selectedId === review.recommended_candidate_id ? 'model' : 'user';
    const payload = analysisPayload(session.candidateSet, chart, review, session.evidence, session.context, selectedBy, session.asOfDate);
    const knownIds = referenceableEvidenceIds([...session.evidence, ...session.context]);
    this.enterModel(); session.analysisPending = true;
    try {
      const { data, ...meta } = await this.client.completeJson({ system: ANALYSIS_SYSTEM, payload, maxOutputTokens: runtime.analysis_max_output_tokens });
      const result = validateAnalysis(data, selectedId, knownIds, chartReferencePaths(chart));
      this.stillActive(session);
      session.analyses.set(selectedId, freeze({ result, ...meta }));
      return structuredClone({ analysis: result, ...meta, cached: false });
    } finally { session.analysisPending = false; this.activeModelCalls -= 1; }
  }

  delete(id: unknown) {
    if (typeof id !== 'string') throw new AppError('INVALID_SESSION', '会话 ID 无效。');
    const session = this.sessions.get(id);
    if (session?.expiryTimer) clearTimeout(session.expiryTimer);
    this.sessions.delete(id);
    return { deleted: true };
  }

  dispose() { for (const id of this.sessions.keys()) this.delete(id); }
}
