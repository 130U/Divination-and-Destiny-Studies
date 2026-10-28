# Zhenyi Local Chart Integration

This project performs actual local date-to-Four-Pillars calculations and retains every distinct chart consistent with the supplied time range. The application then compares evidence from submitted, normalized questionnaire answers. The chart module makes no model calls, accesses no API keys, applies no divination scores, and does not prefilter candidates by perceived quality. A subsequent AI recommendation of a working chart does not establish the birth time as an objective fact.

## Pinned Source and License

Upstream: `ZHENYI-ORG/Zhenyi-bazi`, pinned to commit [`383a726437a81db2b87eed517ef5e6ccd30b7bd4`](https://github.com/ZHENYI-ORG/Zhenyi-bazi/tree/383a726437a81db2b87eed517ef5e6ccd30b7bd4). The following files are preserved unchanged in `vendor/zhenyi`:

| Original file | Local purpose |
|---|---|
| `dist/core/LocalPaipan.js` | Gregorian/lunar calendars, solar terms, Four Pillars, hidden stems, Ten Gods, Na Yin element designations, and the start and sequence of luck cycles |
| `dist/core/TrueSolarTimeCalculator.js` | Upstream longitude and equation-of-time corrections |
| `dist/data/nayin.json` | Na Yin data: traditional element designations associated with stem-branch pairs |
| `dist/data/eot.json` | Equation-of-time table indexed by month and day |
| `LICENSE` | Original MIT copyright and license text |

`vendor/zhenyi/SOURCE_MANIFEST.json` records original paths, pinned source links, byte lengths, SHA256 hashes, and upstream Git blob SHA1 hashes. Integration tests check both digests. All five files are unmodified. The local integration adds `package.json` to declare the vendor directory as CommonJS, plus the manifest. The application uses Node 24 ESM and TypeScript; its shared browser integration and dependency setup are described in [Architecture](ARCHITECTURE.md). No upstream UI, commercial backend, regional database, icons, AI prompts, complete blind-school judgment engine, or case files were copied. The MIT text is retained with the copied code; this record is not an independent certification of the rights to all upstream material.

## Inputs and Candidate Coverage

The entry point is `generateCandidateCharts(input: BirthInput): CandidateSet`, defined in `src/chartEngine.ts`. Inputs must explicitly specify calendar type, sex, IANA time zone, longitude, and whether to use true solar time. Missing values cannot be filled with a default sex, UTC+8, noon, or the system time zone. Gregorian and lunar inputs support years 1600–2200; lunar leap months and Gregorian dates are validated first. Algorithmic support does not mean that every date in this range has received independent calendar certification.

Only fields defined by BirthInput are accepted. Unknown fields, arrays, and non-plain objects are rejected. Time fields are mutually exclusive by mode: exact permits only time, range permits only startTime/endTime, and unknown permits no time fields. Callers should omit unused fields rather than submit empty strings or undefined. This also prevents extra metadata from being echoed through input.

- `exact`: accepts strict `HH:mm`, interpreted at second 0 of that civil minute; seconds and 24:00 are rejected.
- `range`: start and end minutes on the same input date, inclusive. Cross-date ranges are explicitly rejected; callers must create separate candidate sets for each date.
- `unknown`: enumerates every minute from 00:00–23:59, rather than only the midpoints of the twelve traditional two-hour periods. This retains minute-level structural differences around the Zi period, solar terms, and true-solar-time date changes.
- Candidates are merged only when all four year/month/day/hour pillars match exactly, retaining `civilTimes`. Each ID is derived deterministically from the four pillars and represents no priority, confidence, or probability. Results follow the chronological order of first occurrence.

In Node, time-zone interpretation uses the host's Intl/ICU time-zone database. The module first collects offsets minute by minute across a surrounding UTC interval, then validates every UTC interpretation of each target civil minute. A nonexistent minute is not moved to another clock time: an exact input in a gap raises an error; gaps within a range are skipped with an explicit warning; a fully skipped day raises an error. Repeated minutes retain all interpretations. If their pillars match, every UTC instant is retained in `features.ambiguousTimeAlternatives`; if true solar time produces different pillars, separate candidates are returned. The wrapper does not silently adopt the upstream calculator's choice of the earlier repeated instant.

## Rule Profile and Retained Information

The integration retains Zhenyi's day change at hour 0 (midnight); its late-Zi treatment from 23:00–24:00, using the current day's pillar and a separately derived hour stem; the year boundary at Lichun (Start of Spring); month boundaries at the relevant solar terms; and blind-school conventions for nominal-age luck-cycle starts and Na Yin-based transitions. **Time coordinates follow this project's explicitly versioned split-clock policy, rather than the upstream entry point's use of one effective wall clock for the whole chart.** The `ruleProfile` is `zhenyi-blind-00h-split-zi-absolute-jieqi-utc8-local-dayhour-v2-minute`.

The reason is that upstream [GetAdjustedJQ](https://github.com/ZHENYI-ORG/Zhenyi-bazi/blob/383a726437a81db2b87eed517ef5e6ccd30b7bd4/dist/core/LocalPaipan.js#L162-L178) explicitly adds 1/3 of a day to solar-term Julian dates, placing them at fixed UTC+8. Comparing these directly with New York or true-solar wall time would move the actual solar-term boundary. The wrapper therefore calculates each real UTC candidate as follows:

1. Year/month: convert the absolute instant to fixed UTC+8, matching the upstream solar-term table's coordinates, and retain only the year and month from this GetGanZhi call.
2. Day/hour: use the explicitly selected local civil clock or the true-solar clock corrected for longitude and the equation of time, retaining only the day and hour from this calculation.
3. Luck-cycle start and sequence: calculate from the same representative instant expressed at fixed UTC+8, avoiding a start based on the wrong month pillar. `qiyun.referenceTimeBasis` and the +08:00 suffix on transition `startTime` explicitly record this convention.

Consequently, longitude and the true-solar-time setting do not shift a solar term that occurs simultaneously worldwide; day and hour pillars can still differ with local time. This is an explicit software rule choice, not a claim that every divination school follows the same convention. The original vendor files remain unchanged; coordinate separation occurs only in the local wrapper.

True-solar-time correction uses the unchanged upstream calculator with a zero UTC offset to obtain the longitude/equation-of-time result, then subtracts the offset for each actual time-zone interpretation. This wrapper preserves both DST interpretations and historical offsets with second-level components; it does not use the entry point that automatically selects the earlier DST instant. The equation of time comes from the upstream month/day table, not a solar ephemeris calculated second by second for the birth year. Candidate enumeration has one-minute resolution. It cannot guarantee coverage of structures that exist only briefly within a minute, and is not a certification of birth time to the second.

Each candidate's `features` includes:

- `hiddenStems`, `tenGods`, `nayin`, and `fiveElements`. The Five Elements values are unweighted counts of visible stems and the branches' principal elements, not strength scores. Hidden stems retain `principal` and the underlying `upstreamOrder`. This order does not always match the secondary/residual-stem ordering in the upstream display adapter, so array order is not presented as a strength ranking.
- The 12 major luck cycles in `luckCycles`: each pillar, starting and ending nominal ages, starting and ending Gregorian years, the transition instant at fixed UTC+8, and the convention assigning five years each to its stem and branch. Start/end years are coarse labels for the ten-year phase, not precise UTC intervals.
- The `qiyun` method, source day count, nominal age, and explanation of the Na Yin transition convention. Qiyun denotes the start of the major luck-cycle sequence; nominal age is the traditional age-counting convention used upstream.
- The `representative` civil time, UTC instant, offset, effective day/hour calculation time, and year/month `solarTermTime`; `timeBasis/solarTermTimeBasis/solarDate` and time-zone metadata; and all interpretations of a repeated civil time.

**Matching four pillars do not imply matching luck-cycle start instants.** The start and cycle sequence are calculated from the first valid minute and its time-zone interpretation in each group. `luckCyclesRepresentative.exactForAllGroupedMinutes=false`, and groups containing multiple minutes carry a warning. An application that needs an exact transition comparison against a dated life event must recalculate the relevant candidate minutes separately, rather than treating the representative value as exact for the whole group.

`LocalPaipan.GetInfo` still computes upstream descriptive, weighted Five Elements values internally because the vendor file remains unchanged. This project neither exposes nor reads those values to filter candidates. It also does not invoke the complete `BlindJudgmentEngine` for principal-function judgments, path scores, final interpretations, or future event-timing projections.

## Validation Scope

`node --test tests/chartEngine.test.ts` uses synthetic inputs and public upstream examples. It covers fixed pillar fixtures, early and late Zi periods, all 1440 minutes of a day, hour and Lichun boundaries, Gregorian/lunar dates and leap months, true-solar-time date changes, missing/unknown/conflicting fields, DST gaps and repeated times, Apia's skipped date, repeatability, unchanged inputs, and original vendor-file integrity. Tests use no real user information, call no models, and make no network requests.

Independent solar-term fixtures come from the [Hong Kong Observatory's February 2026 calendar](https://www.hko.gov.hk/tc/gts/astron2026/files/2026cal02.pdf) and the [National Astronomical Observatory of Japan's 2026 calendar tables](https://eco.mtk.nao.ac.jp/koyomi/yoko/2026/rekiyou262.html):

| Solar term | Date (month/day) | Published time |
| --- | --- | --- |
| Lichun (Start of Spring) | 2/4 | 04:02 HKT / 05:02 JST |
| Jingzhe (Awakening of Insects) | 3/5 | 22:59 JST |

Tests use instants two minutes before and after the published minute to check Lichun falling on the previous civil date in New York, the Jingzhe month change, consistent year/month pillars for the same UTC instant across time zones, and solar-term invariance under true-solar longitude correction. These are independent astronomical date-boundary checks; expected results are not generated by the upstream functions.

The tests establish consistency of the listed software behaviors with the pinned rule profile. They do not establish the truth or accuracy of BaZi, birth-time inference, or life-event predictions. Comprehensive historical time-zone certification, second-level time uncertainty, astronomical-accuracy certification across all supported years, and cross-school validation remain incomplete.
