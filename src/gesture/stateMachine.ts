import { GESTURE, GESTURE_CONTINUOUS } from '@/config';
import type { HandFeature } from './types';

/**
 * 手势状态机（极简三动作版 · 2026-10 最终重构）
 *
 * 只有三个动作，互相不干扰：
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │ ① 扇风 = 切照片                                              │
 *  │    手腕甩一下（手掌中心横向速度 > flick.velocity）            │
 *  │    → 立刻给长河一个冲量 → 惯性 → 磁吸到最近的照片             │
 *  │    铁律：甩动期间（含 320ms 尾）**绝不做缩放**                │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │ ② 手静止 = 缩放                                              │
 *  │    手停住（速度 < flick.stillVelocity 持续 70ms）             │
 *  │    → 只读 openness，慢慢张开放大、慢慢握拳缩小                │
 *  │    铁律：手没停就只管甩，不缩放                               │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │ ③ 捏合 / 快速握拳 = 确认进入                                  │
 *  │    拇指食指捏合 3 帧，或"张开→快速握拳"（< 420ms）            │
 *  │    → 进入当前居中的照片（L2）                                 │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * 已彻底删除：连续平移跟随、300ms 复位、500ms 缩小、缓冲带、停留自动进入、
 *             极限张开推进、张开度阈值切换层级……
 *
 * 唯一保留的"陈旧复杂度"是**分带**：openness 只在自己那一层里推拉，
 * 这样在 L1 拨照片时张开手不会把画面推到 L2（上一轮真机反馈的核心痛点）。
 */

export type CommittedLayer = 'L0' | 'L1' | 'L2';

export interface MachineInput {
  feature: HandFeature | null;
  now: number;
  /** 当前居中的照片 id（由场景的自动焦点提供），不再用手指拾取 */
  hoverTarget: string | null;
  /** L2 界面锁定：忽略扇风/缩放/握拳退出，只保留捏合解锁 */
  locked?: boolean;
  /** 长河仍在滑动/惯性/吸附，或刚停稳的冻结尾段：禁止连续缩放 */
  scrollActive?: boolean;
}

export interface MachineEvent {
  signal:
    | 'handLost'
    | 'pinch'
    | 'lockToggle'
    | 'dwell'
    | 'hover'
    | 'fistEnter'
    | 'fistExit'
    | 'flick';
  feature: HandFeature | null;
  now: number;
  targetId?: string | null;
  /** 甩动速度（屏幕宽度/秒），正值 = 手向右甩 */
  velocityX?: number;
}

export type GestureStatusKey =
  | 'noHand'
  | 'open'
  | 'closed'
  | 'pending'
  | 'pinch'
  | 'swiping'
  | 'hovering';

export interface MachineDebug {
  openness: number;
  zoomTarget: number;
  zoomFrozen: boolean;
  /** 这一次是不是"握拳退出"触发的缩小 */
  fistExit: boolean;
  committed: CommittedLayer;
  /** 是否正在扇风（含冷却尾） */
  flicking: boolean;
  /** 手是否静止（允许缩放） */
  still: boolean;
  /** 手掌中心横向速度 */
  palmVx: number;
  /** L2 是否锁定 */
  locked: boolean;
  /** 锁定/解锁冷却剩余（ms） */
  lockCooldownRemaining: number;
}

export interface GestureMachine {
  feed(input: MachineInput): MachineEvent | null;
  reset(): void;
  readonly status: GestureStatusKey;
  readonly debug: MachineDebug;
  readonly zoomTarget: number;
  readonly cursorVisible: boolean;
  /** 外部（缩略图/鼠标点击）进入某层时同步分带 */
  commit(layer: CommittedLayer): void;
}

/** openness → 当前带内的归一化位置 0..1 */
export function opennessToUnit(openness: number): number {
  const { lowOpenness, highOpenness, curve } = GESTURE_CONTINUOUS;
  const span = Math.max(highOpenness - lowOpenness, 1e-4);
  const normalized = Math.min(Math.max((openness - lowOpenness) / span, 0), 1);
  return Math.pow(normalized, curve);
}

/** 兼容旧调用 */
export function opennessToProgress(openness: number): number {
  return opennessToUnit(openness) * GESTURE_CONTINUOUS.maxProgress;
}

/**
 * 分带映射：openness 只在自己那层里推拉
 *   L0 → 0..1（靠近长河）
 *   L1 → 锁死 1（拨照片时手张开绝不切层）
 *   L2 → 1..2（贴近照片 / 退回）
 */
export function progressForBand(committed: CommittedLayer, unit: number): number {
  if (committed === 'L0') return unit;
  // L1：硬锁 1（按用户要求改回之前的映射）
  if (committed === 'L1') return 1;
  return 1 + unit;
}

