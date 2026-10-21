import { GESTURE } from '@/config';

/**
 * 手势校准（一键标定这只手）
 *
 * 为什么需要：`openness` 是「四指指尖到腕的平均距离 / 手掌尺度」的比值，
 * 但这个比值的绝对值因人（也因相机距离）而异。同一套 lo/hi 对有些人
 * 张到极限也只有 0.5。
 *
 * 校准流程：
 *   ① 完全握拳 3 秒 → 采集比值 → 取低分位作为 lo
 *   ② 完全张开 3 秒 → 采集比值 → 取高分位作为 hi
 *   ③ 存进 localStorage，之后所有 openness 计算都用这个人的区间
 *
 * 只要区间宽度足够（hi - lo > 0.15）就认为有效，否则提示重来。
 */

const STORAGE_KEY = 'memory-river:gesture-calibration';

export interface CalibrationRange {
  lo: number;
  hi: number;
  /** 校准时间戳（便于 UI 显示"已校准"） */
  at: number;
}

let current: CalibrationRange | null = null;

function load(): CalibrationRange | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CalibrationRange>;
    if (typeof parsed.lo !== 'number' || typeof parsed.hi !== 'number') return null;
    if (!(parsed.hi - parsed.lo > 0.05)) return null;
    return { lo: parsed.lo, hi: parsed.hi, at: parsed.at ?? Date.now() };
  } catch {
    return null;
  }
}

current = load();

/** 当前生效的比值区间（校准时用自己的，否则用默认） */
export function activeRange(): { lo: number; hi: number; calibrated: boolean } {
  if (current) return { lo: current.lo, hi: current.hi, calibrated: true };
  const { lo, hi } = GESTURE.openness.ratioRange;
  return { lo, hi, calibrated: false };
}

export function getCalibration(): CalibrationRange | null {
  return current;
}

export function setCalibration(range: CalibrationRange | null): void {
  current = range;
  try {
    if (range) localStorage.setItem(STORAGE_KEY, JSON.stringify(range));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式下 localStorage 可能不可用，静默降级（本次会话仍然生效）
  }
}

/** 原始比值 → openness 0..1 */
export function ratioToOpenness(ratio: number): number {
  const { lo, hi } = activeRange();
  const span = Math.max(hi - lo, 1e-4);
  return Math.min(Math.max((ratio - lo) / span, 0), 1);
}

/** 取分位数（校准采集用；避免单帧噪声） */
function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(Math.max(Math.floor(sorted.length * p), 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

export type CalibrationPhase = 'idle' | 'fist' | 'open' | 'done' | 'error';

export interface CalibrationState {
  phase: CalibrationPhase;
  /** 当前阶段的进度 0..1 */
  progress: number;
  /** 当前阶段的实时原始比值 */
  liveRatio: number;
  /** 已采集的样本数 */
  samples: number;
  /** 是否仍处于阶段开头的稳定期 */
  settling: boolean;
  message: string;
  range: CalibrationRange | null;
}

export interface CalibrationSession {
  read(): CalibrationState;
  start(): void;
  cancel(): void;
  /** 每帧推一次原始比值（由 engine 调用） */
  sample(rawRatio: number | null): void;
}

export interface CalibrationOptions {
  /** 每个阶段的时长（默认 3000ms） */
  durationMs?: number;
  /** 每个阶段开头的稳定期：这段时间不采样（人换姿势需要反应时间） */
  settleMs?: number;
  /** 时钟（默认 performance.now；仿真时可注入） */
  now?: () => number;
}

export function createCalibrationSession(
  onChange: (state: CalibrationState) => void,
  options: CalibrationOptions = {},
): CalibrationSession {
  const durationMs = options.durationMs ?? 3000;
  const settleMs = options.settleMs ?? 350;
  const nowFn = options.now ?? (() => performance.now());
  let phase: CalibrationPhase = 'idle';
  let startedAt = 0;
  let fistSamples: number[] = [];
  let openSamples: number[] = [];
  /** 握拳阶段采到的 lo，等张开阶段结束再一起落库 */
  let pendingLo: number | null = null;
  let liveRatio = 0;
  let message = '';
  let lastEmit = 0;

  const state: CalibrationState = {
    phase,
    progress: 0,
    liveRatio: 0,
    samples: 0,
    message: '',
    range: null,
    settling: false,
  };

  function emit(force = false): void {
    const now = nowFn();
    if (!force && now - lastEmit < 80) return;
    lastEmit = now;
    state.phase = phase;
    state.liveRatio = liveRatio;
    state.message = message;
    state.samples = phase === 'fist' ? fistSamples.length : phase === 'open' ? openSamples.length : 0;
    state.range = current;
    onChange({ ...state });
  }

  return {
    read: () => ({ ...state }),

    start() {
      phase = 'fist';
      startedAt = nowFn();
      fistSamples = [];
      openSamples = [];
      message = '请完全握拳，保持 3 秒';
      emit(true);
    },

    cancel() {
      phase = 'idle';
      message = '';
      pendingLo = null;
      emit(true);
    },

    sample(rawRatio) {
      if (phase !== 'fist' && phase !== 'open') return;
      const now = nowFn();
      const elapsed = now - startedAt;
      if (typeof rawRatio === 'number' && Number.isFinite(rawRatio) && rawRatio > 0) {
        liveRatio = rawRatio;
        // 稳定期内不采样：避免"刚握完拳手还没张开"的样本污染 hi，反之亦然
        if (elapsed >= settleMs) {
          if (phase === 'fist') fistSamples.push(rawRatio);
          else openSamples.push(rawRatio);
        }
      } else {
        liveRatio = 0;
      }

      state.progress = Math.min(elapsed / durationMs, 1);
      state.settling = elapsed < settleMs;

      if (elapsed >= durationMs) {
        if (phase === 'fist') {
          const lo = percentile(fistSamples, 0.2);
          if (fistSamples.length < 10) {
            phase = 'error';
            message = '没采集到足够的画面，请把手放进来再试';
          } else {
            phase = 'open';
            startedAt = now;
            openSamples = [];
            message = '请完全张开手掌，保持 3 秒';
            pendingLo = lo;
          }
          emit(true);
          return;
        }

        if (phase === 'open') {
          const hi = percentile(openSamples, 0.8);
          const lo = pendingLo ?? percentile(fistSamples, 0.2);
          if (openSamples.length < 10) {
            phase = 'error';
            message = '没采集到足够的画面，请把手放进来再试';
          } else if (hi - lo < 0.15) {
            phase = 'error';
            message = `区分度太小（${lo.toFixed(2)} → ${hi.toFixed(2)}），请把拳头握紧、手掌张到最大再试`;
          } else {
            const range: CalibrationRange = { lo, hi, at: Date.now() };
            setCalibration(range);
            phase = 'done';
            message = `校准完成：${lo.toFixed(2)} → ${hi.toFixed(2)}`;
          }
          emit(true);
          return;
        }
      }

      emit();
    },

  };
}
