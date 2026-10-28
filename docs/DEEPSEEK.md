# DeepSeek JSON Client and Credential Modes

`src/deepseek.ts` uses native `fetch`. The same client runs in Node.js 24 or a browser without a model SDK. It handles requests and transport validation; the workflow must still validate essential report text, candidate identities, and references. A successful request does not validate a BaZi interpretation.

## Online mode: each visitor supplies a key

In the static online app, `src/browser.ts` creates a workflow in the current tab. Visitors enter their key on an HTTPS page. The key stays in closure memory and is never written to localStorage, sessionStorage, URLs, logs, build files, or exported reports. Replacing or clearing the key, refreshing, or leaving the page clears both the key and sessions. Clearing cancels local waiting and discards late results, but cannot guarantee cancellation of requests or charges already received by the provider.

Setting a key does not call the model. Only an explicit AI action sends a request directly from the browser to the fixed endpoint, `https://api.deepseek.com/chat/completions`. The key is used solely to authenticate that official API request. Requests do not pass through the author's backend or use the author's account; charges accrue to the visitor's DeepSeek account. Browser fetch uses `credentials: "omit"` and `referrerPolicy: "no-referrer"`. Custom endpoints and redirects are not allowed.

Online mode uses `deepseek-flash` + `medium`. The `configured` status means only that a key has been set. `verified` means the current key has received a successful client response. Neither guarantees a remaining balance or success on subsequent requests. Authentication, balance, rate-limit, network, and browser CORS errors are reported explicitly. The app does not retry automatically or switch to an author-operated proxy.

## Local Node mode: server configuration

| Environment variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | Configure only in the server process environment. Never commit it, send it to the browser, log it, or include it in a request payload. |
| `DEEPSEEK_MODEL` | Defaults to `deepseek-flash`. Model identifiers beginning with `deepseek-` are accepted; the provider ultimately determines whether a model is available. |
| `DEEPSEEK_THINKING` | Defaults to `medium`. Supports `low`, `medium`, `high`, `max`, and `disabled`. |

