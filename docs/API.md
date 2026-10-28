# API and Browser Operation Contract

Version 0.3.0 supports two execution modes that share chart calculation, questionnaire handling, the workflow, and result structures:

| Mode | Execution and credentials | Operation transport |
| --- | --- | --- |
| Static web app | Runs in the browser; each visitor's key stays in the current page's memory | The adapter in `src/browser.ts` calls the in-memory workflow; AI requests go directly from the browser to DeepSeek |
| Local Node app | Runs locally in Node; the server environment supplies the key | The HTTP API described below, at `http://127.0.0.1:3210` by default |

The browser adapter uses the same `/api/...` operation names and business data contract. These names are in-memory dispatch identifiers, **not HTTP endpoints on the public website**. The static site has no author-operated model proxy and does not send visitor data through the local Node API.

The methods, HTTP status codes, Host restrictions, and Content-Type rules below describe the local Node app. Write requests must use `Content-Type: application/json`. Only local Host values are accepted, and cross-origin browser requests are rejected. The Node API does not accept keys, model names, candidate chart objects, or arbitrary upstream URLs. Credentials come from server configuration, and charts come from local calculation.

The browser app manages credentials separately through `setApiKey(value)` and `clearApiKey()`; keys do not enter business request bodies. Setting a key requires a secure context and does not make a model request. Keys are never written to localStorage, sessionStorage, URLs, logs, or reports. Replacing or clearing a key clears the current sessions and caches and cancels local pending requests. Refreshing or leaving the page also clears them. Only an explicit AI operation connects to the official API, with charges applied to the visitor's account.

## Operation overview

| Method and path | Request | Successful result | Model call |
| --- | --- | --- | --- |
| `GET /api/status` | None | App version, DeepSeek configuration status, model name, and session lifetime | No |
| `GET /api/questionnaire` | None | Versioned question bank and applicability definitions | No |
| `POST /api/session` | `{ birth, answers? }` | HTTP 201; session, all candidates, and structured answers | No |
| `POST /api/review` | `{ sessionId }` | Candidate comparison and usage | Yes, unless a successful review is cached |
| `POST /api/analysis` | `{ sessionId, candidateId? }` | Analysis of the selected working chart and usage | Yes, unless a successful analysis of that chart is cached |
| `DELETE /api/session` | `{ sessionId }` | `{ "deleted": true }` | No |

## 1. Create a session

Example birth input:

```json
{
  "date": "2000-06-15",
  "calendar": "solar",
  "timeMode": "range",
  "startTime": "09:00",
  "endTime": "13:00",
  "timezone": "Asia/Shanghai",
  "longitude": 121.47,
  "trueSolarTime": false,
  "sex": "female"
}
```

This is synthetic input, not a private case. Dates use `YYYY-MM-DD`. `calendar` accepts `solar` or `lunar`; lunar input may also include the boolean `leapMonth`. Time modes are mutually exclusive: `exact` takes only `time`, `range` takes only `startTime/endTime`, and `unknown` takes no time fields. Times use `HH:mm`; ranges must stay within one civil date and include both endpoints. `male` and `female` supply the sex parameter required by the traditional luck-cycle calculation.

The product accepts converted Gregorian birth dates from 1900-01-01 through the evaluation date in the running environment. The local engine converts lunar dates first. Questionnaire event dates are always validated as Gregorian dates. Invalid dates, conflicting time fields, nonexistent exact civil minutes, missing parameters, and extra fields are rejected.

`answers` may be omitted, supplied as `{}`, or contain only some answers. All 27 questions and both applicability questions are optional. Missing values are normalized to `unknown`; conditional questions explicitly marked inapplicable become `not_applicable`. Supplied content must still pass format and date validation. The normalized internal structure is:

```ts
{
  responses: Record<questionId,
    { status: "answered", value: string | string[] | YearEvent[] }
    | { status: "unknown" }
    | { status: "not_applicable" }
  >,
  applicability: {
    current_identity_is_working_or_has_work_history: boolean | "unknown",
    childbearing_applicable: boolean | "unknown"
  }
}
```

`YearEvent` is `{ year: number, description: string, date?: string, eventType?: string }`. Leave the exact date absent when only the year is known. C9 requires either `best_year` or `worst_year`; the question bank determines event types for the other questions. C7/C8 may be omitted or answered `not_applicable` when their applicability condition is false. See the [questionnaire contract](QUESTIONNAIRE.md) for all options and limits.

