import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { generateCandidateCharts } from '../src/chartEngine.ts';
import { createDeepSeekClient, DeepSeekError, getDeepSeekStatus, type DeepSeekResult } from '../src/deepseek.ts';
import { getQuestionnaire, normalizeAnswers } from '../src/questionnaire.ts';
import { runtime } from '../src/runtime.ts';
import { sha256Hex } from '../src/sha256.ts';
import { Workflow } from '../src/workflow.ts';
import { fakeModelData, fakeResponse, syntheticSubmission } from './fixtures.ts';

function withProcess<T>(value: unknown, action: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')!;
  Object.defineProperty(globalThis, 'process', { configurable: true, writable: true, value });
  try { return action(); }
  finally { Object.defineProperty(globalThis, 'process', descriptor); }
}

test('portable SHA-256 preserves UTF-8 hashes and existing chart identifiers', () => {
  for (const text of ['', 'abc', '庚辰|壬午|甲辰|己巳', '出生时间🌏']) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'));
  }
  const charts = generateCandidateCharts(syntheticSubmission().birth);
  for (const chart of charts.candidates) {
    const key = [chart.pillars.year, chart.pillars.month, chart.pillars.day, chart.pillars.hour].join('|');
    assert.equal(chart.id, 'chart-' + createHash('sha256').update(key).digest('hex').slice(0, 16));
  }
});

test('static JSON config imports keep optional intake and runtime limits usable', () => {
  const questionnaire = getQuestionnaire();
  assert.equal(questionnaire.sections.flatMap(section => section.questions).length, 27);
  assert.equal(Object.keys(normalizeAnswers().responses).length, 27);
  assert.equal(runtime.review_max_output_tokens, 8192);
  assert.equal(runtime.analysis_max_output_tokens, 8192);
  questionnaire.sections.length = 0;
  assert.equal(getQuestionnaire().sections.length, 2);
});

test('no process global is required and a browser without a visitor key never calls fetch', async () => {
  let calls = 0;
  const attempt = withProcess(undefined, () => {
    assert.equal(getDeepSeekStatus().configured, false);
    return createDeepSeekClient({ fetchImpl: async () => { calls++; throw new Error('must not fetch'); } })
      .completeJson({ system: 'Return JSON.', payload: {} });
  });
  await assert.rejects(attempt, error => error instanceof DeepSeekError && error.code === 'NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('an explicit empty environment never reads or inherits a Node environment key', async () => {
  let environmentReads = 0;
  const fakeNode = { versions: { node: 'test' }, get env() { environmentReads++; throw new Error('environment must not be read'); } };
  const attempt = withProcess(fakeNode, () => {
    assert.equal(getDeepSeekStatus({}).configured, false);
    return createDeepSeekClient({ env: {} }).completeJson({ system: 'Return JSON.', payload: {} });
  });
  await assert.rejects(attempt, error => error instanceof DeepSeekError && error.code === 'NOT_CONFIGURED');
  assert.equal(environmentReads, 0);
});

test('Node fallback stays available while a visitor environment is used without process', async () => {
  const syntheticEnvironment = { DEEPSEEK_API_KEY: 'synthetic-browser-key' };
  withProcess({ versions: { node: 'test' }, env: syntheticEnvironment }, () => assert.equal(getDeepSeekStatus().configured, true));
  let attempt: Promise<DeepSeekResult>;
  let calls = 0;
  attempt = withProcess(undefined, () => createDeepSeekClient({ env: syntheticEnvironment, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-browser-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.reasoning_effort, 'medium');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }));
  } }).completeJson({ system: 'Return JSON.', payload: {} }));
  assert.deepEqual((await attempt).data, { ok: true });
  assert.equal(calls, 1);
});

test('workflow accepts browser numeric timers, global crypto, and caches both model stages', async () => {
  const timeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout')!;
  const clearDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout')!;
  let callback: (() => void) | undefined;
  let calls = 0;
  let cleared = false;
  const workflow = new Workflow({ client: { completeJson: async request => { calls++; return fakeResponse(fakeModelData(request)); } } });
  let id = '';
  try {
    Object.defineProperty(globalThis, 'setTimeout', { configurable: true, writable: true, value: (handler: () => void) => { callback = handler; return 123; } });
    Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, writable: true, value: (timer: unknown) => { assert.equal(timer, 123); cleared = true; } });
    const session = workflow.create({ birth: syntheticSubmission().birth });
    id = session.id;
    assert.match(id, /^[a-f0-9-]{36}$/);
    await workflow.review(id);
    await workflow.analyze(id);
    assert.equal((await workflow.review(id)).cached, true);
    assert.equal((await workflow.analyze(id)).cached, true);
    assert.equal(calls, 2);
    callback!();
    assert.equal(cleared, true);
    await assert.rejects(workflow.review(id), { code: 'SESSION_EXPIRED' });
  } finally {
    workflow.dispose();
    Object.defineProperty(globalThis, 'setTimeout', timeoutDescriptor);
    Object.defineProperty(globalThis, 'clearTimeout', clearDescriptor);
  }
});
