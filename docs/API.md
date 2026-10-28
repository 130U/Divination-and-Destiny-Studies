# 本地 API

默认地址为 `http://127.0.0.1:3210`。写请求必须使用 `Content-Type: application/json`。只接受本机 Host；浏览器跨来源请求会被拒绝。API 不接收密钥、模型名、候选盘对象或任意上游 URL；这些由服务端配置和本地计算决定。

## 接口一览

| 方法与路径 | 请求 | 成功返回 | 是否调用模型 |
| --- | --- | --- | --- |
| `GET /api/status` | 无 | 应用版本、DeepSeek 配置状态、模型名、会话期限 | 否 |
| `GET /api/questionnaire` | 无 | 版本化题库及适用性定义 | 否 |
| `POST /api/session` | `{ birth, answers? }` | HTTP 201，会话、全部候选与结构化回答 | 否 |
| `POST /api/review` | `{ sessionId }` | 候选比较及用量 | 首次成功结果前会请求 |
| `POST /api/analysis` | `{ sessionId, candidateId? }` | 指定工作盘分析及用量 | 该盘首次成功结果前会请求 |
| `DELETE /api/session` | `{ sessionId }` | `{ "deleted": true }` | 否 |

## 1. 建立会话

出生表单示意：

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

这是合成输入示意，不是私人命例。日期为 `YYYY-MM-DD`；`calendar` 可为 `solar` / `lunar`，农历可加布尔 `leapMonth`。时间模式互斥：`exact` 只带 `time`；`range` 只带 `startTime/endTime`；`unknown` 不带时间字段。时间均为 `HH:mm`，范围必须同日且包含两端。性别为传统排运所需的 `male` / `female`。

产品接受转换后的公历出生日期从 1900-01-01 到服务器评估当天。农历先由本地引擎转换，问卷中的事件日期统一按公历校验。无效日期、冲突时间字段、不存在的准确民用分钟、缺失参数和额外字段会被拒绝。

`answers` 可省略，也可提交 `{}` 或部分回答。27 道问题和 2 道适用性确认全部可选；缺失值规范化为 `unknown`，已明确不适用的条件题记为 `not_applicable`。已填写内容仍须通过格式与日期校验。规范化后的内部结构如下：

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

`YearEvent` 为 `{ year: number, description: string, date?: string, eventType?: string }`。只知道年份时不填精确日期。填写 C9 时必须指定 `best_year` 或 `worst_year`；其余题的事件类型由题库确定。适用条件为 false 的 C7/C8 可以省略或回复 `not_applicable`。详细选项与限制见 [问卷契约](QUESTIONNAIRE.md)。

会话返回 `id`、`createdAt`、`expiresAt`、`asOfDate`、`candidateSet`、`evidence`、`context`。其中 `candidateSet` 包含出生输入、引擎版本、全部候选和警告。服务端保留冻结副本；修改返回对象不会修改后续分析所用资料。更正出生资料或答案需重新建立会话。

## 2. 一次比较全部候选

```json
{ "sessionId": "由建立会话接口返回的ID" }
```

成功返回：

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

`ranking` 必须恰好包含每个候选一次，不能新增、遗漏或重复候选；指定的工作盘必须与首位一致。成功规范化的结果提供有效工作盘 ID。单候选使用 `selection_source: "birth_input"` 和 `provisional`，表示输入已限定唯一四柱，不是模型验证了出生时辰。多候选通常由模型选择；模型未指定 ID 时，使用其完整排序首位作为 `ranked_fallback`，明确标成暂定。类型保留 `ambiguous` / `insufficient_evidence` 以兼容模型输入，但当前服务会将可用的弱证据结果规范化为 `provisional` 并继续分析。

没有已知校盘回答也会请求模型，结果标为 `chart_only` 和暂定；有已知回答时为 `context_supported`。这里的已知只表示用户提供了实质信息，不表示独立核实，也不保证能区分时辰。

服务端通过 `referenceable_evidence_ids` 提供已知回答白名单。轻微引用问题会规范化：去除重复、未知或不适用 ID，修复可识别的空白和单字符串形式，并在 `reportWarnings` 说明；同一题同时列为支持和反证时，从两边移除并警告。必要正文会保留。候选身份错误、覆盖不完整或缺少必要正文仍拒绝。这些处理不证明正文事实或推理正确。

## 3. 深入分析一个工作盘

```json
{ "sessionId": "由建立会话接口返回的ID", "candidateId": "本会话中的候选ID" }
```

`candidateId` 可省略，此时采用已完成校盘的工作盘 ID，包括暂定选择；也允许显式选择本会话的另一候选。仍须先完成 review。

成功返回的元数据与校盘相同，将 `review` 替换为：

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

