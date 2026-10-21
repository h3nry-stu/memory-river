import { AI } from '@/config';
import type { PromptMessage } from './prompt';
import {
  chatEndpoint,
  envApiKey,
  readApiSettings,
  resolvedApiKey,
  resolvedVisionConfig,
  useSettingsStore,
} from './settings';

/**
 * LLM 适配器（DeepSeek / 任意 OpenAI 兼容端点）
 * ────────────────────────────────────────────────────────────────
 * 设计原则：**永远不抛错给 UI**。
 *   没 key → 走 mock；超时 / 网络错 / 429 / 5xx → 重试一次 → 仍失败就熔断，
 *   本会话之后直接走 mock。路演现场断网也不能白屏或卡住说话。
 *
 * key 从 `.env` 的 `VITE_DEEPSEEK_API_KEY` 读（Vite 只注入 VITE_ 前缀）。
 * ⚠️ VITE_ 变量会被打进前端产物 —— 本机原型可以，上线必须换成同源代理
 *    （把 runtime.baseUrl 改成 `/api/chat` 那种形式，key 留在服务端）。
 */

export type RuntimeSource = 'remote' | 'mock';

export interface CompletionResult {
  text: string;
  source: RuntimeSource;
  /** 失败原因（诊断用，UI 不显示） */
  reason?: string;
  latencyMs: number;
}

export interface VisionResult {
  ok: boolean;
  text: string;
  reason?: string;
  latencyMs: number;
  /** 这次用的是独立 VLM 还是回退聊天模型 */
  independent: boolean;
  model: string;
}

interface RuntimeState {
  consecutiveFailures: number;
  disabledUntilMs: number;
  lastReason: string | null;
  lastSource: RuntimeSource;
  remoteTriedCount: number;
  remoteSuccessCount: number;
}

const state: RuntimeState = {
  consecutiveFailures: 0,
  disabledUntilMs: 0,
  lastReason: null,
  lastSource: 'mock',
  remoteTriedCount: 0,
  remoteSuccessCount: 0,
};

/** VLM 有独立熔断，截图失败不能影响聊天 */
const visionState = {
  consecutiveFailures: 0,
  disabledUntilMs: 0,
  lastReason: null as string | null,
};

/** 当前生效的 key：设置面板 > .env（没有就是空串 → 全走 mock） */
export function apiKey(): string {
  return resolvedApiKey(readApiSettings());
}

export function hasRemote(): boolean {
  return apiKey().length > 0;
}

export function runtimeStatus(): {
  hasKey: boolean;
  model: string;
  baseUrl: string;
  circuitOpen: boolean;
  consecutiveFailures: number;
  lastSource: RuntimeSource;
  lastReason: string | null;
  remoteTriedCount: number;
  remoteSuccessCount: number;
} {
  const settings = readApiSettings();
  return {
    hasKey: hasRemote(),
    model: settings.model || AI.runtime.model,
    baseUrl: settings.baseUrl || AI.runtime.baseUrl,
    circuitOpen: performance.now() < state.disabledUntilMs,
    consecutiveFailures: state.consecutiveFailures,
    lastSource: state.lastSource,
    lastReason: state.lastReason,
    remoteTriedCount: state.remoteTriedCount,
    remoteSuccessCount: state.remoteSuccessCount,
  };
}

/**
 * DeepSeek Flash 默认开启 Thinking（effort=high），思考 token 会吃掉
 * max_tokens；短回复 / 识图 JSON 很容易只剩空 content。
 *
 * 只对 Flash 系列关闭思考；deepseek-reasoner 保留其思考能力。
 */
function thinkingOverride(model: string): Record<string, unknown> {
  return /^deepseek-flash(?:$|-)/i.test(model) || /^deepseek-v4-flash/i.test(model)
    ? { thinking: { type: 'disabled' } }
    : {};
}

/** 一次远端请求（OpenAI 兼容 /chat/completions） */
async function requestOnce(
  messages: PromptMessage[],
  signal: AbortSignal,
  maxTokens: number,
): Promise<string> {
  const settings = readApiSettings();
  const model = settings.model || AI.runtime.model;
  const response = await fetch(chatEndpoint(settings.baseUrl), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolvedApiKey(settings)}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: AI.sampling.temperature,
      top_p: AI.sampling.topP,
      max_tokens: maxTokens,
      stream: false,
      ...thinkingOverride(model),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${detail.slice(0, 120)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('empty completion');
  return text;
}

/**
 * 请求一次补全。
 *
 * @param messages 组好的 messages（system + 历史 + 这一句）
 * @returns 远端成功返回 `source: 'remote'`；否则 `source: 'mock'` 且 `text` 为空串，
 *          由调用方决定用哪套 mock（mock 需要切片上下文，只有 chat.ts 有）
 */
export async function completeChat(
  messages: PromptMessage[],
  options: { timeoutMs?: number; maxTokens?: number } = {},
): Promise<CompletionResult> {
  const started = performance.now();
  if (!hasRemote()) {
    state.lastSource = 'mock';
    state.lastReason = 'no-api-key';
    return { text: '', source: 'mock', reason: 'no-api-key', latencyMs: 0 };
  }
  if (performance.now() < state.disabledUntilMs) {
    state.lastSource = 'mock';
    return { text: '', source: 'mock', reason: 'circuit-open', latencyMs: 0 };
  }

  const timeoutMs = options.timeoutMs ?? AI.runtime.timeoutMs;
  const maxTokens = options.maxTokens ?? AI.sampling.maxTokens;
  const attempts = AI.runtime.maxRetries + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      state.remoteTriedCount += 1;
      const text = await requestOnce(messages, controller.signal, maxTokens);
      window.clearTimeout(timer);
      state.consecutiveFailures = 0;
      state.remoteSuccessCount += 1;
      state.lastSource = 'remote';
      state.lastReason = null;
      return { text, source: 'remote', latencyMs: performance.now() - started };
    } catch (error) {
      window.clearTimeout(timer);
      const reason = error instanceof Error ? error.message : String(error);
      state.lastReason = reason;
      state.consecutiveFailures += 1;
      // 熔断：连续失败够多就本会话不再尝试（比赛/路演现场不能每次都等超时）
      if (state.consecutiveFailures >= AI.runtime.failureThreshold) {
        state.disabledUntilMs = performance.now() + 5 * 60_000;
      }
    }
  }

  state.lastSource = 'mock';
  return {
    text: '',
    source: 'mock',
    reason: state.lastReason ?? 'unknown',
    latencyMs: performance.now() - started,
  };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

