import { GESTURE, VISION } from '@/config';
import { ratioToOpenness } from './calibration';
import type { HandFeature, LandmarkPoint } from './types';

/**
 * 21 点 → 语义特征
 *
 * 一切都用"手掌尺度"归一化，所以手离镜头远近不会改变阈值：
 *   palmScale = |wrist(0) - middleMcp(9)|
 *
 * openness：四指指尖到腕的平均距离 / palmScale，再线性映射到 0..1。
 *           手掌完全张开 ≈ 1，握拳 ≈ 0（阈值 0.3 / 0.6 就是规格里那两条线）。
 * pinch：   拇指尖(4) 与食指尖(8) 的距离 / palmScale —— 阈值 0.1 在这个尺度上。
 */

const L = VISION.landmarks;
const FINGER_TIPS = [L.indexTip, L.middleTip, L.ringTip, L.pinkyTip];

function dist(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 手掌尺度：腕到中指掌指关节。加一个下限，避免退化时除 0。 */
function palmScale(landmarks: LandmarkPoint[]): number {
  const wrist = landmarks[L.wrist];
  const mcp = landmarks[L.middleMcp];
  if (!wrist || !mcp) return 0.1;
  return Math.max(dist(wrist, mcp), 0.02);
}

/**
 * 原始比值：四指指尖到腕的平均距离 / 手掌尺度
 * 这个值因人而异（张开手 ≈ 1.5–2.2），所以不直接当 openness，
 * 而是交给 ratioToOpenness() 用「当前生效区间」（默认值或一键校准结果）归一化。
 */
export function rawRatioOf(landmarks: LandmarkPoint[]): number {
  const wrist = landmarks[L.wrist];
  if (!wrist) return 0;
  const scale = palmScale(landmarks);
  let sum = 0;
  let count = 0;
  for (const index of FINGER_TIPS) {
    const tip = landmarks[index];
    if (!tip) continue;
    sum += dist(tip, wrist) / scale;
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

/** openness 0..1（用当前生效区间归一化） */
export function opennessOf(landmarks: LandmarkPoint[]): number {
  return ratioToOpenness(rawRatioOf(landmarks));
}

/**
 * 扇风测速用的"整只手参考点"：
 * 四个指尖（8/12/16/20）+ 四个掌指关节（5/9/13/17）的均值。
 * 手腕扇风时指尖扫得最快，混入 MCP 是为了让手型变化时也不至于失效。
 */
function handReferenceOf(landmarks: LandmarkPoint[]): { x: number; y: number } {
  const ids = [8, 12, 16, 20, 5, 9, 13, 17];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const id of ids) {
    const point = landmarks[id];
    if (!point) continue;
    sx += point.x;
    sy += point.y;
    n += 1;
  }
  return n === 0 ? { x: 0.5, y: 0.5 } : { x: sx / n, y: sy / n };
}

/** 手掌中心：四个掌指关节（食指/中指/无名指/小指的 MCP）的均值 */
function palmCenterOf(landmarks: LandmarkPoint[]): { x: number; y: number } {
  const ids = [5, 9, 13, 17];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const id of ids) {
    const point = landmarks[id];
    if (!point) continue;
    sx += point.x;
    sy += point.y;
    n += 1;
  }
  return n === 0 ? { x: 0.5, y: 0.5 } : { x: sx / n, y: sy / n };
}

/** 捏合距离（手掌尺度归一化） */
function pinchOf(landmarks: LandmarkPoint[]): number {
  const thumb = landmarks[L.thumbTip];
  const index = landmarks[L.indexTip];
  if (!thumb || !index) return 1;
  return dist(thumb, index) / palmScale(landmarks);
}

export interface FeatureSmoother {
  openness: number;
  /** 最近一帧的原始比值（未归一化，校准与遥测用） */
  rawRatio: number;
  /** 手掌中心的 EMA */
  palmX: number;
  palmY: number;
  palmInit: boolean;
  palmVx: number;
  palmVy: number;
  /** 上一帧的手腕角度 */
  prevAngle: number;
  angularVel: number;
  /** 扇风测速的历史采样（t, x, y） */
  flickSamples: { t: number; x: number; y: number }[];
  flickVx: number;
  flickVy: number;
  velocityX: number;
  velocityY: number;
  hasPrev: boolean;
  prevTip: { x: number; y: number } | null;
  prevTipAt: number;
}

export function createSmoother(): FeatureSmoother {
  return {
    openness: 0,
    rawRatio: 0,
    palmX: 0,
    palmY: 0,
    palmInit: false,
    palmVx: 0,
    palmVy: 0,
    prevAngle: Number.NaN,
    angularVel: 0,
    flickSamples: [],
    flickVx: 0,
    flickVy: 0,
    velocityX: 0,
    velocityY: 0,
    hasPrev: false,
    prevTip: null,
    prevTipAt: 0,
  };
}

/**
 * 一帧关键点 → HandFeature（带 EMA 平滑）
 *
 * @param landmarks 归一化关键点（MediaPipe 原始坐标，未镜像）
 * @param mirrored  摄像头是否镜像（自拍视角）；镜像后食指 x 要翻转，才能和屏幕一致
 * @param nowMs     performance.now() 时间戳
 */
export function computeFeature(
  landmarks: LandmarkPoint[],
  mirrored: boolean,
  nowMs: number,
  smoother: FeatureSmoother,
): HandFeature {
  smoother.rawRatio = rawRatioOf(landmarks);
  const rawOpenness = ratioToOpenness(smoother.rawRatio);
  const { opennessAlpha, velocityAlpha } = GESTURE.smoothing;

  if (!smoother.hasPrev) {
    smoother.openness = rawOpenness;
    smoother.hasPrev = true;
  } else {
    smoother.openness += (rawOpenness - smoother.openness) * opennessAlpha;
  }

  // ── 手掌中心（扇风检测用）：手腕甩动时它扫过的横向距离最大最稳 ──
  const palm = palmCenterOf(landmarks);
  const palmX = mirrored ? 1 - palm.x : palm.x;
  const palmY = palm.y;
  if (!smoother.palmInit) {
    smoother.palmX = palmX;
    smoother.palmY = palmY;
    smoother.palmInit = true;
  }
  // 手掌中心的目标位置（镜像后），重算世界坐标

  const indexTip = landmarks[L.indexTip] ?? { x: 0.5, y: 0.5, z: 0 };
  const tipX = mirrored ? 1 - indexTip.x : indexTip.x;
  const tipY = indexTip.y;

  // 速度（屏幕宽度 / 秒）：用真实时间差，掉帧也不会误判
  const dt = smoother.prevTip ? Math.max((nowMs - smoother.prevTipAt) / 1000, 1 / 240) : 0;
  let vx = 0;
  let vy = 0;
  let palmVx = 0;
  let palmVy = 0;
  let angularVel = 0;

  if (smoother.prevTip && dt > 0) {
    vx = (tipX - smoother.prevTip.x) / dt;
    vy = (tipY - smoother.prevTip.y) / dt;
    smoother.velocityX += (vx - smoother.velocityX) * velocityAlpha;
    smoother.velocityY += (vy - smoother.velocityY) * velocityAlpha;

    // 手掌中心速度：这里的 α 更小一点，甩动的峰值不会被抹平
    palmVx = (palmX - smoother.palmX) / dt;
    palmVy = (palmY - smoother.palmY) / dt;
    smoother.palmVx += (palmVx - smoother.palmVx) * 0.5;
    smoother.palmVy += (palmVy - smoother.palmVy) * 0.5;

    // 手腕角速度：wrist(0) → middleMcp(9) 的朝向变化
    const wrist = landmarks[L.wrist];
    const mcp = landmarks[L.middleMcp];
    if (wrist && mcp) {
      const angle = Math.atan2(mcp.y - wrist.y, mcp.x - wrist.x);
      if (Number.isFinite(smoother.prevAngle)) {
        let delta = angle - smoother.prevAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        angularVel = delta / dt;
        smoother.angularVel += (angularVel - smoother.angularVel) * 0.5;
      }
      smoother.prevAngle = angle;
    }
  } else {
    smoother.velocityX = 0;
    smoother.velocityY = 0;
    smoother.palmVx = 0;
    smoother.palmVy = 0;
  }

  smoother.palmX = palmX;
  smoother.palmY = palmY;
  smoother.prevTip = { x: tipX, y: tipY };
  smoother.prevTipAt = nowMs;

  // ── 扇风测速：环形缓冲 + 多窗口取峰值 ──
  // 不用 EMA 平滑（会把 100ms 量级的甩动峰值直接抹掉），
  // 而是在 60–260ms 的每个区间里算平均速度，取横向最大者。
  const ref = handReferenceOf(landmarks);
  const refX = mirrored ? 1 - ref.x : ref.x;
  const refY = ref.y;
  smoother.flickSamples.push({ t: nowMs, x: refX, y: refY });
  while (smoother.flickSamples.length > 24) smoother.flickSamples.shift();
  // 丢掉太老的样本
  while (
    smoother.flickSamples.length > 2 &&
    nowMs - (smoother.flickSamples[0]?.t ?? nowMs) > GESTURE.flick.windowMaxMs * 1.6
  ) {
    smoother.flickSamples.shift();
  }

  let bestVx = 0;
  let bestVy = 0;
  let bestScore = 0;
  const last = smoother.flickSamples[smoother.flickSamples.length - 1];
  if (last) {
    for (const sample of smoother.flickSamples) {
      const dt = (last.t - sample.t) / 1000;
      if (dt < GESTURE.flick.windowMinMs / 1000 || dt > GESTURE.flick.windowMaxMs / 1000) continue;
      const vx = (last.x - sample.x) / dt;
      const vy = (last.y - sample.y) / dt;
      // 横向主导才可能是"扇风"
      if (Math.abs(vx) <= Math.abs(vy) * 1.2) continue;
      const score = Math.abs(vx);
      if (score > bestScore) {
        bestScore = score;
        bestVx = vx;
        bestVy = vy;
      }
    }
  }
  // 平滑一点（只对已算出的值做轻滤波，仍然保留峰值）
  smoother.flickVx += (bestVx - smoother.flickVx) * 0.6;
  smoother.flickVy += (bestVy - smoother.flickVy) * 0.6;

  return {
    openness: smoother.openness,
    rawRatio: smoother.rawRatio,
    pinchDistance: pinchOf(landmarks),
    indexTip: { x: tipX, y: tipY },
    palmCenter: { x: palmX, y: palmY },
    velocityPerSec: { x: smoother.velocityX, y: smoother.velocityY },
    palmVelocityPerSec: { x: smoother.palmVx, y: smoother.palmVy },
    flickVelocity: { x: smoother.flickVx, y: smoother.flickVy },
    angularVelocity: smoother.angularVel,
    isClosed: smoother.openness < GESTURE.openness.closeThreshold,
    timestampMs: nowMs,
    landmarks,
  };
}
