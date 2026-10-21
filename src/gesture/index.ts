/**
 * 手势层
 * ────────────────────────────────────────────────────────────────
 *  tracker.ts       摄像头 + MediaPipe HandLandmarker（30fps 节流）
 *  features.ts      21 点 → openness / pinch / 速度（含 EMA 平滑）
 *  stateMachine.ts  8 级优先级状态机（纯逻辑，可用假数据单测）
 *  engine.ts        引擎：追踪 → 特征 → 状态机 → store / 场景
 *  liveState.ts     60fps 实时状态（光标/拖尾/进度环），刻意不走 zustand
 *  singleton.ts     与场景层的桥（命中检测 / 投影 / 拨动）
 *  priority.ts      优先级裁决纯函数
 *
 * 资产：public/mediapipe/{wasm,models} 由 `pnpm prepare:assets` 生成。
 */
export { createGestureMachine, STATUS_TEXT, GESTURE_HINT_ROWS, opennessToProgress } from './stateMachine';
export type { GestureMachine, GestureStatusKey, MachineEvent, MachineInput } from './stateMachine';

export { computeFeature, createSmoother, opennessOf, rawRatioOf } from './features';
export {
  activeRange,
  getCalibration,
  setCalibration,
  ratioToOpenness,
  createCalibrationSession,
} from './calibration';
export type { CalibrationRange, CalibrationSession, CalibrationState, CalibrationPhase } from './calibration';
export type { FeatureSmoother } from './features';

export { createHandTracker, toPoints } from './tracker';
export type { HandTracker, TrackerStatus } from './tracker';

export { getGestureEngine, stageBridge } from './singleton';
export type { StageBridge } from './singleton';
export type { GestureEngine } from './engine';

export { liveGesture } from './liveState';
export type { LiveGestureState } from './liveState';

export { pickDominantSignal, outranks } from './priority';
export type { LandmarkPoint, HandFrame, HandFeature, GestureEvent } from './types';
