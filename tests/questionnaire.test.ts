import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidence,
  getQuestionnaire,
  QuestionnaireValidationError,
  validateAnswers,
} from "../src/questionnaire.ts";
import type { Answer, QuestionnaireAnswers } from "../src/questionnaire.ts";

const reference = { birthDate: "2000-05-15", asOfDate: "2026-10-28" };

function completeUnknown(): QuestionnaireAnswers {
  return {
    responses: Object.fromEntries(getQuestionnaire().sections.flatMap((section) => section.questions.map((question) => [question.id, { status: "unknown" } as Answer]))),
    applicability: { current_identity_is_working_or_has_work_history: "unknown", childbearing_applicable: "unknown" },
  };
}

function completeSynthetic(): QuestionnaireAnswers {
  const submission = completeUnknown();
  submission.applicability = { current_identity_is_working_or_has_work_history: true, childbearing_applicable: true };
  for (const section of getQuestionnaire().sections) {
    for (const question of section.questions) {
      let value: Answer & { status: "answered" };
      if (question.type === "single_choice") value = { status: "answered", value: question.options![0]!.id };
      else if (question.type === "multi_choice") value = { status: "answered", value: [question.options![0]!.id] };
      else if (question.type === "short_text") value = { status: "answered", value: "合成测试背景，没有真实个人数据。" };
      else value = { status: "answered", value: [{ year: 2020, description: "合成测试事件", ...(question.eventTypeOptions ? { eventType: question.eventTypeOptions[0]!.id } : {}) }] };
      submission.responses[question.id] = value;
    }
  }
  return submission;
}

function withResponse(id: string, response: unknown): unknown {
  const submission = completeUnknown();
  return { ...submission, responses: { ...submission.responses, [id]: response } };
}

function rejected(input: unknown, code: string): void {
  const validation = validateAnswers(input, reference);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((issue) => issue.code === code), JSON.stringify(validation.errors));
}

test("questionnaire provides 27 uniquely named questions in two sections and preserves provenance", () => {
  const questionnaire = getQuestionnaire();
  assert.deepEqual(questionnaire.sections.map((section) => [section.id, section.questions.length]), [["evidence", 17], ["context", 10]]);
  const questions = questionnaire.sections.flatMap((section) => section.questions);
  assert.equal(new Set(questions.map((question) => question.id)).size, 27);
  assert.ok(questions.every((question) => question.required && question.sourceRequired === false));
  assert.ok(questions.every((question) => question.label && question.type && question.stage && question.purpose));
  assert.ok(questions.every((question) => !question.id.startsWith("A")));
  assert.equal(questionnaire.provenance.sourceVersion, "1.1");
  assert.match(questionnaire.provenance.sourceFileSha256, /^[a-f0-9]{64}$/);
  assert.equal(questionnaire.completionPolicy.allApplicableBeforeAI, true);
  assert.equal(questionnaire.sections[0]!.questions.find((question) => question.id === "C7_career_years")!.condition, "current_identity_is_working_or_has_work_history");
});

test("returned definitions cannot change subsequent questionnaire behavior", () => {
  const first = getQuestionnaire();
  first.sections[0]!.questions[0]!.label = "mutated";
  first.sections[0]!.questions[0]!.options!.splice(0);
  assert.notEqual(getQuestionnaire().sections[0]!.questions[0]!.label, "mutated");
  assert.equal(validateAnswers(completeSynthetic(), reference).valid, true);
});

test("a complete synthetic submission and explicit unknown answers are valid without fabricating evidence", () => {
  assert.deepEqual(validateAnswers(completeSynthetic(), reference), { valid: true, errors: [], missingQuestionIds: [] });
  const unknown = completeUnknown();
  assert.equal(validateAnswers(unknown, reference).valid, true);
  const bundle = buildEvidence(unknown, reference);
  assert.equal(bundle.evidence.length, 17);
  assert.equal(bundle.context.length, 10);
  assert.ok([...bundle.evidence, ...bundle.context].every((item) => item.informationStatus === "unknown"));
});

test("all applicable questions need an explicit reply, including context questions", () => {
  const submission = completeUnknown();
  delete submission.responses.B1_hair_whorl;
  delete submission.responses.D10_recent_focus_or_anxiety;
  const validation = validateAnswers(submission, reference);
  assert.deepEqual(validation.missingQuestionIds, ["B1_hair_whorl", "D10_recent_focus_or_anxiety"]);
  assert.equal(validation.valid, false);
});

test("a false applicability gate permits omission without inventing a response", () => {
  const submission = completeUnknown();
  submission.applicability.current_identity_is_working_or_has_work_history = false;
  submission.applicability.childbearing_applicable = false;
  delete submission.responses.C7_career_years;
  delete submission.responses.C8_childbearing_years;
  assert.equal(validateAnswers(submission, reference).valid, true);
  const bundle = buildEvidence(submission, reference);
  assert.equal(bundle.evidence.length, 15);
  assert.equal(bundle.evidence.some((item) => item.id === "C7_career_years"), false);
});

