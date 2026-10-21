import { AI } from '@/config';
import {
  hasCustomTts,
  readApiSettings,
  ttsEndpoint,
  type ApiSettings,
} from './settings';

/**
 * 语音朗读（TTS）
 * ────────────────────────────────────────────────────────────────
 * 默认用浏览器自带的 Web Speech API：零成本、零网络、中文语音系统自带。
 * 目标是陪伴感，所以语速偏慢、按标点分句、用户一开口就停掉上一句。
 *
 * 音色策略（重点）：
 *   优先系统里最拟人的中文音色（macOS 婷婷/美佳、Windows 晓晓/云希…），
 *   并给 "Natural / Online / Premium" 这类自然音加分；找不到就回落默认。
 *
 * 第三方 TTS：
 *   设置面板填了 Base URL + Key 时，走 OpenAI 兼容 /audio/speech。
 *   任何请求失败都**静默回落系统音色**，绝不让 UI 报错或卡死。
 */

let enabled: boolean = AI.tts.enabled;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesPrimed = false;
let customAbort: AbortController | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let speechToken = 0;

function readSelectedVoice(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(AI.tts.voiceStorageKey) ?? '';
  } catch {
    return '';
  }
}

/** 用户选中的系统音色 voiceURI；空串 = 自动挑选 */
let selectedVoiceURI = readSelectedVoice();

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  try {
    return window.speechSynthesis;
  } catch {
    return null;
  }
}

export function ttsAvailable(): boolean {
  return synth() !== null;
}

function voiceScore(voice: SpeechSynthesisVoice): number {
  const lang = voice.lang.replace('_', '-').toLowerCase();
  const name = voice.name.toLowerCase();
  let score = 0;

  if (lang === AI.tts.lang.toLowerCase()) score += 120;
  else if (lang.startsWith('zh-cn') || lang.includes('cmn')) score += 100;
  else if (lang.startsWith('zh')) score += 45;
  else return -1;

  const preferred = AI.tts.preferredVoiceNames.findIndex((needle) =>
    name.includes(needle.toLowerCase()),
  );
  if (preferred >= 0) score += 90 - preferred * 4;

  if (AI.tts.naturalVoiceHints.some((hint) => name.includes(hint))) score += 35;
  // 本地合成音通常比在线自然音机械，但不绝对 —— 只做小幅减分
  if (voice.localService === false) score += 12;
  if (/siri/i.test(voice.name)) score += 18;

  return score;
}

/**
 * 列出系统里可用的中文音色（按拟人度排序）
 * Safari 首次可能返回空数组，设置面板会监听 voiceschanged 再刷新。
 */
export function listChineseVoices(): SpeechSynthesisVoice[] {
  const engine = synth();
  if (!engine) return [];
  try {
    return engine
      .getVoices()
      .filter((voice) => voiceScore(voice) >= 0)
      .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name, 'zh-CN'));
  } catch {
    return [];
  }
}

export function getSelectedVoiceURI(): string {
  return selectedVoiceURI;
}

/** 选择系统音色；传空串恢复自动挑选 */
export function setSelectedVoice(voiceURI: string): void {
  selectedVoiceURI = voiceURI.trim();
  cachedVoice = null;
  try {
    if (selectedVoiceURI.length > 0) {
      window.localStorage.setItem(AI.tts.voiceStorageKey, selectedVoiceURI);
    } else {
      window.localStorage.removeItem(AI.tts.voiceStorageKey);
    }
  } catch {
    // 隐私模式：音色只在本次会话有效
  }
}

/** 挑一个中文语音：优先用户选择，其次按拟人度评分；找不到中文返回 null */
export function pickVoice(): SpeechSynthesisVoice | null {
  const engine = synth();
  if (!engine) return null;
  if (cachedVoice) return cachedVoice;

  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = engine.getVoices();
  } catch {
    return null;
  }
  if (voices.length === 0) return null;

  if (selectedVoiceURI.length > 0) {
    const selected = voices.find(
      (voice) => voice.voiceURI === selectedVoiceURI || voice.name === selectedVoiceURI,
    );
    if (selected) {
      cachedVoice = selected;
      return cachedVoice;
    }
  }

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const score = voiceScore(voice);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }

  cachedVoice = best;
  return cachedVoice;
}

/** 按标点切句，每句不超过 maxChunkChars（长句一次念完会断气） */
export function splitForSpeech(text: string, maxChars: number = AI.tts.maxChunkChars): string[] {
  const sentences = text
    .split(/(?<=[。！？…；])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
      continue;
    }
    // 太长就按逗号再切；仍然太长就硬切
    for (const piece of sentence.split(/(?<=[，、])/)) {
      const trimmed = piece.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length <= maxChars) {
        chunks.push(trimmed);
      } else {
        for (let i = 0; i < trimmed.length; i += maxChars) {
          chunks.push(trimmed.slice(i, i + maxChars));
        }
      }
    }
  }
  return chunks;
}

export function setTtsEnabled(value: boolean): void {
  enabled = value;
  if (!value) cancelSpeech();
  try {
    window.localStorage.setItem(AI.tts.storageKey, value ? '1' : '0');
  } catch {
    // 隐私模式下 localStorage 可能不可写：不影响朗读本身
  }
}

export function isTtsEnabled(): boolean {
  return enabled;
}

/** 从 localStorage 恢复用户偏好（启动时调用一次） */
export function restoreTtsPreference(): boolean {
  try {
    const saved = window.localStorage.getItem(AI.tts.storageKey);
    if (saved === '0') enabled = false;
    else if (saved === '1') enabled = true;
  } catch {
    // 读不到就保持 config 默认
  }
  return enabled;
}

