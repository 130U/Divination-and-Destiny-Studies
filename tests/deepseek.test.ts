import test from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekClient, DEEPSEEK_ENDPOINT, DeepSeekError, getDeepSeekStatus, MAX_DEEPSEEK_OUTPUT_TOKENS } from "../src/deepseek.ts";

const env = { DEEPSEEK_API_KEY: "test-key-only" };
const request = { system: 'Return JSON only. Example: {"ok":true}', payload: { fictional: true } };
function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "request_fixture_1", model: "deepseek-flash",
    choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200, prompt_cache_hit_tokens: 40, completion_tokens_details: { reasoning_tokens: 30 } }, ...overrides };
}
function response(value: unknown = envelope()): Response { return new Response(JSON.stringify(value)); }
function errorCode(code: string, status?: number): (error: unknown) => boolean {
  return (error) => error instanceof DeepSeekError && error.code === code && (status === undefined || error.status === status);
}

test("configuration status contains only safe public fields and never exposes credentials", () => {
  assert.deepEqual(getDeepSeekStatus({}), { configured: false, provider: "deepseek", model: "deepseek-flash" });
  assert.deepEqual(getDeepSeekStatus(env), { configured: true, provider: "deepseek", model: "deepseek-flash" });
  const invalid = getDeepSeekStatus({ ...env, DEEPSEEK_MODEL: "test-key-only" });
  assert.equal(invalid.configured, false);
  assert.equal(JSON.stringify(invalid).includes(env.DEEPSEEK_API_KEY), false);
});

test("unconfigured client explicitly fails without invoking fetch", async () => {
  let called = false;
  const client = createDeepSeekClient({ env: {}, fetchImpl: async () => { called = true; return response(); } });
  await assert.rejects(client.completeJson(request), errorCode("NOT_CONFIGURED"));
  assert.equal(called, false);
});

test("default medium-thinking JSON request uses fixed endpoint, bounded tokens and reads actual usage", async () => {
  let calls = 0;
  const client = createDeepSeekClient({ env, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, DEEPSEEK_ENDPOINT);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key-only");
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.model, "deepseek-flash");
    assert.equal(sent.stream, false);
    assert.deepEqual(sent.response_format, { type: "json_object" });
    assert.deepEqual(sent.thinking, { type: "enabled" });
    assert.equal(sent.reasoning_effort, "medium");
    assert.equal(sent.max_tokens, 4096);
    assert.equal("temperature" in sent, false);
    assert.equal(String(init?.body).includes(env.DEEPSEEK_API_KEY), false);
    assert.deepEqual(JSON.parse(sent.messages[1].content), request.payload);
    return response();
  } });
  const result = await client.completeJson(request);
  assert.equal(calls, 1);
  assert.deepEqual(result.data, { ok: true });
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 80, totalTokens: 200, cachedInputTokens: 40, reasoningTokens: 30 });
  assert.equal(result.model, "deepseek-flash");
  assert.equal(result.requestId, "request_fixture_1");
  assert.ok(result.durationMs >= 0);
});

test("explicit reasoning modes reach the provider unchanged and are configured", async () => {
  for (const thinking of ["low", "medium", "high", "max"] as const) {
    const configuredEnv = { ...env, DEEPSEEK_THINKING: thinking };
    assert.equal(getDeepSeekStatus(configuredEnv).configured, true);
    let calls = 0;
    const client = createDeepSeekClient({ env: configuredEnv, fetchImpl: async (_url, init) => {
      calls++;
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.model, "deepseek-flash");
      assert.deepEqual(sent.thinking, { type: "enabled" });
      assert.equal(sent.reasoning_effort, thinking);
      return response();
    } });
    await client.completeJson(request);
    assert.equal(calls, 1);
  }
});

test("explicit medium option overrides a low environment without downgrading", async () => {
  const client = createDeepSeekClient({ env: { ...env, DEEPSEEK_THINKING: "low" }, thinking: "medium", fetchImpl: async (_url, init) => {
    const sent = JSON.parse(String(init?.body));
    assert.deepEqual(sent.thinking, { type: "enabled" });
    assert.equal(sent.reasoning_effort, "medium");
    return response();
  } });
  await client.completeJson(request);
});

test("disabled thinking omits effort and accepts a lower output budget", async () => {
  const client = createDeepSeekClient({ env: { ...env, DEEPSEEK_MODEL: "deepseek-pro", DEEPSEEK_THINKING: "disabled" }, fetchImpl: async (_url, init) => {
    const sent = JSON.parse(String(init?.body));
    assert.deepEqual(sent.thinking, { type: "disabled" });
    assert.equal("reasoning_effort" in sent, false);
    assert.equal(sent.max_tokens, 512);
    return response();
  } });
  assert.equal((await client.completeJson({ ...request, maxOutputTokens: 512 })).model, "deepseek-pro");
});

