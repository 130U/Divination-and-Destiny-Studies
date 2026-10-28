# DeepSeek 服务端 JSON 客户端

本模块使用 Node.js 24 原生 `fetch`，没有 SDK 或新增依赖。它只负责请求与传输校验；业务端仍须验证返回数据的 schema、证据引用和已锁定四柱。传输成功不代表命理判断得到验证。

## 服务端配置

| 环境变量 | 含义 |
|---|---|
| `DEEPSEEK_API_KEY` | 仅在运行服务端的进程环境中配置；不得提交、发送到浏览器、记录到日志或写入请求 payload |
| `DEEPSEEK_MODEL` | 默认 `deepseek-flash`；允许以 `deepseek-` 开头的模型标识，服务方最终判断模型是否可用 |
| `DEEPSEEK_THINKING` | `medium`（默认）；支持 `low`、`medium`、`high`、`max`、`disabled` |

默认组合为 `deepseek-flash` + `medium`。截至 2026-10-28，[官方模型页](https://api-docs.deepseek.com/)说明 `deepseek-flash` 当前由 **DeepSeek-V4.1-Flash-1017** 提供服务。该名称是服务端别名，可能随官方升级改变，不能将配置名当成永久固定的模型版本或自行拼造快照模型 ID。

`medium` 按请求值原样发送。[官方思考强度映射](https://api-docs.deepseek.com/guides/thinking_mode/)将请求的 `medium` 映射为实际 `high`；本项目不预先改写为 `high`，也不降级为 `low`。支持的四档启用值与关闭方式如下：

| 本地配置 | 请求中的 `reasoning_effort` | 官方当前实际强度 |
| --- | --- | --- |
| `low` | `low` | `low` |
| `medium`（默认） | `medium` | `high` |
| `high` | `high` | `high` |
| `max` | `max` | `max` |
| `disabled` | 不发送 | 关闭思考 |

没有 key 时返回 `NOT_CONFIGURED`，不会以 mock 冒充真实结果。`getDeepSeekStatus()` 仅返回 `configured`、`provider`、`model`，不表示已成功连接或账户有余额。无效模型标识时状态使用安全默认模型名称且 `configured=false`，实际调用明确拒绝配置。

凭据由服务端进程环境读取，可通过启动时加载的本地 `.env` 或进程环境变量配置。克隆源码的人需自行配置自己的 key，发布源码不会共享作者额度；共享后端的请求则使用运营者配置的 key。当前没有网页访客各自提供 key 的功能。测试通过 `options.env` 注入明确的假凭据，不会读取或使用真实凭据。

## 调用契约

```ts
const client = createDeepSeekClient();
const result = await client.completeJson({
  system: 'Return only JSON matching this schema: {"answer": "string"}.',
  payload: { question: "A fictional example" },
  maxOutputTokens: 2048
});
// result: { data, usage, model, providerModel?, requestId?, durationMs }
```

调用方必须在 system 中声明 JSON、提供实际业务结构与示例。客户端拒绝不包含 `json` 的 system。`data` 是未经业务 schema 验证的 JSON 对象；不会返回模型的 `reasoning_content`。`model` 表示此次请求采用的配置模型。可选 `providerModel` 保留提供方响应中的模型标签，仅在通过格式和凭据过滤时返回；它不构成对模型快照身份的独立证明。

业务提示输入携带 `referenceable_evidence_ids`，与业务校验器共用已知回答 ID 生成函数。unknown 和不适用项不能作为事实引用。业务层可规范化轻微引用格式、去重或移除不可用 ID，并在 `reportWarnings` 说明，保留正文；候选身份错误或缺少必要正文仍失败。背景全部留空时允许 `chart_only` 分析，不伪造经历。传输客户端不替代这些业务检查。

`usage` 映射服务端实际返回的 `prompt_tokens`、`completion_tokens`、`total_tokens`；可选记录 `prompt_cache_hit_tokens` 和 `completion_tokens_details.reasoning_tokens`。缺失必需 token 计数会拒绝响应，不以零值伪造计费记录。缓存输入计数属于输入 token 的子集，reasoning token 属于相应服务端统计字段；不要重复相加计费。

页面与导出的 usage 只代表对应的该次模型调用，不含其他阶段、此前失败或重试，不是账户累计账单。缓存返回原调用用量，此次不会新增模型请求。完整提供方响应若在业务校验失败，API 的 `error.modelAttempt` 仍保留安全的 `stage`、`model`、可选 `providerModel`、`durationMs` 和 `usage`；没有取得 usage 的失败不能当成零费用。系统不自动付费重试。

默认总超时 120 秒、响应上限 1 MiB、客户端输出预算 4096 tokens；单次请求允许调低/调高预算，但固定上限为 8192。业务流程仍为一次校盘和一次分析，两次分别显式使用 8192 tokens 上限；调整思考强度不会自动扩大预算。`timeoutMs` 覆盖接收响应头和读取响应体；`maxResponseBytes` 同时检查 Content-Length 与实际累计字节。服务层可以设置更小限制。客户端没有自动重试；失败请求仍可能已产生服务方费用，不可把 timeout 当成免费取消。

固定 endpoint：`https://api.deepseek.com/chat/completions`，禁止跳转，不接受用户输入的 endpoint。JSON 模式使用 `response_format: {type: "json_object"}`；`low/medium/high/max` 均发送 `thinking: {type: "enabled"}`，并将所选值原样发送为 `reasoning_effort`。默认请求因此包含 `reasoning_effort: "medium"`。`disabled` 使用 `thinking: {type: "disabled"}`，不发送 effort；所有模式都不发送 temperature。

仅接受 `finish_reason="stop"`。空答案、截断、其他 finish_reason、无效 JSON、非对象 JSON、缺失 usage 均拒绝。HTTP、网络、超时错误使用静态安全消息，不附带原始响应、请求 payload、密钥或原异常 cause。业务数据可能包含个人信息，调用方仍须在发送前最小化字段，在展示或记录前作业务级脱敏。

## 测试与边界

`node --test tests/deepseek.test.ts` 使用注入的 fake fetch；涵盖配置、请求形状、usage 映射、提供方模型标签过滤、缺 key、401、无重试、网络异常脱敏、请求和响应体超时、响应大小、截断及 JSON 拒绝。测试不调用真实 API，不安装依赖。

0.2.0 在 2026-10-28 完成真实浏览器合成验收：27 题留空、单候选、默认 `deepseek-flash` + `medium`，两阶段成功并返回 4 节分析。review 为 4,656 tokens / 6,852 ms，analysis 为 11,053 tokens / 39,336 ms，合计 15,709 tokens；90 项离线测试通过。

同日 0.1.0 历史验收的首轮 analysis 引用校验失败，未保留原始输出和用量；第二轮两请求均通过，共 24,353 tokens。该轮 review 为 `insufficient_evidence`，脚本显式选取合成候选继续分析，缓存重复未新增请求。这是独立的历史样例，不能与 0.2.0 用量混算，也不能称为校盘成功。模型请求名或返回标签不能独立确认实际快照。详见 [验证记录](VALIDATION.md)。

当前 live 脚本在请求前限制 `attemptedRequests` 最多为 2，实时记录已取得的安全元数据，并把提供方响应与业务校验成功分开记录。浏览器验收与独立 live 脚本是不同执行记录；未取得 usage 的失败不能当作零费用。

可用 `npm run test:live -- --birth-only --single-candidate` 选择背景留空、准确分钟的单候选合成输入，仍保留两次请求上限。0.2.0 已记录的真实验收来自浏览器，未将该 CLI 参数组合标为另行完成的真实调用。

服务层负责业务结构校验、上下文可见性、已锁定四柱不变、本地历法计算与 AI 候选比较的职责分离，以及输入长度、输出 token 上限、并发与缓存控制。实际用量来自提供方响应；当前没有金额级消费上限。生产流程只接受真实提供方结果，测试客户端仅在自动化测试中注入。不要把本客户端放入禁止联网的排盘 adapter。

官方接口依据：[Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)、[JSON Output](https://api-docs.deepseek.com/guides/json_mode)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)。接口验收通过不证明命理解释或预测有效。
