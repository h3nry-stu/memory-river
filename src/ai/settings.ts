import { create } from 'zustand';
import { AI } from '@/config';

/**
 * AI / TTS 的可编辑配置（localStorage 持久化）
 * ────────────────────────────────────────────────────────────────
 * 黑客松现场可能拿到任意平台的 OpenAI 兼容 Key，所以 Base URL / Key / Model
 * 都必须能在界面上改，而不是写死 .env。
 *
 * 优先级：
 *   1. 用户在设置面板里保存的值（localStorage）
 *   2. .env 的 VITE_DEEPSEEK_API_KEY（仅 Key）
 *   3. config.AI.runtime 的默认值
 *
 * 安全提示：这是纯前端原型，Key 存在 localStorage 并随请求发往用户填写的地址。
 * 上线必须换成服务端代理（见 config.AI.runtime.proxyPathHint）。
 */

export interface ApiSettings {
  /** AI.providers 里的服务商 id（deepseek / openai / ... / custom） */
  providerId: string;
  /** OpenAI 兼容 base（可带 /v1，也可直接以 /chat/completions 结尾） */
  baseUrl: string;
  /** 兼容任意平台 Key；空串表示回落到 .env */
  apiKey: string;
  model: string;
  /** AI.personas 里的 id */
  personaId: string;
  /** 可选第三方 TTS（OpenAI 兼容 /audio/speech）；留空则用系统音色 */
  ttsBaseUrl: string;
  ttsKey: string;
  /** 独立视觉模型（截图 OCR / 照片识图 / 学热梗）；Model 留空则回退聊天模型 */
  visionProviderId: string;
  visionBaseUrl: string;
  visionApiKey: string;
  visionModel: string;
  /** 高清识图（2800px / JPEG 0.95 / detail high） */
  visionHighQuality: boolean;
  /** 导入照片时自动识图（只有配置了可用 VLM 才执行） */
  visionAutoAnalyze: boolean;
}

export interface SettingsStore extends ApiSettings {
  /** 每次保存 +1，UI 用它触发「在线/离线 / 人格名」等派生显示 */
  revision: number;
  save(patch: Partial<ApiSettings>): void;
  reset(): void;
}

export type ProviderPreset = (typeof AI.providers)[number];

export function providerById(providerId: string): ProviderPreset {
  return (
    AI.providers.find((provider) => provider.id === providerId) ??
    AI.providers.find((provider) => provider.id === AI.defaultProviderId) ??
    AI.providers[0]!
  );
}

function defaults(): ApiSettings {
  const provider = providerById(AI.defaultProviderId);
  return {
    providerId: provider.id,
    baseUrl: provider.baseUrl || AI.runtime.baseUrl,
    apiKey: '',
    model: provider.defaultModel || AI.runtime.model,
    personaId: AI.defaultPersonaId,
    ttsBaseUrl: '',
    ttsKey: '',
    visionProviderId: '',
    visionBaseUrl: '',
    visionApiKey: '',
    visionModel: '',
    visionHighQuality: AI.vision.highQualityDefault,
    visionAutoAnalyze: AI.vision.autoAnalyzeDefault,
  };
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function load(): ApiSettings {
  const base = defaults();
  try {
    const raw = window.localStorage.getItem(AI.settings.storageKey);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<keyof ApiSettings, unknown>>;
    const personaId =
      typeof parsed.personaId === 'string' &&
      AI.personas.some((persona) => persona.id === parsed.personaId)
        ? parsed.personaId
        : base.personaId;
    const providerId =
      typeof parsed.providerId === 'string' &&
      AI.providers.some((provider) => provider.id === parsed.providerId)
        ? parsed.providerId
        : (AI.providers.find(
            (provider) =>
              typeof parsed.baseUrl === 'string' && provider.baseUrl === parsed.baseUrl.trim(),
          )?.id ?? base.providerId);
    const provider = providerById(providerId);
    const visionModel =
      typeof parsed.visionModel === 'string' ? parsed.visionModel.trim() : '';
    const visionBaseUrl =
      typeof parsed.visionBaseUrl === 'string' ? parsed.visionBaseUrl.trim() : '';
    const savedVisionProviderId =
      typeof parsed.visionProviderId === 'string' &&
      AI.providers.some((item) => item.id === parsed.visionProviderId)
        ? parsed.visionProviderId
        : '';
    const inferredVisionProviderId =
      savedVisionProviderId ||
      AI.providers.find(
        (item) =>
          item.visionModels.length > 0 &&
          (item.visionModels.includes(visionModel) ||
            (visionBaseUrl.length > 0 && item.baseUrl === visionBaseUrl)),
      )?.id ||
      '';
    return {
      providerId,
      baseUrl: cleanText(parsed.baseUrl, provider.baseUrl || base.baseUrl),
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : base.apiKey,
      model: cleanText(parsed.model, provider.defaultModel || base.model),
      personaId,
      ttsBaseUrl: typeof parsed.ttsBaseUrl === 'string' ? parsed.ttsBaseUrl.trim() : '',
      ttsKey: typeof parsed.ttsKey === 'string' ? parsed.ttsKey.trim() : '',
      visionProviderId: inferredVisionProviderId,
      visionBaseUrl,
      visionApiKey: typeof parsed.visionApiKey === 'string' ? parsed.visionApiKey.trim() : '',
      visionModel,
      visionHighQuality:
        typeof parsed.visionHighQuality === 'boolean'
          ? parsed.visionHighQuality
          : AI.vision.highQualityDefault,
      visionAutoAnalyze:
        typeof parsed.visionAutoAnalyze === 'boolean'
          ? parsed.visionAutoAnalyze
          : AI.vision.autoAnalyzeDefault,
    };
  } catch {
    return base;
  }
}

function persist(settings: ApiSettings): void {
  try {
    window.localStorage.setItem(AI.settings.storageKey, JSON.stringify(settings));
  } catch {
    // 隐私模式 / 存储满了：设置只在本次会话有效，不阻断对话
  }
}

const initial = load();

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  ...initial,
  revision: 0,

  save(patch) {
    const current = get();
    const providerId =
      patch.providerId && AI.providers.some((provider) => provider.id === patch.providerId)
        ? patch.providerId
        : current.providerId;
    const provider = providerById(providerId);
    const next: ApiSettings = {
      providerId,
      baseUrl: cleanText(patch.baseUrl ?? current.baseUrl, provider.baseUrl || AI.runtime.baseUrl),
      apiKey: (patch.apiKey ?? current.apiKey).trim(),
      model: cleanText(patch.model ?? current.model, provider.defaultModel || AI.runtime.model),
      personaId:
        patch.personaId && AI.personas.some((persona) => persona.id === patch.personaId)
          ? patch.personaId
          : current.personaId,
      ttsBaseUrl: (patch.ttsBaseUrl ?? current.ttsBaseUrl).trim(),
      ttsKey: (patch.ttsKey ?? current.ttsKey).trim(),
      visionProviderId: (patch.visionProviderId ?? current.visionProviderId).trim(),
      visionBaseUrl: (patch.visionBaseUrl ?? current.visionBaseUrl).trim(),
      visionApiKey: (patch.visionApiKey ?? current.visionApiKey).trim(),
      visionModel: (patch.visionModel ?? current.visionModel).trim(),
      visionHighQuality: patch.visionHighQuality ?? current.visionHighQuality,
      visionAutoAnalyze: patch.visionAutoAnalyze ?? current.visionAutoAnalyze,
    };
    persist(next);
    set({ ...next, revision: current.revision + 1 });
  },

  reset() {
    const next = defaults();
    persist(next);
    set({ ...next, revision: get().revision + 1 });
  },
}));

