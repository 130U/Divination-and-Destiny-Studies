import questionBank from '../configs/question_bank.v1.json' with { type: 'json' };

export type QuestionStage = "symbol_prior" | "event_backtest" | "context_box";
export type QuestionPurpose = "rectification_matching" | "contextual_analysis";
export type Applicability = boolean | "unknown";
export type QuestionType = "single_choice" | "multi_choice" | "short_text" | "year_event" | "year_event_list";
export interface QuestionOption { id: string; label: string }
export interface QuestionDefinition {
  id: string;
  label: string;
  type: QuestionType;
  stage: QuestionStage;
  stageLabel: string;
  purpose: QuestionPurpose;
  required: boolean;
  sourceRequired: boolean;
  options?: QuestionOption[];
  unknownOptionIds?: string[];
  condition?: string;
  maxLength?: number;
  maxSelections?: number;
  maxItems?: number;
  eventType?: string;
  eventTypeOptions?: QuestionOption[];
}
export interface ApplicabilityQuestion {
  id: string;
  label: string;
  type: "single_choice";
  required: boolean;
  options: QuestionOption[];
  impliedTrueBy?: { questionId: string; optionIds: string[] };
}
export interface Questionnaire {
  version: string;
  provenance: {
    sourceRepository: string;
    sourcePath: string;
    sourceVersion: string;
    sourceCheckoutRevision: string;
    sourceFileSha256: string;
    copiedOn: string;
    authorization: string;
    revisionNote: string;
    adaptations: string[];
  };
  completionPolicy: {
    allApplicableBeforeAI: boolean;
    questionnaireOptional: boolean;
    missingAnswerStatus: "unknown";
    missingApplicability: "unknown";
    allowUnknown: boolean;
    allowNotApplicable: boolean;
    skipOnlyWhenConditionFalse: boolean;
    evidenceSource: "user_report";
    independentlyVerified: false;
  };
  answerStatuses: QuestionOption[];
  limits: {
    minimumDate: string;
    maxEventDescriptionLength: number;
    maxTextLength: number;
    maxResponses: number;
    maxQuestionIdLength: number;
  };
  eventFields: Record<string, { label: string; type?: string; required?: boolean; format?: string; maxLength?: number; requiredFor?: string }>;
  applicabilityQuestions: ApplicabilityQuestion[];
  sections: { id: "evidence" | "context"; title: string; questions: QuestionDefinition[] }[];
}
export interface YearEvent {
  year: number;
  description: string;
  eventType?: string;
  date?: string;
}
export type Answer =
  | { status: "answered"; value: string | string[] | YearEvent[] | YearEvent }
  | { status: "unknown" }
  | { status: "not_applicable" };
export interface QuestionnaireAnswers {
  responses: Record<string, Answer>;
  applicability: Record<string, Applicability>;
}
export interface QuestionnaireBirthContext { birthDate?: string; asOfDate?: string }
export interface ValidationIssue { path: string; code: string; message: string }
export interface AnswersValidation {
  valid: boolean;
  errors: ValidationIssue[];
  missingQuestionIds: string[];
}
export interface EvidenceItem {
  id: string;
  label: string;
  answer: Answer;
  answerLabels?: string[];
  stage: QuestionStage;
  purpose: QuestionPurpose;
  source: "user_report";
  independentlyVerified: false;
  informationStatus: "known" | "unknown" | "not_applicable";
}
export interface EvidenceBundle { evidence: EvidenceItem[]; context: EvidenceItem[] }

const bank = structuredClone(questionBank) as Questionnaire;
const questions = bank.sections.flatMap((section) => section.questions);
const questionMap = new Map(questions.map((question) => [question.id, question]));
const conditionMap = new Map(bank.applicabilityQuestions.map((question) => [question.id, question]));

