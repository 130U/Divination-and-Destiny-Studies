# Third-Party Sources and Licenses

## Zhenyi-bazi

- Upstream: [ZHENYI-ORG/Zhenyi-bazi](https://github.com/ZHENYI-ORG/Zhenyi-bazi).
- Pinned revision: [`383a726437a81db2b87eed517ef5e6ccd30b7bd4`](https://github.com/ZHENYI-ORG/Zhenyi-bazi/tree/383a726437a81db2b87eed517ef5e6ccd30b7bd4).
- Copyright: Copyright (c) 2026 ZhenYi.
- License: MIT. The complete original text is retained in [`vendor/zhenyi/LICENSE`](vendor/zhenyi/LICENSE).

The following five files are retained unchanged from the pinned revision:

| Upstream path | Local path | Purpose |
| --- | --- | --- |
| `dist/core/LocalPaipan.js` | `vendor/zhenyi/core/LocalPaipan.js` | Calendar calculations, Four Pillars, and luck cycles |
| `dist/core/TrueSolarTimeCalculator.js` | `vendor/zhenyi/core/TrueSolarTimeCalculator.js` | Longitude and equation-of-time corrections |
| `dist/data/nayin.json` | `vendor/zhenyi/data/nayin.json` | Nayin correspondence data |
| `dist/data/eot.json` | `vendor/zhenyi/data/eot.json` | Equation-of-time data |
| `LICENSE` | `vendor/zhenyi/LICENSE` | Original copyright and license |

[`SOURCE_MANIFEST.json`](vendor/zhenyi/SOURCE_MANIFEST.json) records each file's pinned source URL, byte count, SHA-256 hash, and upstream Git blob identity. The additional `package.json` and manifest in the vendor directory are this project's loading configuration and provenance records, not original upstream files. `npm run check` includes the integrity check.

This project's time-coordinate wrapper and application workflow are independently implemented. The full upstream `BlindJudgmentEngine`, AI prompts, commercial backend, interface, icons, fonts, geographic database, and private cases were not copied. The copied files retain their MIT notices; this statement does not extend to upstream material excluded from this project. The MIT license is not an endorsement of the validity of chart interpretations or predictions.

## Questionnaire design

The question design comes from project owner `130U`'s `bazi-context-agent/configs/question_bank.v1.json`, with the owner's explicit authorization to copy and adapt it. The source version is `1.1`. The checkout revision at the time of reading was `b277fec462bada4c09ac651ed02a68d25ccd935d`; the SHA-256 hash of the actual source file was `a10cac9ad1928d702f81e3b71fcc8bcf51e5c025279192fcaab0aa3c50b135ff`.

The new question bank preserves the B/C/D question IDs, original wording, options, and applicability conditions, while adapting collection order and completeness rules. Source information, the actual content hash, and adaptation notes are recorded in the `provenance` field of [`configs/question_bank.v1.json`](configs/question_bank.v1.json). This records owner authorization for specific content; it does not claim a general third-party open-source license for all material in the original repository. The app neither depends on nor modifies that repository at runtime.

## Dependencies and external services

Dependency versions and license metadata are recorded in [`package-lock.json`](package-lock.json):

| Development dependency | Locked version | License metadata |
| --- | --- | --- |
| `typescript` and its platform compiler packages | `7.0.2` | Apache-2.0 |
| `@types/node` | `24.13.3` | MIT |
| `undici-types` (type dependency) | `7.18.2` | MIT |
| `esbuild` (browser build tool) | `0.28.2` | MIT |

Installed packages retain the license text distributed with their npm packages. The app does not bundle the Node.js runtime. At runtime it uses `@noble/hashes` 2.4.0 (MIT, Copyright (c) 2022 Paul Miller) to generate identical SHA-256 candidate identifiers in Node and the browser. The online build includes the full Zhenyi and library licenses in `THIRD_PARTY_LICENSES.txt`.

DeepSeek is accessed through its official HTTP API. The online app connects directly from the browser with the visitor's own key; local Node mode uses the operator's server configuration. No model weights are copied, and the external service is not covered by this project's MIT license. Service use, data handling, and charges are governed by the provider's applicable terms. The default model name is a client configuration value, not a certification of service availability or predictive capability.
