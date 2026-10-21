import { PHOTO, RIVER } from '@/config';

/**
 * 无限长河的几何
 *
 * 核心思想：**波形是 x 的纯函数**，所以任意 x（哪怕几万）都成立，
 * 左边可以无限延伸（过去），右边可以无限延伸（未来）。
 *
 *   y = sin(x·f1)·a1 + sin(x·f2+p)·a2      → 起伏
 *   z = sin(x·f3+p3)·a3                    → 纵深蜿蜒
 *   管子截面 = Frenet 框架（法线 ≈ 深度，副法线 ≈ 画面上下）
 *
 * 粒子池只覆盖相机附近的一段（`poolWidth`），靠 `uScroll` 平移 + 环绕实现无缝滚动。
 * 照片的世界坐标直接由序号推出来：第 i 张 x = i × spacing。
 */

type Vec3 = { x: number; y: number; z: number };

/** X 处的起伏高度（不含整条河的呼吸；呼吸是着色器里的 uTime 项） */
export function waveYAtX(x: number): number {
  const { amp, freq, amp2, freq2, phase2 } = RIVER.wave;
  return Math.sin(x * freq) * amp + Math.sin(x * freq2 + phase2) * amp2;
}

/** X 处的纵深 */
export function waveZAtX(x: number): number {
  const { amp, freq, phase } = RIVER.depth;
  return Math.sin(x * freq + phase) * amp;
}

/** 切线（解析导数） */
export function tangentAtX(x: number): Vec3 {
  const { amp, freq, amp2, freq2, phase2 } = RIVER.wave;
  const dy = Math.cos(x * freq) * amp * freq + Math.cos(x * freq2 + phase2) * amp2 * freq2;
  const dz = Math.cos(x * RIVER.depth.freq + RIVER.depth.phase) * RIVER.depth.amp * RIVER.depth.freq;
  const len = Math.hypot(1, dy, dz) || 1;
  return { x: 1 / len, y: dy / len, z: dz / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Frenet 框架（up 取 (0,1,0)） */
export function frameAtX(x: number): { normal: Vec3; binormal: Vec3 } {
  const tangent = tangentAtX(x);
  const normal = normalize(cross({ x: 0, y: 1, z: 0 }, tangent));
  const binormal = normalize(cross(tangent, normal));
  return { normal, binormal };
}

/** 轴线上的世界坐标 */
export function pointOnRiverX(x: number): Vec3 {
  return { x, y: waveYAtX(x), z: waveZAtX(x) };
}

/** 管壁上的一点（世界坐标） */
export function pointOnTubeAtX(x: number, phase: number, radiusNorm: number): Vec3 {
  const axis = pointOnRiverX(x);
  const { normal, binormal } = frameAtX(x);
  const theta = phase * Math.PI * 2 + x * RIVER.tube.twistTurnsPerUnit * Math.PI * 2;
  const r = radiusNorm * RIVER.tube.radius;
  return {
    x: axis.x + (Math.cos(theta) * normal.x + Math.sin(theta) * binormal.x) * r,
    y: axis.y + (Math.cos(theta) * normal.y + Math.sin(theta) * binormal.y) * r,
    z: axis.z + (Math.cos(theta) * normal.z + Math.sin(theta) * binormal.z) * r,
  };
}

/* ────────────────── 照片在长河上的位置 ────────────────── */

/** 第 index 张照片的世界 x（按导入顺序向右排） */
export function photoXForIndex(index: number): number {
  return index * PHOTO.spacing;
}

/** 世界 x → 最近的序号（四舍五入，可能越界） */
export function indexFromX(x: number): number {
  return Math.round(x / Math.max(PHOTO.spacing, 1e-3));
}

/**
 * 把滚动位置夹在「照片范围 + 两端余量」里，
 * 这样长河可以越过两端一点点（橡皮筋），但不会滚到没有照片的虚空里。
 */
export function clampScroll(x: number, photoCount: number): number {
  const first = 0;
  const last = Math.max(photoCount - 1, 0) * PHOTO.spacing;
  const pad = PHOTO.spacing * PHOTO.endOverscroll;
  return Math.min(Math.max(x, first - pad), last + pad);
}

/* ────────────────── 情绪光色沿河的位置 ────────────────── */

/**
 * 情绪温度沿河的分布：用慢波把时间轴切成暖/冷交替的段落。
 * 现在它是**世界 x 的函数**（不再依赖 0..1 的归一化位置），无限延伸也成立。
 */
export function emotionAtX(x: number): number {
  const wave = Math.sin((x / RIVER.windowWidth) * 2.6 + 0.6) * 0.5 + 0.5;
  return 0.18 + wave * 0.78;
}
