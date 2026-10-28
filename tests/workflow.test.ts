import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow } from '../src/workflow.ts';
import { runtime } from '../src/runtime.ts';
import { syntheticSubmission, fakeModelData, fakeResponse } from './fixtures.ts';
import type { DeepSeekRequest } from '../src/deepseek.ts';

test('partial answers are optional and every local candidate is retained before the first model call', async () => {
  let calls = 0;
  const workflow = new Workflow({ client: { completeJson: async request => { calls++; return fakeResponse(fakeModelData(request)); } } });
  const partial = syntheticSubmission(); delete partial.answers.responses.D1_growth_location;
  assert.equal(workflow.create(partial).context.find(item => item.id === 'D1_growth_location')!.informationStatus, 'unknown');
  assert.equal(calls, 0);
  const submitted = syntheticSubmission(), before = structuredClone(submitted);
  const session = workflow.create(submitted);
  assert.ok(session.candidateSet.candidates.length >= 3);
  assert.deepEqual(submitted, before);
  assert.equal(calls, 0);
  const reviewed = await workflow.review(session.id);
  assert.equal(reviewed.review.ranking.length, session.candidateSet.candidates.length);
  assert.equal(calls, 1);
});

test('normal workflow makes two calls and caches identical operations without extra billing', async () => {
  const requests: DeepSeekRequest[] = [];
  const workflow = new Workflow({ client: { completeJson: async request => { requests.push(request); return fakeResponse(fakeModelData(request)); } } });
  const session = workflow.create(syntheticSubmission());
  const review = await workflow.review(session.id);
  assert.equal((await workflow.review(session.id)).cached, true);
  const analysis = await workflow.analyze(session.id);
  assert.equal(analysis.analysis.selected_candidate_id, review.review.recommended_candidate_id);
  assert.equal((await workflow.analyze(session.id)).cached, true);
  assert.equal(requests.length, 2);
  assert.ok(!('context' in (requests[0]!.payload as Record<string, unknown>)));
  assert.ok('context' in (requests[1]!.payload as Record<string, unknown>));
  assert.ok(!JSON.stringify(requests[0]!.payload).includes('civilTimes'));
});

test('server session snapshots cannot be replaced by edited client-returned candidate data', async () => {
  const workflow = new Workflow({ client: { completeJson: async request => fakeResponse(fakeModelData(request)) } });
  const session = workflow.create(syntheticSubmission());
  const actualId = session.candidateSet.candidates[0]!.id;
  session.candidateSet.candidates[0]!.id = 'forged';
  const review = await workflow.review(session.id);
  assert.equal(review.review.recommended_candidate_id, actualId);
  await assert.rejects(workflow.analyze(session.id, 'forged'), /本次计算的候选盘/);
});

test('model reference whitelist includes only known facts and excludes unknown and inapplicable answers', async () => {
  const workflow = new Workflow({ client: { completeJson: async request => {
    const payload = request.payload as { referenceable_evidence_ids: string[]; evidence: { id: string; informationStatus: string }[]; context?: { id: string; informationStatus: string }[] };
    const all = [...payload.evidence, ...(payload.context ?? [])];
    assert.deepEqual(payload.referenceable_evidence_ids, all.filter(item => item.informationStatus === 'known').map(item => item.id));
    assert.ok(!payload.referenceable_evidence_ids.includes('B1_hair_whorl'));
    assert.ok(!payload.referenceable_evidence_ids.includes('C8_childbearing_years'));
    assert.match(request.system, /referenceable_evidence_ids/);
    const data = fakeModelData(request);
    if ('sections' in data) data.sections.push({ domain: '未知背景', text: '没有相关资料。', evidence_ids: [], chart_basis: [], uncertainties: ['未提供相关背景，不能推断。'] });
    return fakeResponse(data);
  } } });
  const session = workflow.create(syntheticSubmission());
  await workflow.review(session.id);
  const analysis = await workflow.analyze(session.id);
  assert.deepEqual(analysis.analysis.sections[1]!.evidence_ids, []);
  workflow.dispose();
});

