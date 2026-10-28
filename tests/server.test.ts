import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';
import { Workflow } from '../src/workflow.ts';
import { createDeepSeekClient } from '../src/deepseek.ts';
import { syntheticSubmission, fakeModelData, fakeResponse } from './fixtures.ts';

async function running(workflow: Workflow) {
  const server = createApp({ workflow, providerStatus: () => ({ configured: false, provider: 'deepseek', model: 'deepseek-flash' }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}

test('HTTP workflow uses the stored session and returns actual provider metadata', async () => {
  const app = await running(new Workflow({ client: { completeJson: async request => fakeResponse(fakeModelData(request)) } }));
  const post = (path: string, body: unknown) => fetch(app.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const create = await post('/api/session', syntheticSubmission()); assert.equal(create.status, 201);
    const session = await create.json() as { id: string };
    const review = await post('/api/review', { sessionId: session.id }); assert.equal(review.status, 200);
    assert.equal((await review.json() as { model: string }).model, 'deepseek-flash');
    const analysis = await post('/api/analysis', { sessionId: session.id }); assert.equal(analysis.status, 200);
    const illegal = await post('/api/review', { sessionId: session.id, ranking: [] }); assert.equal(illegal.status, 400);
  } finally { await app.close(); }
});

test('missing credentials is an explicit error rather than a mock result', async () => {
  const app = await running(new Workflow({ client: createDeepSeekClient({ env: {} }) }));
  try {
    const created = await fetch(app.base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(syntheticSubmission()) });
    const { id } = await created.json() as { id: string };
    const response = await fetch(app.base + '/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: id }) });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /DEEPSEEK_NOT_CONFIGURED/);
  } finally { await app.close(); }
});

test('birth-only HTTP intake supports a single working chart and substantive analysis without questionnaire facts', async () => {
  let calls = 0;
  const app = await running(new Workflow({ client: { completeJson: async request => { calls++; return fakeResponse(fakeModelData(request)); } } }));
  const post = (path: string, body: unknown) => fetch(app.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const { startTime: _start, endTime: _end, ...birth } = syntheticSubmission().birth;
    const create = await post('/api/session', { birth: { ...birth, timeMode: 'exact', time: '09:30' } });
    assert.equal(create.status, 201);
    const session = await create.json() as { id: string; candidateSet: { candidates: { id: string }[] } };
    assert.equal(session.candidateSet.candidates.length, 1);
    const reviewResponse = await post('/api/review', { sessionId: session.id }); assert.equal(reviewResponse.status, 200);
    const { review } = await reviewResponse.json() as { review: { evidence_mode: string; recommended_candidate_id: string; selection_source: string } };
    assert.equal(review.evidence_mode, 'chart_only');
    assert.equal(review.selection_source, 'birth_input');
    assert.equal(review.recommended_candidate_id, session.candidateSet.candidates[0]!.id);
    const analysisResponse = await post('/api/analysis', { sessionId: session.id }); assert.equal(analysisResponse.status, 200);
    const { analysis } = await analysisResponse.json() as { analysis: { evidence_mode: string; sections: { text: string }[] } };
    assert.equal(analysis.evidence_mode, 'chart_only');
    assert.ok(analysis.sections[0]!.text.length > 0);
    await post('/api/analysis', { sessionId: session.id });
    assert.equal(calls, 2);
  } finally { await app.close(); }
});

test('a paid response with a critical output error exposes usage but never raw model content', async () => {
  const app = await running(new Workflow({ client: { completeJson: async () => fakeResponse({ privateRawText: 'PRIVATE_MODEL_RESPONSE_SENTINEL' }) } }));
  const post = (path: string, body: unknown) => fetch(app.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const create = await post('/api/session', syntheticSubmission());
    const { id } = await create.json() as { id: string };
    const response = await post('/api/review', { sessionId: id });
    assert.equal(response.status, 502);
    const raw = await response.text();
    assert.doesNotMatch(raw, /PRIVATE_MODEL_RESPONSE_SENTINEL|privateRawText|synthetic-request/);
    const result = JSON.parse(raw);
    assert.equal(result.error.code, 'INVALID_MODEL_OUTPUT');
    assert.deepEqual(result.error.modelAttempt, {
      stage: 'review', model: 'deepseek-flash', durationMs: 1,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
  } finally { await app.close(); }
});

test('localhost server rejects cross-site writes, invalid content, and private file requests', async () => {
  const app = await running(new Workflow());
  try {
    const status = await fetch(app.base + '/api/status'); assert.equal(status.status, 200);
    const statusData = await status.json() as { version: string; billing: string; questionnaire: string };
    assert.equal(statusData.version, '0.3.0');
    assert.equal(statusData.billing, 'server_operator_key');
    assert.equal(statusData.questionnaire, 'optional');
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.match(status.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    const crossSite = await fetch(app.base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' });
    assert.equal(crossSite.status, 403);
    const text = await fetch(app.base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(text.status, 415);
    const invalid = await fetch(app.base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400);
    assert.equal((await fetch(app.base + '/.env')).status, 404);
    assert.equal((await fetch(app.base + '/src/server.ts')).status, 404);
  } finally { await app.close(); }
});