function stopAudio(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = '';
    } catch {
      // 已被浏览器回收
    }
    currentAudio = null;
  }
  if (currentAudioUrl) {
    try {
      URL.revokeObjectURL(currentAudioUrl);
    } catch {
      // ignore
    }
    currentAudioUrl = null;
  }
}

export function cancelSpeech(): void {
  speechToken += 1;
  currentUtterance = null;

  customAbort?.abort();
  customAbort = null;
  stopAudio();

  const engine = synth();
  if (!engine) return;
  try {
    engine.cancel();
  } catch {
    // 某些浏览器在 voices 加载前 cancel 会抛，忽略
  }
}

/** 系统音色朗读（内部）；force 用于设置面板试听，不受自动朗读开关影响 */
function speakWithSystem(
  text: string,
  token: number,
  options: { force?: boolean; voiceURI?: string } = {},
): void {
  const engine = synth();
  if (!engine || token !== speechToken) return;
  if (!enabled && options.force !== true) return;

  let voice: SpeechSynthesisVoice | null = null;
  if (options.voiceURI) {
    try {
      voice =
        engine
          .getVoices()
          .find(
            (item) => item.voiceURI === options.voiceURI || item.name === options.voiceURI,
          ) ?? null;
    } catch {
      // 音色列表异常时回落自动挑选
    }
  }
  voice ??= pickVoice();
  const chunks = splitForSpeech(text);

  for (const chunk of chunks) {
    if (!enabled || token !== speechToken) return;
    try {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = voice?.lang ?? AI.tts.lang;
      if (voice) utterance.voice = voice;
      utterance.rate = AI.tts.rate;
      utterance.pitch = AI.tts.pitch;
      utterance.volume = AI.tts.volume;
      utterance.onend = () => {
        if (currentUtterance === utterance) currentUtterance = null;
      };
      utterance.onerror = () => {
        if (currentUtterance === utterance) currentUtterance = null;
      };
      currentUtterance = utterance;
      engine.speak(utterance);
    } catch {
      // 某个音色/语音包异常时继续尝试下一句，不向 UI 抛错
      currentUtterance = null;
    }
  }
}

/** 第三方 TTS（OpenAI 兼容 /audio/speech） */
async function speakWithCustom(
  text: string,
  settings: ApiSettings,
  token: number,
): Promise<boolean> {
  const controller = new AbortController();
  customAbort = controller;
  const timer = window.setTimeout(() => controller.abort(), AI.tts.custom.timeoutMs);

  try {
    const response = await fetch(ttsEndpoint(settings.ttsBaseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.ttsKey}`,
      },
      body: JSON.stringify({
        model: AI.tts.custom.model,
        input: text,
        voice: AI.tts.custom.voice,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);

    const blob = await response.blob();
    if (!blob.size) throw new Error('TTS empty audio');
    if (!enabled || token !== speechToken) return false;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    currentAudioUrl = url;
    audio.volume = AI.tts.volume;

    return await new Promise<boolean>((resolve) => {
      const done = (ok: boolean): void => {
        if (currentAudio === audio) stopAudio();
        resolve(ok);
      };
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      void audio.play().then(
        () => undefined,
        () => done(false),
      );
      // 页面切走 / 被取消时也能结束等待
      controller.signal.addEventListener('abort', () => done(false), { once: true });
    });
  } finally {
    window.clearTimeout(timer);
    if (customAbort === controller) customAbort = null;
  }
}

/**
 * 朗读一段话（自动分句排队）
 *
 * 浏览器要求先有用户手势才允许出声；回复前用户刚发过消息，满足条件。
 */
export function speak(text: string): void {
  if (!enabled) return;
  const clean = text.replace(/[「」“”]/g, '').trim();
  if (clean.length === 0) return;

  cancelSpeech();
  const token = speechToken;
  const settings = readApiSettings();

  if (hasCustomTts(settings)) {
    void speakWithCustom(clean, settings, token)
      .then((ok) => {
        if (!ok && enabled && token === speechToken) {
          speakWithSystem(clean, token);
        }
      })
      .catch(() => {
        // 第三方失败一律静默回落系统音色
        if (enabled && token === speechToken) speakWithSystem(clean, token);
      });
    return;
  }

  speakWithSystem(clean, token);
}

/** 设置面板试听：忽略「自动朗读」开关，但不会把它打开 */
export function previewVoice(text = '我在这里，陪你看看这张照片。'): void {
  if (!synth()) return;
  cancelSpeech();
  const token = speechToken;
  speakWithSystem(text, token, { force: true, voiceURI: selectedVoiceURI });
}

/** 当前是否正在说话（口型/光效可以接） */
export function isSpeaking(): boolean {
  const engine = synth();
  if (engine) {
    try {
      if (engine.speaking) return true;
    } catch {
      // ignore
    }
  }
  return currentAudio !== null || currentUtterance !== null;
}

/**
 * 语音列表是异步加载的：某些浏览器首次 getVoices() 返回空。
 * 提前订阅一次 voiceschanged，把最优中文语音缓存下来。
 */
export function primeVoices(): void {
  const engine = synth();
  if (!engine || voicesPrimed) return;
  voicesPrimed = true;

  const refresh = (): void => {
    cachedVoice = null;
    pickVoice();
  };
  refresh();
  try {
    engine.addEventListener?.('voiceschanged', refresh);
    engine.onvoiceschanged = refresh;
  } catch {
    // 不支持 voiceschanged 的浏览器：首次 speak 时还会再试
  }
}
