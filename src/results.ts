import { AppError, assertNoSecrets, exactKeys, record } from './runtime.ts';

export interface CandidateAssessment {
  candidate_id: string;
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  rationale: string;
  unresolved_questions: string[];
}
export interface ChartReview {
  status: 'recommended' | 'ambiguous' | 'insufficient_evidence';
  recommended_candidate_id: string | null;
  ranking: CandidateAssessment[];
  alternatives: string[];
  summary: string;
  limits: string[];
}
export interface PersonalAnalysis {
  selected_candidate_id: string;
  overview: string;
  sections: Array<{ domain: string; text: string; evidence_ids: string[]; chart_basis: string[]; uncertainties: string[] }>;
  scenarios: Array<{ condition: string; implication: string; evidence_ids: string[] }>;
  limitations: string[];
}

function fail(): never { throw new AppError('INVALID_MODEL_OUTPUT', '模型返回的结构或依据不完整，请保留资料并明确重试。', 502); }
function bounded(value: unknown, max = 2400): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail();
}
function strings(value: unknown, max = 20): asserts value is string[] {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 1200)) fail();
}
function references(value: unknown, permitted: Set<string>): asserts value is string[] {
  strings(value, 80);
  if (new Set(value).size !== value.length || value.some(id => !permitted.has(id))) fail();
}
function checkKeys(value: unknown, keys: string[]): Record<string, unknown> {
  try { const object = record(value, '模型结果'); exactKeys(object, keys, '模型结果'); return object; } catch { return fail(); }
}

export function validateReview(value: unknown, candidateIds: string[], evidenceIds: string[]): ChartReview {
  assertNoSecrets(value);
  const result = checkKeys(value, ['status', 'recommended_candidate_id', 'ranking', 'alternatives', 'summary', 'limits']);
  if (!['recommended', 'ambiguous', 'insufficient_evidence'].includes(String(result.status))) fail();
  const candidates = new Set(candidateIds), evidence = new Set(evidenceIds);
  if (!Array.isArray(result.ranking) || result.ranking.length !== candidateIds.length) fail();
  const ranked = new Set<string>();
  for (const item of result.ranking) {
    const row = checkKeys(item, ['candidate_id', 'supporting_evidence_ids', 'contradicting_evidence_ids', 'rationale', 'unresolved_questions']);
    if (typeof row.candidate_id !== 'string' || !candidates.has(row.candidate_id) || ranked.has(row.candidate_id)) fail();
    ranked.add(row.candidate_id);
    references(row.supporting_evidence_ids, evidence); references(row.contradicting_evidence_ids, evidence);
    const contradictions = row.contradicting_evidence_ids;
    if (row.supporting_evidence_ids.some(id => contradictions.includes(id))) fail();
    bounded(row.rationale); strings(row.unresolved_questions, 10);
  }
  references(result.alternatives, candidates);
  if (result.status === 'recommended') {
    if (typeof result.recommended_candidate_id !== 'string' || !candidates.has(result.recommended_candidate_id)) fail();
    const first = result.ranking[0] as CandidateAssessment;
    if (first.candidate_id !== result.recommended_candidate_id || !first.supporting_evidence_ids.length || result.alternatives.includes(result.recommended_candidate_id)) fail();
  } else if (result.recommended_candidate_id !== null) fail();
  bounded(result.summary); strings(result.limits, 10);
  if (!result.limits.length) fail();
  return structuredClone(result) as unknown as ChartReview;
}

export function validateAnalysis(value: unknown, selectedId: string, evidenceIds: string[], chartPaths: string[]): PersonalAnalysis {
  assertNoSecrets(value);
  const result = checkKeys(value, ['selected_candidate_id', 'overview', 'sections', 'scenarios', 'limitations']);
  if (result.selected_candidate_id !== selectedId) fail();
  bounded(result.overview);
  const evidence = new Set(evidenceIds);
  const allowedChartPaths = new Set(chartPaths);
  let evidenceCount = 0, chartCount = 0;
  if (!Array.isArray(result.sections) || result.sections.length < 1 || result.sections.length > 8) fail();
  for (const item of result.sections) {
    const section = checkKeys(item, ['domain', 'text', 'evidence_ids', 'chart_basis', 'uncertainties']);
    bounded(section.domain, 60); bounded(section.text, 4000);
    references(section.evidence_ids, evidence); references(section.chart_basis, allowedChartPaths); strings(section.uncertainties, 12);
    if (!section.evidence_ids.length && !section.uncertainties.length) fail();
    evidenceCount += section.evidence_ids.length; chartCount += section.chart_basis.length;
  }
  if (!evidenceCount || !chartCount) fail();
  if (!Array.isArray(result.scenarios) || result.scenarios.length > 8) fail();
  for (const item of result.scenarios) {
    const scenario = checkKeys(item, ['condition', 'implication', 'evidence_ids']);
    bounded(scenario.condition); bounded(scenario.implication); references(scenario.evidence_ids, evidence);
  }
  strings(result.limitations, 12);
  if (!result.limitations.length) fail();
  return structuredClone(result) as unknown as PersonalAnalysis;
}
