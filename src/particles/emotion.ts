import * as THREE from 'three';
import { PALETTE, PARTICLE } from '@/config';
export { emotionAtX } from './riverPath';


/**
 * 情绪光色映射（CPU 侧）
 * 与 shaders/river.vert.glsl 的 ⑧ 段保持同一套语义：
 *   e = 0 → 冷蓝 #5b7cff
 *   e = 0.5 → 青白 #9fd8ff（中点由 PARTICLE.color.blendWarmCyan 给出）
 *   e = 1 → 暖金 #ffb86b
 * 涟漪、UI、将来的记忆卡都用这个函数取色，保证「同一个人同一套颜色」。
 */

const COLD = new THREE.Color(PALETTE.emotion.coldBlue);
const CYAN = new THREE.Color(PALETTE.emotion.cyanWhite);
const WARM = new THREE.Color(PALETTE.emotion.warmGold);

/** 情绪值 → 颜色（写入 target 并返回，避免每帧 new Color） */
export function emotionToColor(emotion: number, target: THREE.Color): THREE.Color {
  const { min, max } = PALETTE.emotionRange;
  const e = Math.min(Math.max(emotion, min), max);
  const mid = PARTICLE.color.blendWarmCyan;

  if (e < mid) {
    const k = mid <= 0 ? 1 : e / mid;
    return target.copy(COLD).lerp(CYAN, k);
  }
  const k = (e - mid) / Math.max(1 - mid, 1e-6);
  return target.copy(CYAN).lerp(WARM, k);
}

/** 情绪值 → CSS 十六进制（UI 层用） */
export function emotionToHex(emotion: number): string {
  return `#${emotionToColor(emotion, new THREE.Color()).getHexString()}`;
}

/**
 * 某个河段的「年份温度」（世界 x 的函数，无限延伸都成立）。
 * 用慢波把时间轴切成暖/冷交替的段落 —— 这样观众能读到「有些年很暖」。
 */


