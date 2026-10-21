import { AI } from '@/config';
import { useRiverStore, type ChatCitation, type ChatTurn } from '@/state';
import type { PhotoMemory } from '@/photo/types';
import { guard } from './guard';
import { mockReply } from './mock';
import { parseReplyBubbles, replyTextFromBubbles } from './bubbles';
import { buildMessages } from './prompt';
import { buildCorpus, emotionTagsOf, retrieve, type Citation } from './retrieval';
import { markApiFailure, markApiOnline } from './apiStatus';
import { completeChat, runtimeStatus, type CompletionResult } from './runtime';
import { activePersona } from './settings';
import { openingFor, sliceForPhoto, type SliceProfile } from './slices';
import { speak } from './tts';

/**
 * 对话控制流（UI 只调这里，不直接碰 ai/* 内部）
 * ────────────────────────────────────────────────────────────────
 * 一次发送的完整链路：
 *
 *   用户输入
 *     → 切片（这张图的分身是谁）
 *     → 检索别的切片（跨图记忆从哪来）
 *     → 组装 prompt（总人格 + 切片 + 检索）
 *     → 远端补全（失败 → 不回复；只有开发探针可显式走 Mock）
 *     → 按 photoId 归档 + TTS 朗读
 *
 * 铁律：
 *  - 归档永远按 photoId 分开存；跨图引用只经过"检索"，不预载
 *  - 产品路径没有 Key / 离线 / 401 → 不生成任何 AI 回复，也不伪造 Mock
 */

let turnCounter = 0;
let speechTimer: number | null = null;

function nextTurnId(): string {
  turnCounter += 1;
  return `turn-${Date.now().toString(36)}-${turnCounter}`;
}

/** 把远端原始回复变成 turn；<<<MSG>>> 只用于 UI，text 保持干净 */
function personaTurnFrom(
  rawReply: string,
  citations: ChatCitation[],
): ChatTurn {
  const bubbles = parseReplyBubbles(rawReply);
  const text = replyTextFromBubbles(bubbles);
  const turn: ChatTurn = {
    id: nextTurnId(),
    role: 'persona',
    text,
    atMs: Date.now(),
    tags: emotionTagsOf(text),
  };
  if (bubbles.length > 1) turn.bubbles = bubbles;
  if (citations.length > 0) turn.citations = citations;
  return turn;
}

/** 等最后一条气泡出现后再朗读，避免语音抢跑；新回复会取消旧计时 */
function scheduleSpeech(text: string, bubbleCount: number): void {
  if (speechTimer) {
    window.clearTimeout(speechTimer);
    speechTimer = null;
  }
  const delayMs = Math.max(bubbleCount - 1, 0) * AI.ui.bubbles.replyDelayMs;
  if (delayMs <= 0) {
    speak(text);
    return;
  }
  speechTimer = window.setTimeout(() => {
    speechTimer = null;
    speak(text);
  }, delayMs);
}

/** 引用去重：同一张图只保留分数最高的一条（UI 上不出现两个一样的标签） */
function uniqueCitations(items: readonly Citation[], limit: number): ChatCitation[] {
  const seen = new Set<string>();
  const out: ChatCitation[] = [];
  for (const item of items) {
    if (seen.has(item.sliceId)) continue;
    seen.add(item.sliceId);
    out.push({ sliceId: item.sliceId, label: item.sliceLabel, text: item.text });
    if (out.length >= limit) break;
  }
  return out;
}

function profileFor(photoId: string): SliceProfile | null {
  const photo = useRiverStore.getState().photos.find((item) => item.id === photoId);
  if (!photo) return null;
  return sliceForPhoto(photo);
}

/** 当前正在对话的照片（面板打开时就是它） */
export function activePhotoId(): string | null {
  const state = useRiverStore.getState();
  return state.focusedId ?? state.photos[0]?.id ?? null;
}

export function threadOf(photoId: string): ChatTurn[] {
  return useRiverStore.getState().chatByPhoto[photoId] ?? [];
}

/**
 * 打开一段记忆：必要时补一句开场白
 *
 * 开场白由切片事实拼成（画面细节优先），只在**第一次**打开这张图时出现。
 */
