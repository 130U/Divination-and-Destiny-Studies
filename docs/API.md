# 本地 API

默认地址为 `http://127.0.0.1:3210`。写请求必须使用 `Content-Type: application/json`。只接受本机 Host；浏览器跨来源请求会被拒绝。API 不接收密钥、模型名、候选盘对象或任意上游 URL；这些由服务端配置和本地计算决定。

## 接口一览

| 方法与路径 | 请求 | 成功返回 | 是否调用模型 |
| --- | --- | --- | --- |
| `GET /api/status` | 无 | 应用版本、DeepSeek 配置状态、模型名、会话期限 | 否 |
| `GET /api/questionnaire` | 无 | 版本化题库及适用性定义 | 否 |
| `POST /api/session` | `{ birth, answers }` | HTTP 201，会话、全部候选与结构化回答 | 否 |
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

`answers` 结构如下；示意中的 `responses` 必须补齐所有适用题，不能直接提交空对象：

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

`YearEvent` 为 `{ year: number, description: string, date?: string, eventType?: string }`。只知道年份时不填精确日期。C9 必须指定 `best_year` 或 `worst_year`；其余题的事件类型由题库确定。适用条件为 false 的 C7/C8 可以省略或回复 `not_applicable`，其余适用题须明确回复。详细选项与限制见 [问卷契约](QUESTIONNAIRE.md)。

会话返回 `id`、`createdAt`、`expiresAt`、`asOfDate`、`candidateSet`、`evidence`、`context`。其中 `candidateSet` 包含出生输入、引擎版本、全部候选和警告。服务端保留冻结副本；修改返回对象不会修改后续分析所用资料。更正出生资料或答案需重新建立会话。

## 2. 一次比较全部候选

```json
{ "sessionId": "由建立会话接口返回的ID" }
```

成功返回：

```ts
{
  review: {
    status: "recommended" | "ambiguous" | "insufficient_evidence",
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
    limits: string[]
  },
  usage: { inputTokens: number, outputTokens: number, totalTokens: number },
  model: string,
  requestId?: string,
  durationMs: number,
  cached: boolean
}
```

`ranking` 必须恰好包含每个候选一次，不能新增或省略候选。推荐盘须排第一并有已知回答作为支持；不确定结果的推荐 ID 必须为 null。问卷引用只能指向本会话中的已知实质回答，同一候选不能把同一题同时列为支持和反证。所有校盘回答均无已知实质信息时，直接返回 `INSUFFICIENT_EVIDENCE`，不请求模型。

## 3. 深入分析一个工作盘

```json
{ "sessionId": "由建立会话接口返回的ID", "candidateId": "本会话中的候选ID" }
```

`candidateId` 可省略，此时采用已完成校盘的推荐 ID。校盘没有唯一推荐时必须明确提供候选 ID；允许显式选择另一候选作暂用工作盘。

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
  limitations: string[]
}
```

返回的工作盘 ID 必须与请求选择一致。`chart_basis` 只能引用服务端在模型输入 `chart_reference_paths` 中提供的实际字段路径，例如 `pillars.day`、`features.luckCycles`；它不接受任意盘内断语。回答引用也须存在；没有事实引用的段落须列出未知项，全文至少有一个事实引用和一个盘内引用。这些检查验证引用对象和结构，不验证解释文字、因果推断或预测语义正确。

`usage` 来自实际提供方响应，可能额外包含 `cachedInputTokens`、`reasoningTokens`。`cached: true` 表示返回本地已有成功结果，此次没有新的模型请求；其中用量仍描述原请求，不能再次累计为本次费用。

## 会话、费用与错误

会话从创建起有效 30 分钟，评估日期 `asOfDate` 在创建时冻结，并作为 `as_of_date` 传给两次模型请求。服务端会按期限定时清理，重启也会清空。删除或过期后的会话返回 410；删除进行中的会话会使迟到结果丢弃，但不能保证撤回上游已收到的请求。

同一会话的成功校盘和同一候选的成功分析可缓存。并发重复调用被拒绝，服务端同时只运行一个模型请求。没有自动重试或失败后的模拟回退；网络异常、无效输出及手动重试仍可能产生提供方费用。

错误格式为 `{ "error": { "code": "...", "message": "...", "details": [] } }`，`details` 只在部分校验错误出现；提供方 HTTP 错误可能附带 `upstreamStatus`。常见状态如下：

| 状态 | 示例 | 含义 |
| --- | --- | --- |
| 400 | `INCOMPLETE_QUESTIONNAIRE`、`INVALID_CANDIDATE` | 输入不完整、无效或步骤顺序错误 |
| 403 | `HOST_NOT_ALLOWED`、`ORIGIN_NOT_ALLOWED` | 非允许的本机来源 |
| 409 | `REVIEW_IN_PROGRESS`、`MODEL_BUSY` | 已有相关请求进行中 |
| 410 | `SESSION_EXPIRED` | 会话清除或过期 |
| 413 | `BODY_TOO_LARGE`、`PROMPT_TOO_LARGE` | 超过输入或单次提示预算 |
| 415 | `CONTENT_TYPE` | 不是 JSON 写请求 |
| 429 | `SESSION_LIMIT` | 内存会话达到上限 |
| 502 | `INVALID_MODEL_OUTPUT`、`DEEPSEEK_*` | 上游失败或输出不符合契约 |
| 503 | `DEEPSEEK_NOT_CONFIGURED`、`DEEPSEEK_INVALID_CONFIG` | 服务端未配置或配置无效 |

当前默认预算见 [`configs/runtime.v1.json`](../configs/runtime.v1.json)：请求体 256 KiB、模型输入 JSON 100,000 字符、每次输出上限 8,192 tokens、最多 100 个内存会话。服务端不回传 API 密钥或原始提供方错误正文。
