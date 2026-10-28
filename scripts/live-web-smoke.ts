import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { syntheticSubmission } from '../tests/fixtures.ts';

// Runs the exact browser bundle in Node with invented inputs; not a browser-UI test.
const key = process.env.DEEPSEEK_API_KEY?.trim();
if (!key) { console.error('LIVE_NOT_RUN: configure a local test credential.'); process.exitCode = 1; }
else {
  const bundleUrl = new URL('../dist/browser.js', import.meta.url);
  const bundle = await readFile(bundleUrl, 'utf8');
  assert.equal(bundle.includes(key), false, 'A credential must never be embedded in the browser bundle.');
  const { createBrowserRuntime } = await import(bundleUrl.href);
  let attempts = 0;
  const traces: unknown[] = [];
  const origin = 'https://www.theodoreoy.com';
  const app = createBrowserRuntime({ fetchImpl: async (url: string, init: RequestInit) => {
    assert.ok(attempts < 2, 'At most two provider attempts per invocation.');
    attempts++;
    const headers = new Headers(init.headers); headers.set('Origin', origin);
    const response = await fetch(url, { ...init, headers });
    const cors = response.headers.get('access-control-allow-origin');
    assert.ok(cors === origin || cors === '*', 'The authenticated response must allow the public app origin.');
    return response;
  } });
  try {
    app.setApiKey(key);
    const { startTime: _start, endTime: _end, ...birth } = syntheticSubmission().birth;
    const session = await app.api('/api/session', 'POST', { birth: { ...birth, timeMode: 'exact', time: '09:30' } });
    for (const stage of ['review', 'analysis']) {
      const result = await app.api('/api/' + stage, 'POST', { sessionId: session.id });
      traces.push({ stage, model: result.model, providerModel: result.providerModel, usage: result.usage, durationMs: result.durationMs, evidenceMode: result[stage].evidence_mode, ...(stage === 'analysis' ? { sections: result.analysis.sections.length } : {}) });
      console.log(JSON.stringify({ event: 'completed_stage', ...traces.at(-1) as object }));
    }
    assert.equal((await app.api('/api/review', 'POST', { sessionId: session.id })).cached, true);
    assert.equal((await app.api('/api/analysis', 'POST', { sessionId: session.id })).cached, true);
    assert.equal(attempts, 2);
    console.log(JSON.stringify({ status: 'passed', artifact: 'dist/browser.js', execution: 'Node with public Origin header, not browser UI', thinking: 'medium', attempts, traces, cachedRepeatsAvoidedCalls: true }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', attempts, traces, code: error && typeof error === 'object' && 'code' in error ? error.code : 'WEB_LIVE_CHECK_FAILED' }));
    process.exitCode = 1;
  } finally { app.clearApiKey(); }
}
