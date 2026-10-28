# Delivery Validation Record

Validation date: 2026-10-28. These records cover the engineering implementation only. They do not establish the validity of BaZi birth-time rectification or future predictions.

## 0.3.0 Online BYOK Validation

On 2026-10-28, a browser-only runtime was added, sharing the calendar engine, questionnaire, model prompts, and report validation with the local application.

- `npm run check`: 103 tests passed (the original 90 + 6 browser-compatible core tests + 4 browser runtime tests + 3 key-submission lifecycle tests), along with type checking and integrity checks for all 5 vendor files. The restricted environment initially blocked loopback connections in 5 HTTP tests; the complete check passed after local connections were permitted.
- `npm run build:web` and `node --check public/app.js` passed. The static release contains only explicitly listed web assets and licenses, with no environment files, private reports, or Node backend.
- Visitor credentials reach the client through an explicit environment object, with no fallback to the author's configuration. Tests cover isolation between visitor instances, chart generation without a key, configuration without network requests, cancellation and rejection of late results after clearing a key, and cache reuse without additional calls.
- If the user leaves while the key module is loading lazily, neither a late success nor a late failure callback restores the key or writes page state. Tests execute the actual frontend submission callback.
- A local static browser preview verified single-candidate generation with no background answers, clearing the key input after configuration, the unverified status, the official authentication error for an invalid key, and retention of the entered birth information.
- CORS was checked against actual responses for the public Origin `https://www.theodoreoy.com`. HTTPS enforcement was configured for the project site.

### Public Deployment and Page Checks