/** Returns an isolated copy so a UI cannot mutate the validator's definitions. */
export function getQuestionnaire(): Questionnaire {
  return structuredClone(bank);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isISODate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

/** Strict internal check for normalized answers; intake uses normalizeAnswers. */
export function validateAnswers(answers: unknown, birth?: QuestionnaireBirthContext): AnswersValidation {
  const errors: ValidationIssue[] = [];
  const missingQuestionIds: string[] = [];
  const add = (path: string, code: string, message: string): void => { errors.push({ path, code, message }); };
  const extraKeys = (record: Record<string, unknown>, allowed: readonly string[], path: string): void => {
    for (const key of Object.keys(record)) {
      if (!allowed.includes(key)) add(`${path}.${key}`, "extra_field", "包含不允许的字段。");
    }
  };
  const result = (): AnswersValidation => ({ valid: errors.length === 0, errors, missingQuestionIds });
  let asOfDate = new Date().toISOString().slice(0, 10);
  let minimumDate = bank.limits.minimumDate;
  if (birth !== undefined) {
    if (!isRecord(birth)) add("birth", "invalid_object", "出生日期参考必须是对象。");
    else {
      extraKeys(birth, ["birthDate", "asOfDate"], "birth");
      if ("asOfDate" in birth) {
        if (!isISODate(birth.asOfDate) || birth.asOfDate < bank.limits.minimumDate) add("birth.asOfDate", "invalid_date", "参考日期须为有效的 YYYY-MM-DD。");
        else asOfDate = birth.asOfDate;
      }
      if ("birthDate" in birth) {
        if (!isISODate(birth.birthDate) || birth.birthDate < minimumDate || birth.birthDate > asOfDate) add("birth.birthDate", "invalid_date", "出生日期须在支持范围内且不晚于参考日期。");
        else minimumDate = birth.birthDate;
      }
    }
  }
  if (!isRecord(answers)) {
    add("answers", "invalid_object", "问卷提交必须是对象。");
    return result();
  }
  extraKeys(answers, ["responses", "applicability"], "answers");
  if (!isRecord(answers.responses)) add("responses", "invalid_object", "responses 必须是按题目 ID 索引的对象。");
  if (!isRecord(answers.applicability)) add("applicability", "invalid_object", "须填写适用性确认。");
  if (!isRecord(answers.responses) || !isRecord(answers.applicability)) return result();
  const responses = answers.responses;
  const applicability = answers.applicability;
  for (const key of Object.keys(applicability)) {
    if (!conditionMap.has(key)) add(`applicability.${key}`, "unknown_condition", "不是本版本题库中的适用条件。");
  }
  for (const condition of bank.applicabilityQuestions) {
    const answer = applicability[condition.id];
    if (answer !== true && answer !== false && answer !== "unknown") add(`applicability.${condition.id}`, "invalid_applicability", "适用性须明确为 true、false 或 unknown。");
    const implication = condition.impliedTrueBy;
    if (answer === false && implication) {
      const reply = responses[implication.questionId];
      if (isRecord(reply) && reply.status === "answered" && typeof reply.value === "string" && implication.optionIds.includes(reply.value)) {
        add(`applicability.${condition.id}`, "conflicting_applicability", "适用性与已填写的身份信息冲突。");
      }
    }
  }
  if (Object.keys(responses).length > bank.limits.maxResponses) add("responses", "too_many_answers", "回答数量超过本版本题库上限。");
  for (const id of Object.keys(responses)) {
    if (id.length > bank.limits.maxQuestionIdLength || !questionMap.has(id)) add(`responses.${id}`, "unknown_question", "不是本版本题库中的题目 ID。");
  }
  for (const question of questions) {
    const path = `responses.${question.id}`;
    const hasResponse = Object.hasOwn(responses, question.id);
    const inactive = question.condition !== undefined && applicability[question.condition] === false;
    if (!hasResponse) {
      if (!inactive) {
        missingQuestionIds.push(question.id);
        add(path, "required_answer", "此项尚未规范化为明确答案或 unknown。");
      }
      continue;
    }
    const response = responses[question.id];
    if (!isRecord(response)) {
      add(path, "invalid_answer", "答案须包含明确的 status。");
      continue;
    }
    extraKeys(response, response.status === "answered" ? ["status", "value"] : ["status"], path);
    if (inactive && response.status !== "not_applicable") add(path, "inactive_question", "此题已标为不适用，只能省略或填写 not_applicable。");
    if (response.status === "unknown" || response.status === "not_applicable") continue;
    if (response.status !== "answered") {
      add(`${path}.status`, "invalid_status", "状态须为 answered、unknown 或 not_applicable。");
      continue;
    }
    const value = response.value;
    const optionIds = new Set(question.options?.map((option) => option.id));
    if (question.type === "single_choice") {
      if (typeof value !== "string" || !optionIds.has(value)) add(`${path}.value`, "invalid_choice", "须使用题库中的一个选项 ID。");
    } else if (question.type === "multi_choice") {
      if (!Array.isArray(value) || value.length === 0 || value.length > (question.maxSelections ?? optionIds.size)) add(`${path}.value`, "invalid_choices", "选项数量不符合题目要求。");
      else {
        if (value.some((item) => typeof item !== "string" || !optionIds.has(item)) || new Set(value).size !== value.length) add(`${path}.value`, "invalid_choices", "选项须来自题库且不得重复。");
        if (value.length > 1 && value.some((item) => question.unknownOptionIds?.includes(item as string))) add(`${path}.value`, "conflicting_choices", "不知道 / 暂不提供不能与实质选项并选。");
      }
    } else if (question.type === "short_text") {
      if (!validText(value, question.maxLength ?? bank.limits.maxTextLength)) add(`${path}.value`, "invalid_text", "文字不能为空、含非法控制字符或超过长度上限。");
    } else {
      const events = question.type === "year_event" ? [value] : value;
      if (!Array.isArray(events) || events.length === 0 || events.length > (question.maxItems ?? 1)) {
        add(`${path}.value`, "invalid_events", "事件列表须有内容且不超过题目数量上限；没有经历请选择不适用。");
        continue;
      }
      const seen = new Set<string>();
      for (const [index, event] of events.entries()) {
        const eventPath = question.type === "year_event" ? `${path}.value` : `${path}.value[${index}]`;
        if (!isRecord(event)) {
          add(eventPath, "invalid_event", "每条事件须是包含 year 和 description 的对象。");
          continue;
        }
        extraKeys(event, ["year", "description", "eventType", "date"], eventPath);
        if (typeof event.year !== "number" || !Number.isInteger(event.year) || event.year < Number(minimumDate.slice(0, 4)) || event.year > Number(asOfDate.slice(0, 4))) add(`${eventPath}.year`, "invalid_year", "年份须为出生至参考日期范围内的整数；不知道年份时请选 unknown。");
        if (!validText(event.description, bank.limits.maxEventDescriptionLength)) add(`${eventPath}.description`, "invalid_text", "事件描述不能为空、含非法控制字符或超过长度上限。");
        if ("date" in event && (!isISODate(event.date) || event.date < minimumDate || event.date > asOfDate || Number(event.date.slice(0, 4)) !== event.year)) add(`${eventPath}.date`, "invalid_date", "日期须真实有效、与年份一致，并位于出生至参考日期范围内。");
        if (question.eventTypeOptions) {
          if (typeof event.eventType !== "string" || !question.eventTypeOptions.some((option) => option.id === event.eventType)) add(`${eventPath}.eventType`, "invalid_event_type", "此题须明确选择题库中的事件类型。");
        } else if ("eventType" in event && event.eventType !== question.eventType) add(`${eventPath}.eventType`, "invalid_event_type", "事件类型须与本题定义一致。");
        if (typeof event.year === "number" && typeof event.description === "string") {
          const identity = JSON.stringify([event.year, event.description.trim(), typeof event.date === "string" ? event.date : null, typeof event.eventType === "string" ? event.eventType : question.eventType]);
          if (seen.has(identity)) add(eventPath, "duplicate_event", "同一题不得重复提交同一事件。");
          seen.add(identity);
        }
      }
    }
  }
  return result();
}

export class QuestionnaireValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super("已填写的问卷内容格式无效；未填写的项目可以留空。");
    this.name = "QuestionnaireValidationError";
    this.issues = structuredClone(issues);
  }
}