export function createGestureMachine(): GestureMachine {
  let status: GestureStatusKey = 'noHand';

  // 分带
  let committed: CommittedLayer = 'L0';
  let backHoldSince = 0;
  /** 握拳计时 / 进入后的"必须先张开"闩锁 */
  let fistSince = 0;
  let fistLatchUntil = 0;
  let fistOpenReleased = true;

  // 缩放
  let zoomTarget = 0;
  let lastApplied = 0;

  // 扇风
  let lastFlickAt = -Infinity;

  // 静止判定
  let stillSince = 0;

  // 捏合
  let pinchFrames = 0;
  let pinchLatched = false;
  /** 上一次成功锁/解锁的时间：3 秒内忽略再次捏合切换 */
  let lastLockToggleAt = -Infinity;

  // 快速握拳
  let openSeenAt = 0;
  let lastFistEnterAt = -Infinity;
  /** 上一帧是否已经握拳：快速握拳必须是"张开 → 握起"的边沿，不能持续闭合重触发 */
  let prevClosed = false;

  // 手离开
  let handPresent = false;
  let lastSeenAt = 0;
  let lostEmitted = false;

  const debug: MachineDebug = {
    openness: 0,
    zoomTarget: 0,
    zoomFrozen: false,
    fistExit: false,
    committed: 'L0',
    flicking: false,
    still: false,
    palmVx: 0,
    locked: false,
    lockCooldownRemaining: 0,
  };

  const machine: GestureMachine = {
    get status() {
      return status;
    },
    get debug() {
      return debug;
    },
    get zoomTarget() {
      return zoomTarget;
    },
    get cursorVisible() {
      // 宽限期内保持光标（手短暂飞出画面不闪断）
      return handPresent || (lastSeenAt > 0 && performance.now() - lastSeenAt < GESTURE.lost.graceMs);
    },

    commit(layer) {
      committed = layer;
      backHoldSince = 0;
      if (layer !== 'L2') {
        lastLockToggleAt = -Infinity;
        debug.lockCooldownRemaining = 0;
      }
      // 外部点缩略图 / 回车 / 捏合进入某层时，连续缩放目标也要跟过去，
      // 否则下一帧仍会把手势的旧目标（比如 0）灌回相机，把刚进的照片拉走。
      zoomTarget = layer === 'L0' ? 0 : layer === 'L1' ? 1 : 2;
      lastApplied = zoomTarget;
      debug.committed = committed;
      debug.zoomTarget = zoomTarget;
    },

    reset() {
      handPresent = false;
      lastSeenAt = 0;
      lostEmitted = false;
      pinchFrames = 0;
      pinchLatched = false;
      openSeenAt = 0;
      lastFistEnterAt = -Infinity;
      prevClosed = false;
      lastFlickAt = -Infinity;
      backHoldSince = 0;
      stillSince = 0;
      fistSince = 0;
      fistLatchUntil = 0;
      fistOpenReleased = true;
      lastLockToggleAt = -Infinity;
      committed = 'L0';
      debug.committed = committed;
      debug.fistExit = false;
      debug.flicking = false;
      debug.zoomFrozen = false;
      debug.locked = false;
      status = 'noHand';
      // 不清零 zoomTarget：手离开不该把画面弹回原处
    },

    feed({ feature, now, hoverTarget, locked = false, scrollActive = false }): MachineEvent | null {
      // ═══════════════════════════════════════════
      // 手离开（宽限期内保留状态）
      // ═══════════════════════════════════════════
      if (!feature) {
        const away = lastSeenAt === 0 ? 0 : now - lastSeenAt;
        if (!handPresent && !lostEmitted) {
          status = 'noHand';
          return null;
        }
        if (away < GESTURE.lost.graceMs) return null;
        if (!lostEmitted) {
          lostEmitted = true;
          handPresent = false;
          status = 'noHand';
          return { signal: 'handLost', feature: null, now };
        }
        status = 'noHand';
        return null;
      }

      handPresent = true;
      lastSeenAt = now;
      lostEmitted = false;

      const { openness, pinchDistance } = feature;
      // 扇风看的是"整只手参考点"的窗口峰值速度；静止判定也用它（比手掌中心敏感）
      const palmVx = feature.flickVelocity.x;
      const palmSpeed = Math.hypot(feature.flickVelocity.x, feature.flickVelocity.y);
      debug.openness = openness;
      debug.palmVx = palmVx;
      debug.fistExit = false;
      debug.locked = locked;
      debug.lockCooldownRemaining = Math.max(
        0,
        GESTURE.lock.cooldownMs - (now - lastLockToggleAt),
      );

      // ═══════════════════════════════════════════
      // ★ 最高优先级：握拳 = 无条件退回长河
      //
      //   这条规则不受"手是否静止"、不受层级分带、也不受"是否在聊天"影响。
      //   必须在扇风/缩放/捏合之前裁决 —— 否则聊天时握拳会被后面的分支抢走。
      //   · 进入 L2 后有 1.2s 闩锁，且必须先张开一次，避免同一次握拳"刚进就退"。
      //   · 在 L2 里快速握拳不再触发"进入"（已经在了），只会走退出。
      // ═══════════════════════════════════════════
      const fistExitCfg = GESTURE.fistExit;
      const closedNow = openness <= GESTURE.fistEnter.opennessThreshold;
      // 快速握拳只认"张开 → 握起"的那一帧；持续闭合不能反复触发进入
      const wasClosed = prevClosed;
      prevClosed = closedNow;
      if (fistExitCfg.enabled && !locked) {
        if (!closedNow) {
          fistSince = 0;
          // 张开过之后才允许下一次握拳退出（避免"一进来就弹出去"）
          fistOpenReleased = true;
        } else {
          if (fistSince === 0) fistSince = now;
          const latched = now < fistLatchUntil || !fistOpenReleased;
          const heldLongEnough = now - fistSince >= fistExitCfg.holdMs;
          if (!latched && heldLongEnough) {
            committed = 'L0';
            zoomTarget = fistExitCfg.target;
            lastApplied = zoomTarget;
            backHoldSince = 0;
            fistSince = 0;
            // 保持握拳不重复触发：必须先张开一次，下一次握拳才算新的退出
            fistOpenReleased = false;
            status = 'closed';
            debug.committed = committed;
            debug.zoomTarget = zoomTarget;
            debug.fistExit = true;
            debug.flicking = false;
            debug.zoomFrozen = false;
            return { signal: 'fistExit', feature, now, targetId: hoverTarget };
          }
        }
      } else if (locked) {
        // 锁定时握拳不退出，也不累积退出计时
        fistSince = 0;
      }

      // ═══════════════════════════════════════════
      // ① 扇风 = 切照片（一次甩动只算一次）
      // ═══════════════════════════════════════════
      const canFlick = now - lastFlickAt > GESTURE.flick.cooldownMs;
      const flickingNow = Math.abs(palmVx) > GESTURE.flick.velocity;
      if (!locked && flickingNow && canFlick && openness > GESTURE.flick.minOpenness) {
        lastFlickAt = now;
        stillSince = 0;
        status = 'swiping';
        debug.flicking = true;
        debug.still = false;
        debug.zoomFrozen = true;
        return { signal: 'flick', feature, now, velocityX: palmVx, targetId: hoverTarget };
      }
      const flickCooling = now - lastFlickAt < GESTURE.flick.zoomFreezeMs;
      debug.flicking = !locked && (flickingNow || flickCooling);

      // ═══════════════════════════════════════════
      // ② 静止 = 缩放（动的时候完全不缩放）
      // ═══════════════════════════════════════════
      const stillNow = palmSpeed < GESTURE.flick.stillVelocity;
      if (stillNow) {
        if (stillSince === 0) stillSince = now;
      } else {
        stillSince = 0;
      }
      const stillLongEnough = stillSince > 0 && now - stillSince >= GESTURE.flick.stillSettleMs;
      // 滑动/惯性/吸附/停稳尾段期间一律不缩放。离散手势（捏合/握拳）不受影响。
      const zoomLocked = locked || debug.flicking || scrollActive || !stillLongEnough;
      debug.still = stillLongEnough;
      debug.zoomFrozen = zoomLocked;

      if (locked) {
        // 锁定时把相机钉在 L2，绝不被手型拉回 L1/L0
        zoomTarget = 2;
        lastApplied = 2;
      } else if (!zoomLocked) {
        const unit = opennessToUnit(openness);
        const next = progressForBand(committed, unit);
        if (Math.abs(next - lastApplied) > GESTURE_CONTINUOUS.deadband) {
          zoomTarget = next;
          lastApplied = next;
        }
      }
      debug.zoomTarget = zoomTarget;

      if (flickingNow && !locked) {
        status = 'swiping';
        return null;
      }

      // ═══════════════════════════════════════════
      // ③ 捏合 / 快速握拳 = 确认进入
      // ═══════════════════════════════════════════
      // 捏合
      if (pinchDistance < GESTURE.pinch.distanceThreshold) {
        pinchFrames += 1;
      } else {
        pinchFrames = 0;
        pinchLatched = false;
      }
      debug.still = stillLongEnough;

      if (pinchFrames >= GESTURE.pinch.framesToConfirm && !pinchLatched) {
        pinchLatched = true;
        status = 'pinch';
        if (committed === 'L2') {
          const remaining = GESTURE.lock.cooldownMs - (now - lastLockToggleAt);
          if (remaining > 0) {
            // 3 秒冷却中：本次捏合完全忽略，不锁也不解锁
            debug.lockCooldownRemaining = remaining;
            debug.committed = committed;
            return null;
          }
          lastLockToggleAt = now;
          debug.lockCooldownRemaining = GESTURE.lock.cooldownMs;
          debug.committed = committed;
          return { signal: 'lockToggle', feature, now, targetId: hoverTarget };
        }
        if (committed === 'L1') committed = 'L2';
        fistLatchUntil = now + GESTURE.fistExit.afterEnterLatchMs;
        fistOpenReleased = false;
        debug.committed = committed;
        return { signal: 'pinch', feature, now, targetId: hoverTarget };
      }

      // 快速握拳：先记录"张开过"的时刻，然后看是否在窗口内握起来
      if (openness > GESTURE.fistEnter.fromOpenAbove) openSeenAt = now;
      const quickClose =
        GESTURE.fistEnter.enabled &&
        !locked &&
        committed !== 'L2' &&
        !wasClosed &&
        now - lastFistEnterAt > GESTURE.fistEnter.cooldownMs &&
        openness < GESTURE.fistEnter.opennessThreshold &&
        openSeenAt > 0 &&
        now - openSeenAt <= GESTURE.fistEnter.quickWindowMs;
      if (quickClose) {
        lastFistEnterAt = now;
        openSeenAt = 0;
        status = 'closed';
        if (committed === 'L1') committed = 'L2';
        fistLatchUntil = now + GESTURE.fistExit.afterEnterLatchMs;
        fistOpenReleased = false;
        fistSince = 0;
        debug.committed = committed;
        return { signal: 'fistEnter', feature, now, targetId: hoverTarget };
      }

      // ═══════════════════════════════════════════
      // 分带提交 / 回退（只在手静止时发生，全部带滞后）
      // ═══════════════════════════════════════════
      const bands = GESTURE_CONTINUOUS.bands;
      const unit = opennessToUnit(openness);

      if (!locked && stillLongEnough) {
        if (committed === 'L0') {
          // 张开到顶 → 进 L1（L1 锁死，所以这一步安全）
          if (unit >= bands.commitL1At) {
            committed = 'L1';
            debug.committed = committed;
            backHoldSince = 0;
          }
        } else if (committed === 'L1') {
          // 合拢并保持 → 退回 L0
          if (unit <= bands.backToL0At) {
            if (backHoldSince === 0) backHoldSince = now;
            else if (now - backHoldSince >= bands.backToL0HoldMs) {
              committed = 'L0';
              debug.committed = committed;
              backHoldSince = 0;
            }
          } else {
            backHoldSince = 0;
          }
        } else {
          // L2：合拢并保持 → 退回 L1
          if (unit <= bands.backToL1At) {
            if (backHoldSince === 0) backHoldSince = now;
            else if (now - backHoldSince >= bands.backToL1HoldMs) {
              committed = 'L1';
              debug.committed = committed;
              backHoldSince = 0;
            }
          } else {
            backHoldSince = 0;
          }
        }
      } else {
        backHoldSince = 0;
      }
      debug.committed = committed;

      // ═══════════════════════════════════════════
      // 状态文字
      // ═══════════════════════════════════════════
      status =
        openness > GESTURE.openness.zoomInThreshold
          ? 'open'
          : openness < GESTURE.openness.closeThreshold
            ? 'closed'
            : 'pending';

      return null;
    },
  };

  return machine;
}

/** 供 UI 显示的中文状态文案 */
export const STATUS_TEXT: Record<GestureStatusKey, string> = {
  noHand: '状态：未检测到手',
  open: '状态：张开放大',
  closed: '状态：合拢缩小',
  pending: '状态：半开 · 微调中',
  pinch: '状态：捏合确认',
  swiping: '状态：拨动中',
  hovering: '状态：悬停选中',
};

/** 手势说明（UI / 文档共用） */
export const GESTURE_HINT_ROWS = [
  { name: '手腕左右扇一下', desc: '长河滚动一段，自动磁吸到最近的照片' },
  { name: '手停住 + 张合', desc: '连续放大 / 缩小（手一动就不缩放）' },
  { name: '拇指食指捏合', desc: '进入当前居中的照片' },
  { name: '张开后快速握拳', desc: '同样进入当前照片' },
  { name: 'L2 捏合', desc: '锁定界面（锁定后握拳不退出，再捏合解锁）' },
  { name: '握拳保持', desc: '任何层级 / 聊天中，随时退回长河 L0（L2 锁定时除外）' },
] as const;
