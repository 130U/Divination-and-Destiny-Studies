import runtimeConfig from '../configs/runtime.v1.json' with { type: 'json' };
import type { DeepSeekUsage } from './deepseek.ts';

export interface ModelAttempt {
  stage: 'review' | 'analysis';
  usage: DeepSeekUsage;
  model: string;
  providerModel?: string;
  durationMs: number;
}

export const runtime = Object.freeze({ ...runtimeConfig } as {
  version: string; session_ttl_ms: number; max_sessions: number; max_request_bytes: number;
  max_prompt_characters: number; review_max_output_tokens: number; analysis_max_output_tokens: number;
  max_concurrent_model_calls: number;
});

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  modelAttempt?: ModelAttempt;
  constructor(code: string, message: string, status = 400) {
    super(message); this.name = 'AppError'; this.code = code; this.status = status;
  }
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_INPUT', `${label} 必须是对象。`);
  return value as Record<string, unknown>;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new AppError('INVALID_INPUT', `${label} 包含未支持的字段。`);
}

export function assertNoSecrets(value: unknown): void {
  const text = JSON.stringify(value);
  if (/(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{16,})/.test(text)) {
    throw new AppError('SECRET_IN_INPUT', '请移除资料中的密钥或访问令牌。');
  }
}

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) if (item && typeof item === 'object' && !Object.isFrozen(item)) freeze(item);
  }
  return value;
}