/** 非 React 消费者（runtime / tts / chat）读快照 */
export function readApiSettings(): ApiSettings & { revision: number } {
  return useSettingsStore.getState();
}

/** .env 里的 Key（仅作为设置面板留空时的兜底） */
export function envApiKey(): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  return (env[AI.runtime.envKeyName] ?? '').trim();
}

/** 当前真正用于请求的 Key（设置面板 > .env） */
export function resolvedApiKey(settings: ApiSettings = readApiSettings()): string {
  return settings.apiKey.trim() || envApiKey();
}

/** 把用户填的 Base URL 规范化成「不带末尾斜杠、且能安全拼 /chat/completions」 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/**
 * 兼容两种填法：
 *   https://api.deepseek.com/v1
 *   https://api.deepseek.com/v1/chat/completions
 */
export function chatEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

export function ttsEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/audio\/speech$/i.test(base)) return base;
  return `${base}${AI.tts.custom.path}`;
}

/** 当前选中的预设人格（找不到就回温柔老友） */
export function activePersona(
  settings: ApiSettings = readApiSettings(),
): (typeof AI.personas)[number] {
  return (
    AI.personas.find((persona) => persona.id === settings.personaId) ??
    AI.personas.find((persona) => persona.id === AI.defaultPersonaId) ??
    AI.personas[0]!
  );
}

export function activeProvider(
  settings: ApiSettings = readApiSettings(),
): ProviderPreset {
  return providerById(settings.providerId);
}

export function hasCustomTts(settings: ApiSettings = readApiSettings()): boolean {
  return settings.ttsBaseUrl.length > 0 && settings.ttsKey.length > 0;
}


export interface VisionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 是否使用了独立 VLM 配置 */
  independent: boolean;
}

/**
 * VLM 配置解析：
 *   填了 visionModel → 优先独立视觉模型（Base/Key 可留空，留空跟随聊天）
 *   没填 visionModel → 完全回退聊天模型
 */
export function resolvedVisionConfig(
  settings: ApiSettings = readApiSettings(),
): VisionConfig {
  const independent = settings.visionModel.trim().length > 0;
  const baseUrl = independent
    ? settings.visionBaseUrl.trim() || settings.baseUrl
    : settings.baseUrl;
  const sameEndpoint =
    normalizeBaseUrl(baseUrl) === normalizeBaseUrl(settings.baseUrl);
  return {
    baseUrl,
    /*
     * 只有 VLM 与聊天使用同一个 Base URL 时，才允许“VLM Key 留空跟随聊天 Key”。
     * 否则把 DeepSeek 的 Key 发到 OpenAI / Qwen 一定会 401 —— 这是现场最常见的识图失败原因。
     */
    apiKey: independent
      ? settings.visionApiKey.trim() || (sameEndpoint ? resolvedApiKey(settings) : '')
      : resolvedApiKey(settings),
    model: independent ? settings.visionModel.trim() : settings.model,
    independent,
  };
}


/** 是否有可用于照片识图的 VLM：必须有独立视觉模型 + Key */
export function hasAvailableVlm(settings: ApiSettings = readApiSettings()): boolean {
  if (!settings.visionModel.trim()) return false;
  return resolvedVisionConfig(settings).apiKey.length > 0;
}

/** VLM 服务商（只保留支持视觉模型的） */
export function visionProviders(): (typeof AI.providers)[number][] {
  return AI.providers.filter(
    (provider) => provider.id === 'custom' || provider.visionModels.length > 0,
  );
}

export function visionProviderById(providerId: string): (typeof AI.providers)[number] | null {
  return visionProviders().find((provider) => provider.id === providerId) ?? null;
}