The session response contains `id`, `createdAt`, `expiresAt`, `asOfDate`, `candidateSet`, `evidence`, and `context`. `candidateSet` contains the birth input, engine version, all candidates, and warnings. The workflow retains a frozen copy in its execution environment. Editing a returned object cannot change the data used in later analysis. Correcting birth details or answers requires a new session.

## 2. Compare all candidates in one call

```json
{ "sessionId": "ID returned when the session was created" }
```

Successful response:

```ts
{
  review: {
    status: "recommended" | "provisional" | "ambiguous" | "insufficient_evidence",
    recommended_candidate_id: string | null,
    ranking: Array<{
      candidate_id: string,
      supporting_evidence_ids: string[],
      contradicting_evidence_ids: string[],
      rationale: string,
      unresolved_questions: string[]
    }>,
    alternatives: string[],
    summary: string,
    limits: string[],
    evidence_mode: "chart_only" | "context_supported",
    selection_source: "model" | "birth_input" | "ranked_fallback",
    reportWarnings: string[]
  },
  usage: { inputTokens: number, outputTokens: number, totalTokens: number },
  model: string,
  providerModel?: string,
  requestId?: string,
  durationMs: number,
  cached: boolean
}
```

`ranking` must contain every candidate exactly once, with no invented, omitted, or duplicate candidates. An explicitly selected working chart must match the first-ranked candidate. A successfully normalized result provides a valid working-chart ID. A single candidate receives `selection_source: "birth_input"` and `provisional`: the input has constrained the result to one set of Four Pillars; the model has not verified the birth time. With multiple candidates, the model normally makes the selection. If it supplies no selected ID, the workflow uses the first entry in its complete ranking as `ranked_fallback` and explicitly marks the choice provisional. The type retains `ambiguous` and `insufficient_evidence` for compatibility with model input, but the current service normalizes usable results with weak evidence to `provisional` and permits analysis to continue.

The workflow still calls the model when there are no known answers for chart comparison. The result is provisional and marked `chart_only`; known answers produce `context_supported`. Here, "known" means the user supplied substantive information. It does not imply independent verification or guarantee that the information distinguishes birth hours.

The workflow supplies an allowlist of known answers through `referenceable_evidence_ids`. Minor citation issues are normalized: duplicate, unknown, or inapplicable IDs are removed; recognizable surrounding whitespace and single-string references are repaired; and `reportWarnings` describes the changes. If the same question appears as both support and contradiction, its reference is removed from both lists with a warning. Essential report text is retained. Candidate identity errors, incomplete coverage, and missing essential text still cause rejection. These checks do not establish the factual or reasoning accuracy of the text.

## 3. Analyze one working chart

```json
{ "sessionId": "ID returned when the session was created", "candidateId": "Candidate ID from this session" }
```

`candidateId` is optional. When omitted, analysis uses the working-chart ID from the completed review, including a provisional selection. The caller may explicitly select another candidate from the same session. A completed review is still required.

The successful response uses the same metadata as review and replaces `review` with:

```ts
analysis: {
  selected_candidate_id: string,
  overview: string,
  sections: Array<{
    domain: string,
    text: string,
    evidence_ids: string[],
    chart_basis: string[],
    uncertainties: string[]
  }>,
  scenarios: Array<{ condition: string, implication: string, evidence_ids: string[] }>,
  limitations: string[],
  evidence_mode: "chart_only" | "context_supported",
  reportWarnings: string[]
}
```

The returned working-chart ID must match the requested selection. An overview and 1-8 analysis sections with body text are required. `chart_basis` may reference only actual field paths in the input's `chart_reference_paths`, such as `pillars.day` or `features.luckCycles`. The answer allowlist combines known answers from chart-comparison evidence and personal context. Invalid references are removed with warnings. Missing references or limitations also produce warnings; these metadata issues do not discard existing report text. With no known personal information, `evidence_ids` may be empty and the model provides conditional analysis in `chart_only` mode. Otherwise, the mode is `context_supported`. The model must not invent personal experiences from unknown information or describe a provisional selection as a probability. Structural checks do not validate the meaning or accuracy of explanations, causal claims, or predictions.

`usage` comes from the actual provider response and may also contain `cachedInputTokens` and `reasoningTokens`. It describes only that model call, excluding other stages, earlier failures, and retries; it is not a cumulative bill. `cached: true` means an existing local successful result was returned without a new model request. The usage still describes the original request and must not be counted again as a new charge.

`model` is the configured request name. Optional `providerModel` is the provider's returned label after format and credential filtering. Both were `deepseek-flash` in the synthetic rerun on 2026-10-28. These labels cannot independently establish that the underlying model was the 1017 snapshot.

