import { MUSIC, type LayerId } from '@/config';
import type { PhotoAudio } from '@/photo/types';
import { createBandAnalyser, type BandAnalyser } from './analyser';

/**
 * 照片音乐引擎（无程序化背景音）
 * ────────────────────────────────────────────────────────────────
 * 只播放用户为照片绑定的音频：
 *   · L2 循环
 *   · 进入淡入 / 离开淡出
 *   · 一张照片一首，切照片时旧曲先淡出并停止，再淡入新曲
 *   · 没绑定 / 解码失败 / CORS 失败 → 完全静音
 *
 * 不再生成任何 drone / 宇宙低频音。
 */

export interface MusicEnergy {
  low: number;
  mid: number;
  high: number;
  playing: boolean;
}

export const SILENT_ENERGY: MusicEnergy = { low: 0, mid: 0, high: 0, playing: false };

export interface MusicEngine {
  unlock(): Promise<void>;
  bindLayer(layer: LayerId): void;
  /** 绑定照片音频；null = 清除配乐。一张照片只有一首。 */
  setTrack(track: PhotoAudio | null): Promise<boolean>;
  readonly currentTrack: PhotoAudio | null;
  energy(): MusicEnergy;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
  readonly enabled: boolean;
  readonly volume: number;
  /** DEV 诊断：层级 / 当前曲 / 淡入淡出增益 */
  debugState(): Record<string, unknown>;
  dispose(): void;
}

interface AudioGraph {
  master: GainNode;
  musicBus: GainNode;
  trackBus: GainNode;
  analyser: BandAnalyser;
  trackSource: AudioBufferSourceNode | null;
  stopTimer: number | null;
}

type AudioContextCtor = new () => AudioContext;

function createAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(ms, 0)));
}

function fadeParam(ctx: AudioContext, param: AudioParam, to: number, ms: number): void {
  const now = ctx.currentTime;
  try {
    param.cancelScheduledValues(now);
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(Math.max(to, 0.0001), now + Math.max(ms, 1) / 1000);
  } catch {
    try {
      param.value = to;
    } catch {
      // ignore
    }
  }
}

