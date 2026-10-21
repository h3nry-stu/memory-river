import { MUSIC } from '@/config';

/**
 * 手势音效（Web Audio 实时合成，零素材）
 * ────────────────────────────────────────────────────────────────
 * 只在用户手势/点击之后尝试发声；不支持 AudioContext 或自动播放被拒时静默。
 * 四种动作盲听可分：放大上扬 / 缩小下沉 / 扇风流动 / 确认钟声。
 */

export type SfxKind = 'zoomIn' | 'zoomOut' | 'swipe' | 'confirm' | 'error';

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;
let bus: GainNode | null = null;
let enabled = true;

function createContext(): AudioContext | null {
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

function ensureBus(): AudioContext | null {
  if (context && bus) return context;
  context = context ?? createContext();
  if (!context) return null;
  try {
    bus = context.createGain();
    bus.gain.value = MUSIC.sfxVolume;
    bus.connect(context.destination);
  } catch {
    bus = null;
  }
  return context;
}

/** 首次用户交互时调用：恢复 AudioContext，失败静默 */
export async function unlockSfx(): Promise<void> {
  const ctx = ensureBus();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    // 自动播放策略拦截：下一次真实点击再试
  }
}

export function setSfxEnabled(value: boolean): void {
  enabled = value;
}

/** App 卸载时释放独立音效上下文（StrictMode 二次挂载会自然重建） */
export function disposeSfx(): void {
  bus?.disconnect();
  bus = null;
  if (context) {
    const closing = context;
    context = null;
    void closing.close().catch(() => undefined);
  }
}

function tone(
  ctx: AudioContext,
  target: GainNode,
  options: {
    type: OscillatorType;
    from: number;
    to: number;
    durationMs: number;
    gain: number;
    filterHz?: number;
  },
): void {
  const now = ctx.currentTime;
  const duration = options.durationMs / 1000;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = options.type;
    osc.frequency.setValueAtTime(Math.max(options.from, 20), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(options.to, 20), now + duration);
    filter.type = 'lowpass';
    filter.frequency.value = options.filterHz ?? 2600;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(options.gain, 0.0002), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(target);
    osc.start(now);
    osc.stop(now + duration + 0.03);
    osc.onended = () => {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };
  } catch {
    // 单个音效失败不影响交互
  }
}

/** 播放一个手势音效（不抛错、不阻塞） */
export function playSfx(kind: SfxKind): void {
  if (!enabled) return;
  const ctx = ensureBus();
  if (!ctx || !bus) return;

  const run = (): void => {
    if (!bus) return;
    if (kind === 'confirm') {
      const confirm = MUSIC.sfx.confirm;
      tone(ctx, bus, {
        type: 'sine',
        from: confirm.pitch,
        to: confirm.pitch * 0.998,
        durationMs: confirm.durationMs,
        gain: 0.22,
        filterHz: 4200,
      });
      tone(ctx, bus, {
        type: 'sine',
        from: confirm.pitch * 1.5,
        to: confirm.pitch * 1.5,
        durationMs: confirm.durationMs * 0.7,
        gain: 0.1,
        filterHz: 5200,
      });
      return;
    }

    if (kind === 'error') {
      const error = MUSIC.sfx.error;
      tone(ctx, bus, {
        type: 'sine',
        from: error.pitch,
        to: error.pitch * 0.72,
        durationMs: error.durationMs,
        gain: 0.18,
        filterHz: 900,
      });
      return;
    }

    const preset = MUSIC.sfx[kind];
    tone(ctx, bus, {
      type: kind === 'swipe' ? 'triangle' : 'sine',
      from: preset.pitchFrom,
      to: preset.pitchTo,
      durationMs: preset.durationMs,
      gain: 0.16,
      filterHz: kind === 'swipe' ? 1400 : 3200,
    });
  };

  if (ctx.state === 'suspended') {
    void ctx.resume().then(run, () => undefined);
  } else {
    run();
  }
}
