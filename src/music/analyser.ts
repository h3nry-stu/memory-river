import { MUSIC } from '@/config';
import type { MusicEnergy } from './engine';

/**
 * 频谱分析：把音乐总线的 FFT 压成低 / 中 / 高三个 0..1 的能量值
 *
 * 关键点：
 *  - 只读：音乐驱动粒子，粒子永远不反向改音乐
 *  - EMA 平滑：低频重拍不会让整个光河抽搐
 *  - 未播放时返回全 0，粒子的音乐驱动自然归零
 */
export interface BandAnalyser {
  readonly node: AnalyserNode;
  read(playing: boolean): MusicEnergy;
}

export function createBandAnalyser(ctx: AudioContext): BandAnalyser {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = MUSIC.bands.fftSize;
  analyser.smoothingTimeConstant = 0.72;

  const bins = new Uint8Array(analyser.frequencyBinCount);
  const binHz = ctx.sampleRate / analyser.fftSize;

  const bandOf = (range: readonly [number, number]): [number, number] => [
    Math.max(0, Math.floor(range[0] / binHz)),
    Math.min(bins.length - 1, Math.ceil(range[1] / binHz)),
  ];

  const low = bandOf(MUSIC.bands.low);
  const mid = bandOf(MUSIC.bands.mid);
  const high = bandOf(MUSIC.bands.high);

  const alpha = 1 - Math.min(Math.max(MUSIC.bands.smoothing, 0), 0.95);
  const state = { low: 0, mid: 0, high: 0 };

  const average = (from: number, to: number): number => {
    let sum = 0;
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    for (let i = start; i <= end; i += 1) sum += bins[i] ?? 0;
    return sum / Math.max(end - start + 1, 1) / 255;
  };

  return {
    node: analyser,

    read(playing) {
      if (!playing) {
        state.low *= 1 - alpha;
        state.mid *= 1 - alpha;
        state.high *= 1 - alpha;
        return { ...state, playing: false };
      }

      analyser.getByteFrequencyData(bins);
      // 低频本身能量大、高频小；这里只做归一化，不再人为拉高高频
      state.low += (average(low[0], low[1]) - state.low) * alpha;
      state.mid += (average(mid[0], mid[1]) - state.mid) * alpha;
      state.high += (average(high[0], high[1]) - state.high) * alpha;

      return { ...state, playing: true };
    },
  };
}