返回的工作盘 ID 必须与请求选择一致，必须有 overview 和 1–8 个有正文的分析段落。`chart_basis` 只能引用输入 `chart_reference_paths` 中的实际字段路径，例如 `pillars.day`、`features.luckCycles`。分析的回答白名单来自校盘与背景中的已知回答。非法引用会移除并警告，缺少引用或限制说明也会警告，不因这类元数据问题丢弃已有正文。无已知材料时允许空 `evidence_ids`，以 `chart_only` 给出条件性分析；有材料时标为 `context_supported`。模型不得把未知内容编成个人经历，也不得把暂定选择称为概率。这些结构检查不验证解释、因果关系或预测语义正确。

`usage` 来自实际提供方响应，可能额外包含 `cachedInputTokens`、`reasoningTokens`。它只代表该次模型调用，不含其他阶段、此前失败或重试，不是累计账单。`cached: true` 表示返回本地已有成功结果，此次没有新的模型请求；用量仍描述原请求，不能再次累计为本次费用。

`model` 是请求配置名；可选 `providerModel` 是经过格式和凭据过滤的提供方返回标签。2026-10-28 的合成重测中两者均为 `deepseek-flash`，它们不能独立确认实际使用了 1017 快照。

## 会话、费用与错误

会话从创建起有效 30 分钟，评估日期 `asOfDate` 在创建时冻结，并作为 `as_of_date` 传给两次模型请求。服务端会按期限定时清理，重启也会清空。删除或过期后的会话返回 410；删除进行中的会话会使迟到结果丢弃，但不能保证撤回上游已收到的请求。

同一会话的成功校盘和同一候选的成功分析可缓存。并发重复调用被拒绝，服务端同时只运行一个模型请求。没有自动重试或失败后的模拟回退；网络异常、无效输出及手动重试仍可能产生提供方费用。

错误格式为 `{ "error": { "code": "...", "message": "...", "details": [] } }`，`details` 只在部分校验错误出现；提供方 HTTP 错误可能附带 `upstreamStatus`。已经取得完整提供方响应、但业务结构校验失败时，额外返回安全的 `error.modelAttempt: { stage, model, providerModel?, durationMs, usage }`，不回传原始模型正文。其 usage 仅是该次失败调用的用量；没有取得 usage 的失败不能当成零费用。常见状态如下：

| 状态 | 示例 | 含义 |
| --- | --- | --- |
| 400 | `INVALID_QUESTIONNAIRE`、`INVALID_CANDIDATE` | 已填写内容无效、出生输入缺失或步骤顺序错误 |
| 403 | `HOST_NOT_ALLOWED`、`ORIGIN_NOT_ALLOWED` | 非允许的本机来源 |
| 409 | `REVIEW_IN_PROGRESS`、`MODEL_BUSY` | 已有相关请求进行中 |
| 410 | `SESSION_EXPIRED` | 会话清除或过期 |
| 413 | `BODY_TOO_LARGE`、`PROMPT_TOO_LARGE` | 超过输入或单次提示预算 |
| 415 | `CONTENT_TYPE` | 不是 JSON 写请求 |
| 429 | `SESSION_LIMIT` | 内存会话达到上限 |
| 502 | `INVALID_MODEL_OUTPUT`、`DEEPSEEK_*` | 上游失败或输出不符合契约 |
| 503 | `DEEPSEEK_NOT_CONFIGURED`、`DEEPSEEK_INVALID_CONFIG` | 服务端未配置或配置无效 |

当前默认预算见 [`configs/runtime.v1.json`](../configs/runtime.v1.json)：请求体 256 KiB、模型输入 JSON 100,000 字符、每次输出上限 8,192 tokens、最多 100 个内存会话。服务端不回传 API 密钥或原始提供方错误正文。

`GET /api/status` 当前返回版本 `0.2.0`，并标记 `questionnaire: "optional"`、`billing: "server_operator_key"`。克隆后自行运行需要各自配置服务端 key；若共享同一个后端，请求使用运营者的 key。当前接口没有网页访客各自提供 key 的功能。

## 已完成的合成验收

0.2.0 于 2026-10-28 完成真实浏览器验收：合成出生资料、27 题留空、单候选，两阶段均成功，4 节分析；review 为 4,656 tokens / 6,852 ms，analysis 为 11,053 tokens / 39,336 ms，合计 15,709 tokens。90 项离线测试通过。

同日 0.1.0 历史重测的两次请求共 24,353 tokens：3 候选 review 为 `insufficient_evidence`，脚本显式选盘继续分析，缓存重复无新增请求；更早首轮的 analysis 引用失败未保留用量。历史与本次是不同验收，不合并计算。接口验收不能视为识别出生时辰或预测有效的证明；详见 [验证记录](VALIDATION.md)。