## Sessions, costs, and errors

Sessions last 30 minutes from creation. The evaluation date, `asOfDate`, is frozen at creation and passed to both model requests as `as_of_date`. The workflow removes expired sessions. Restarting Node clears them; refreshing or leaving the browser page, or replacing or clearing the key, also clears them. The Node API returns 410 for a deleted or expired session; the browser adapter throws the corresponding business error. Clearing a session with a pending request discards late results but cannot guarantee withdrawal of a request already received upstream.

A successful review is cached by session, and a successful analysis is cached by session and candidate. Each workflow instance rejects concurrent model calls: the Node process shares its workflow, while each browser tab has its own. There are no automatic retries or mock fallbacks after failures. Network errors, invalid output, and manual retries may still incur provider charges.

Node HTTP errors use `{ "error": { "code": "...", "message": "...", "details": [] } }`. `details` appears only for some validation errors; provider HTTP errors may also include `upstreamStatus`. When a complete provider response has arrived but fails business-structure validation, the error includes safe metadata as `error.modelAttempt: { stage, model, providerModel?, durationMs, usage }`, without returning the raw model text. The browser adapter throws business errors for the UI and preserves available safe `modelAttempt` metadata; it does not fabricate HTTP responses. Usage describes only that failed call. A failure without returned usage must not be treated as free. Common Node status codes are:

| Status | Examples | Meaning |
| --- | --- | --- |
| 400 | `INVALID_QUESTIONNAIRE`, `INVALID_CANDIDATE` | Invalid supplied content, missing birth input, or incorrect operation order |
| 403 | `HOST_NOT_ALLOWED`, `ORIGIN_NOT_ALLOWED` | Disallowed local host or origin |
| 409 | `REVIEW_IN_PROGRESS`, `MODEL_BUSY` | A related request is already in progress |
| 410 | `SESSION_EXPIRED` | Session cleared or expired |
| 413 | `BODY_TOO_LARGE`, `PROMPT_TOO_LARGE` | Input or per-call prompt budget exceeded |
| 415 | `CONTENT_TYPE` | Write request is not JSON |
| 429 | `SESSION_LIMIT` | In-memory session limit reached |
| 502 | `INVALID_MODEL_OUTPUT`, `DEEPSEEK_*` | Upstream failure or output outside the contract |
| 503 | `DEEPSEEK_NOT_CONFIGURED`, `DEEPSEEK_INVALID_CONFIG` | Server configuration missing or invalid |

Current default limits are defined in [`configs/runtime.v1.json`](../configs/runtime.v1.json): a 256 KiB request body, 100,000 characters of model-input JSON, an 8,192-token output limit per call, and at most 100 in-memory sessions. The server does not return API keys or raw provider error bodies.

The current status version is `0.3.0`. Both modes report `questionnaire: "optional"`. Node reports `storage: "memory_only"` and `billing: "server_operator_key"`; the browser adapter reports `storage: "browser_memory_only"` and `billing: "visitor_key"`. Browser `deepseek.verified` means only that the current key has produced a successful client response. Setting a key does not check the account balance or make a separate authentication call.

The web app uses the fixed endpoint `https://api.deepseek.com/chat/completions` with `credentials: "omit"` and `referrerPolicy: "no-referrer"`. Authentication failures, insufficient balance, rate limits, network failures, and cross-origin errors are reported explicitly without automatic retries. If the Node app is separately shared with others, their requests still use the operator's key. That is not the architecture of the current static web app.

## Completed synthetic acceptance checks

The following checks cover historical local versions. They do not establish public deployment or direct-browser acceptance for 0.3.0. See the [validation record](VALIDATION.md) for the checks performed on each version.

Version 0.2.0 completed a live browser acceptance check on 2026-10-28 using synthetic birth data, all 27 questions left blank, and a single candidate. Both stages succeeded, producing four analysis sections. Review used 4,656 tokens in 6,852 ms; analysis used 11,053 tokens in 39,336 ms; the combined total was 15,709 tokens. All 90 offline tests passed.

The historical 0.1.0 rerun on the same date used 24,353 tokens across two requests. Its three-candidate review returned `insufficient_evidence`; the script explicitly selected a chart to continue analysis, and repeated cached operations made no additional requests. An earlier first run failed analysis citation validation and did not retain usage. These are separate acceptance checks and their totals are not combined. API acceptance does not prove birth-hour identification or predictive validity; see the [validation record](VALIDATION.md).
