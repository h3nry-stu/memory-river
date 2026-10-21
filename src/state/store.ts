import { create } from 'zustand';
import { AI, INPUT, LAYER_ORDER, type LayerId, type LodTier } from '@/config';
import { assignPositions } from '@/photo/ingest';
import type { PhotoAudio, PhotoMemory, PhotoVlmAnalysis } from '@/photo/types';

/* ───────────────────────── 阶段 4：对话与记忆 ───────────────────────── */

/** AI 引用到的"另一张照片"（UI 会把它显示成小标签，让跨图记忆看得见） */
export interface ChatCitation {
  sliceId: string;
  /** 那张图的切片标签：2021 夏 · 海边 */
  label: string;
  /** 被引用的原话 */
  text: string;
}

/** 一轮对话 */
export interface ChatTurn {
  id: string;
  role: 'user' | 'persona';
  text: string;
  atMs: number;
  /** 这轮 AI 引用了哪些别的切片（跨图记忆的可见证据） */
  citations?: ChatCitation[] | undefined;
  /** AI 连发多条时的气泡文本；仅用于 UI，text 仍是完整回复 */
  bubbles?: string[];
  /** 情绪标签（检索用） */
  tags: string[];
}

/**
 * 对话归档：**按 photoId 存**
 *
 * 铁律：一张图一个分身一个档案。跨图引用必须靠检索（ai/retrieval.ts），
 * 不能把别人的话直接塞进这个切片的上下文 —— 那样分身就变成"全知"了。
 */
export type ChatArchive = Record<string, ChatTurn[]>;

/**
 * 归档层：对话摘要（手动「凝聚记忆」产生）
 *
 * 只做一件事：把这段对话压成一句**事实性**摘要，喂进跨图检索，
 * 让别的切片更容易想起这件事。不写情绪、不写抒情（话术铁律）。
 */
export interface MemoryDigest {
  id: string;
  photoId: string;
  /** 那张图的切片标签 */
  label: string;
  /** 一句事实摘要 */
  text: string;
  /** 压缩时的对话轮数 */
  turnCount: number;
  atMs: number;
}

/** 输入模式：手势优先，随时可回落到鼠标键盘（按 G 切换） */
export type InputMode = 'gesture' | 'pointer';

/** 手势可用性——直接驱动 HUD 提示（丢失 2s 提示，见 GESTURE.lost） */
export type GestureStatus = 'idle' | 'tracking' | 'lost' | 'unavailable';

/**
 * 运行期遥测（只给 HUD 看）
 * ⚠️ 架构约定：store 只允许 scene 写这一个切片，其余全部由输入层写。
 * 这样「scene 不反写 UI 状态」的铁律仍然成立，同时 HUD 不需要额外的事件总线。
 */
export interface Telemetry {
  fps: number;
  tier: LodTier;
  particles: number;
  bloom: boolean;
  /** 连续层级进度：0 = L0，1 = L1，2 = L2（含过渡与过冲） */
  layerProgress: number;
  /** 当前照片数量 */
  photoCount: number;
}

export interface RiverState {
  /** 当前层级：L0 长河全景 → L1 人生阶段 → L2 一件事 → L3 对话 */
  layer: LayerId;
  /** 是否处于层级过渡动画中（过渡中屏蔽手势放大/缩小，防抖） */
  isTransitioning: boolean;

  inputMode: InputMode;
  gestureStatus: GestureStatus;

  /** 拨动时间河：进行中暂停悬停（GESTURE.swipe.suspendHoverWhileSwiping） */
  isSwiping: boolean;
  swipeVelocityPerSec: number;

  /** 悬停/选中的记忆切片 id（阶段 1 起由 scene 命中检测填充） */
  hoveredId: string | null;
  /** 进入 L2/L3 的那张照片 */
  focusedId: string | null;

  /** 内存里的照片（阶段 2 只做视觉与布局；阶段 3 落 IndexedDB） */
  photos: PhotoMemory[];
  /** 导入中（UI 显示进度/禁用重复点击） */
  importing: boolean;

