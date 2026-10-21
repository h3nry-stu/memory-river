/**
 * 手势层的类型契约
 * ────────────────────────────────────────────────────────────────
 * 数据流：
 *   MediaPipe HandLandmarker (21 点/手)
 *     → HandFrame（原始归一化点 + 时间戳）
 *     → HandFeature（平滑后的 openness / pinch / 食指位置 / 速度）
 *     → GestureEvent（状态机裁决出的**单一**信号，见 GESTURE_PRIORITY）
 *     → state/store
 *
 * 铁律：这一层不碰 DOM、不碰 Three，纯函数 + 帧序列，方便单测。
 */

import type { GestureSignal, LayerId } from '@/config';

/** MediaPipe 归一化关键点（x/y ∈ 0..1，左上原点；z 为相对深度） */
export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

/** 一帧原始检测结果（已做镜像与 EMA 平滑前） */
export interface HandFrame {
  /** 21 个关键点；无手时为 null */
  landmarks: LandmarkPoint[] | null;
  /** performance.now() 时间戳（ms） */
  timestampMs: number;
}

/** 由关键点算出的语义特征（状态机的输入） */
export interface HandFeature {
  /** 张开度 0..1（指尖到掌心均值 / 手掌尺度，按校准区间归一化） */
  openness: number;
  /** 归一化之前的原始比值（校准与遥测用） */
  rawRatio: number;
  /** 拇指尖 ↔ 食指尖的归一化距离（阈值见 GESTURE.pinch） */
  pinchDistance: number;
  /** 食指指尖位置（屏幕归一化坐标，已按镜像处理）—— 只用于画光标 */
  indexTip: { x: number; y: number };
  /** 手掌中心（四个掌指关节的均值）—— 扇风检测用 */
  palmCenter: { x: number; y: number };
  /** 食指速度，屏幕宽度 / 秒（光标拖尾用） */
  velocityPerSec: { x: number; y: number };
  /** 手掌中心速度，屏幕宽度 / 秒 */
  palmVelocityPerSec: { x: number; y: number };
  /**
   * 扇风参考速度（屏幕宽度/秒）：四指尖 + 四掌指关节的均值，取 60–250ms 窗口内的峰值。
   * 手腕甩动时这个值最敏感 —— 扇风判定只看它。
   */
  flickVelocity: { x: number; y: number };
  /** 手腕 → 中指根的角速度（rad/s，正=逆时针）：扇风判定的补充 */
  angularVelocity: number;
  /** 是否判定为「合拢」（openness < GESTURE.openness.closeThreshold） */
  isClosed: boolean;
  timestampMs: number;
  /** 原始关键点（画骨架用） */
  landmarks: LandmarkPoint[];
}

/** 状态机输出的单一信号 */
export interface GestureEvent {
  signal: GestureSignal;
  /** 触发瞬间的特征快照，用于视觉反馈（拖尾方向、涟漪强度等） */
  feature: HandFeature | null;
  /** 事件发生时的层级，避免异步竞态把事件打到错误的层 */
  layer: LayerId;
  timestampMs: number;
}

/** 状态机的输入/输出契约（阶段 1 实现 gesture/stateMachine.ts） */
export interface GestureMachine {
  /** 每帧喂一次；返回本帧裁决出的信号（可能为 null） */
  feed(frame: HandFrame): GestureEvent | null;
  /** 输入源切换 / 页面失焦时清空计时器与边沿状态 */
  reset(): void;
  /** 只读快照，供 UI 画进度环与光标 */
  snapshot(): HandFeature | null;
}