test('analysis removes unknown or inapplicable references and deduplicates without losing its body', async () => {
  for (const ids of [['B1_hair_whorl'], ['C8_childbearing_years'], ['C1_major_turning_years', 'C1_major_turning_years']]) {
    const workflow = new Workflow({ client: { completeJson: async request => {
      const data = fakeModelData(request);
      if ('sections' in data) data.sections[0]!.evidence_ids = ids;
      return fakeResponse(data);
    } } });
    const session = workflow.create(syntheticSubmission());
    await workflow.review(session.id);
    const result = await workflow.analyze(session.id);
    assert.equal(result.analysis.sections[0]!.text, '已知经历来自用户测试输入。');
    assert.deepEqual(result.analysis.sections[0]!.evidence_ids, ids[0] === 'C1_major_turning_years' ? ['C1_major_turning_years'] : []);
    assert.ok(result.analysis.reportWarnings!.length > 0);
    workflow.dispose();
  }
});

test('unknown-only evidence still permits two provisional chart-only model calls and caching', async () => {
  let calls = 0;
  const workflow = new Workflow({ client: { completeJson: async request => { calls++; return fakeResponse(fakeModelData(request)); } } });
  const submission = syntheticSubmission();
  for (const id of Object.keys(submission.answers.responses)) {
    if (submission.answers.responses[id]!.status !== 'not_applicable') submission.answers.responses[id] = { status: 'unknown' };
  }
  const session = workflow.create(submission);
  const review = await workflow.review(session.id);
  assert.equal(review.review.status, 'provisional');
  assert.equal(review.review.evidence_mode, 'chart_only');
  const analysis = await workflow.analyze(session.id);
  assert.equal(analysis.analysis.evidence_mode, 'chart_only');
  assert.deepEqual(analysis.analysis.sections[0]!.evidence_ids, []);
  assert.equal((await workflow.review(session.id)).cached, true);
  assert.equal((await workflow.analyze(session.id)).cached, true);
  assert.equal(calls, 2);
  workflow.dispose();
});

test('lunar birth dates are converted before Gregorian questionnaire date validation', () => {
  const workflow = new Workflow();
  const submission = syntheticSubmission();
  submission.birth.calendar = 'lunar'; submission.birth.date = '2000-02-30';
  const session = workflow.create(submission);
  assert.equal(session.candidateSet.candidates[0]!.features.solarDate, '2000-04-04');
});

test('hallucinated and missing candidates are still rejected', async () => {
  for (const mutation of ['candidate', 'missing', 'duplicate', 'alternative']) {
    const workflow = new Workflow({ client: { completeJson: async request => {
      const data = fakeModelData(request);
      if (!('ranking' in data)) throw new Error('wrong task');
      if (mutation === 'candidate') data.recommended_candidate_id = 'made-up';
      if (mutation === 'missing') data.ranking.pop();
      if (mutation === 'duplicate') data.ranking[1]!.candidate_id = data.ranking[0]!.candidate_id;
      if (mutation === 'alternative') data.alternatives = ['made-up'];
      return fakeResponse(data);
    } } });
    await assert.rejects(workflow.review(workflow.create(syntheticSubmission()).id), /模型报告缺少必要正文或候选身份不一致/);
    workflow.dispose();
  }
});

test('a legacy ambiguous response derives a transparent provisional choice from its complete ranking', async () => {
  const workflow = new Workflow({ client: { completeJson: async request => {
    const data = fakeModelData(request);
    if ('ranking' in data) { data.status = 'ambiguous'; data.recommended_candidate_id = null; }
    return fakeResponse(data);
  } } });
  const session = workflow.create(syntheticSubmission());
  const result = await workflow.review(session.id);
  assert.equal(result.review.recommended_candidate_id, result.review.ranking[0]!.candidate_id);
  assert.equal(result.review.status, 'provisional');
  assert.equal(result.review.selection_source, 'ranked_fallback');
  assert.ok(result.review.reportWarnings!.some(message => message.includes('模型未明确选择')));
  assert.equal((await workflow.analyze(session.id)).analysis.selected_candidate_id, result.review.recommended_candidate_id);
  const selected = session.candidateSet.candidates[1]!.id;
  assert.equal((await workflow.analyze(session.id, selected)).analysis.selected_candidate_id, selected);
});

