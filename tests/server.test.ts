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

test('localhost server rejects cross-site writes, invalid content, and private file requests', async () => {
  const app = await running(new Workflow());
  try {
    const status = await fetch(app.base + '/api/status'); assert.equal(status.status, 200);
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
