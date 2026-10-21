/**
 * 粒子系统（横向光丝带 + 星尘 + 涟漪 + 情绪光色）
 * ────────────────────────────────────────────────────────────────
 * 阶段 1 已实现：
 *   starfield.ts  星尘底噪
 *   river.ts      光河主体（GPU 流动 + 情绪光色 + 拖尾 + 涟漪位移）
 *   ripples.ts    涟漪（水面光环 + 粒子波前）
 *   emotion.ts    情绪 → 光色 的唯一映射
 * 阶段 3 补齐：photoSpawner.ts（照片 → 粒子解体，用 PARTICLE.dissolve）
 */
export { createStarDust } from './starfield';
export { createRiver } from './river';
export type { RiverSystem, RiverOptions } from './river';
export { createRippleField, createRippleSlots, emotionNearX, riverPointToWorld } from './ripples';
export type { RippleField, RippleSlots, RippleSpawnOptions } from './ripples';
export { emotionToColor, emotionToHex } from './emotion';
export {
  waveYAtX,
  waveZAtX,
  pointOnRiverX,
  pointOnTubeAtX,
  tangentAtX,
  frameAtX,
  photoXForIndex,
  indexFromX,
  clampScroll,
  emotionAtX,
} from './riverPath';

import type { LayerId } from '@/config';

/** 一张照片在粒子场中的身份（阶段 3 实现） */
export interface PhotoParticleSource {
  /** 记忆切片 id，与 memory 层一一对应 */
  id: string;
  /** 该照片所属层级，决定粒子归属哪条光带 */
  layer: LayerId;
  /** 情绪值 0..1（0 冷蓝 → 1 暖金），决定粒子色 */
  emotion: number;
  /** 解体进度 0..1，由 photoSpawner 推进 */
  dissolve: number;
}

/** 粒子场对外契约：阶段 3 的照片解体将实现这份接口 */
export interface ParticleField {
  /** 每帧推进（dt 秒），内部按 PARTICLE.motion 积分 */
  update(dt: number): void;
  /** 注册一张要解体的照片，返回实际分配的粒子数 */
  spawn(source: PhotoParticleSource): number;
  /** 回收某张照片的粒子（退出 L2 时淡出汇回光河） */
  despawn(id: string): void;
  dispose(): void;
}
