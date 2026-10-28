import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf("$('browser-key-form').addEventListener('submit',");
const end = source.indexOf("$('clear-browser-key').addEventListener", start);
assert.ok(start >= 0 && end > start, 'the actual key-submit registration must be present');
const keyRegistration = source.slice(start, end);

function harness() {
  let submit!: (event: { preventDefault(): void }) => Promise<void>;
  let resolveAdapter!: (value: { setApiKey(value: string): void }) => void;
  let rejectAdapter!: (error: Error) => void;
  const loading = new Promise<{ setApiKey(value: string): void }>((resolve, reject) => { resolveAdapter = resolve; rejectAdapter = reject; });
  const input = { value: 'synthetic-visitor-key-for-lifecycle-test' };
  const state = { busy: null, keyBusy: false, configured: false, keyVerified: false, lifecycle: 0 };
  const savedKeys: string[] = [], statusMessages: string[] = [], uiWrites: string[] = [];
  const adapter = { setApiKey(value: string) { savedKeys.push(value); } };
  const sandbox = {
    browserRuntime: true,
    state,
    $: (id: string) => {
      if (id === 'browser-api-key') return input;
      if (id === 'browser-key-form') return { addEventListener(event: string, handler: typeof submit) { assert.equal(event, 'submit'); submit = handler; } };
      throw new Error('unexpected DOM access: ' + id);
    },
    getBrowserAdapter: () => loading,
    updateActions: () => { uiWrites.push('actions'); },
    clearResults: () => { state.lifecycle++; uiWrites.push('clear-results'); },
    clearError: () => { uiWrites.push('clear-error'); },
    announce: () => { uiWrites.push('announce'); },
    keyStatus: (_kind: string, message: string) => { statusMessages.push(message); uiWrites.push('key-status'); },
    refreshStatus: async () => { state.configured = savedKeys.length > 0; uiWrites.push('refresh-status'); },
  };
  runInNewContext(keyRegistration, sandbox, { filename: 'public/app.js:key-submit' });
  return {
    state, input, savedKeys, statusMessages, uiWrites,
    submit: () => submit({ preventDefault() {} }),
    finishLoading: () => resolveAdapter(adapter),
    failLoading: () => rejectAdapter(new Error('synthetic module-loading failure')),
    pagehide: () => {
      // Match the lifecycle invalidation and credential-state clearing in the pagehide handler.
      state.lifecycle++; state.configured = false; state.keyVerified = false; state.keyBusy = false; input.value = '';
    },
  };
}

test('a delayed key submission cannot restore credentials or UI state after pagehide', async () => {
  const app = harness(), pending = app.submit();
  assert.equal(app.input.value, '');
  assert.equal(app.state.keyBusy, true);
  app.pagehide();
  const before = { ...app.state }, writes = app.uiWrites.length;
  app.finishLoading();
  await pending;
  assert.deepEqual(app.savedKeys, []);
  assert.deepEqual(app.state, before);
  assert.equal(app.uiWrites.length, writes);
  assert.deepEqual(app.statusMessages, []);
  assert.doesNotMatch(JSON.stringify({ state: app.state, messages: app.statusMessages, input: app.input }), /synthetic-visitor-key/);
});

test('a stale module-loading failure does not restore an error or busy state after pagehide', async () => {
  const app = harness(), pending = app.submit();
  app.pagehide();
  const writes = app.uiWrites.length;
  app.failLoading();
  await pending;
  assert.equal(app.state.keyBusy, false);
  assert.equal(app.state.configured, false);
  assert.equal(app.uiWrites.length, writes);
  assert.deepEqual(app.statusMessages, []);
  assert.deepEqual(app.savedKeys, []);
});

test('a current key submission still saves once and refreshes status after clearing old results', async () => {
  const app = harness(), pending = app.submit();
  app.finishLoading();
  await pending;
  assert.deepEqual(app.savedKeys, ['synthetic-visitor-key-for-lifecycle-test']);
  assert.equal(app.input.value, '');
  assert.equal(app.state.lifecycle, 1);
  assert.equal(app.state.configured, true);
  assert.equal(app.state.keyBusy, false);
  assert.equal(app.uiWrites.filter(value => value === 'clear-results').length, 1);
  assert.equal(app.uiWrites.filter(value => value === 'refresh-status').length, 1);
  assert.equal(app.statusMessages.length, 1);
  assert.match(app.statusMessages[0]!, /尚未连接验证/);
  assert.doesNotMatch(JSON.stringify(app.statusMessages), /synthetic-visitor-key/);
});
