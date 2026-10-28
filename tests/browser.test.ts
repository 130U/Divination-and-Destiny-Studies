import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserRuntime } from '../src/browser.ts';
import { DEEPSEEK_ENDPOINT, type DeepSeekRequest } from '../src/deepseek.ts';
import { syntheticSubmission, fakeModelData } from './fixtures.ts';

function syntheticFetch(seen: Array<{ url: string; authorization: string; credentials?: RequestCredentials; thinking: string }>): typeof fetch {
  return async (url, init) => {
    const request = JSON.parse(String(init!.body));
    seen.push({ url: String(url), authorization: new Headers(init!.headers).get('authorization')!, credentials: init!.credentials, thinking: request.reasoning_effort });
    const payload = JSON.parse(request.messages[1].content);
    const data = fakeModelData({ system: request.messages[0].content, payload } as DeepSeekRequest);
    return new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
  };
}
test('online runtime calculates locally without a key, then uses only the visitor key with two cached model calls', async () => {
  const seen: Parameters<typeof syntheticFetch>[0] = [], app = createBrowserRuntime({ fetchImpl: syntheticFetch(seen) });
  try {
    assert.equal(app.status().configured, false);
    const local = await app.api('/api/session', 'POST', { birth: syntheticSubmission().birth }) as { id: string };
    assert.equal(seen.length, 0);
    await assert.rejects(app.api('/api/review', 'POST', { sessionId: local.id }), { code: 'DEEPSEEK_NOT_CONFIGURED' });
    app.setApiKey('invented-visitor-credential-for-unit-test');
    assert.equal(app.status().verified, false); assert.equal(seen.length, 0);
    await assert.rejects(app.api('/api/review', 'POST', { sessionId: local.id }), { code: 'SESSION_EXPIRED' });
    const session = await app.api('/api/session', 'POST', { birth: syntheticSubmission().birth }) as { id: string };
    const review = await app.api('/api/review', 'POST', { sessionId: session.id }) as { review: { evidence_mode: string } };
    assert.equal(review.review.evidence_mode, 'chart_only'); assert.equal(app.status().verified, true);
    await app.api('/api/analysis', 'POST', { sessionId: session.id });
    await app.api('/api/review', 'POST', { sessionId: session.id });
    await app.api('/api/analysis', 'POST', { sessionId: session.id });
    assert.equal(seen.length, 2);
    for (const call of seen) assert.deepEqual(call, { url: DEEPSEEK_ENDPOINT, authorization: 'Bearer invented-visitor-credential-for-unit-test', credentials: 'omit', thinking: 'medium' });
    assert.doesNotMatch(JSON.stringify(await app.api('/api/status')), /invented-visitor|API_KEY|Bearer/);
  } finally { app.clearApiKey(); }
});
test('two browser instances isolate credentials and clearing a key drops sessions', async () => {
  const aSeen: Parameters<typeof syntheticFetch>[0] = [], bSeen: Parameters<typeof syntheticFetch>[0] = [];
  const a = createBrowserRuntime({ fetchImpl: syntheticFetch(aSeen) }), b = createBrowserRuntime({ fetchImpl: syntheticFetch(bSeen) });
  try {
    a.setApiKey('invented-key-a'); b.setApiKey('invented-key-b');
    for (const app of [a, b]) {
      const session = await app.api('/api/session', 'POST', syntheticSubmission()) as { id: string };
      await app.api('/api/review', 'POST', { sessionId: session.id });
      app.clearApiKey();
      await assert.rejects(app.api('/api/analysis', 'POST', { sessionId: session.id }), { code: 'SESSION_EXPIRED' });
      assert.equal(app.status().configured, false); assert.equal(app.status().verified, false);
    }
    assert.equal(aSeen[0]!.authorization, 'Bearer invented-key-a');
    assert.equal(bSeen[0]!.authorization, 'Bearer invented-key-b');
  } finally { a.clearApiKey(); b.clearApiKey(); }
});
test('clearing a key aborts an in-flight official request and suppresses stale results', async () => {
  let signal: AbortSignal | undefined, started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const app = createBrowserRuntime({ fetchImpl: async (_url, init) => {
    signal = init!.signal!; started();
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('test abort')), { once: true }));
  } });
  app.setApiKey('invented-cancel-test-key');
  const session = await app.api('/api/session', 'POST', syntheticSubmission()) as { id: string };
  const pending = app.api('/api/review', 'POST', { sessionId: session.id });
  await waiting; app.clearApiKey();
  await assert.rejects(pending, { code: 'KEY_CLEARED' }); assert.equal(signal!.aborted, true);
});
test('invalid visitor keys and provider authentication errors never leak credential or raw response', async () => {
  const app = createBrowserRuntime({ fetchImpl: async () => new Response('PRIVATE_PROVIDER_RESPONSE', { status: 401 }) });
  try {
    for (const key of ['', '   ', 'key\nnewline']) assert.throws(() => app.setApiKey(key), { code: 'INVALID_KEY' });
    app.setApiKey('invented-rejected-key');
    const session = await app.api('/api/session', 'POST', syntheticSubmission()) as { id: string };
    await assert.rejects(app.api('/api/review', 'POST', { sessionId: session.id }), (error: Error) => {
      assert.match(error.message, /未接受这个 Key/); assert.doesNotMatch(error.message, /PRIVATE_PROVIDER|invented-rejected/); return true;
    });
    assert.equal(app.status().verified, false);
  } finally { app.clearApiKey(); }
});