test('analysis cannot run before review or switch the selected chart in model output', async () => {
  const workflow = new Workflow({ client: { completeJson: async request => {
    const data = fakeModelData(request);
    if ('selected_candidate_id' in data) data.selected_candidate_id = 'forged';
    return fakeResponse(data);
  } } });
  const session = workflow.create(syntheticSubmission());
  await assert.rejects(workflow.analyze(session.id), /先完成候选盘复核/);
  await workflow.review(session.id);
  await assert.rejects(workflow.analyze(session.id), /模型报告缺少必要正文或候选身份不一致/);
});

test('deleted and expired sessions cannot be used again', async () => {
  let now = Date.parse('2026-10-28T12:00:00Z');
  const workflow = new Workflow({ now: () => now });
  const a = workflow.create(syntheticSubmission()); workflow.delete(a.id);
  await assert.rejects(workflow.review(a.id), /已清除或过期/);
  const b = workflow.create(syntheticSubmission()); now += runtime.session_ttl_ms + 1;
  await assert.rejects(workflow.review(b.id), /已清除或过期/);
});

test('concurrent duplicate calls are blocked and a deleted pending result is discarded', async () => {
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const workflow = new Workflow({ client: { completeJson: async request => { await waiting; return fakeResponse(fakeModelData(request)); } } });
  const session = workflow.create(syntheticSubmission());
  const pending = workflow.review(session.id);
  await assert.rejects(workflow.review(session.id), /正在校盘/);
  workflow.delete(session.id); finish();
  await assert.rejects(pending, /本次结果未保存/);
});

test('secrets and client-supplied chart injection are rejected before model invocation', () => {
  const workflow = new Workflow();
  const secret = syntheticSubmission();
  secret.answers.responses.D1_growth_location = { status: 'answered', value: 'sk-' + 'a'.repeat(40) };
  assert.throws(() => workflow.create(secret), /移除资料中的密钥/);
  assert.throws(() => workflow.create({ ...syntheticSubmission(), candidateSet: {} }), /未支持的字段/);
});

test('analysis receives a frozen cutoff and removes nonexistent chart references with an explicit warning', async () => {
  const requests: DeepSeekRequest[] = [];
  const workflow = new Workflow({ now: () => Date.parse('2026-10-28T12:00:00Z'), client: { completeJson: async request => {
    requests.push(request); const data = fakeModelData(request);
    if ('sections' in data) data.sections[0]!.chart_basis = ['features.inventedFortune'];
    return fakeResponse(data);
  } } });
  const session = workflow.create(syntheticSubmission());
  assert.equal(session.asOfDate, '2026-10-28');
  await workflow.review(session.id);
  const result = await workflow.analyze(session.id);
  assert.deepEqual(result.analysis.sections[0]!.chart_basis, []);
  assert.equal(result.analysis.sections[0]!.text, '已知经历来自用户测试输入。');
  assert.ok(result.analysis.reportWarnings!.some(message => message.includes('盘内字段引用')));
  assert.equal((requests[0]!.payload as { as_of_date: string }).as_of_date, session.asOfDate);
  assert.equal((requests[1]!.payload as { as_of_date: string }).as_of_date, session.asOfDate);
});

test('idle sessions are removed by their expiry timer without another request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workflow = new Workflow({ now: () => Date.parse('2026-10-28T12:00:00Z') });
  const session = workflow.create(syntheticSubmission());
  t.mock.timers.tick(runtime.session_ttl_ms + 1);
  await assert.rejects(workflow.review(session.id), /已清除或过期/);
  workflow.dispose();
});

test('product intake rejects dates outside the questionnaire-supported range', () => {
  const workflow = new Workflow({ now: () => Date.parse('2026-10-28T12:00:00Z') });
  for (const date of ['1899-06-15', '2027-06-15']) {
    const submission = syntheticSubmission(); submission.birth.date = date;
    assert.throws(() => workflow.create(submission), /1900 年至今天/);
  }
});