The default combination is `deepseek-flash` + `medium`. As of 2026-10-28, the [official model documentation](https://api-docs.deepseek.com/) states that `deepseek-flash` is served by **DeepSeek-V4.1-Flash-1017**. This is a provider-managed alias and may change with an upstream upgrade. Do not treat the configured name as a permanently pinned model version or invent a snapshot model ID.

The client sends `medium` unchanged. The [official reasoning-effort mapping](https://api-docs.deepseek.com/guides/thinking_mode/) maps a requested value of `medium` to an effective level of `high`. This project does not rewrite the request to `high` or downgrade it to `low`. The four enabled levels and the disabled setting behave as follows:

| Local setting | Requested `reasoning_effort` | Current effective level documented by the provider |
| --- | --- | --- |
| `low` | `low` | `low` |
| `medium` (default) | `medium` | `high` |
| `high` | `high` | `high` |
| `max` | `max` | `max` |
| `disabled` | Not sent | Thinking disabled |

A missing key produces `NOT_CONFIGURED`; a mock response is never substituted for a real result. `getDeepSeekStatus()` returns only `configured`, `provider`, and `model`. It does not establish connectivity or account balance. The online adapter separately maintains `verified`, as described above. If the model identifier is invalid, status uses a safe default model name with `configured=false`, and an actual call explicitly rejects the configuration.

Node mode reads credentials from the process environment, populated either directly or through a local `.env` file loaded at startup. The default environment reader returns an empty object in the browser; the online adapter explicitly supplies the visitor's key. People who clone and run the source use their own configuration. If someone separately shares a Node backend, requests use that operator's key. This differs from the current static online app, where each visitor calls the provider directly. Tests inject fake credentials through `options.env` and do not read real credentials.

## Client contract

```ts
const client = createDeepSeekClient();
const result = await client.completeJson({
  system: 'Return only JSON matching this schema: {"answer": "string"}.',
  payload: { question: "A fictional example" },
  maxOutputTokens: 2048
});
// result: { data, usage, model, providerModel?, requestId?, durationMs }
```

The caller must request JSON in `system` and provide the actual business structure and an example. The client rejects a system prompt that does not contain `json`. `data` is a JSON object that has not yet passed business-schema validation. The client does not return the model's `reasoning_content`. `model` identifies the configured model used for the request. The optional `providerModel` preserves the provider's response label only if it passes format and credential filtering; it is not independent proof of a particular model snapshot.

Business prompt inputs include `referenceable_evidence_ids`, generated by the same function that supplies known-answer IDs to the business validator. Unknown and not-applicable answers cannot be cited as facts. The business layer may normalize minor reference-format issues, deduplicate IDs, or remove unavailable IDs while retaining report text and recording the changes in `reportWarnings`. Candidate-identity errors or missing essential text still cause failure. Entirely blank background answers permit `chart_only` analysis without inventing life events. The transport client does not replace these business checks.

`usage` maps the provider's actual `prompt_tokens`, `completion_tokens`, and `total_tokens`. It optionally records `prompt_cache_hit_tokens` and `completion_tokens_details.reasoning_tokens`. Responses missing required token counts are rejected rather than assigned fabricated zero-cost records. Cached input tokens are a subset of input tokens, and reasoning tokens belong to the corresponding provider accounting field; do not add them again when calculating charges.

Usage shown on the page or in an export describes only the associated model call. It excludes other stages, earlier failures, and retries, and is not a cumulative account bill. A cached result retains the original call's usage and does not make another model request. If a completed provider response fails business validation, the API's `error.modelAttempt` still preserves safe `stage`, `model`, optional `providerModel`, `durationMs`, and `usage` metadata. A failure without available usage must not be treated as free. The system never retries a paid request automatically.

Defaults are a 120-second total timeout, a 1 MiB response limit, and a client output budget of 4096 tokens. A request may lower or raise the budget, up to a fixed ceiling of 8192. The business workflow still consists of one chart review and one analysis; each explicitly uses an 8192-token output limit. Changing the thinking level does not automatically increase that budget. `timeoutMs` covers both response headers and body consumption. `maxResponseBytes` checks both Content-Length and the actual accumulated bytes. The service layer may impose smaller limits. The client does not retry automatically. Failed requests may still incur provider charges; a timeout is not a guarantee of free cancellation.

The endpoint is fixed at `https://api.deepseek.com/chat/completions`. Redirects and user-supplied endpoints are prohibited. JSON mode uses `response_format: {type: "json_object"}`. The `low/medium/high/max` settings all send `thinking: {type: "enabled"}` and pass the selected value unchanged as `reasoning_effort`. The default request therefore includes `reasoning_effort: "medium"`. `disabled` sends `thinking: {type: "disabled"}` and omits the effort parameter. No mode sends temperature.

Only `finish_reason="stop"` is accepted. Empty answers, truncation, other finish reasons, invalid JSON, non-object JSON, and missing usage are rejected. HTTP, network, and timeout errors use static, safe messages without raw responses, request payloads, keys, or the original exception cause. Business data may contain personal information. Callers must still minimize fields before sending them and apply business-level redaction before display or logging.

## Tests and limits

The 0.2.0 and 0.1.0 records below are historical acceptance checks of local versions using synthetic inputs. They do not validate the 0.3.0 public deployment or direct browser requests. Consult the [validation record](VALIDATION.md) for checks actually performed on the current version.

`node --test tests/deepseek.test.ts` uses injected fake fetch implementations. It covers configuration, request shape, usage mapping, provider-model label filtering, missing keys, 401 responses, absence of retries, network-error redaction, request and body timeouts, response size, truncation, and JSON rejection. These tests neither call the real API nor install dependencies.

Version 0.2.0 completed live browser acceptance with synthetic inputs on 2026-10-28: all 27 questions were blank, there was one candidate, and the default was `deepseek-flash` + `medium`. Both stages succeeded and returned four analysis sections. Review used 4,656 tokens / 6,852 ms; analysis used 11,053 tokens / 39,336 ms, for a total of 15,709 tokens. All 90 offline tests passed.

In the historical 0.1.0 check on the same date, the first analysis failed reference validation; its raw output and usage were not retained. Both requests in the second run passed, totaling 24,353 tokens. That run's review returned `insufficient_evidence`; the script explicitly selected a synthetic candidate to continue analysis. Repeating the cached operation made no additional request. This is a separate historical example: its usage must not be combined with the 0.2.0 figures, and it must not be described as successful birth-time rectification. A requested model name or returned label cannot independently establish the actual snapshot. See the [validation record](VALIDATION.md).

The current live script limits `attemptedRequests` to at most 2 before sending requests, records available safe metadata as execution proceeds, and distinguishes a provider response from successful business validation. Browser acceptance and the standalone live script are separate execution records. Failures without available usage must not be treated as free.

Use `npm run test:live -- --birth-only --single-candidate` to select synthetic input with blank background answers and one candidate at an exact minute. The two-request limit still applies. The recorded 0.2.0 live acceptance was performed in the browser; this CLI argument combination is not marked as a separately completed live run.

The service layer is responsible for business-structure validation, context visibility, preserving fixed pillars, separating local calendar calculation from AI candidate comparison, and controlling input length, output-token limits, concurrency, and caching. Actual usage comes from provider responses; there is currently no monetary spending cap. Production workflows accept only real provider results. Test clients are injected only in automated tests. Do not place this client inside a calendar adapter that prohibits network access.

Official references: [Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion), [JSON Output](https://api-docs.deepseek.com/guides/json_mode), and [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode). Passing interface acceptance checks does not establish the validity of BaZi interpretations or predictions.
