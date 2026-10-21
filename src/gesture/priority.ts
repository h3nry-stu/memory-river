import { GESTURE_PRIORITY, type GestureSignal } from '@/config';

/**
 * 优先级裁决（纯函数，阶段 1 状态机直接复用）
 *
 * 铁律顺序：手离开 > 合拢保持缩小 > 复位 > 捏合 > 拨动 > 放大边沿 > 悬停 > 停留
 * 每帧只允许一个信号生效 —— 冲突时取优先级数字最小者。
 * 同优先级并列时按传入顺序（先到先得）。
 */
export function pickDominantSignal(signals: readonly GestureSignal[]): GestureSignal | null {
  let best: GestureSignal | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const signal of signals) {
    const rank = GESTURE_PRIORITY[signal];
    if (rank < bestRank) {
      best = signal;
      bestRank = rank;
    }
  }

  return best;
}

/** 判断 signal 是否比 current 更该被采纳（状态机内部用来比较候选） */
export function outranks(next: GestureSignal, current: GestureSignal): boolean {
  return GESTURE_PRIORITY[next] < GESTURE_PRIORITY[current];
}
