# 问卷输入与证据边界

本模块把可选回答分为校盘材料和分析背景，在 AI 请求前将缺失内容记为 unknown 并校验已填写内容。27 道问题与 2 道适用性确认全部可留空；出生资料足以排盘时可以先出结果。它不排候选盘、不计算命理分数、不判断出生时辰，也不调用外部服务。

## 来源与本次调整

问题设计经用户授权复用自 `130U/bazi-context-agent` 的 `configs/question_bank.v1.json`，源版本为 `1.1`。读取时旧仓库 HEAD 为 `b277fec462bada4c09ac651ed02a68d25ccd935d`；实际源文件 SHA-256 为 `a10cac9ad1928d702f81e3b71fcc8bcf51e5c025279192fcaab0aa3c50b135ff`。HEAD 只标识当时 checkout，源文件散列才标识本次复制的内容；不假设旧工作区文件等于该提交。旧仓库仅被读取。

新题库版本为 `1.1.0`，完整出处记录在 JSON 的 `provenance`。保留 B、C、D 组的 27 个题目 ID、原题文字、选项 ID / 文字、事件类型、适用条件、数量和长度上限。出生 A 组由必填的独立出生信息表单负责，不属于 `responses`。

旧题库的自适应提问、分数稳定后停止、锁盘后才收集背景等元策略不沿用。`sourceRequired` 保留原题设置；当前问题和适用性确认均为 `required: false`。每题可留空，也能选择 `unknown` 或 `not_applicable`。原有“不确定”“情况复杂或不确定”等选项保留；缺失状态的默认规则来自题库 `responsePolicy`。

| 部分 | 原阶段 | 内容 | 用途 |
| --- | --- | --- | --- |
| `evidence` | `symbol_prior` | B1–B8，传统验时辰线索 | `rectification_matching` |
| `evidence` | `event_backtest` | C1–C9，本人提供的重大年份经历 | `rectification_matching` |
| `context` | `context_box` | D1–D10，家庭背景、路径、偏好与关注事项 | `contextual_analysis` |

`event_backtest` 是保留的阶段 ID，不代表本模块已完成回测，更不代表用户提供的既往经历是独立验证结果。

## 题库与 UI

`getQuestionnaire(): Questionnaire` 返回题库的独立副本。修改这个返回对象不会改变服务端校验规则。题目文字、选项、适用条件和长度限制全部来自 `configs/question_bank.v1.json`；UI 不另设题目定义。

每个题目至少包括 `id`、`label`、`type`、`stage`、`stageLabel`、`purpose`、`required` 和 `sourceRequired`。类型有 `single_choice`、`multi_choice`、`short_text`、`year_event_list`；模块亦支持单条 `year_event`，当前题库未使用它。选项统一为 `{ id, label }`，条件存放在 `condition`。事件输入框标签在 `eventFields`，统一回复状态在 `answerStatuses`。

题库另有两道可选 `applicabilityQuestions`，用于明确 C7 工作经历、C8 子女或生育经历是否适用。它们的 UI 选项 ID 是字符串 `"true"`、`"false"`、`"unknown"`，提交时前两项需转换成布尔值；缺失记为 `unknown`。

## 提交格式

`POST /api/session` 的 `answers` 可完全省略，也可为 `{}` 或包含部分 `responses` / `applicability` 的对象；不能用 null、数组等替代对象。以下类型描述规范化后的内部结构，不能理解为要求用户填写所有字段：