async function requestVisionOnce(
  prompt: string,
  imageDataUrl: string,
  signal: AbortSignal,
  maxTokens: number,
  detail: 'high' | 'auto' | 'low' | 'none',
): Promise<string> {
  const config = resolvedVisionConfig();
  if (!config.apiKey) throw new Error('no-vision-api-key');
  const model = config.model;
  const response = await fetch(chatEndpoint(config.baseUrl), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url:
                detail === 'none'
                  ? { url: imageDataUrl }
                  : { url: imageDataUrl, detail },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: false,
      ...thinkingOverride(model),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`VLM HTTP ${response.status} ${detail.slice(0, 120)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const text = contentToText(data.choices?.[0]?.message?.content);
  if (!text) throw new Error('empty vision completion');
  return text;
}

/**
 * 多模态补全（截图 OCR / 学热梗）
 *
 * 优先独立 VLM 配置；没填独立模型则回退聊天模型（可能不支持看图）。
 * 永远不抛错给 UI，只返回 ok / reason。
 */
export async function completeVision(
  prompt: string,
  imageDataUrl: string,
  options: {
    timeoutMs?: number;
    maxTokens?: number;
    detail?: 'high' | 'auto' | 'low' | 'none';
  } = {},
): Promise<VisionResult> {
  const started = performance.now();
  const config = resolvedVisionConfig();
  const base: Omit<VisionResult, 'ok' | 'text' | 'latencyMs'> = {
    independent: config.independent,
    model: config.model,
  };
  const fail = (reason: string): VisionResult => ({
    ...base,
    ok: false,
    text: '',
    reason,
    latencyMs: performance.now() - started,
  });

  if (!config.apiKey) {
    visionState.lastReason = 'no-vision-api-key';
    return fail('no-vision-api-key');
  }
  if (performance.now() < visionState.disabledUntilMs) {
    return fail('vision-circuit-open');
  }

  const timeoutMs = options.timeoutMs ?? AI.vision.timeoutMs;
  const maxTokens = options.maxTokens ?? AI.vision.maxTokens;
  const detail = options.detail ?? AI.vision.detail;
  const attempts = AI.runtime.maxRetries + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const text = await requestVisionOnce(
        prompt,
        imageDataUrl,
        controller.signal,
        maxTokens,
        detail,
      );
      window.clearTimeout(timer);
      visionState.consecutiveFailures = 0;
      visionState.lastReason = null;
      return {
        ...base,
        ok: true,
        text,
        latencyMs: performance.now() - started,
      };
    } catch (error) {
      window.clearTimeout(timer);
      const reason = error instanceof Error ? error.message : String(error);
      visionState.lastReason = reason;
      visionState.consecutiveFailures += 1;
      if (visionState.consecutiveFailures >= AI.vision.failureThreshold) {
        visionState.disabledUntilMs = performance.now() + 5 * 60_000;
      }
      // 4xx（429 除外）是确定性错误：重试不会变好，直接交给上层 fallback
      const statusMatch = /VLM HTTP (\d{3})/.exec(reason);
      const httpStatus = statusMatch ? Number(statusMatch[1]) : 0;
      if (httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429) break;
    }
  }

  return fail(visionState.lastReason ?? 'vision-failed');
}

/** 手动重置熔断（UI 的"重试远端"按钮 / 探针用） */
export function resetRuntime(): void {
  state.consecutiveFailures = 0;
  state.disabledUntilMs = 0;
  state.lastReason = null;
  visionState.consecutiveFailures = 0;
  visionState.disabledUntilMs = 0;
  visionState.lastReason = null;
}

/**
 * 换了平台 / Key / 模型后必须马上解除熔断：
 * 否则用户刚填好新 Key，仍会看到旧配置失败后的 5 分钟 mock。
 */
let apiFingerprint = '';
function fingerprintOf(state: {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionBaseUrl: string;
  visionApiKey: string;
  visionModel: string;
}): string {
  const key = state.apiKey.trim() || envApiKey();
  return [
    state.baseUrl,
    state.model,
    key,
    state.visionBaseUrl,
    state.visionApiKey,
    state.visionModel,
  ].join('\u0000');
}
apiFingerprint = fingerprintOf(readApiSettings());
useSettingsStore.subscribe((settings) => {
  const next = fingerprintOf(settings);
  if (next === apiFingerprint) return;
  apiFingerprint = next;
  resetRuntime();
});
