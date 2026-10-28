import { AppError, assertNoSecrets, record } from './runtime.ts';

export type EvidenceMode = 'chart_only' | 'context_supported';
export type SelectionSource = 'model' | 'birth_input' | 'ranked_fallback';
export interface CandidateAssessment {
  candidate_id: string;
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  rationale: string;
  unresolved_questions: string[];
}
export interface ChartReview {
  status: 'recommended' | 'provisional' | 'ambiguous' | 'insufficient_evidence';
  // Legacy model inputs may contain null; validated results always select a real candidate.
  recommended_candidate_id: string | null;
  ranking: CandidateAssessment[];
  alternatives: string[];
  summary: string;
  limits: string[];
  evidence_mode?: EvidenceMode;
  reportWarnings?: string[];
  selection_source?: SelectionSource;
}
export interface PersonalAnalysis {
  selected_candidate_id: string;
  overview: string;
  sections: Array<{ domain: string; text: string; evidence_ids: string[]; chart_basis: string[]; uncertainties: string[] }>;
  scenarios: Array<{ condition: string; implication: string; evidence_ids: string[] }>;
  limitations: string[];
  evidence_mode?: EvidenceMode;
  reportWarnings?: string[];
}

function fail(): never { throw new AppError('INVALID_MODEL_OUTPUT', '模型报告缺少必要正文或候选身份不一致，请保留当前资料后重试；无需重新填写问卷。', 502); }
function bounded(value: unknown, max = 2400): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail();
}
function warn(warnings: string[], message: string): void {
  if (!warnings.includes(message)) warnings.push(message);
}
function checkObject(value: unknown, keys: string[], warnings: string[], path: string): Record<string, unknown> {
  let object: Record<string, unknown>;
  try { object = record(value, '模型结果'); } catch { return fail(); }
  if (Object.keys(object).some(key => !keys.includes(key))) warn(warnings, `${path}：已忽略契约之外的附加字段。`);
  return object;
}
function optionalTexts(value: unknown, warnings: string[], path: string, max = 12): string[] {
  if (value === undefined || value === null) return [];
  const values = typeof value === 'string' ? [value] : value;
  if (typeof value === 'string') warn(warnings, `${path}：单条文字已规范化为数组。`);
  if (!Array.isArray(values)) { warn(warnings, `${path}：无效的可选说明已忽略。`); return []; }
  const output = values.filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && item.length <= 1200).slice(0, max);
  if (output.length !== values.length) warn(warnings, `${path}：已忽略空白、格式错误或超出数量/长度限制的可选说明。`);
  return [...new Set(output)];
}

/** Repair citation metadata only. Never manufacture supporting facts or body text. */
function references(value: unknown, permitted: Set<string>, warnings: string[], path: string): string[] {
  if (value === undefined || value === null) return [];
  const values = typeof value === 'string' ? [value] : value;
  if (typeof value === 'string') warn(warnings, `${path}：单个引用已规范化为数组。`);
  if (!Array.isArray(values)) { warn(warnings, `${path}：引用格式无效，已清空；相关正文未因此获得验证。`); return []; }
  const output: string[] = [];
  if (values.length > 80) warn(warnings, `${path}：超出引用数量上限的条目已忽略。`);
  for (const item of values.slice(0, 80)) {
    if (typeof item !== 'string' || !permitted.has(item.trim())) {
      warn(warnings, `${path}：已剔除无效、未知或不适用的引用；相关正文未因此获得验证。`);
      continue;
    }
    const id = item.trim();
    if (id !== item) warn(warnings, `${path}：已去除引用 ID 周围的空白。`);
    if (output.includes(id)) { warn(warnings, `${path}：重复引用已去重。`); continue; }
    output.push(id);
  }
  return output;
}

function candidateReferences(value: unknown, candidates: Set<string>, warnings: string[]): string[] {
  if (value === undefined || value === null) return [];
  const values = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(values) || values.length > 80) fail();
  if (values.some(id => typeof id !== 'string' || !candidates.has(id))) fail();
  if (new Set(values).size !== values.length) warn(warnings, 'alternatives：重复候选已去重。');
  return [...new Set(values)] as string[];
}

