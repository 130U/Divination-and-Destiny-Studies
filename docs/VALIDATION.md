# Validation

Engineering validation covers local calendar calculation, questionnaire handling, provider transport, workflow state, and the static browser app. Birth-time identification and future-prediction accuracy have not been established.

## Automated release checks

```sh
npm ci --ignore-scripts
npm run check
npm run build:web
node --check public/app.js
```

The suite checks strict types, calendar fixtures, solar-term boundaries, lunar conversion, true-solar time, DST gaps and repeated times, optional questionnaires, candidate identity, citation normalization, caching, concurrency, expiry, provider errors and browser key lifecycle. All five vendored Zhenyi files are checked against their source integrity manifest. Controlled fake clients provide model responses in automated tests; production has no simulated-report fallback.

The static build includes only listed web assets and licenses. Keys and sessions remain in tab memory. Tests cover visitor isolation, local chart generation without a key, configuration without network requests, cancellation, rejection of late results after key clearing, and cache reuse without a new call.

## Public browser evidence

On 2026-10-28, the public HTTPS app and its scripts, bundle, stylesheet and licenses were read back successfully. Synthetic birth input (Gregorian 2000-06-15 09:30, Asia/Shanghai, female, longitude 121.47, true solar time disabled) generated one candidate with all 27 background questions blank. Its pillars were Geng-Chen, Ren-Wu, Jia-Chen and Ji-Si. Without a key, AI actions were disabled and no simulated report appeared.

A local static preview checked key-input clearing, the unverified status, the official authentication error for an invalid key, and retention of birth inputs. Offline tests and local previews do not constitute a paid acceptance run through the public browser UI.

## Live bundle contract evidence

`npm run test:web:live` loads the actual `dist/browser.js` bundle in Node, uses synthetic birth inputs and local credentials, and sends the public site's Origin header. It permits at most two requests with no automatic retry and records neither credentials nor raw report text. It checks bundle contracts and CORS; it is not a test of entering a key through the browser UI.

The 2026-10-28 bundle run completed both stages with all background information unknown, four analysis sections, and cache reuse on repeated operations. Requested and returned model names were `deepseek-flash`, with thinking set to `medium`.

| Stage | Input tokens | Output tokens | Total tokens | Cached input tokens | Reasoning tokens | Duration, ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| review | 3,759 | 2,384 | 6,143 | 640 | 1,851 | 14,554 |
| analysis | 4,772 | 4,484 | 9,256 | 640 | 2,671 | 31,924 |
| Total | 8,531 | 6,868 | **15,399** | 1,280 | 4,522 | — |

These figures cover only that two-call run. Cached input and reasoning tokens are already included in the input/output totals. They establish neither prediction accuracy nor the identity of an underlying provider snapshot. No additional paid model calls are part of documentation or repository-hygiene checks.

## Release scope

The public entry is [Divination and Destiny Studies](https://www.theodoreoy.com/Divination-and-Destiny-Studies/). The Pages workflow runs the automated checks and builds the web app for each `main` commit. Current deployment acceptance requires checking that commit's workflow and public assets. Provider behavior, browser environment security and the semantic correctness of generated interpretations remain outside the guarantees of these engineering checks.