export function ensureThreadOpened(photoId: string): void {
  const profile = profileFor(photoId);
  if (!profile) return;
  const store = useRiverStore.getState();

  const thread = store.chatByPhoto[photoId] ?? [];
  if (thread.length > 0) return;
  // 开场白默认关闭（AI.opening.enabled = false）：
  // 进 L2 不再自动冒一句模板话 —— 安静的人才像老朋友，想听它说话就主动开口
  if (!AI.opening.enabled) return;

  const text = guard(openingFor(profile), { maxChars: AI.opening.maxChars });
  const turn: ChatTurn = {
    id: nextTurnId(),
    role: 'persona',
    text,
    atMs: Date.now(),
    tags: ['开场'],
  };
  store.appendChatTurn(photoId, turn);
  speak(text);
}

export interface SendResult {
  ok: boolean;
  /** 失败原因（UI 用来提示离线 / Key 无效） */
  reason?: string;
  /** 诊断：这一轮是怎么产生的 */
  debug: {
    source: 'remote' | 'mock' | 'error';
    citations: number;
    sharedEmotions: string[];
    promptChars: number;
    reason?: string;
    latencyMs: number;
  };
}

export interface SendOptions {
  /**
   * 仅开发探针使用：允许远端失败时回落本地 Mock。
   * 生产构建会直接忽略；产品 UI 永远不传。
   */
  allowLocalMock?: boolean;
}

/** DEV：URL 带 ?mockChat=1 时允许 UI 走 Mock，仅用于探针 */
function devMockAllowed(options: SendOptions): boolean {
  if (!import.meta.env.DEV) return false;
  if (options.allowLocalMock === true) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    // 开发探针专用；生产构建在函数开头已经 return false
    return params.has('mockChat') || params.has('chatSim') || params.has('chatPanel');
  } catch {
    return false;
  }
}

/**
 * 发送一句话，等 AI 回完再 resolve（面板用它控制 busy 状态）
 */
export async function sendChatMessage(
  rawText: string,
  options: SendOptions = {},
): Promise<SendResult> {
  const text = rawText.trim();
  const store = useRiverStore.getState();
  const photoId = activePhotoId();
  const emptyResult: SendResult = {
    ok: false,
    reason: 'empty',
    debug: { source: 'error', citations: 0, sharedEmotions: [], promptChars: 0, latencyMs: 0 },
  };

  if (!photoId || text.length === 0) return emptyResult;
  const profile = profileFor(photoId);
  if (!profile) return emptyResult;

  const allowMock = devMockAllowed(options);

  // ① 先归档用户这句（哪怕后面失败，记忆里也要有"你说过"）
  const turnsBefore = threadOf(photoId);
  const userTags = emotionTagsOf(text);
  const userTurn: ChatTurn = {
    id: nextTurnId(),
    role: 'user',
    text,
    atMs: Date.now(),
    tags: userTags,
  };
  store.appendChatTurn(photoId, userTurn);
  store.setChatBusy(true);

  const fail = (reason: string, latencyMs = 0): SendResult => {
    markApiFailure(reason);
    useRiverStore.getState().setChatBusy(false);
    return {
      ok: false,
      reason,
      debug: {
        source: 'error',
        citations: 0,
        sharedEmotions: [],
        promptChars: 0,
        latencyMs,
      },
    };
  };

  // 浏览器明确离线：不发请求、不伪造回复
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return fail('offline');
  }

  // ② 检索别的切片：这是"同一个人"能被说出来的唯一来源
  const profiles = store.photos
    .map((photo: PhotoMemory) => sliceForPhoto(photo))
    .filter((item) => item.id !== photoId);
  const corpus = buildCorpus(profiles, store.chatByPhoto, photoId, store.digestsByPhoto);
  const retrieval = retrieve(text, corpus);
  const persona = activePersona();
  const avoidMemeEmotions = AI.mock.memes.avoidEmotions as readonly string[];
  const lightContext = !userTags.some((tag) => avoidMemeEmotions.includes(tag));
  const memeRequired = persona.id === 'humor' && lightContext;
  const messages = buildMessages(
    profile,
    turnsBefore,
    text,
    retrieval.items,
    retrieval.sharedEmotions,
    persona.id,
    memeRequired,
  );
  const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);

  let remote: CompletionResult = { text: '', source: 'mock', latencyMs: 0 };
  try {
    remote = await completeChat(messages);

    if (remote.source === 'remote' && remote.text.length > 0) {
      const replyText = guard(remote.text);
      const citations = uniqueCitations(retrieval.items, AI.reply.maxMemoryCitations);
      const personaTurn = personaTurnFrom(replyText, citations);
      useRiverStore.getState().appendChatTurn(photoId, personaTurn);
      useRiverStore.getState().setChatBusy(false);
      markApiOnline();
      scheduleSpeech(personaTurn.text, personaTurn.bubbles?.length ?? 1);
      return {
        ok: true,
        debug: {
          source: 'remote',
          citations: citations.length,
          sharedEmotions: retrieval.sharedEmotions,
          promptChars,
          latencyMs: Math.round(remote.latencyMs),
        },
      };
    }

    // 开发探针：显式允许时才回退 Mock
    if (allowMock) {
      const mock = mockReply({
        profile,
        turns: turnsBefore,
        userText: text,
        citations: retrieval.items,
        sharedEmotions: retrieval.sharedEmotions,
        sharedPlaces: retrieval.sharedPlaces,
        personaId: persona.id,
      });
      const personaTurn = personaTurnFrom(mock.text, mock.citations);
      useRiverStore.getState().appendChatTurn(photoId, personaTurn);
      useRiverStore.getState().setChatBusy(false);
      scheduleSpeech(personaTurn.text, personaTurn.bubbles?.length ?? 1);
      return {
        ok: true,
        debug: {
          source: 'mock',
          citations: mock.citations.length,
          sharedEmotions: retrieval.sharedEmotions,
          promptChars,
          latencyMs: Math.round(remote.latencyMs),
          reason: remote.reason ?? 'dev-mock',
        },
      };
    }

    // 产品路径：远端失败就是不回复
    return fail(remote.reason ?? 'remote-failed', Math.round(remote.latencyMs));
  } catch (error) {
    if (allowMock) {
      // 探针的最终兜底也不能让 busy 卡住
      markApiFailure(error instanceof Error ? error.message : 'unexpected');
    }
    return fail(error instanceof Error ? error.message : 'unexpected');
  }
}