test("unknown applicability does not silently skip a question", () => {
  const submission = completeUnknown();
  delete submission.responses.C8_childbearing_years;
  rejected(submission, "required_answer");
});

test("inactive questions cannot contain an asserted event or ambiguous status", () => {
  const submission = completeUnknown();
  submission.applicability.childbearing_applicable = false;
  rejected(submission, "inactive_question");
  submission.responses.C8_childbearing_years = { status: "not_applicable" };
  assert.equal(validateAnswers(submission, reference).valid, true);
});

test("a known working identity cannot contradict the employment applicability gate", () => {
  const submission = completeUnknown();
  submission.applicability.current_identity_is_working_or_has_work_history = false;
  submission.responses.C7_career_years = { status: "not_applicable" };
  submission.responses.D6_current_identity = { status: "answered", value: "professional" };
  rejected(submission, "conflicting_applicability");
});

test("not applicable is an explicit answer, never a made-up substantive value", () => {
  const submission = completeUnknown();
  submission.responses.C5_health_or_accident_years = { status: "not_applicable" };
  submission.responses.B4_little_finger_length = { status: "not_applicable" };
  assert.equal(validateAnswers(submission, reference).valid, true);
  assert.equal(buildEvidence(submission, reference).evidence.find((item) => item.id === "C5_health_or_accident_years")!.informationStatus, "not_applicable");
});

test("rejects malformed envelopes, unknown question IDs, old birth fields, and unknown gates", () => {
  for (const input of [null, [], "answers", new Date()]) rejected(input, "invalid_object");
  rejected({ responses: [], applicability: {} }, "invalid_object");
  rejected({ ...completeUnknown(), extra: true }, "extra_field");
  rejected({ ...completeUnknown(), applicability: {} }, "invalid_applicability");
  rejected({ ...completeUnknown(), applicability: { ...completeUnknown().applicability, extra: true } }, "unknown_condition");
  rejected({ ...completeUnknown(), applicability: { ...completeUnknown().applicability, childbearing_applicable: "false" } }, "invalid_applicability");
  rejected(withResponse("A1_birth_date", { status: "answered", value: "2000-05-15" }), "unknown_question");
  rejected(withResponse("x".repeat(81), { status: "unknown" }), "unknown_question");
});

test("rejects extra fields at response and event levels", () => {
  rejected(withResponse("B1_hair_whorl", { status: "unknown", value: "one_centered" }), "extra_field");
  rejected(withResponse("B1_hair_whorl", { status: "answered", value: "one_centered", confidence: 1 }), "extra_field");
  rejected(withResponse("C1_major_turning_years", { status: "answered", value: [{ year: 2020, description: "合成事件", score: 100 }] }), "extra_field");
});

test("rejects invalid status, missing choice, arbitrary choice values, and duplicate or excessive multi selections", () => {
  rejected(withResponse("B1_hair_whorl", { status: "maybe" }), "invalid_status");
  rejected(withResponse("B1_hair_whorl", { status: "answered" }), "invalid_choice");
  rejected(withResponse("B1_hair_whorl", { status: "answered", value: "invented" }), "invalid_choice");
  rejected(withResponse("D9_desired_life_outcomes", { status: "answered", value: [] }), "invalid_choices");
  rejected(withResponse("D9_desired_life_outcomes", { status: "answered", value: ["career_growth", "career_growth"] }), "invalid_choices");
  rejected(withResponse("D9_desired_life_outcomes", { status: "answered", value: ["career_growth", "financial_security", "health"] }), "invalid_choices");
  rejected(withResponse("D4_family_values", { status: "answered", value: ["unknown", "independence"] }), "conflicting_choices");
});

test("preserves source choice IDs while marking legacy unknown options as uncertain", () => {
  const submission = completeUnknown();
  submission.responses.B3_siblings = { status: "answered", value: "complex_unknown" };
  submission.responses.B6_sleep_posture = { status: "answered", value: "varies_unknown" };
  const bundle = buildEvidence(submission, reference);
  const item = bundle.evidence.find((entry) => entry.id === "B3_siblings")!;
  assert.deepEqual(item.answer, { status: "answered", value: "complex_unknown" });
  assert.deepEqual(item.answerLabels, ["情况复杂或不确定"]);
  assert.equal(item.informationStatus, "unknown");
  assert.equal(bundle.evidence.find((entry) => entry.id === "B6_sleep_posture")!.informationStatus, "unknown");
});

test("enforces text limits and rejects empty or control-character text", () => {
  assert.equal(validateAnswers(withResponse("D1_growth_location", { status: "answered", value: "甲".repeat(160) }), reference).valid, true);
  for (const value of ["甲".repeat(161), "   ", "text\u0000text", 123, {}]) rejected(withResponse("D1_growth_location", { status: "answered", value }), "invalid_text");
  rejected(withResponse("C1_major_turning_years", { status: "answered", value: [{ year: 2020, description: "甲".repeat(401) }] }), "invalid_text");
});