Both the [Windows / Linux checks](https://github.com/130U/Divination-and-Destiny-Studies/actions/runs/40714096462) and [Pages deployment](https://github.com/130U/Divination-and-Destiny-Studies/actions/runs/40714096272) succeeded for implementation commit `ed667d7` of 0.3.0. The public entry point is [www.theodoreoy.com/Divination-and-Destiny-Studies](https://www.theodoreoy.com/Divination-and-Destiny-Studies/), with enforced HTTPS.

- The home page, application script, browser bundle, stylesheet, and third-party licenses all returned HTTP 200. The HTML, both scripts, and complete third-party license file matched the local artifacts byte for byte. CSS differed only in Windows / Git CRLF versus LF line endings; its content matched after normalization.
- On the actual public page, entirely synthetic birth information was entered: 2000-06-15 09:30, Asia/Shanghai, female, longitude 121.47, and true solar time disabled. All 27 background questions were left blank. One candidate was generated successfully, with pillars Geng-Chen, Ren-Wu, Jia-Chen, and Ji-Si. Without a key, the AI buttons were disabled and no simulated report appeared.
- GitHub rendered the product README, actual UI screenshot, and public HTTPS link. The About description and homepage were confirmed by reading them back through the remote interface.
- The two-stage click flow with a valid key on the public page was not subjected to another paid acceptance run. The live calls below used the actual released bundle in Node. The local static browser preview separately verified the official authentication error and key-clearing behavior.

### Live Model Check of the Release Bundle

`npm run test:web:live` loads **the actual dist/browser.js** into Node, uses local test credentials and entirely synthetic birth information, and sends the public site's Origin header. It checks the browser release bundle's two-stage behavior and the CORS headers of authenticated responses. **It is not an acceptance test in which a real key was entered through the browser UI.** The run permits at most two requests, with no automatic retries. Neither the key nor raw model report text is written to its output.

Both stages succeeded in this run. All background information was unknown, analysis returned 4 sections, and repeated stages hit the cache. Both the requested and returned model names were `deepseek-flash`, with thinking set to `medium`.

| Stage | Input tokens | Output tokens | Total tokens | Cached input tokens | Reasoning tokens | Duration, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| review | 3,759 | 2,384 | 6,143 | 640 | 1,851 | 14,554 |
| analysis | 4,772 | 4,484 | 9,256 | 640 | 2,671 | 31,924 |
| Total | 8,531 | 6,868 | **15,399** | 1,280 | 4,522 | — |

These figures cover only the two calls in this run, excluding other versions and invalid-credential checks. This was not a prediction-accuracy test. Cached input and reasoning tokens are already included in input and output totals, respectively, and must not be added again.

## 0.2.0 Offline Check History

`npm run check` was executed on Windows with Node.js 24.16.0:

- TypeScript checking passed.
- 90 tests passed: 21 calendar tests, 16 DeepSeek transport tests, 25 questionnaire tests, 5 local HTTP API tests, and 23 workflow tests.
- All 5 unchanged Zhenyi upstream files passed SHA-256 and Git blob SHA-1 integrity checks.
- `node --check public/app.js` passed.

Tests cover solar-term boundaries, lunar conversion, true solar time, DST gaps and repeated times, complete and omitted questionnaires, model-reference repair, caching, concurrency, expiry cleanup, and error handling. New 0.2.0 coverage includes proceeding with one or multiple candidates without background answers, retaining partial answers, removing unknown or not-applicable references with warnings, deduplicating references, and preserving safe usage metadata when essential output validation fails. Incorrect candidate identities and missing report text are still rejected; failure is not replaced with a fabricated report. HTTP tests require local loopback access. Model tests use controlled fake clients, not the real API; the application has no simulated-report fallback.

Configuration update on 2026-10-28: the default model remained `deepseek-flash`, officially mapped that day to DeepSeek-V4.1-Flash-1017, while the default reasoning parameter changed to `medium`. Transport tests confirmed that default and explicit settings both send `reasoning_effort: "medium"` unchanged, without lowering it to `low` or disabling thinking. The provider maps `medium` to an effective `high` level. That mapping comes from provider documentation; offline tests do not prove what the live service actually executed.

## Browser Checks

The 0.2.0 acceptance check used a separate local service on port 3212, without refreshing or modifying the user's existing session on port 3211. Neither the 1280-pixel desktop viewport nor the 390-pixel mobile viewport had horizontal overflow. The mobile navigation expanded and collapsed after a step was selected. Background groups were collapsed by default, and candidates could be generated with all 27 questions and applicability checks left blank. Review and analysis statuses appeared within their respective sections, without a simultaneous top-level success message and a current failure message. No browser warnings or errors were observed, and JSON report export succeeded.

The revised UI used a paper-white background, fine grid, numbered sidebar, blue navigation marker, square buttons, and serif report text, drawing on Cognition's layout rhythm. It did not copy Cognition's brand, proprietary fonts, or images.

### Historical 0.1.0 Page Check

The actual page was filled and local requests were made using explicitly fictional information. The synthetic input was Gregorian 2000-06-15, Asia/Shanghai, female, longitude 121.47, with true solar time disabled. The 09:00–13:00 time range returned 3 distinct Four-Pillars candidates. Changing the end time to 12:59 immediately invalidated the old result; resubmission returned 2 candidates.

This local page check showed that AI had not yet been called, and AI buttons were disabled when no key was configured. No browser console errors were captured. At a 658-pixel viewport, the page width was 658 pixels, with no horizontal overflow. This page check was separate from the live API script acceptance runs below.

## 0.2.0 Live API Acceptance with No Background Answers

On 2026-10-28, only fictional birth information was entered in the actual browser page: Gregorian 2000-06-15, 09:30, Asia/Shanghai, female, longitude 121.47, and true solar time disabled. All 27 background questions and the applicability checks were left blank; the exported report confirmed 0 answered items. No real user experiences were used.

- Local calculation produced one candidate. Review returned `provisional`, with selection source `birth_input`.
- Analysis returned `chart_only`, with four substantive sections covering chart structure, learning and career, relationships, and resources and action planning, plus conditional scenarios.
- Missing background information appeared as reading guidance rather than blocking the report. Reference and structure validation passed.
- This run made only two model calls, with no retry. Reading back the JSON export confirmed the usage below.
- The requested configuration was `deepseek-flash` with `medium`; both responses carried the provider model label `deepseek-flash`. This still does not independently establish the identity of the 1017 snapshot.

| Stage | Input tokens | Output tokens | Total tokens | Cached input tokens | Reasoning tokens | Duration, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| review | 3,765 | 891 | 4,656 | 128 | 320 | 6,852 |
| analysis | 4,793 | 6,260 | 11,053 | 128 | 4,421 | 39,336 |
| Total | 8,558 | 7,151 | **15,709** | 256 | 4,741 | — |

Reasoning and cached input tokens are already included in output and input statistics, respectively, and must not be added again. This table counts only the two calls in this run; it is not combined with the historical examples below, and no monetary bill was estimated from it. The multiple-candidate path without background answers and repeated-operation caching were covered by regression tests in this round; no additional paid calls were made for those cases. This verifies workflow availability, not the correctness of divination judgments.

## 0.1.0 Live API Synthetic Acceptance History

On 2026-10-28, two rounds of real DeepSeek requests were made using entirely fictional repository fixtures: two requests per round, four requests in total. No real personal cases were used. The requested model was `deepseek-flash`, with `medium` sent unchanged as the thinking parameter. In the successful retest, the provider also returned `deepseek-flash` as the model label. That label does not independently identify the DeepSeek-V4.1-Flash-1017 snapshot; the 1017 mapping comes from the official documentation available that day.

### First Round: Analysis Rejected by Strict Validation

Review passed in the first round, but analysis failed validation of known-fact references in `evidence_ids`. Neither the raw model output nor token usage was retained. It is therefore not possible to determine whether the cause was an unknown answer, a not-applicable answer, a duplicate ID, or another reference-format issue. An inferred cause must not be presented as confirmed, and missing usage must not be interpreted as no cost.

The model input was then given an explicit `referenceable_evidence_ids` allowlist, and the prompt stated that unknown and not-applicable answers must not appear in reference arrays. Sections without facts could use empty references and explain gaps in `uncertainties`. The strict 0.1.0 validator was not relaxed at that point; 0.2.0 later introduced nonfatal reference repair, as described above. The next round's success establishes that the then-current version satisfied the interface contract for that synthetic case. It does not identify the first round's exact cause or guarantee that future requests will succeed.

### Second Round: Both Stage Contracts Passed

- Candidate count: 3.
- Review status: `insufficient_evidence`, without a unique recommendation.
- The script explicitly selected a synthetic candidate to continue checking the analysis interface; this selection does not count as successful birth-time rectification.
- Analysis retained the selected working chart, and its output passed structure and reference validation.
- Repeated review and repeated analysis of the same candidate both hit the cache, without additional model requests.

The following are provider-reported usage and client-measured durations for the second round only:

| Stage | Input tokens | Output tokens | Total tokens | Cached input tokens | Reasoning tokens | Duration, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| review | 7,208 | 4,355 | 11,563 | 0 | 3,401 | 28,452 |
| analysis | 4,820 | 7,970 | 12,790 | 128 | 5,955 | 43,550 |
| Total | 12,028 | 12,325 | **24,353** | 128 | 9,356 | — |

Reasoning tokens are already included in output and total tokens, and are not added again. Cached input tokens are a subset of input tokens and are not added separately. The 24,353 figure covers only the second round, excluding the first round whose usage was not retained. No monetary bill is inferred here. Each business-stage request retained an output ceiling of 8,192 tokens.

### Acceptance-Script Signals and Request Cap

`npm run test:live` records provider response metadata separately from completion of the business stages. It emits `status: passed` only after both stage validations and both cache checks pass. On failure, it emits `status: failed`, `completedStages`, and any safe response metadata already obtained, then exits with a nonzero status. Records contain no raw answers or private information. Network, timeout, or client parsing failures may prevent usage from being obtained; this still does not establish that no fee was incurred.

After the second round, the script added a pre-request `attemptedRequests` cap of 2. If a cache check unexpectedly attempts another request, it is rejected before the call is made; failed attempts also count toward the cap. This diagnostic and request-counting change passed `npm run check`, without another paid acceptance run specifically for it.

## Validation Boundaries

GitHub Actions is configured to check Node 24 on Windows and Linux. The remote result for a particular commit is determined by that repository's Actions records.

Calendar tests cover the boundaries explicitly listed in the documentation. They are not an exhaustive certification of all historical dates, time zones, or astronomical models. Live API acceptance covers two-stage transport, structure, references, and caching for entirely synthetic examples. It does not measure real birth-time identification accuracy, the correctness of natural-language interpretations, or future predictive performance.
