/**
 * 音乐层
 * ────────────────────────────────────────────────────────────────
 * engine.ts   照片绑定音乐 + L2 循环 + 淡入淡出（无程序化背景音）
 * analyser.ts FFT 三频段 → 平滑能量，供粒子消费
 * sfx.ts      手势音效（放大 / 缩小 / 扇风 / 确认）
 *
 * 铁律：
 *  - 音乐绑定 L2：进入淡入、退出淡出
 *  - 只在用户手势之后 resume()
 *  - 音频能量是只读的：音乐驱动粒子，粒子不反向改音乐
 *  - 任何音频失败都静默，绝不阻断视觉与对话
 */

import { createMusicEngine, type MusicEngine } from './engine';

export type { MusicEnergy, MusicEngine } from './engine';
export { SILENT_ENERGY } from './engine';
export { createBandAnalyser } from './analyser';
export type { BandAnalyser } from './analyser';
export { disposeSfx, playSfx, setSfxEnabled, unlockSfx } from './sfx';
export type { SfxKind } from './sfx';

let engine: MusicEngine | null = null;

/** 单例：App / Scene / UI 共用同一个音频引擎 */
export function getMusicEngine(): MusicEngine {
  if (!engine) engine = createMusicEngine();
  return engine;
}

/** App 卸载时释放（StrictMode 二次挂载会新建） */
export function releaseMusicEngine(): void {
  engine?.dispose();
  engine = null;
}