  /** 渲染遥测（scene 写、UI 读） */
  telemetry: Telemetry;

  /** 对话面板是否滑出（进入 L2 自动开，点「返回」关） */
  dialogOpen: boolean;
  /** AI 正在"思考"（打字指示器 + 禁用发送） */
  chatBusy: boolean;
  /** 按 photoId 归档的对话 */
  chatByPhoto: ChatArchive;
  /** 对话摘要（按 photoId 存，只由「凝聚记忆」产生） */
  digestsByPhoto: Record<string, MemoryDigest[]>;
  /** 语音朗读开关（持久化到 localStorage） */
  ttsEnabled: boolean;
  /** 设置面板是否打开（右上角齿轮 / Esc） */
  settingsOpen: boolean;
  /** L2 手势锁定：锁定时忽略扇风/缩放/握拳退出，只保留捏合解锁 */
  l2Locked: boolean;
  /** 锁定/解锁冷却截止时间（performance.now 时间戳，0 = 无冷却） */
  l2LockCooldownUntil: number;
  /** 环境音 / 手势音效开关（持久化） */
  musicEnabled: boolean;
  /** 音乐音量倍率 0..1（持久化） */
  musicVolume: number;
}

export interface RiverActions {
  setLayer(layer: LayerId): void;
  /** 放大一层（边沿触发后的产物）；L3 封顶 */
  zoomIn(): void;
  /** 缩小一层；L0 触底回弹 */
  zoomOut(): void;
  /** 合拢<300ms 再张开 = 复位到 L0，**继续放大，不缩小** */
  resetToOverview(): void;
  setInputMode(mode: InputMode): void;
  toggleInputMode(): void;
  setGestureStatus(status: GestureStatus): void;
  setSwiping(active: boolean, velocityPerSec?: number): void;
  setHovered(id: string | null): void;
  focusPhoto(id: string | null): void;

  addPhotos(list: PhotoMemory[]): void;
  removePhoto(id: string): void;
  clearPhotos(): void;
  /** 绑定 / 清除某张照片的配乐（一张照片最多一首） */
  setPhotoAudio(photoId: string, audio: PhotoAudio | null): void;
  /** 写入 / 清除 VLM 照片分析结果 */
  setPhotoVlm(photoId: string, analysis: PhotoVlmAnalysis | null): void;
  setImporting(value: boolean): void;
  /** 放大一层；若已在 L1 但没有聚焦照片，自动选一张 */
  zoomInOrFocus(): void;
  setTelemetry(patch: Partial<Telemetry>): void;

  /* ── 阶段 4 ── */
  openDialog(): void;
  closeDialog(): void;
  setChatBusy(value: boolean): void;
  /** 追加一轮对话（按 photoId 归档） */
  appendChatTurn(photoId: string, turn: ChatTurn): void;
  /** 清掉某张图的对话（重新开始这段记忆） */
  clearChatThread(photoId: string): void;
  /** 追加一条对话摘要 */
  appendDigest(digest: MemoryDigest): void;
  setTtsEnabled(value: boolean): void;

  /* ── 设置面板 ── */
  openSettings(): void;
  closeSettings(): void;
  setMusicEnabled(value: boolean): void;
  setMusicVolume(value: number): void;
  setL2Locked(value: boolean): void;
  toggleL2Locked(): void;
  setL2LockCooldownUntil(at: number): void;
}

/** 音乐偏好（localStorage）：读失败时回到默认值 */
const MUSIC_PREF_KEY = 'memory-river:music';
function readMusicPreference(): { enabled: boolean; volume: number } {
  try {
    const raw = window.localStorage.getItem(MUSIC_PREF_KEY);
    if (!raw) return { enabled: true, volume: 1 };
    const parsed = JSON.parse(raw) as { enabled?: unknown; volume?: unknown };
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      volume:
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
          ? Math.min(Math.max(parsed.volume, 0), 1)
          : 1,
    };
  } catch {
    return { enabled: true, volume: 1 };
  }
}
function writeMusicPreference(enabled: boolean, volume: number): void {
  try {
    window.localStorage.setItem(MUSIC_PREF_KEY, JSON.stringify({ enabled, volume }));
  } catch {
    // 隐私模式：只在本次会话生效
  }
}
const musicPreference = readMusicPreference();