export function validateReview(value: unknown, candidateIds: string[], evidenceIds: string[]): ChartReview {
  assertNoSecrets(value);
  const warnings: string[] = [];
  const result = checkObject(value, ['status', 'recommended_candidate_id', 'ranking', 'alternatives', 'summary', 'limits', 'evidence_mode', 'reportWarnings', 'selection_source'], warnings, 'review');
  if (!['recommended', 'provisional', 'ambiguous', 'insufficient_evidence'].includes(String(result.status))) fail();
  if (!candidateIds.length || new Set(candidateIds).size !== candidateIds.length) fail();
  const candidates = new Set(candidateIds), evidence = new Set(evidenceIds);
  if (!Array.isArray(result.ranking) || result.ranking.length !== candidateIds.length) fail();
  const ranked = new Set<string>();
  const ranking: CandidateAssessment[] = [];
  for (const [index, item] of result.ranking.entries()) {
    const path = `ranking[${index}]`;
    const row = checkObject(item, ['candidate_id', 'supporting_evidence_ids', 'contradicting_evidence_ids', 'rationale', 'unresolved_questions'], warnings, path);
    if (typeof row.candidate_id !== 'string' || !candidates.has(row.candidate_id) || ranked.has(row.candidate_id)) fail();
    ranked.add(row.candidate_id);
    bounded(row.rationale);
    let supporting = references(row.supporting_evidence_ids, evidence, warnings, `${path}.supporting_evidence_ids`);
    let contradicting = references(row.contradicting_evidence_ids, evidence, warnings, `${path}.contradicting_evidence_ids`);
    const overlap = new Set(supporting.filter(id => contradicting.includes(id)));
    if (overlap.size) {
      supporting = supporting.filter(id => !overlap.has(id));
      contradicting = contradicting.filter(id => !overlap.has(id));
      warn(warnings, `${path}：同时被列为支持和反证的引用已从两处移除，正文判断仍需核对。`);
    }
    ranking.push({ candidate_id: row.candidate_id, supporting_evidence_ids: supporting, contradicting_evidence_ids: contradicting, rationale: row.rationale, unresolved_questions: optionalTexts(row.unresolved_questions, warnings, `${path}.unresolved_questions`, 10) });
  }
  const first = ranking[0]!;
  const requested = result.recommended_candidate_id;
  if (requested !== null && requested !== undefined && (typeof requested !== 'string' || !candidates.has(requested))) fail();
  if (typeof requested === 'string' && requested !== first.candidate_id) fail();
  const selectedId = typeof requested === 'string' ? requested : first.candidate_id;
  let selectionSource: SelectionSource = 'model';
  let status: ChartReview['status'] = result.status as ChartReview['status'];
  if (candidateIds.length === 1) {
    selectionSource = 'birth_input';
    status = 'provisional';
    warn(warnings, '出生输入只对应一个候选，直接作为暂用工作盘；这不表示已经通过人生经历验证出生时辰。');
  } else if (requested === null || requested === undefined) {
    selectionSource = 'ranked_fallback';
    status = 'provisional';
    warn(warnings, '模型未明确选择工作盘，系统按其完整排序的首项暂定以继续分析；这不是模型已验证的推荐，其他候选仍保留。');
  }
  if (evidence.size === 0) {
    status = 'provisional';
    warn(warnings, '未提供可引用的已知经历，本次仅根据命盘作暂定比较，不表示已经识别真实出生时辰。');
  } else if (status === 'ambiguous' || status === 'insufficient_evidence' || !first.supporting_evidence_ids.length) {
    status = 'provisional';
    warn(warnings, '现有依据不足以验证工作盘，保留暂定选择并继续条件性分析。');
  }
  let alternatives = candidateReferences(result.alternatives, candidates, warnings);
  if (alternatives.includes(selectedId)) {
    alternatives = alternatives.filter(id => id !== selectedId);
    warn(warnings, 'alternatives：暂用工作盘已从备选列表移除。');
  }
  bounded(result.summary);
  const limits = optionalTexts(result.limits, warnings, 'limits', 10);
  if (!limits.length) warn(warnings, '模型未单独提供局限说明；暂定选择和自然语言解释均未经独立正确率验证。');
  warnings.push(...optionalTexts(result.reportWarnings, warnings, 'reportWarnings', 20));
  return { status, recommended_candidate_id: selectedId, ranking, alternatives, summary: result.summary, limits, evidence_mode: evidence.size ? 'context_supported' : 'chart_only', selection_source: selectionSource, reportWarnings: [...new Set(warnings)] };
}