export function createMusicEngine(): MusicEngine {
  let enabled = true;
  let volume = 1;
  let boundLayer: LayerId = 'L0';
  let disposed = false;
  let context: AudioContext | null = null;
  let graph: AudioGraph | null = null;

  let currentTrack: PhotoAudio | null = null;
  let desiredTrack: PhotoAudio | null = null;
  let trackToken = 0;
  const trackCache = new Map<string, AudioBuffer>();

  const layerOn = (): boolean => enabled && boundLayer === MUSIC.boundLayer;
  const targetGain = (): number => (layerOn() ? MUSIC.masterVolume * clamp01(volume) : 0);
  const shouldPlay = (): boolean =>
    layerOn() && graph !== null && graph.trackSource !== null && context?.state === 'running';

  function applyMix(immediate = false): void {
    if (!context || !graph) return;
    const on = targetGain() > 0 && Boolean(graph.trackSource);
    fadeParam(
      context,
      graph.musicBus.gain,
      on ? targetGain() : 0.0001,
      immediate ? 1 : on ? MUSIC.fadeInMs : MUSIC.fadeOutMs,
    );
  }

  function applyTrackGain(to: number, ms: number, immediate = false): void {
    if (!context || !graph) return;
    fadeParam(context, graph.trackBus.gain, to, immediate ? 1 : ms);
  }

  function clearStopTimer(): void {
    if (graph?.stopTimer) {
      window.clearTimeout(graph.stopTimer);
      graph.stopTimer = null;
    }
  }

  function stopSourceNow(): void {
    if (!graph) return;
    clearStopTimer();
    if (graph.trackSource) {
      try {
        graph.trackSource.onended = null;
        graph.trackSource.stop();
        graph.trackSource.disconnect();
      } catch {
        // already stopped
      }
      graph.trackSource = null;
    }
  }

  /** 淡出后停止 source；期间重新进入 L2 会取消停止 */
  function stopSourceAfter(ms: number): void {
    if (!graph?.trackSource) return;
    applyTrackGain(0.0001, ms);
    clearStopTimer();
    graph.stopTimer = window.setTimeout(() => {
      if (!graph) return;
      graph.stopTimer = null;
      stopSourceNow();
      applyMix();
    }, Math.max(ms, 30) + 30);
  }

  function startSource(buffer: AudioBuffer): void {
    if (!context || !graph) return;
    stopSourceNow();
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(graph.trackBus);
      source.start(0);
      graph.trackSource = source;
      graph.stopTimer = null;
    } catch {
      graph.trackSource = null;
    }
  }

  async function loadBuffer(url: string): Promise<AudioBuffer> {
    const cached = trackCache.get(url);
    if (cached) {
      trackCache.delete(url);
      trackCache.set(url, cached);
      return cached;
    }
    if (!context) throw new Error('no-audio-context');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`audio HTTP ${response.status}`);
    const array = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(array.slice(0));
    trackCache.set(url, buffer);
    while (trackCache.size > MUSIC.track.cacheLimit) {
      const oldest = trackCache.keys().next().value;
      if (oldest === undefined) break;
      trackCache.delete(oldest);
    }
    return buffer;
  }

  async function applyTrack(track: PhotoAudio | null, token: number): Promise<boolean> {
    if (!context || !graph) return true;

    if (!track) {
      currentTrack = null;
      if (graph.trackSource) stopSourceAfter(MUSIC.track.switchOutMs);
      else applyMix();
      return true;
    }

    if (currentTrack?.url === track.url && !graph.trackSource) {
      currentTrack = track;
      const cached = trackCache.get(track.url);
      if (cached && boundLayer === MUSIC.boundLayer && enabled) {
        startSource(cached);
        applyTrackGain(1, MUSIC.track.switchInMs);
        applyMix();
      }
      return true;
    }
    if (currentTrack?.url === track.url && graph.trackSource) {
      currentTrack = track;
      applyMix();
      return true;
    }

    if (graph.trackSource) {
      applyTrackGain(0.0001, MUSIC.track.switchOutMs);
      await delay(MUSIC.track.switchOutMs);
      if (token !== trackToken) return false;
      stopSourceNow();
    }

    let buffer: AudioBuffer;
    try {
      buffer = await loadBuffer(track.url);
    } catch {
      if (token !== trackToken) return false;
      currentTrack = null;
      desiredTrack = null;
      stopSourceNow();
      applyTrackGain(0.0001, 1, true);
      applyMix();
      return false;
    }

    if (token !== trackToken) return false;
    currentTrack = track;
    if (boundLayer === MUSIC.boundLayer && enabled) {
      startSource(buffer);
      applyTrackGain(1, MUSIC.track.switchInMs);
      applyMix();
    }
    return true;
  }

  function buildGraph(ctx: AudioContext): AudioGraph {
    const master = ctx.createGain();
    master.gain.value = 0.9;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;

    master.connect(limiter);
    limiter.connect(ctx.destination);

    const musicBus = ctx.createGain();
    musicBus.gain.value = 0.0001;

    const trackBus = ctx.createGain();
    trackBus.gain.value = 0.0001;
    trackBus.connect(musicBus);

    const analyser = createBandAnalyser(ctx);
    musicBus.connect(analyser.node);
    analyser.node.connect(master);

    return {
      master,
      musicBus,
      trackBus,
      analyser,
      trackSource: null,
      stopTimer: null,
    };
  }

  const engine: MusicEngine = {
    get enabled() {
      return enabled;
    },
    get volume() {
      return volume;
    },
    get currentTrack() {
      return currentTrack;
    },

    async unlock() {
      if (disposed) return;
      try {
        if (!context) context = createAudioContext();
        if (!context) return;
        if (context.state === 'suspended') await context.resume();
        if (!graph) graph = buildGraph(context);
        if (desiredTrack && !graph.trackSource) {
          void applyTrack(desiredTrack, ++trackToken);
        } else {
          applyMix();
        }
      } catch {
        // 自动播放策略 / 设备不支持：保持静音
      }
    },

    bindLayer(layer) {
      boundLayer = layer;
      if (layer === MUSIC.boundLayer && enabled) {
        clearStopTimer();
        if (desiredTrack) {
          const cached = trackCache.get(desiredTrack.url);
          if (cached) {
            currentTrack = desiredTrack;
            startSource(cached);
            applyTrackGain(1, MUSIC.fadeInMs);
            applyMix();
          } else {
            void applyTrack(desiredTrack, ++trackToken);
          }
        }
        applyMix();
      } else {
        applyMix();
        if (graph?.trackSource) stopSourceAfter(MUSIC.fadeOutMs);
      }
    },

    async setTrack(track) {
      desiredTrack = track;
      const token = ++trackToken;
      if (!context || !graph) return true;
      if (!track) return applyTrack(null, token);
      return applyTrack(track, token);
    },

    energy() {
      if (!graph || !context) return SILENT_ENERGY;
      return graph.analyser.read(shouldPlay());
    },

    setEnabled(value) {
      enabled = value;
      if (!enabled) {
        applyMix();
        if (graph?.trackSource) stopSourceAfter(MUSIC.fadeOutMs);
        return;
      }
      if (boundLayer === MUSIC.boundLayer && desiredTrack) {
        const cached = trackCache.get(desiredTrack.url);
        if (cached) {
          currentTrack = desiredTrack;
          startSource(cached);
          applyTrackGain(1, MUSIC.fadeInMs);
        } else {
          void applyTrack(desiredTrack, ++trackToken);
        }
      }
      applyMix();
    },

    setVolume(next) {
      volume = clamp01(next);
      applyMix();
    },

    debugState() {
      return {
        layer: boundLayer,
        layerOn: layerOn(),
        enabled,
        volume,
        track: currentTrack
          ? { name: currentTrack.name, url: currentTrack.url, source: currentTrack.source }
          : null,
        hasSource: Boolean(graph?.trackSource),
        musicGain: graph?.musicBus.gain.value ?? 0,
        trackGain: graph?.trackBus.gain.value ?? 0,
        energy: this.energy(),
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (graph?.stopTimer) {
        window.clearTimeout(graph.stopTimer);
        graph.stopTimer = null;
      }
      stopSourceNow();
      try {
        graph?.musicBus.disconnect();
        graph?.master.disconnect();
      } catch {
        // ignore
      }
      graph = null;
      trackCache.clear();
      currentTrack = null;
      desiredTrack = null;
      if (context) {
        const closing = context;
        context = null;
        void closing.close().catch(() => undefined);
      }
    },
  };

  return engine;
}
