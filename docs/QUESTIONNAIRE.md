# Questionnaire Inputs and Evidence Boundaries

This module separates optional responses into chart-comparison evidence and analysis context. Before an AI request, it marks missing information as unknown and validates any supplied answers. All 27 questions and 2 applicability checks may be left blank; sufficient birth information is enough to generate charts and proceed. This module does not rank candidate charts, calculate divination scores, determine a birth time, or call external services.

## Source and Adaptation

The question design was reused, with the user's authorization, from `configs/question_bank.v1.json` in `130U/bazi-context-agent`, source version `1.1`. The old repository's HEAD at the time of reading was `b277fec462bada4c09ac651ed02a68d25ccd935d`; the actual source file's SHA-256 was `a10cac9ad1928d702f81e3b71fcc8bcf51e5c025279192fcaab0aa3c50b135ff`. HEAD identifies the checkout at that time, while the file hash identifies the copied content. The source working-tree file is not assumed to match that commit. The old repository was read only.

The adapted question bank is version `1.1.0`, with full provenance in its JSON `provenance` field. It retains all 27 question IDs in groups B, C, and D, their original wording, option IDs and labels, event types, applicability conditions, and count and length limits. Birth-information group A is handled by a separate required form and is not part of `responses`.

The source bank's higher-level strategies, such as adaptive questioning, stopping when scores stabilize, and collecting context only after a chart is locked, are not carried over. `sourceRequired` preserves the original setting; all current questions and applicability checks have `required: false`. Each question may be omitted or explicitly marked `unknown` or `not_applicable`. Original options such as "uncertain" and "complex or uncertain" remain available. Defaults for missing states come from the bank's `responsePolicy`.

| Section | Original stage | Content | Purpose |
| --- | --- | --- | --- |
| `evidence` | `symbol_prior` | B1–B8: traditional birth-time rectification clues | `rectification_matching` |
| `evidence` | `event_backtest` | C1–C9: self-reported major life events and their years | `rectification_matching` |
| `context` | `context_box` | D1–D10: family background, life paths, preferences, and concerns | `contextual_analysis` |

`event_backtest` is a retained stage ID. It does not mean that this module has performed a backtest, or that the user's past experiences constitute independent validation results.

## Question Bank and UI

`getQuestionnaire(): Questionnaire` returns an independent copy of the bank. Changing that object does not change the validation rules. All question wording, options, applicability conditions, and length limits come from `configs/question_bank.v1.json`; the UI does not define a separate question set.

Each question includes at least `id`, `label`, `type`, `stage`, `stageLabel`, `purpose`, `required`, and `sourceRequired`. Types include `single_choice`, `multi_choice`, `short_text`, and `year_event_list`. The module also supports a single `year_event`, although the current bank does not use it. Options use `{ id, label }`, and conditions are stored in `condition`. Event-input labels are in `eventFields`, and shared response states are in `answerStatuses`.

The bank also contains two optional `applicabilityQuestions`, establishing whether C7 work history and C8 childbearing or parenting experiences apply. Their UI option IDs are the strings `"true"`, `"false"`, and `"unknown"`; the first two must be converted to booleans when submitted. Missing values become `unknown`.

## Submission Format

The `answers` field in `POST /api/session` may be omitted entirely, supplied as `{}`, or contain only some `responses` and/or `applicability` fields. Null, arrays, and other non-object values are rejected. The following types describe the normalized internal structure; they do not require users to fill every field:

```ts
type Answer =
  | { status: "answered"; value: string | string[] | YearEvent[] | YearEvent }
  | { status: "unknown" }
  | { status: "not_applicable" };

interface YearEvent {
  year: number;
  description: string;
  date?: string;      // YYYY-MM-DD; supply only when the exact date is known
  eventType?: string;
}

interface QuestionnaireAnswers {
  responses: Record<string, Answer>;
  applicability: {
    current_identity_is_working_or_has_work_history: boolean | "unknown";
    childbearing_applicable: boolean | "unknown";
  };
}
```

A single-choice `value` uses the original option ID; multiple-choice answers use an array of distinct IDs; text answers use strings; event questions use arrays of events. Every C9 event must specify `eventType: "best_year" | "worst_year"`. Other event questions may omit `eventType`; when supplied, it must match the question's fixed event type.

This partial response can be submitted inside `answers.responses`, leaving the remaining questions blank:

```json
{
  "C1_major_turning_years": {
    "status": "answered",
    "value": [{ "year": 2020, "description": "Synthetic example: changed field of study" }]
  },
  "B1_hair_whorl": { "status": "unknown" },
  "C8_childbearing_years": { "status": "not_applicable" }
}
```