/** Optional input becomes explicit unknowns; no substantive answer is inferred. */
export function normalizeAnswers(answers?: unknown, birth?: QuestionnaireBirthContext): QuestionnaireAnswers {
  const supplied = answers === undefined ? {} : answers;
  if (!isRecord(supplied)) throw new QuestionnaireValidationError([{ path: "answers", code: "invalid_object", message: "问卷须为对象，或直接省略。" }]);
  const normalized: Record<string, unknown> = { ...supplied };
  const applicability = Object.hasOwn(supplied, "applicability") ? supplied.applicability : {};
  const responses = Object.hasOwn(supplied, "responses") ? supplied.responses : {};
  if (isRecord(applicability)) {
    const defaults: Record<string, unknown> = { ...applicability };
    for (const condition of bank.applicabilityQuestions) {
      if (!Object.hasOwn(defaults, condition.id)) defaults[condition.id] = "unknown";
    }
    normalized.applicability = defaults;
  } else normalized.applicability = applicability;
  if (isRecord(responses)) {
    const defaults: Record<string, unknown> = { ...responses };
    for (const question of questions) {
      if (!Object.hasOwn(defaults, question.id)) {
        const inactive = question.condition !== undefined && isRecord(normalized.applicability) && normalized.applicability[question.condition] === false;
        defaults[question.id] = { status: inactive ? "not_applicable" : "unknown" };
      }
    }
    normalized.responses = defaults;
  } else normalized.responses = responses;
  const validation = validateAnswers(normalized, birth);
  if (!validation.valid) throw new QuestionnaireValidationError(validation.errors);
  return structuredClone(normalized) as unknown as QuestionnaireAnswers;
}

/** Organizes self-reports for comparison; it makes no independent hit claim. */
export function buildEvidence(answers?: unknown, birth?: QuestionnaireBirthContext): EvidenceBundle {
  const validated = normalizeAnswers(answers, birth);
  const bundle: EvidenceBundle = { evidence: [], context: [] };
  for (const section of bank.sections) {
    for (const question of section.questions) {
      const answer = validated.responses[question.id];
      if (answer === undefined) continue;
      let informationStatus: EvidenceItem["informationStatus"] = answer.status === "answered" ? "known" : answer.status;
      let answerLabels: string[] | undefined;
      if (answer.status === "answered" && (question.type === "single_choice" || question.type === "multi_choice")) {
        const values = typeof answer.value === "string" ? [answer.value] : answer.value as string[];
        answerLabels = values.map((value) => question.options!.find((option) => option.id === value)!.label);
        if (values.every((value) => question.unknownOptionIds?.includes(value))) informationStatus = "unknown";
      }
      const item: EvidenceItem = {
        id: question.id,
        label: question.label,
        answer: structuredClone(answer),
        stage: question.stage,
        purpose: question.purpose,
        source: "user_report",
        independentlyVerified: false,
        informationStatus,
      };
      if (answerLabels !== undefined) item.answerLabels = answerLabels;
      bundle[section.id].push(item);
    }
  }
  return bundle;
}
