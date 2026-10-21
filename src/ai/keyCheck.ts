import { normalizeBaseUrl } from './settings';

/**
 * 真实联网校验 API Key
 * ────────────────────────────────────────────────────────────────
 * 优先 GET /models；部分兼容平台没有该接口时，退化为一次
 * max_tokens=1 的 /chat/completions 请求，只验证鉴权，尽量少消耗。
 *
 * 铁律：
 *  - 不重试、不写聊天/VLM 熔断状态
 *  - 不输出 Key 到 console
 *  - 超时、CORS、断网都只返回状态，不抛异常给 UI
 */

export type KeyCheckStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'error';

export interface KeyCheckResult {
  status: KeyCheckStatus;
  reason?: string;
  latencyMs: number;
}

export interface KeyCheckOptions {
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** 外部取消（输入变化 / 组件卸载） */
  signal?: AbortSignal;
}

export function modelsEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/models$/i.test(base)) return base;
  if (/\/chat\/completions$/i.test(base)) {
    return `${base.replace(/\/chat\/completions$/i, '')}/models`;
  }
  return `${base}/models`;
}

export function completionsEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

function reasonFromStatus(status: number, detail: string): string {
  if (status === 401 || status === 403) return 'Key 无效或没有权限';
  if (status === 429) return '请求过于频繁（429）';
  if (status >= 500) return `服务端错误（${status}）`;
  if (detail.trim()) return `HTTP ${status}：${detail.trim().slice(0, 100)}`;
  return `HTTP ${status}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = (): void => controller.abort();
  external?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}

async function probeChat(
  options: KeyCheckOptions,
  timeoutMs: number,
): Promise<KeyCheckResult> {
  const started = performance.now();
  const model = options.model?.trim() ?? '';
  if (!model) {
    return {
      status: 'error',
      reason: '接口不支持 /models，且没有填写模型名，无法继续校验',
      latencyMs: performance.now() - started,
    };
  }

  const attempt = async (tokenField: 'max_tokens' | 'max_completion_tokens'): Promise<Response> => {
    return fetchWithTimeout(
      completionsEndpoint(options.baseUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          [tokenField]: 1,
          temperature: 0,
          stream: false,
        }),
      },
      timeoutMs,
      options.signal,
    );
  };

  try {
    let response = await attempt('max_tokens');
    // 新一代推理模型只接受 max_completion_tokens；400 时再试一次
    if (response.status === 400) {
      response = await attempt('max_completion_tokens');
    }

    if (response.ok) {
      return { status: 'valid', latencyMs: performance.now() - started };
    }
    const detail = await response.text().catch(() => '');
    return {
      status: response.status === 401 || response.status === 403 ? 'invalid' : 'error',
      reason: reasonFromStatus(response.status, detail),
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? '请求超时'
        : '无法连接接口（可能是网络或 CORS 限制）';
    return { status: 'error', reason, latencyMs: performance.now() - started };
  }
}

/**
 * 校验一个 OpenAPI 兼容 Key。
 * 返回状态而不是抛错；调用方用 AbortController 丢弃过期结果。
 */
export async function checkApiKey(options: KeyCheckOptions): Promise<KeyCheckResult> {
  const started = performance.now();
  const apiKey = options.apiKey.trim();
  const baseUrl = options.baseUrl.trim();
  if (!apiKey) {
    return { status: 'idle', reason: '未填写 API Key', latencyMs: 0 };
  }
  if (!baseUrl) {
    return { status: 'error', reason: '未填写 Base URL', latencyMs: 0 };
  }

  const timeoutMs = options.timeoutMs ?? 8_000;

  try {
    const response = await fetchWithTimeout(
      modelsEndpoint(baseUrl),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      timeoutMs,
      options.signal,
    );

    if (response.ok) {
      return { status: 'valid', latencyMs: performance.now() - started };
    }

    // 401/403 直接判定 Key 无效
    if (response.status === 401 || response.status === 403) {
      const detail = await response.text().catch(() => '');
      return {
        status: 'invalid',
        reason: reasonFromStatus(response.status, detail),
        latencyMs: performance.now() - started,
      };
    }

    // 没有 /models 的平台：用一次极小 chat 请求验证鉴权
    if (response.status === 404 || response.status === 405) {
      return probeChat(options, timeoutMs);
    }

    const detail = await response.text().catch(() => '');
    return {
      status: 'error',
      reason: reasonFromStatus(response.status, detail),
      latencyMs: performance.now() - started,
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? '请求超时'
        : '无法连接接口（可能是网络或 CORS 限制）';
    return { status: 'error', reason, latencyMs: performance.now() - started };
  }
}