/**
 * 「凝聚记忆」：把这段对话压成一句**事实性**摘要，存进归档层
 *
 * 为什么有意义：摘要会进跨图检索的语料（权重高于零散对话），
 * 所以凝聚 = 主动把这件事压实，别的切片之后更容易想起它。
 * 措辞同样是克制的：只写"哪天、谁说了什么"，不写情绪总结。
 */
export interface CondenseResult {
  ok: boolean;
  summary: string;
  turnCount: number;
}

export function condenseMemory(photoId: string): CondenseResult {
  const profile = profileFor(photoId);
  const store = useRiverStore.getState();
  if (!profile) return { ok: false, summary: '', turnCount: 0 };

  const thread = store.chatByPhoto[photoId] ?? [];
  const userTurns = thread.filter((turn) => turn.role === 'user');
  if (userTurns.length === 0) return { ok: false, summary: '', turnCount: 0 };

  // 取信息量最大的那句用户发言（越长通常越具体），去掉句尾标点
  const spoken = [...userTurns]
    .map((turn) => turn.text.replace(/[。！？…]+$/g, '').trim())
    .sort((a, b) => b.length - a.length)[0];
  const summary = `${profile.label}：${(spoken ?? '').slice(0, 18)}`;

  store.appendDigest({
    id: `digest-${Date.now().toString(36)}`,
    photoId,
    label: profile.label,
    text: summary,
    turnCount: thread.length,
    atMs: Date.now(),
  });
  return { ok: true, summary, turnCount: thread.length };
}

/** 面板上的「重播」 */
export function replayLastReply(photoId: string): void {
  const thread = threadOf(photoId);
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const turn = thread[i];
    if (turn?.role === 'persona') {
      speak(turn.text);
      return;
    }
  }
}

/** 诊断：切片人格长什么样（DEV 探针 / 面板小字用） */
export function sliceDebug(photoId: string): Record<string, unknown> | null {
  const profile = profileFor(photoId);
  if (!profile) return null;
  return {
    id: profile.id,
    label: profile.label,
    place: profile.placeName,
    voice: profile.voice,
    tone: profile.tone,
    facts: profile.facts.map((fact) => fact.text),
    runtime: runtimeStatus(),
  };
}