test("events require a nonempty bounded array, integer known year and description", () => {
  for (const value of [[], "2020", [{ year: 2020 }], [{ year: "2020", description: "合成事件" }]]) {
    assert.equal(validateAnswers(withResponse("C1_major_turning_years", { status: "answered", value }), reference).valid, false);
  }
  rejected(withResponse("C1_major_turning_years", { status: "answered", value: [2010, 2011, 2012, 2013].map((year) => ({ year, description: "合成事件" })) }), "invalid_events");
  for (const year of [1999, 2027, 2020.5, NaN, Infinity, 0]) rejected(withResponse("C1_major_turning_years", { status: "answered", value: [{ year, description: "合成事件" }] }), "invalid_year");
});

test("checks exact-date format, leap days, year consistency and birth/current-date boundaries", () => {
  for (const [year, date] of [[2020, "2020-02-30"], [2021, "2021-02-29"], [2020, "2020-2-29"], [2020, "2020-13-01"], [2020, "2020-00-01"], [2020, "2021-01-01"], [2000, "2000-05-14"], [2026, "2026-10-29"], [2020, "2020-02-29T12:00:00Z"]] as const) {
    rejected(withResponse("C1_major_turning_years", { status: "answered", value: [{ year, date, description: "合成事件" }] }), "invalid_date");
  }
  for (const [year, date] of [[2020, "2020-02-29"], [2000, "2000-05-15"], [2026, "2026-10-28"]] as const) {
    assert.equal(validateAnswers(withResponse("C1_major_turning_years", { status: "answered", value: [{ year, date, description: "合成事件" }] }), reference).valid, true);
  }
});

test("missing exact dates stay missing; year-only events do not acquire invented months or days", () => {
  const submission = completeUnknown();
  submission.responses.C1_major_turning_years = { status: "answered", value: [{ year: 2000, description: "仅知道年份的合成事件" }] };
  const item = buildEvidence(submission, reference).evidence.find((entry) => entry.id === "C1_major_turning_years")!;
  assert.deepEqual(item.answer, submission.responses.C1_major_turning_years);
  assert.ok(!JSON.stringify(item.answer).includes('"date"'));
});

test("best/worst year events need a valid event type; fixed event types cannot be overwritten", () => {
  rejected(withResponse("C9_best_and_worst_years", { status: "answered", value: [{ year: 2020, description: "合成事件" }] }), "invalid_event_type");
  rejected(withResponse("C9_best_and_worst_years", { status: "answered", value: [{ year: 2020, description: "合成事件", eventType: "career" }] }), "invalid_event_type");
  rejected(withResponse("C2_education_years", { status: "answered", value: [{ year: 2020, description: "合成事件", eventType: "career" }] }), "invalid_event_type");
  assert.equal(validateAnswers(withResponse("C9_best_and_worst_years", { status: "answered", value: [{ year: 2020, description: "合成事件", eventType: "best_year" }] }), reference).valid, true);
});

test("duplicates do not inflate a single question's event list", () => {
  rejected(withResponse("C2_education_years", { status: "answered", value: [{ year: 2020, description: "合成事件" }, { year: 2020, description: " 合成事件 ", eventType: "education" }] }), "duplicate_event");
});

test("invalid date context is rejected and reference fields cannot silently be ignored", () => {
  for (const context of [{ birthDate: "2000-02-30" }, { birthDate: "2027-01-01", asOfDate: "2026-10-28" }, { asOfDate: "2026-1-1" }, { birthDate: "1899-01-01" }]) {
    assert.equal(validateAnswers(completeUnknown(), context).valid, false);
  }
  assert.equal(validateAnswers(completeUnknown(), { ...reference, date: "2000-01-01" } as typeof reference).valid, false);
  assert.equal(validateAnswers(completeUnknown()).valid, true);
});

test("structured evidence has stable IDs, separates purposes and does not claim independent hits", () => {
  const input = completeSynthetic();
  const bundle = buildEvidence(input, reference);
  const questionnaire = getQuestionnaire();
  assert.deepEqual(bundle.evidence.map((item) => item.id), questionnaire.sections[0]!.questions.map((question) => question.id));
  assert.ok(bundle.evidence.every((item) => item.purpose === "rectification_matching" && item.stage !== "context_box"));
  assert.ok(bundle.context.every((item) => item.purpose === "contextual_analysis" && item.stage === "context_box"));
  assert.ok([...bundle.evidence, ...bundle.context].every((item) => item.source === "user_report" && item.independentlyVerified === false && !("score" in item) && !("confidence" in item)));
  bundle.evidence[0]!.answer = { status: "unknown" };
  assert.notEqual(input.responses.B1_hair_whorl!.status, "unknown");
  assert.throws(() => buildEvidence({ responses: {}, applicability: {} }, reference), QuestionnaireValidationError);
});

test("malformed object event fields are rejected rather than coerced or serialized", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const result = validateAnswers(withResponse("C1_major_turning_years", { status: "answered", value: [{ year: 2020, description: "合成事件", date: cyclic, eventType: cyclic }] }), reference);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.code === "invalid_date"));
});
