import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow } from '../src/workflow.ts';
import { runtime } from '../src/runtime.ts';
import { syntheticSubmission, fakeModelData, fakeResponse } from './fixtures.ts';
import type { DeepSeekRequest } from '../src/deepseek.ts';

test('collect all applicable answers before any model call and retain every local candidate', async () => {
  let calls = 0;
  const workflow = new Workflow({ client: { completeJson: async request => { calls++; return fakeResponse(fakeModelData(request)); } } });
  const bad = syntheticSubmission(); delete bad.answers.responses.D1_growth_location;
  assert.throws(() => workflow.create(bad), /完成所有适用问题/);
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

test('analysis still rejects unknown or inapplicable question IDs and duplicate factual references', async () => {
  for (const ids of [['B1_hair_whorl'], ['C8_childbearing_years'], ['C1_major_turning_years', 'C1_major_turning_years']]) {
    const workflow = new Workflow({ client: { completeJson: async request => {
      const data = fakeModelData(request);
      if ('sections' in data) data.sections[0]!.evidence_ids = ids;
      return fakeResponse(data);
    } } });
    const session = workflow.create(syntheticSubmission());
    await workflow.review(session.id);
    await assert.rejects(workflow.analyze(session.id), /模型返回的结构或依据不完整/);
    workflow.dispose();
  }
});

test('unknown-only evidence avoids a paid request', async () => {
  let calls = 0;
  const workflow = new Workflow({ client: { completeJson: async request => { calls++; return fakeResponse(fakeModelData(request)); } } });
  const submission = syntheticSubmission();
  for (const id of Object.keys(submission.answers.responses)) {
    if (submission.answers.responses[id]!.status !== 'not_applicable') submission.answers.responses[id] = { status: 'unknown' };
  }
  const session = workflow.create(submission);
  await assert.rejects(workflow.review(session.id), /尚无可用事实/);
  assert.equal(calls, 0);
});

test('lunar birth dates are converted before Gregorian questionnaire date validation', () => {
  const workflow = new Workflow();
  const submission = syntheticSubmission();
  submission.birth.calendar = 'lunar'; submission.birth.date = '2000-02-30';
  const session = workflow.create(submission);
  assert.equal(session.candidateSet.candidates[0]!.features.solarDate, '2000-04-04');
});

test('hallucinated candidates, missing candidates, and invented evidence are rejected', async () => {
  for (const mutation of ['candidate', 'missing', 'evidence']) {
    const workflow = new Workflow({ client: { completeJson: async request => {
      const data = fakeModelData(request);
      if (!('ranking' in data)) throw new Error('wrong task');
      if (mutation === 'candidate') data.recommended_candidate_id = 'made-up';
      if (mutation === 'missing') data.ranking.pop();
      if (mutation === 'evidence') data.ranking[0]!.supporting_evidence_ids = ['made-up-evidence'];
      return fakeResponse(data);
    } } });
    await assert.rejects(workflow.review(workflow.create(syntheticSubmission()).id), /模型返回的结构或依据不完整/);
  }
});

test('ambiguous results stay unselected and require an explicit working chart for analysis', async () => {
  const workflow = new Workflow({ client: { completeJson: async request => {
    const data = fakeModelData(request);
    if ('ranking' in data) { data.status = 'ambiguous'; data.recommended_candidate_id = null; }
    return fakeResponse(data);
  } } });
  const session = workflow.create(syntheticSubmission());
  const result = await workflow.review(session.id);
  assert.equal(result.review.recommended_candidate_id, null);
  await assert.rejects(workflow.analyze(session.id), /明确选择/);
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
  await assert.rejects(workflow.analyze(session.id), /模型返回的结构或依据不完整/);
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

test('analysis receives a frozen information cutoff and only accepts real chart field references', async () => {
  const requests: DeepSeekRequest[] = [];
  const workflow = new Workflow({ now: () => Date.parse('2026-10-28T12:00:00Z'), client: { completeJson: async request => {
    requests.push(request); const data = fakeModelData(request);
    if ('sections' in data) data.sections[0]!.chart_basis = ['features.inventedFortune'];
    return fakeResponse(data);
  } } });
  const session = workflow.create(syntheticSubmission());
  assert.equal(session.asOfDate, '2026-10-28');
  await workflow.review(session.id);
  await assert.rejects(workflow.analyze(session.id), /模型返回的结构或依据不完整/);
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
