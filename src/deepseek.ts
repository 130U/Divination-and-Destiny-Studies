export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const MAX_DEEPSEEK_OUTPUT_TOKENS = 8192;

export type DeepSeekThinking = "low" | "disabled";
export interface DeepSeekEnvironment {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_THINKING?: string;
}
export interface DeepSeekOptions {
  env?: DeepSeekEnvironment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  thinking?: DeepSeekThinking;
  maxOutputTokens?: number;
}
export interface DeepSeekRequest {
  system: string;
  payload: unknown;
  maxOutputTokens?: number;
}
export interface DeepSeekUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}
export interface DeepSeekResult {
  data: unknown;
  usage: DeepSeekUsage;
  model: string;
  requestId?: string;
  durationMs: number;
}
export type DeepSeekErrorCode = "NOT_CONFIGURED" | "INVALID_CONFIG" | "INVALID_REQUEST" |
  "TIMEOUT" | "NETWORK_ERROR" | "HTTP_ERROR" | "RESPONSE_TOO_LARGE" |
  "INVALID_RESPONSE" | "EMPTY_RESPONSE" | "INCOMPLETE_RESPONSE" | "INVALID_JSON";

const ERROR_MESSAGES: Record<DeepSeekErrorCode, string> = {
  NOT_CONFIGURED: "DeepSeek is not configured on this server.",
  INVALID_CONFIG: "DeepSeek server configuration is invalid.",
  INVALID_REQUEST: "DeepSeek request is invalid.",
  TIMEOUT: "DeepSeek request exceeded its time limit.",
  NETWORK_ERROR: "DeepSeek connection failed.",
  HTTP_ERROR: "DeepSeek returned an unsuccessful HTTP status.",
  RESPONSE_TOO_LARGE: "DeepSeek response exceeded its size limit.",
  INVALID_RESPONSE: "DeepSeek response metadata is invalid.",
  EMPTY_RESPONSE: "DeepSeek returned no answer.",
  INCOMPLETE_RESPONSE: "DeepSeek did not finish a complete answer.",
  INVALID_JSON: "DeepSeek did not return a valid JSON object."
};