```ts
type Answer =
  | { status: "answered"; value: string | string[] | YearEvent[] | YearEvent }
  | { status: "unknown" }
  | { status: "not_applicable" };

interface YearEvent {
  year: number;
  description: string;
  date?: string;      // YYYY-MM-DD，仅在确切知道日期时填写
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

单选 `value` 使用原选项 ID；多选使用无重复的 ID 数组；文本使用字符串；事件题使用事件数组。C9 必须为每条事件选择 `eventType: "best_year" | "worst_year"`。其他事件题可以省略 `eventType`；填写时必须与题目固定类型一致。

以下是部分回答片段；将其放入 `answers.responses` 即可提交，其余问题留空：

```json
{
  "C1_major_turning_years": {
    "status": "answered",
    "value": [{ "year": 2020, "description": "合成示例：改变学习方向" }]
  },
  "B1_hair_whorl": { "status": "unknown" },
  "C8_childbearing_years": { "status": "not_applicable" }
}
```

条件为 `false` 时，缺失的对应题目规范化为 `not_applicable`；若主动填写，也只能是该状态。条件为 `true` 或 `unknown` 时，缺失回答规范化为 `unknown`。非条件题同样可省略。已回答的职业身份若明确表明工作经历，则不能把工作适用性标成 `false`。这些依赖规则也定义在 JSON 中。

所有题留空或回复 `unknown` 均可继续两阶段 AI 流程，但不能据此声称找准时辰。单候选直接成为暂定工作盘；多候选弱证据时仍暂定选择并说明把握度有限。没有已知校盘或背景材料时，报告使用 `chart_only`；有已知材料时使用 `context_supported`。两者都不代表预测已验证，更不是概率。

## 严格校验

公开流程先调用 `normalizeAnswers(answers?, birth?)` 补齐状态，再用下列 `validateAnswers` 校验规范化对象。`missingQuestionIds` 用于内部完整结构检查，不表示网页用户必须回答全部问题。无效的已填内容仍会被拒绝。

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

上层先生成候选集，再传入转换后的公历生日 `{ birthDate: candidateSet.candidates[0].features.solarDate, asOfDate: 会话评估ISO日期 }`，不能把原始农历日期直接作为公历校验。缺少 `asOfDate` 时使用服务器当前 UTC 日期；测试传固定参考日期保证可重复。校验不接受出生对象的其他字段，避免把整份出生表单误传后静默忽略。

- 问卷、适用性、回答、事件均检查未知字段；旧 A 组和未知题目 ID 不能进入 `responses`。
- `unknown` / `not_applicable` 不能携带 `value`。空字符串、空事件数组和空多选数组不能伪装为已回答。
- 单选和多选只能使用题库 ID；多选不重复、不超限，原“不确定”选项不能与实质选项并选。
- 文本不能只含空白、含非法控制字符或超过题目上限；事件描述上限 400 个 JavaScript UTF-16 code units。
- 年份必须是整数，处于出生年与参考年之间。未传出生日期时，下限来自题库 `limits.minimumDate`（当前为 `1900-01-01`）。不会将字符串年份、空值或未知值转换成数字。
- 可选日期必须是严格 `YYYY-MM-DD`、真实公历日期、年份相符，且不早于出生日期、不晚于参考日期；闰日按公历规则核对。
- 只有年份时保留年份精度，不补月份或日。发生在出生年但不知确切日期的事件无法进一步判断是否早于生日，也不会伪造更精确结论。
- 同一题内完全相同的事件拒绝重复；跨题同一经历可能有不同用途，本模块不把它们计算成多次独立命中。

未知年份不填猜测值，应将该题标为 `unknown`；没有该类经历可标为 `not_applicable`。本模块不推测缺失内容。

## 结构化证据

`buildEvidence(answers?, birth?)` 先规范化缺失状态并使用同一校验器，失败时抛出 `QuestionnaireValidationError`，其中 `issues` 提供结构化错误。有效输入返回 `{ evidence, context }`，每条包含：

```ts
{
  id: string;                     // 原题目 ID，稳定引用
  label: string;                  // 原题目文字
  answer: Answer;                 // 已填回复的副本，或规范化后的缺失状态
  answerLabels?: string[];        // 单选/多选的原选项文字
  stage: "symbol_prior" | "event_backtest" | "context_box";
  purpose: "rectification_matching" | "contextual_analysis";
  source: "user_report";
  independentlyVerified: false;
  informationStatus: "known" | "unknown" | "not_applicable";
}
```

`informationStatus: "known"` 仅表示提供了实质回答，不表示该回答已经核实为真。旧选项中的 `unknown`、`complex_unknown`、`varies_unknown`、`prefer_not_to_say` 通过题库 `unknownOptionIds` 归为 `unknown`，同时保留原始选项 ID。缺失题仍有明确的 unknown / not_applicable 状态记录，但没有虚构实质答案，不能引用为已知个人事实。

模型可以用稳定 ID 说明支持与反证，但这些仍是本次选择工作盘所使用的材料。再次引用同一回答不能作为“选准了”的独立验证；若要评估效果，需要另行保留可靠出生时辰或未参与选择的独立经历。本模块不输出分数、概率或命中率。

## 验证范围

`tests/questionnaire.test.ts` 使用纯合成数据检查可选输入、缺失规范化、内部完整性、条件适用、未知状态、字段拒绝、选项与长度边界、日期和年份、事件类型、重复事件、证据用途及副本隔离。测试不使用真实命例、不请求模型，也不能证明命理判断有效。

```sh
node --test tests/questionnaire.test.ts
npm run check:type
```
