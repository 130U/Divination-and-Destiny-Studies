import { getQuestionnaire, type QuestionnaireAnswers } from '../src/questionnaire.ts';
import type { BirthInput } from '../src/chartEngine.ts';
import type { ChartReview, PersonalAnalysis } from '../src/results.ts';
import type { DeepSeekRequest, DeepSeekResult } from '../src/deepseek.ts';

/** Entirely invented engineering fixture. It is not a private case or accuracy benchmark. */
export function syntheticSubmission() {
  const birth: BirthInput = { date: '2000-06-15', calendar: 'solar', timeMode: 'range', startTime: '09:00', endTime: '13:00', timezone: 'Asia/Shanghai', longitude: 121.47, trueSolarTime: false, sex: 'female' };
  const answers: QuestionnaireAnswers = { applicability: { current_identity_is_working_or_has_work_history: true, childbearing_applicable: false }, responses: {} };
  for (const question of getQuestionnaire().sections.flatMap(section => section.questions)) answers.responses[question.id] = { status: 'unknown' };
  answers.responses.C8_childbearing_years = { status: 'not_applicable' };
  answers.responses.C1_major_turning_years = { status: 'answered', value: [{ year: 2018, description: '完全虚构工程样例：离开家乡开始大学学习。' }] };
  answers.responses.C2_education_years = { status: 'answered', value: [{ year: 2022, description: '完全虚构工程样例：完成本科学习。' }] };
  answers.responses.C7_career_years = { status: 'answered', value: [{ year: 2022, description: '完全虚构工程样例：开始第一份受雇工作。' }] };
  answers.responses.D1_growth_location = { status: 'answered', value: '完全虚构工程样例：在城市成长，无真实身份。' };
  answers.responses.D3_family_support_style = { status: 'answered', value: 'emotional_support' };
  answers.responses.D6_current_identity = { status: 'answered', value: 'professional' };
  answers.responses.D7_inner_preferred_direction = { status: 'answered', value: '完全虚构工程样例：希望兼顾学习和稳定工作。' };
  return { birth, answers };
}

export function fakeModelData(request: DeepSeekRequest): ChartReview | PersonalAnalysis {
  const payload = request.payload as {
    task: string; candidates?: { id: string }[]; selected_chart?: { id: string };
    evidence: { id: string; informationStatus: string }[]; context?: { id: string; informationStatus: string }[];
  };
  const knownIds = [...payload.evidence, ...(payload.context ?? [])].filter(item => item.informationStatus === 'known').map(item => item.id);
  if (payload.task === 'compare_candidate_charts') {
    const ids = payload.candidates!.map(chart => chart.id);
    return {
      status: knownIds.length ? 'recommended' : 'provisional', recommended_candidate_id: ids[0]!,
      ranking: ids.map(id => ({ candidate_id: id, supporting_evidence_ids: knownIds.slice(0, 1), contradicting_evidence_ids: [], rationale: '受控假客户端只验证契约，不代表真实判断。', unresolved_questions: ['工程样例不提供命理有效性证据。'] })),
      alternatives: ids.slice(1), summary: '受控测试结果；不是模型实测。', limits: ['没有验证预测正确率。'],
    };
  }
  return { selected_candidate_id: payload.selected_chart!.id, overview: '受控测试分析。', sections: [{ domain: '职业', text: knownIds.length ? '已知经历来自用户测试输入。' : '合成命盘条件性分析，没有已知个人背景。', evidence_ids: knownIds.slice(0, 1), chart_basis: ['pillars.day'], uncertainties: ['无现实预测效力验证。'] }], scenarios: [], limitations: ['仅为工程测试。'] };
}

export function fakeResponse(data: unknown): DeepSeekResult {
  return { data, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, model: 'deepseek-flash', requestId: 'synthetic-request', durationMs: 1 };
}
