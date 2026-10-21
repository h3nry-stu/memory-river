import { createGestureEngine, type GestureEngine } from './engine';

/**
 * 场景 ↔ 手势引擎的桥
 *
 * 引擎需要三个"场景才知道怎么算"的能力，由 Stage 在初始化时填进来：
 *   pick    ：屏幕坐标 → 其下的照片 id（射线命中）
 *   project ：照片 id → 屏幕位置与半径（画进度环）
 *   swipe   ：横向拨动（驱动长河平移）
 *
 * 为什么不直接把 Stage 传进引擎：引擎属于 gesture 层，不该依赖 scene 层的实现细节。
 */
export interface StageBridge {
  pick(xNorm: number, yNorm: number): string | null;
  project(id: string): { x: number; y: number; radius: number } | null;
  swipe(velocityScreenPerSec: number): void;
  /** 连续缩放：每帧把目标层级进度（0..2）推给相机 */
  zoom(progress: number): void;
  /** L2 锁定：锁定时停止滚动惯性并吸附到当前照片 */
  lock(locked: boolean): void;
}

export const stageBridge: StageBridge = {
  pick: () => null,
  project: () => null,
  swipe: () => undefined,
  zoom: () => undefined,
  lock: () => undefined,
};

let engine: GestureEngine | null = null;

/** 单例：UI 与 Stage 共用同一个引擎 */
export function getGestureEngine(): GestureEngine {
  if (!engine) {
    engine = createGestureEngine({
      pickPhoto: (x, y) => stageBridge.pick(x, y),
      projectPhoto: (id) => stageBridge.project(id),
      onSwipe: (v) => stageBridge.swipe(v),
      onZoom: (p) => stageBridge.zoom(p),
      onLock: (locked) => stageBridge.lock(locked),
    });
  }
  return engine;
}
