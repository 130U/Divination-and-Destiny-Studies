import { Workflow } from './workflow.ts';
import { getQuestionnaire } from './questionnaire.ts';
import { createDeepSeekClient, DEEPSEEK_ENDPOINT, DEFAULT_DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_THINKING, DeepSeekError, type DeepSeekEnvironment } from './deepseek.ts';
import { AppError, exactKeys, record, runtime } from './runtime.ts';

export interface BrowserRuntimeOptions { fetchImpl?: typeof fetch; now?: () => number }

/** Each tab owns its key and sessions. Nothing is persisted or sent to a site backend. */
export function createBrowserRuntime(options: BrowserRuntimeOptions = {}) {
  const env: DeepSeekEnvironment = { DEEPSEEK_MODEL: DEFAULT_DEEPSEEK_MODEL, DEEPSEEK_THINKING: DEFAULT_DEEPSEEK_THINKING };
  let generation = 0, verified = false;
  const pending = new Set<AbortController>();
  const client: ReturnType<typeof createDeepSeekClient> = { completeJson: async request => {
    const current = generation;
    const controller = new AbortController(); pending.add(controller);
    const directFetch: typeof fetch = async (url, init) => {
      if (String(url) !== DEEPSEEK_ENDPOINT) throw new AppError('INVALID_ENDPOINT', '只允许连接 DeepSeek 官方接口。');
      const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
      return (options.fetchImpl ?? fetch)(url, { ...init, signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    };
    try {
      const result = await createDeepSeekClient({ env: { ...env }, fetchImpl: directFetch }).completeJson(request);
      if (current !== generation) throw new AppError('KEY_CLEARED', '密钥已更换或清除，本次结果未保留。');
      verified = true;
      return result;
    } finally { pending.delete(controller); }
  } };
  let workflow = new Workflow({ client, ...(options.now ? { now: options.now } : {}) });
  const status = () => ({ configured: Boolean(env.DEEPSEEK_API_KEY), provider: 'deepseek', model: DEFAULT_DEEPSEEK_MODEL, verified });
  function reset() {
    generation++;
    for (const controller of pending) controller.abort();
    pending.clear(); workflow.dispose();
    workflow = new Workflow({ client, ...(options.now ? { now: options.now } : {}) });
    verified = false;
  }
  function setApiKey(value: string) {
    if (typeof window !== 'undefined' && !window.isSecureContext) throw new AppError('HTTPS_REQUIRED', '请使用 HTTPS 地址访问，再设置密钥。');
    if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\r\n\x00-\x1f]/.test(value)) throw new AppError('INVALID_KEY', '请填写有效的 DeepSeek API Key，不能包含换行。');
    reset(); env.DEEPSEEK_API_KEY = value.trim();
    return status();
  }
  function clearApiKey() { reset(); delete env.DEEPSEEK_API_KEY; return status(); }
  async function api(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const current = generation;
    try {
      let output: unknown;
      if (path === '/api/status' && method === 'GET') return { app: 'Divination and Destiny Studies', version: '0.3.0', deepseek: status(), storage: 'browser_memory_only', billing: 'visitor_key', questionnaire: 'optional', sessionTtlMinutes: runtime.session_ttl_ms / 60000 };
      if (path === '/api/questionnaire' && method === 'GET') return getQuestionnaire();
      if (path === '/api/session' && method === 'POST') output = workflow.create(body);
      else if (path === '/api/session' && method === 'DELETE') { const input = record(body, '请求'); exactKeys(input, ['sessionId'], '请求'); output = workflow.delete(input.sessionId); }
      else if (path === '/api/review' && method === 'POST') { const input = record(body, '请求'); exactKeys(input, ['sessionId'], '请求'); output = await workflow.review(input.sessionId); }
      else if (path === '/api/analysis' && method === 'POST') { const input = record(body, '请求'); exactKeys(input, ['sessionId', 'candidateId'], '请求'); output = await workflow.analyze(input.sessionId, input.candidateId); }
      else throw new AppError('NOT_FOUND', '此操作不存在。');
      if (current !== generation) throw new AppError('KEY_CLEARED', '密钥已更换或清除，本次结果未保留。');
      return output;
    } catch (error) {
      if (current !== generation) throw new AppError('KEY_CLEARED', '密钥已更换或清除，本次请求已取消。');
      if (error instanceof DeepSeekError) {
        const messages: Partial<Record<DeepSeekError['code'], string>> = {
          NOT_CONFIGURED: '请先在本页设置你自己的 DeepSeek API Key。',
          NETWORK_ERROR: '无法连接 DeepSeek，请检查网络或浏览器跨域限制。系统不会自动重试。',
          TIMEOUT: 'DeepSeek 请求超时。失败请求可能已产生用量，不会自动重试。',
          HTTP_ERROR: error.status === 401 ? 'DeepSeek 未接受这个 Key，请核对后重新设置。' : error.status === 402 ? 'DeepSeek 账户余额不足，请检查你的账户。' : error.status === 429 ? 'DeepSeek 请求限流，请稍后手动重试。' : 'DeepSeek 暂未完成请求，请稍后手动重试。',
        };
        if (error.status === 401) verified = false;
        throw new AppError('DEEPSEEK_' + error.code, messages[error.code] ?? error.message, 502);
      }
      throw error;
    }
  }
  return { api, status, setApiKey, clearApiKey };
}

const browserRuntime = createBrowserRuntime();
export const { api, status, setApiKey, clearApiKey } = browserRuntime;