const initial: RiverState = {
  layer: 'L0',
  isTransitioning: false,
  inputMode: INPUT.defaultMode,
  gestureStatus: 'idle',
  isSwiping: false,
  swipeVelocityPerSec: 0,
  hoveredId: null,
  focusedId: null,
  photos: [],
  importing: false,
  telemetry: { fps: 0, tier: 'high', particles: 0, bloom: true, layerProgress: 0, photoCount: 0 },
  dialogOpen: false,
  chatBusy: false,
  chatByPhoto: {},
  digestsByPhoto: {},
  ttsEnabled: AI.tts.enabled,
  settingsOpen: false,
  l2Locked: false,
  l2LockCooldownUntil: 0,
  musicEnabled: musicPreference.enabled,
  musicVolume: musicPreference.volume,
};

/** 层级索引工具：越界一律夹紧，不抛错（手势是噪声输入，必须容错） */
function clampLayerIndex(index: number): LayerId {
  const clamped = Math.min(Math.max(index, 0), LAYER_ORDER.length - 1);
  return LAYER_ORDER[clamped] ?? 'L0';
}

function layerIndex(layer: LayerId): number {
  const i = LAYER_ORDER.indexOf(layer);
  return i < 0 ? 0 : i;
}

export const useRiverStore = create<RiverState & RiverActions>()((set, get) => ({
  ...initial,

  setLayer: (layer) =>
    set({
      layer,
      isTransitioning: true,
      ...(layer !== 'L2' ? { l2Locked: false, l2LockCooldownUntil: 0 } : {}),
    }),

  zoomIn: () => {
    const { layer } = get();
    const next = clampLayerIndex(layerIndex(layer) + 1);
    if (next !== layer) set({ layer: next, isTransitioning: true });
  },

  zoomOut: () => {
    const { layer } = get();
    const next = clampLayerIndex(layerIndex(layer) - 1);
    if (next !== layer) set({ layer: next, isTransitioning: true });
  },

  resetToOverview: () => set({ layer: 'L0', isTransitioning: true, hoveredId: null }),

  setInputMode: (mode) => set({ inputMode: mode }),
  toggleInputMode: () =>
    set({ inputMode: get().inputMode === 'gesture' ? 'pointer' : 'gesture' }),

  setGestureStatus: (gestureStatus) => set({ gestureStatus }),

  setSwiping: (active, velocityPerSec = 0) =>
    set({
      isSwiping: active,
      swipeVelocityPerSec: velocityPerSec,
      // 拨动中暂停悬停：清掉悬停命中，避免进度环继续走
      ...(active ? { hoveredId: null } : {}),
    }),

  setHovered: (id) => set({ hoveredId: get().isSwiping ? null : id }),
  focusPhoto: (id) => set({ focusedId: id }),

  addPhotos: (list) => {
    if (list.length === 0) return;
    const merged = assignPositions([...get().photos, ...list]);
    set({
      photos: merged,
      // 第一张导入时自动聚焦，方便直接滚轮放大看效果
      focusedId: get().focusedId ?? merged[0]?.id ?? null,
    });
  },

  removePhoto: (id) => {
    const removed = get().photos.find((photo) => photo.id === id);
    if (removed) {
      URL.revokeObjectURL(removed.url);
      if (removed.audio?.source === 'file') URL.revokeObjectURL(removed.audio.url);
    }
    const photos = get().photos.filter((photo) => photo.id !== id);
    const chat = { ...get().chatByPhoto };
    delete chat[id];
    const digests = { ...get().digestsByPhoto };
    delete digests[id];
    set({
      photos: assignPositions(photos),
      chatByPhoto: chat,
      digestsByPhoto: digests,
      focusedId: get().focusedId === id ? (photos[0]?.id ?? null) : get().focusedId,
    });
  },

  clearPhotos: () => {
    for (const photo of get().photos) {
      URL.revokeObjectURL(photo.url);
      if (photo.audio?.source === 'file') URL.revokeObjectURL(photo.audio.url);
    }
    set({ photos: [], focusedId: null, chatByPhoto: {}, digestsByPhoto: {}, dialogOpen: false });
  },

  setPhotoAudio: (photoId, audio) => {
    const photos = get().photos.map((photo) => {
      if (photo.id !== photoId) return photo;
      if (photo.audio?.source === 'file') URL.revokeObjectURL(photo.audio.url);
      if (audio) return { ...photo, audio };
      const { audio: _removed, ...rest } = photo;
      return rest;
    });
    set({ photos });
  },

  setPhotoVlm: (photoId, analysis) => {
    const photos = get().photos.map((photo) => {
      if (photo.id !== photoId) return photo;
      if (analysis) return { ...photo, vlm: analysis };
      const { vlm: _removedVlm, ...rest } = photo;
      return rest;
    });
    set({ photos });
  },

  setImporting: (importing) => set({ importing }),

  zoomInOrFocus: () => {
    const { layer, photos, focusedId, focusPhoto, zoomIn } = get();
    if (layer === 'L1' && !focusedId && photos.length > 0) {
      focusPhoto(photos[0]?.id ?? null);
    }
    zoomIn();
  },

  setTelemetry: (patch) => set({ telemetry: { ...get().telemetry, ...patch } }),

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  setChatBusy: (chatBusy) => set({ chatBusy }),

  appendChatTurn: (photoId, turn) => {
    const current = get().chatByPhoto;
    const thread = current[photoId] ?? [];
    set({
      chatByPhoto: {
        ...current,
        [photoId]: [...thread, turn].slice(-AI.ui.maxRenderedTurns * 2),
      },
    });
  },

  appendDigest: (digest) => {
    const current = get().digestsByPhoto;
    const list = current[digest.photoId] ?? [];
    // 只留最近几条：摘要是"最近的印象"，不是日志
    const next = [...list, digest].slice(-AI.ui.maxRenderedTurns / 4);
    set({ digestsByPhoto: { ...current, [digest.photoId]: next } });
  },

  clearChatThread: (photoId) => {
    const next = { ...get().chatByPhoto };
    delete next[photoId];
    set({ chatByPhoto: next });
  },

  setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  setMusicEnabled: (musicEnabled) => {
    set({ musicEnabled });
    writeMusicPreference(musicEnabled, get().musicVolume);
  },

  setMusicVolume: (value) => {
    const musicVolume = Math.min(Math.max(value, 0), 1);
    set({ musicVolume });
    writeMusicPreference(get().musicEnabled, musicVolume);
  },

  setL2Locked: (l2Locked) => set({ l2Locked }),
  toggleL2Locked: () => set({ l2Locked: !get().l2Locked }),
  setL2LockCooldownUntil: (l2LockCooldownUntil) => set({ l2LockCooldownUntil }),
}));

/**
 * 连续缩放派生出离散层（Stage 的渲染循环写 store.layer）时打一个同步标记。
 *
 * 问题：手势引擎也订阅 store.layer，会把这种"副产物"当成用户确认并 commit 分带，
 * 于是连续张手经过 L1/L2 边界时目标被反复重置 —— 这正是 L1↔L2 拉锯的隐藏来源。
 * 标记在 setState 的同步回调里立刻被消费，不进入 React state。
 */
let derivedLayerWriteAt = -Infinity;

export function markDerivedLayerWrite(nowMs: number = performance.now()): void {
  derivedLayerWriteAt = nowMs;
}

export function isDerivedLayerWrite(nowMs: number = performance.now()): boolean {
  return nowMs - derivedLayerWriteAt < 32;
}

/** 供非 React 消费者（scene / gesture）读取快照，避免订阅开销 */
export const readRiverState = (): RiverState & RiverActions => useRiverStore.getState();