test("invalid config and excessive tokens fail before transport", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; return response(); };
  assert.equal(getDeepSeekStatus({ ...env, DEEPSEEK_THINKING: "unbounded" }).configured, false);
  assert.equal(getDeepSeekStatus({ ...env, DEEPSEEK_THINKING: "" }).configured, false);
  await assert.rejects(createDeepSeekClient({ env: { ...env, DEEPSEEK_THINKING: "" }, fetchImpl }).completeJson(request), errorCode("INVALID_CONFIG"));
  await assert.rejects(createDeepSeekClient({ env: { ...env, DEEPSEEK_MODEL: "invalid secret value" }, fetchImpl }).completeJson(request), errorCode("INVALID_CONFIG"));
  await assert.rejects(createDeepSeekClient({ env: { ...env, DEEPSEEK_THINKING: "unbounded" }, fetchImpl }).completeJson(request), errorCode("INVALID_CONFIG"));
  await assert.rejects(createDeepSeekClient({ env, fetchImpl }).completeJson({ ...request, maxOutputTokens: MAX_DEEPSEEK_OUTPUT_TOKENS + 1 }), errorCode("INVALID_REQUEST"));
  await assert.rejects(createDeepSeekClient({ env, fetchImpl }).completeJson({ ...request, system: "Return prose" }), errorCode("INVALID_REQUEST"));
  const circular: Record<string, unknown> = {}; circular.self = circular;
  await assert.rejects(createDeepSeekClient({ env, fetchImpl }).completeJson({ ...request, payload: circular }), errorCode("INVALID_REQUEST"));
  assert.equal(calls, 0);
});

test("401 response is not echoed and is never automatically retried", async () => {
  let calls = 0;
  const client = createDeepSeekClient({ env, fetchImpl: async () => {
    calls++;
    return new Response(`raw provider body ${env.DEEPSEEK_API_KEY} private payload`, { status: 401 });
  } });
  await assert.rejects(client.completeJson(request), (error: unknown) => {
    assert.ok(error instanceof DeepSeekError);
    assert.equal(error.code, "HTTP_ERROR");
    assert.equal(error.status, 401);
    for (const secret of [env.DEEPSEEK_API_KEY, "raw provider body", "private payload"]) {
      assert.equal(String(error).includes(secret), false);
      assert.equal(JSON.stringify(error).includes(secret), false);
    }
    assert.equal("cause" in error, false);
    return true;
  });
  assert.equal(calls, 1);
});

test("network exception details are replaced by a safe error", async () => {
  const client = createDeepSeekClient({ env, fetchImpl: async () => { throw new Error(`Bearer ${env.DEEPSEEK_API_KEY}: private request body`); } });
  await assert.rejects(client.completeJson(request), (error: unknown) => {
    assert.ok(error instanceof DeepSeekError);
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(String(error).includes(env.DEEPSEEK_API_KEY), false);
    assert.equal("cause" in error, false);
    return true;
  });
});

test("timeout covers a stalled fetch even if the injected transport ignores abort", async () => {
  let signal: AbortSignal | null | undefined;
  const client = createDeepSeekClient({ env, timeoutMs: 15, fetchImpl: async (_url, init) => {
    signal = init?.signal;
    return await new Promise<Response>(() => {});
  } });
  await assert.rejects(client.completeJson(request), errorCode("TIMEOUT"));
  assert.equal(signal?.aborted, true);
});

test("timeout remains active while consuming the response body", async () => {
  let signal: AbortSignal | null | undefined;
  const client = createDeepSeekClient({ env, timeoutMs: 15, fetchImpl: async (_url, init) => {
    signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"unfinished":'));
      signal?.addEventListener("abort", () => controller.error(new Error("private body stream error")), { once: true });
    } }));
  } });
  await assert.rejects(client.completeJson(request), errorCode("TIMEOUT"));
  assert.equal(signal?.aborted, true);
});

test("advertised and streamed oversized bodies are rejected", async () => {
  const declared = createDeepSeekClient({ env, maxResponseBytes: 100, fetchImpl: async () => new Response("x", { headers: { "content-length": "101" } }) });
  await assert.rejects(declared.completeJson(request), errorCode("RESPONSE_TOO_LARGE"));
  let cancelled = false;
  const streamed = createDeepSeekClient({ env, maxResponseBytes: 100, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(60)); controller.enqueue(new Uint8Array(60)); },
    cancel() { cancelled = true; }
  })) });
  await assert.rejects(streamed.completeJson(request), errorCode("RESPONSE_TOO_LARGE"));
  assert.equal(cancelled, true);
});

test("truncated, filtered and empty answers are rejected", async () => {
  for (const reason of ["length", "content_filter", null]) {
    const client = createDeepSeekClient({ env, fetchImpl: async () => response(envelope({ choices: [{ finish_reason: reason, message: { content: '{"ok":true}' } }] })) });
    await assert.rejects(client.completeJson(request), errorCode("INCOMPLETE_RESPONSE"));
  }
  for (const content of ["", "   ", null]) {
    const client = createDeepSeekClient({ env, fetchImpl: async () => response(envelope({ choices: [{ finish_reason: "stop", message: { content } }] })) });
    await assert.rejects(client.completeJson(request), errorCode("EMPTY_RESPONSE"));
  }
});

test("invalid JSON, non-object JSON and missing usage are rejected without raw text", async () => {
  for (const content of ["raw private response", "null", "[]", '"text"']) {
    const client = createDeepSeekClient({ env, fetchImpl: async () => response(envelope({ choices: [{ finish_reason: "stop", message: { content } }] })) });
    await assert.rejects(client.completeJson(request), errorCode("INVALID_JSON"));
  }
  const missingUsage = createDeepSeekClient({ env, fetchImpl: async () => response(envelope({ usage: undefined })) });
  await assert.rejects(missingUsage.completeJson(request), errorCode("INVALID_RESPONSE"));
  const invalidBody = createDeepSeekClient({ env, fetchImpl: async () => new Response("raw private response") });
  await assert.rejects(invalidBody.completeJson(request), errorCode("INVALID_RESPONSE"));
});

test("secret-like provider IDs are discarded", async () => {
  const client = createDeepSeekClient({ env, fetchImpl: async () => response(envelope({ id: env.DEEPSEEK_API_KEY })) });
  assert.equal((await client.completeJson(request)).requestId, undefined);
});