export class DeepSeekError extends Error {
  readonly code: DeepSeekErrorCode;
  readonly status?: number;
  constructor(code: DeepSeekErrorCode, status?: number) {
    super(ERROR_MESSAGES[code]);
    this.name = "DeepSeekError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function modelFrom(env: DeepSeekEnvironment): string | undefined {
  const model = env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  return /^deepseek-[a-z0-9][a-z0-9._-]{0,63}$/i.test(model) &&
    (!env.DEEPSEEK_API_KEY?.trim() || !model.includes(env.DEEPSEEK_API_KEY.trim())) ? model : undefined;
}

export function getDeepSeekStatus(env: DeepSeekEnvironment = process.env): {
  configured: boolean; provider: "deepseek"; model: string;
} {
  const model = modelFrom(env);
  const validThinking = !env.DEEPSEEK_THINKING || ["low", "disabled"].includes(env.DEEPSEEK_THINKING);
  return { configured: Boolean(env.DEEPSEEK_API_KEY?.trim() && model && validThinking), provider: "deepseek", model: model ?? DEFAULT_DEEPSEEK_MODEL };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function usageFrom(value: unknown): DeepSeekUsage {
  if (!record(value) || !count(value.prompt_tokens) || !count(value.completion_tokens) || !count(value.total_tokens)) {
    throw new DeepSeekError("INVALID_RESPONSE");
  }
  const usage: DeepSeekUsage = { inputTokens: value.prompt_tokens, outputTokens: value.completion_tokens, totalTokens: value.total_tokens };
  if (value.prompt_cache_hit_tokens !== undefined) {
    if (!count(value.prompt_cache_hit_tokens)) throw new DeepSeekError("INVALID_RESPONSE");
    usage.cachedInputTokens = value.prompt_cache_hit_tokens;
  }
  const details = value.completion_tokens_details;
  if (record(details) && details.reasoning_tokens !== undefined) {
    if (!count(details.reasoning_tokens)) throw new DeepSeekError("INVALID_RESPONSE");
    usage.reasoningTokens = details.reasoning_tokens;
  }
  return usage;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new DeepSeekError("RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new DeepSeekError("EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) throw new DeepSeekError("RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new DeepSeekError("EMPTY_RESPONSE");
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new DeepSeekError("INVALID_RESPONSE"); }
}

export function createDeepSeekClient(options: DeepSeekOptions = {}): { completeJson(request: DeepSeekRequest): Promise<DeepSeekResult> } {
  return {
    async completeJson(request): Promise<DeepSeekResult> {
      const env = options.env ?? process.env;
      const apiKey = env.DEEPSEEK_API_KEY?.trim();
      if (!apiKey) throw new DeepSeekError("NOT_CONFIGURED");
      const model = modelFrom(env);
      const thinking = options.thinking ?? env.DEEPSEEK_THINKING ?? "low";
      const timeoutMs = options.timeoutMs ?? 120_000;
      const maxBytes = options.maxResponseBytes ?? 1024 * 1024;
      if (!model || !["low", "disabled"].includes(thinking) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
          !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new DeepSeekError("INVALID_CONFIG");
      const maxTokens = request.maxOutputTokens ?? options.maxOutputTokens ?? 4096;
      if (typeof request.system !== "string" || !request.system.trim() || !/json/i.test(request.system) ||
          !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_DEEPSEEK_OUTPUT_TOKENS) throw new DeepSeekError("INVALID_REQUEST");
      let body: string;
      try {
        const payload = JSON.stringify(request.payload);
        if (payload === undefined) throw new Error();
        body = JSON.stringify({ model, stream: false, response_format: { type: "json_object" }, max_tokens: maxTokens,
          thinking: { type: thinking === "low" ? "enabled" : "disabled" },
          ...(thinking === "low" ? { reasoning_effort: "low" } : {}),
          messages: [{ role: "system", content: request.system }, { role: "user", content: payload }] });
      } catch { throw new DeepSeekError("INVALID_REQUEST"); }
      const started = performance.now();
      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new DeepSeekError("TIMEOUT")); }, timeoutMs);
      });
      const operation = async (): Promise<DeepSeekResult> => {
        const response = await (options.fetchImpl ?? fetch)(DEEPSEEK_ENDPOINT, {
          method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body, signal: controller.signal
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new DeepSeekError("HTTP_ERROR", response.status);
        }
        const envelope = await readBoundedJson(response, maxBytes);
        if (!record(envelope) || !Array.isArray(envelope.choices) || !record(envelope.choices[0])) throw new DeepSeekError("INVALID_RESPONSE");
        const choice = envelope.choices[0];
        if (choice.finish_reason !== "stop") throw new DeepSeekError("INCOMPLETE_RESPONSE");
        if (!record(choice.message) || typeof choice.message.content !== "string" || !choice.message.content.trim()) throw new DeepSeekError("EMPTY_RESPONSE");
        let data: unknown;
        try { data = JSON.parse(choice.message.content); } catch { throw new DeepSeekError("INVALID_JSON"); }
        if (!record(data)) throw new DeepSeekError("INVALID_JSON");
        const usage = usageFrom(envelope.usage);
        const requestId = typeof envelope.id === "string" && /^[a-z0-9_-]{1,128}$/i.test(envelope.id) &&
          !envelope.id.includes(apiKey) && !/^sk-/i.test(envelope.id) ? envelope.id : undefined;
        return { data, usage, model, ...(requestId ? { requestId } : {}), durationMs: Math.max(0, Math.round(performance.now() - started)) };
      };
      try { return await Promise.race([operation(), timeout]); }
      catch (error) {
        controller.abort();
        if (timedOut) throw new DeepSeekError("TIMEOUT");
        if (error instanceof DeepSeekError) throw error;
        throw new DeepSeekError("NETWORK_ERROR");
      } finally { if (timer !== undefined) clearTimeout(timer); }
    }
  };
}