When a condition is `false`, an omitted dependent response becomes `not_applicable`; an explicitly supplied response must also use that state. When the condition is `true` or `unknown`, an omitted response becomes `unknown`. Questions without conditions may also be omitted. If the supplied occupational-identity answer clearly indicates work experience, work applicability cannot be marked `false`. These dependency rules are also defined in JSON.

Leaving every question blank or answering `unknown` still permits the two-stage AI workflow, but does not establish a correct birth time. A single candidate becomes the provisional working chart. With multiple candidates and weak evidence, the workflow still makes a provisional selection and explains the limited confidence. Reports use `chart_only` when no substantive chart-comparison or context information is available, and `context_supported` when it is. Neither label implies validated predictions or a probability estimate.

## Strict Validation

The public workflow first calls `normalizeAnswers(answers?, birth?)` to populate missing states, then uses `validateAnswers` below to validate the normalized object. `missingQuestionIds` checks the completeness of the internal structure; it does not require website users to answer every question. Invalid supplied content is still rejected.

```ts
validateAnswers(answers: unknown, birth?: {
  birthDate?: string;
  asOfDate?: string;
}): {
  valid: boolean;
  errors: { path: string; code: string; message: string }[];
  missingQuestionIds: string[];
}
```

The caller first generates the candidate set, then supplies the converted Gregorian birth date as `{ birthDate: candidateSet.candidates[0].features.solarDate, asOfDate: sessionAssessmentISODate }`. A raw lunar date must not be treated as Gregorian. If `asOfDate` is absent, validation uses the runtime's current UTC date; tests pass a fixed reference date for reproducibility. Other fields in this birth-context object are rejected, preventing a full birth form from being passed accidentally and silently ignored.

- Unknown fields are checked in questionnaire, applicability, answer, and event objects. Old group A fields and unknown question IDs are not accepted in `responses`.
- `unknown` and `not_applicable` must not carry a `value`. Empty strings, event arrays, and multiple-choice arrays cannot be presented as answered content.
- Single- and multiple-choice answers must use IDs from the bank. Multiple-choice IDs must be distinct and within the count limit; original "uncertain" options cannot be combined with substantive choices.
- Text must not consist only of whitespace, contain prohibited control characters, or exceed the question's limit. Event descriptions are limited to 400 JavaScript UTF-16 code units.
- Years must be integers between the birth year and the reference year. Without a birth date, the lower bound comes from `limits.minimumDate`, currently `1900-01-01`. String years, nulls, and unknown values are not coerced to numbers.
- An optional date must be a valid Gregorian date in strict `YYYY-MM-DD` format, agree with the event year, and fall between the birth date and reference date. Leap days are checked against Gregorian rules.
- Year-only events retain year-level precision; no month or day is invented. An event in the birth year without an exact date cannot be checked more precisely for whether it preceded the birthday.
- Identical events within one question are rejected as duplicates. The same experience may serve different purposes across questions; this module does not count those references as multiple independent hits.

Do not guess an unknown year; mark the question `unknown`. If that type of experience does not apply, use `not_applicable`. The module does not infer missing content.

## Structured Evidence

`buildEvidence(answers?, birth?)` first normalizes missing states and applies the same validator. On failure, it throws `QuestionnaireValidationError`, whose `issues` field contains structured errors. Valid input returns `{ evidence, context }`, with each item containing:

```ts
{
  id: string;                     // Original question ID, used as a stable reference
  label: string;                  // Original question wording
  answer: Answer;                 // Copy of the supplied answer, or normalized missing state
  answerLabels?: string[];        // Original single-/multiple-choice option labels
  stage: "symbol_prior" | "event_backtest" | "context_box";
  purpose: "rectification_matching" | "contextual_analysis";
  source: "user_report";
  independentlyVerified: false;
  informationStatus: "known" | "unknown" | "not_applicable";
}
```

`informationStatus: "known"` means only that a substantive answer was supplied, not that it has been verified as true. Original options `unknown`, `complex_unknown`, `varies_unknown`, and `prefer_not_to_say` are classified as `unknown` through the bank's `unknownOptionIds`, while retaining their original option IDs. Omitted questions still have an explicit unknown or not-applicable state, but no substantive answer is fabricated, and these states cannot be cited as known personal facts.

The model can use stable IDs to describe supporting and contradictory evidence, but that material has already participated in selecting the working chart. Citing it again cannot independently validate the selection. Evaluation would require separately held, reliable birth times or independent experiences not used in selection. This module outputs no scores, probabilities, or hit rates.

## Validation Scope

`tests/questionnaire.test.ts` uses entirely synthetic data to check optional inputs, missing-value normalization, internal completeness, applicability, unknown states, field rejection, option and length limits, dates and years, event types, duplicate events, evidence purposes, and copy isolation. These tests use no real personal cases, make no model requests, and cannot establish the validity of divination judgments.

```sh
node --test tests/questionnaire.test.ts
npm run check:type
```
