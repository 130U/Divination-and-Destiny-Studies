# Using the App and Running It Locally

## Online mode: use your own DeepSeek key

Open the [online app](https://www.theodoreoy.com/Divination-and-Destiny-Studies/). Birth details are sufficient to generate candidates; all 27 background questions and both applicability questions are optional. The app supports Gregorian dates, lunar dates, and leap lunar months. Birth time may be an exact minute, a range within the same day, or entirely unknown. The product accepts birth dates whose converted Gregorian date falls between 1900-01-01 and the assessment date.

AI analysis requires your own DeepSeek API key. The HTTPS page accepts the key and keeps it only in the current tab's closure memory. It is never written to localStorage, sessionStorage, URLs, logs, or exported reports. Refreshing, explicitly clearing, or leaving the page clears the key. Replacing or clearing it also clears the current session and cache and cancels local waiting. Clearing cannot withdraw requests already received by DeepSeek or guarantee cancellation of charges already incurred.

Birth-chart calculation and session management run in the browser. Only an explicit AI action sends a request with your key directly to `https://api.deepseek.com/chat/completions`. Requests do not pass through the author's model backend or consume the author's account quota. The key is sent to DeepSeek as the official request's authentication credential. Birth details, candidate charts, and relevant answers also accompany analysis requests.

The default is `deepseek-flash` + `medium`. Entering a key does not call the model and does not establish that authentication will succeed or the account has a balance. Network problems, browser CORS restrictions, insufficient balance, or rate limits may cause requests to fail. The app displays errors, never retries paid requests automatically, and does not return simulated reports.

The normal workflow makes two model requests: first compare candidates, then analyze the working chart. A single candidate becomes the provisional working chart directly. Entirely blank background answers still allow analysis, with the report identifying its chart-only basis. Successful comparisons and successful analyses of the same working chart are cached within a valid session. Running AI again after changing charts or creating a new session, or explicitly retrying a failed request, may incur new charges.

Sessions expire 30 minutes after creation. In online mode, refreshing or closing the page also loses the session. Export JSON or Markdown explicitly if you want to keep the results. Usage shown on the page and in exports describes only the associated model call. It excludes other stages, earlier failures, and retries, and is not a cumulative account bill. Cached results display the original call's usage, which must not be counted again.

## Local Node mode: the operator configures a server key

Local mode retains the same analysis workflow but uses a key from the Node server environment. It does not accept visitors' keys through the web page. By default, the server listens only on local `127.0.0.1`. This is a separate runtime mode from the public static browser app, where visitors supply their own keys.

You need Node.js **24.12.0 or a newer 24.x release** and npm. Dependency versions are pinned in the lockfile:

```sh
npm ci
npm start
```

Open the [local app](http://127.0.0.1:3210). This address points to your own computer and works only after the local server starts; it is not a public website. Without a key, you can still enter details and generate local candidates. AI operations fail explicitly rather than return simulated results.

Copy `.env.example` to a local `.env`, edit the server configuration, and restart. You may instead set process environment variables directly. Git ignores `.env`. Never put keys in the repository, screenshots, terminal command history, or reports.

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | Credential read by the local server | Not configured |
| `DEEPSEEK_MODEL` | Requested model name | `deepseek-flash` |
| `DEEPSEEK_THINKING` | `low`, `medium`, `high`, `max`, or `disabled` | `medium` |
| `PORT` | Local listening port | `3210` |

People who clone and run the project use their own configured keys. If someone separately exposes a Node backend to other users, their requests use the operator's key. The current public website does not use that shared-backend model, and the project does not provide multi-user account isolation.

## Models, charges, and data boundaries

As of 2026-10-28, the [official model documentation](https://api-docs.deepseek.com/) maps `deepseek-flash` to DeepSeek-V4.1-Flash-1017. This is an updatable provider alias, not a permanently pinned snapshot. The [official thinking-level mapping](https://api-docs.deepseek.com/guides/thinking_mode/) maps a requested value of `medium` to an effective level of `high`; this project sends `medium` unchanged.

Both modes use the fixed official endpoint and an output limit of 8,192 tokens per business stage. Forms cannot specify arbitrary service addresses. Charges are determined by the provider, and there is currently no monetary spending cap. Failed or timed-out requests may still incur charges. If a completed model response fails business validation, any safe usage metadata already received is retained. Missing usage does not mean zero cost.

Minor reference-format problems preserve the report text and produce warnings. Candidate-identity errors or missing essential text still cause failure. Model recommendations are working hypotheses to examine, not calibrated probabilities for a birth hour. Events already supplied by the user cannot count as independent prediction successes.

## Development checks and static builds

```sh
npm run check
npm run build:web
```

`check` runs TypeScript checks, synthetic-data tests, and vendor integrity verification without requesting a real model. Local HTTP tests require loopback access. `build:web` bundles the same calendar calculation, questionnaire, and workflow into `dist/`, and copies static assets and license files. It does not copy `.env`, private reports, or server credentials. Serve the static output through an HTTPS-capable site. Availability of the local Node API does not establish the status of online mode.

The standalone live API script must be invoked explicitly. A successful run makes two paid requests:

```sh
npm run test:live
npm run test:live -- --birth-only --single-candidate
```

These commands are alternatives; there is no need to run both consecutively. The second uses synthetic input with blank background answers and one candidate at an exact minute. Each script run allows at most two attempts, does not retry automatically, and reports `LIVE_NOT_RUN` when unconfigured. Historical records do not mean this argument combination or the current public website has been separately tested live.

The [validation record](VALIDATION.md) separately documents the 90 offline tests and two-stage live local-browser run for 0.2.0, and the earlier 0.1.0 example. These are engineering acceptance checks for their respective versions. They do not automatically establish that the 0.3.0 public deployment works, or validate BaZi interpretations or predictions. Deployment and direct-browser claims must follow the explicitly recorded acceptance checks for the relevant version.

Further documentation: [API contract](API.md), [architecture](ARCHITECTURE.md), [DeepSeek integration](DEEPSEEK.md), [questionnaire](QUESTIONNAIRE.md), and [calendar conventions](ZHENYI_INTEGRATION.md).