export function validateAnalysis(value: unknown, selectedId: string, evidenceIds: string[], chartPaths: string[]): PersonalAnalysis {
  assertNoSecrets(value);
  const warnings: string[] = [];
  const result = checkObject(value, ['selected_candidate_id', 'overview', 'sections', 'scenarios', 'limitations', 'evidence_mode', 'reportWarnings'], warnings, 'analysis');
  if (result.selected_candidate_id !== selectedId) fail();
  bounded(result.overview);
  const evidence = new Set(evidenceIds), allowedChartPaths = new Set(chartPaths);
  if (!Array.isArray(result.sections) || result.sections.length < 1 || result.sections.length > 8) fail();
  let chartCount = 0;
  const sections: PersonalAnalysis['sections'] = [];
  for (const [index, item] of result.sections.entries()) {
    const path = `sections[${index}]`;
    const section = checkObject(item, ['domain', 'text', 'evidence_ids', 'chart_basis', 'uncertainties'], warnings, path);
    bounded(section.domain, 60); bounded(section.text, 4000);
    const evidenceReferences = references(section.evidence_ids, evidence, warnings, `${path}.evidence_ids`);
    const chartReferences = references(section.chart_basis, allowedChartPaths, warnings, `${path}.chart_basis`);
    const uncertainties = optionalTexts(section.uncertainties, warnings, `${path}.uncertainties`);
    if (!evidenceReferences.length && !uncertainties.length) warn(warnings, `${path}：本节无可核对的用户事实引用，解释仅属条件性命盘分析。`);
    chartCount += chartReferences.length;
    sections.push({ domain: section.domain, text: section.text, evidence_ids: evidenceReferences, chart_basis: chartReferences, uncertainties });
  }
  const scenarioInput = result.scenarios ?? [];
  if (!Array.isArray(scenarioInput) || scenarioInput.length > 8) fail();
  const scenarios: PersonalAnalysis['scenarios'] = [];
  for (const [index, item] of scenarioInput.entries()) {
    const path = `scenarios[${index}]`;
    const scenario = checkObject(item, ['condition', 'implication', 'evidence_ids'], warnings, path);
    bounded(scenario.condition); bounded(scenario.implication);
    scenarios.push({ condition: scenario.condition, implication: scenario.implication, evidence_ids: references(scenario.evidence_ids, evidence, warnings, `${path}.evidence_ids`) });
  }
  const limitations = optionalTexts(result.limitations, warnings, 'limitations');
  if (!chartCount) warn(warnings, '报告未保留有效的盘内字段引用，正文已保留，但其命盘依据尚未得到结构核对。');
  if (!evidence.size) warn(warnings, '未提供可引用的个人背景，本报告为纯命盘的条件性解读，不代表已知真实家庭、经历或处境。');
  if (!limitations.length) warn(warnings, '模型未单独提供局限说明；自然语言解释和未来情景未经独立验证。');
  warnings.push(...optionalTexts(result.reportWarnings, warnings, 'reportWarnings', 20));
  return { selected_candidate_id: selectedId, overview: result.overview, sections, scenarios, limitations, evidence_mode: evidence.size ? 'context_supported' : 'chart_only', reportWarnings: [...new Set(warnings)] };
}