test('birth-only single-candidate intake completes both genuine-client stages with a birth-input selection', async () => {
  const requests: DeepSeekRequest[] = [];
  const workflow = new Workflow({ client: { completeJson: async request => {
    requests.push(request);
    const data = fakeModelData(request);
    if ('ranking' in data) { data.status = 'insufficient_evidence'; data.recommended_candidate_id = null; }
    return fakeResponse(data);
  } } });
  const birth = { ...syntheticSubmission().birth, timeMode: 'exact' as const, time: '10:00' };
  delete birth.startTime; delete birth.endTime;
  const session = workflow.create({ birth });
  assert.equal(session.candidateSet.candidates.length, 1);
  assert.ok([...session.evidence, ...session.context].every(item => item.informationStatus === 'unknown'));
  const review = await workflow.review(session.id);
  assert.equal(review.review.selection_source, 'birth_input');
  assert.equal(review.review.recommended_candidate_id, session.candidateSet.candidates[0]!.id);
  assert.equal(review.review.status, 'provisional');
  const analysis = await workflow.analyze(session.id);
  assert.equal(analysis.analysis.selected_candidate_id, review.review.recommended_candidate_id);
  assert.equal(analysis.analysis.evidence_mode, 'chart_only');
  assert.ok(analysis.analysis.sections[0]!.text.length > 0);
  assert.equal((requests[1]!.payload as { selected_by: string }).selected_by, 'birth_input');
  assert.equal((await workflow.review(session.id)).cached, true);
  assert.equal((await workflow.analyze(session.id)).cached, true);
  assert.equal(requests.length, 2);
  workflow.dispose();
});

test('birth-only multiple candidates retain full coverage and a provisional choice permits analysis', async () => {
  const requests: DeepSeekRequest[] = [];
  const workflow = new Workflow({ client: { completeJson: async request => {
    requests.push(request); const data = fakeModelData(request);
    if ('ranking' in data) { data.status = 'insufficient_evidence'; data.recommended_candidate_id = null; }
    return fakeResponse(data);
  } } });
  const session = workflow.create({ birth: syntheticSubmission().birth });
  const review = await workflow.review(session.id);
  assert.ok(session.candidateSet.candidates.length > 1);
  assert.equal(review.review.ranking.length, session.candidateSet.candidates.length);
  assert.equal(review.review.selection_source, 'ranked_fallback');
  const analysis = await workflow.analyze(session.id);
  assert.equal(analysis.analysis.selected_candidate_id, review.review.ranking[0]!.candidate_id);
  assert.equal((requests[1]!.payload as { selected_by: string }).selected_by, 'ranked_fallback');
  assert.equal(requests.length, 2);
  workflow.dispose();
});

test('partial background is available for personalized analysis without requiring rectification evidence', async () => {
  const requests: DeepSeekRequest[] = [];
  const workflow = new Workflow({ client: { completeJson: async request => { requests.push(request); return fakeResponse(fakeModelData(request)); } } });
  const answers = { responses: { D3_family_support_style: { status: 'answered', value: 'limited_support' } } };
  const session = workflow.create({ birth: syntheticSubmission().birth, answers });
  assert.equal((await workflow.review(session.id)).review.evidence_mode, 'chart_only');
  assert.equal((await workflow.analyze(session.id)).analysis.evidence_mode, 'context_supported');
  const analysisPayload = requests[1]!.payload as { referenceable_evidence_ids: string[]; context: { id: string; answer: unknown }[] };
  assert.deepEqual(analysisPayload.referenceable_evidence_ids, ['D3_family_support_style']);
  assert.deepEqual(analysisPayload.context.find(item => item.id === 'D3_family_support_style')!.answer, answers.responses.D3_family_support_style);
  workflow.dispose();
});

