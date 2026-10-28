import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getQuestionnaire, QuestionnaireValidationError } from './questionnaire.ts';
import { ChartInputError } from './chartEngine.ts';
import { DeepSeekError, getDeepSeekStatus } from './deepseek.ts';
import { AppError, exactKeys, record, runtime } from './runtime.ts';
import { Workflow } from './workflow.ts';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new AppError('CONTENT_TYPE', '请求必须使用 application/json。', 415);
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > runtime.max_request_bytes) throw new AppError('BODY_TOO_LARGE', '提交资料超过大小上限。', 413);
  let length = 0; const chunks: Buffer[] = [];
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    length += chunk.length;
    if (length > runtime.max_request_bytes) throw new AppError('BODY_TOO_LARGE', '提交资料超过大小上限。', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('INVALID_JSON', '请求内容不是有效的 JSON。'); }
}

function checkOrigin(request: IncomingMessage) {
  const host = request.headers.host;
  const port = request.socket.localPort;
  if (!host || ![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host)) throw new AppError('HOST_NOT_ALLOWED', '此服务仅供本机使用。', 403);
  if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new AppError('ORIGIN_NOT_ALLOWED', '不接受其他网站发起的请求。', 403);
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new AppError('ORIGIN_NOT_ALLOWED', '不接受跨站请求。', 403);
}

export interface AppOptions { workflow?: Workflow; providerStatus?: typeof getDeepSeekStatus }

export function createApp(options: AppOptions = {}) {
  const workflow = options.workflow ?? new Workflow();
  const status = options.providerStatus ?? getDeepSeekStatus;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      checkOrigin(request);
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      if (request.method === 'GET' && url.pathname === '/api/status') return send(response, 200, { app: 'Divination and Destiny Studies', version: '0.2.0', deepseek: status(), sessionTtlMinutes: runtime.session_ttl_ms / 60000, storage: 'memory_only', billing: 'server_operator_key', questionnaire: 'optional' });
      if (request.method === 'GET' && url.pathname === '/api/questionnaire') return send(response, 200, getQuestionnaire());
      if (request.method === 'POST' && url.pathname === '/api/session') return send(response, 201, workflow.create(await readBody(request)));
      if (request.method === 'DELETE' && url.pathname === '/api/session') {
        const body = record(await readBody(request), '请求'); exactKeys(body, ['sessionId'], '请求');
        return send(response, 200, workflow.delete(body.sessionId));
      }
      if (request.method === 'POST' && url.pathname === '/api/review') {
        const body = record(await readBody(request), '请求'); exactKeys(body, ['sessionId'], '请求');
        return send(response, 200, await workflow.review(body.sessionId));
      }
      if (request.method === 'POST' && url.pathname === '/api/analysis') {
        const body = record(await readBody(request), '请求'); exactKeys(body, ['sessionId', 'candidateId'], '请求');
        return send(response, 200, await workflow.analyze(body.sessionId, body.candidateId));
      }
      const asset = request.method === 'GET' ? ASSETS.get(url.pathname) : undefined;
      if (asset) {
        const content = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': asset[1]! }); return response.end(content);
      }
      send(response, 404, { error: { code: 'NOT_FOUND', message: '接口或页面不存在。' } });
    } catch (error) {
      if (error instanceof DeepSeekError) {
        const status = error.code === 'NOT_CONFIGURED' || error.code === 'INVALID_CONFIG' ? 503 : 502;
        const message = error.code === 'NOT_CONFIGURED' ? '服务端尚未配置 DeepSeek 密钥；本次没有调用模型。' : error.message;
        return send(response, status, { error: { code: `DEEPSEEK_${error.code}`, message, ...(error.status ? { upstreamStatus: error.status } : {}) } });
      }
      if (error instanceof AppError) {
        const details = 'details' in error ? error.details : undefined;
        const attempt = error.modelAttempt;
        const modelAttempt = attempt ? {
          stage: attempt.stage, model: attempt.model, durationMs: attempt.durationMs,
          ...(attempt.providerModel ? { providerModel: attempt.providerModel } : {}),
          usage: {
            inputTokens: attempt.usage.inputTokens, outputTokens: attempt.usage.outputTokens,
            totalTokens: attempt.usage.totalTokens,
            ...(attempt.usage.cachedInputTokens !== undefined ? { cachedInputTokens: attempt.usage.cachedInputTokens } : {}),
            ...(attempt.usage.reasoningTokens !== undefined ? { reasoningTokens: attempt.usage.reasoningTokens } : {}),
          },
        } : undefined;
        return send(response, error.status, { error: { code: error.code, message: error.message, ...(details ? { details } : {}), ...(modelAttempt ? { modelAttempt } : {}) } });
      }
      if (error instanceof ChartInputError || error instanceof QuestionnaireValidationError) return send(response, 400, { error: { code: error.name, message: error.message } });
      send(response, 500, { error: { code: 'INTERNAL_ERROR', message: '本地处理失败，请检查资料或重启服务。' } });
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 10000;
  server.on('close', () => workflow.dispose());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '3210');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`Divination and Destiny Studies: http://127.0.0.1:${port}`);
    console.log(`DeepSeek: ${getDeepSeekStatus().configured ? 'configured' : 'not configured; local charts remain available'}`);
  });
}
