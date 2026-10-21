import type { LandmarkPoint } from './types';
import type { GestureStatusKey } from './stateMachine';

/**
 * 60fps 的实时手势状态（有意**不走 zustand**）
 *
 * 光标位置、拖尾、进度环需要每帧更新；放进 React store 会让整棵 UI 每帧重渲染。
 * 这里用一个模块级可变对象 + 版本号：canvas 覆盖层直接读它，React 组件只在
 * 低频状态（状态文字、模式）变化时重渲染。
 */
export interface LiveGestureState {
  /** 光标是否可见（无手时为 false） */
  active: boolean;
  /** 屏幕归一化坐标 0..1（已做 EMA 平滑与镜像） */
  x: number;
  y: number;
  /** 拖尾历史（归一化坐标 + 时间戳） */
  trail: { x: number; y: number; t: number }[];
  /** 悬停进度 0..1（停留确认用） */
  progress: number;
  /** 当前悬停的照片屏幕位置（归一化），用于画进度环 */
  ring: { x: number; y: number; radius: number } | null;
  /** 状态文字 key */
  status: GestureStatusKey;
  /** 张开度（平滑后 0..1） */
  openness: number;
  /** 原始比值（未归一化，校准与遥测用） */
  rawRatio: number;
  /** 归一化后的 openness（未平滑） */
  rawOpenness: number;
  /** 是否正在拨动 */
  swiping: boolean;
  /** 最近一帧的关键点（画中画骨架用）；无手时为 null */
  landmarks: LandmarkPoint[] | null;
  /** 捏合/扇风期间缩放被冻结（UI 提示用） */
  zoomFrozen: boolean;
  /** 实时扇风速度（屏幕宽度/秒，取绝对值） */
  flickSpeed: number;
  /** 实时捏合距离（拇指尖↔食指尖 / 手掌尺度） */
  pinchDistance: number;
}

export const liveGesture: LiveGestureState = {
  active: false,
  x: 0.5,
  y: 0.5,
  trail: [],
  progress: 0,
  ring: null,
  status: 'noHand',
  openness: 0,
  rawRatio: 0,
  rawOpenness: 0,
  swiping: false,
  landmarks: null,
  zoomFrozen: false,
  flickSpeed: 0,
  pinchDistance: 1,
};

/** 供覆盖层判断是否需要重绘（避免每帧都清空重画） */
export const liveGestureVersion = { value: 0 };