test('missing optional report arrays and harmless extra fields do not discard substantive model text', async () => {
  const workflow = new Workflow({ client: { completeJson: async request => {
    const data = fakeModelData(request) as unknown as Record<string, unknown>;
    if ('ranking' in data) {
      delete data.alternatives; delete data.limits;
      for (const row of data.ranking as Record<string, unknown>[]) { delete row.supporting_evidence_ids; delete row.contradicting_evidence_ids; delete row.unresolved_questions; }
    } else {
      delete data.scenarios; delete data.limitations;
      const section = (data.sections as Record<string, unknown>[])[0]!;
      delete section.evidence_ids; delete section.chart_basis; delete section.uncertainties;
      section.explanation_note = '合成额外字段';
    }
    return fakeResponse(data);
  } } });
  const session = workflow.create({ birth: syntheticSubmission().birth });
  const reviewed = await workflow.review(session.id);
  assert.deepEqual(reviewed.review.ranking[0]!.supporting_evidence_ids, []);
  const { analysis } = await workflow.analyze(session.id);
  assert.equal(analysis.sections[0]!.text, '合成命盘条件性分析，没有已知个人背景。');
  assert.deepEqual(analysis.sections[0]!.evidence_ids, []);
  assert.deepEqual(analysis.sections[0]!.uncertainties, []);
  assert.ok(analysis.reportWarnings!.length > 0);
  assert.equal('explanation_note' in analysis.sections[0]!, false);
  workflow.dispose();
});

test('review citation repair preserves original rationale and transparently downgrades unsupported recommendation', async () => {
  const workflow = new Workflow({ client: { completeJson: async request => {
    const data = fakeModelData(request);
    if ('ranking' in data) {
      data.ranking[0]!.supporting_evidence_ids = ['B1_hair_whorl', 'made-up-evidence'];
      data.ranking[1]!.supporting_evidence_ids = ['C1_major_turning_years', 'C1_major_turning_years'];
    }
    return fakeResponse(data);
  } } });
  const session = workflow.create(syntheticSubmission());
  const { review } = await workflow.review(session.id);
  assert.equal(review.status, 'provisional');
  assert.deepEqual(review.ranking[0]!.supporting_evidence_ids, []);
  assert.deepEqual(review.ranking[1]!.supporting_evidence_ids, ['C1_major_turning_years']);
  assert.equal(review.ranking[0]!.rationale, '受控假客户端只验证契约，不代表真实判断。');
  assert.ok(review.reportWarnings!.some(message => message.includes('剔除')));
  workflow.dispose();
});

test('genuine model body or identity failures preserve safe attempt usage and never fabricate a report', async () => {
  for (const stage of ['review', 'analysis'] as const) {
    const workflow = new Workflow({ client: { completeJson: async request => {
      const data = fakeModelData(request);
      if ('ranking' in data && stage === 'review') data.summary = '';
      if ('sections' in data && stage === 'analysis') { data.overview = ''; data.sections[0]!.text = 'PRIVATE_BODY_SENTINEL'; }
      return fakeResponse(data);
    } } });
    const session = workflow.create({ birth: syntheticSubmission().birth });
    if (stage === 'analysis') await workflow.review(session.id);
    await assert.rejects(stage === 'review' ? workflow.review(session.id) : workflow.analyze(session.id), error => {
      const failure = error as { code: string; modelAttempt: { stage: string; usage: unknown; model: string; durationMs: number } };
      assert.equal(failure.code, 'INVALID_MODEL_OUTPUT');
      assert.equal(failure.modelAttempt.stage, stage);
      assert.deepEqual(failure.modelAttempt.usage, { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
      assert.deepEqual(Object.keys(failure.modelAttempt).sort(), ['durationMs', 'model', 'stage', 'usage']);
      assert.equal(JSON.stringify(failure).includes('PRIVATE_BODY_SENTINEL'), false);
      return true;
    });
    workflow.dispose();
  }
});

test('birth remains mandatory and optional questionnaire values are still validated', () => {
  const workflow = new Workflow();
  assert.throws(() => workflow.create({ answers: {} }), /出生资料/);
  assert.throws(() => workflow.create({ birth: syntheticSubmission().birth, answers: { responses: { B1_hair_whorl: { status: 'answered', value: 'invalid' } } } }), /无效值/);
  workflow.dispose();
});
