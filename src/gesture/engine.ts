// 手势引擎：追踪器 + 连续控制器 + 光标平滑 + 事件派发
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

import { GESTURE } from '@/config';
import { isDerivedLayerWrite, readRiverState, useRiverStore } from '@/state/store';
import {
  createGestureMachine,
  STATUS_TEXT,
  type GestureMachine,
  type MachineEvent,
} from './stateMachine';
import { computeFeature, createSmoother, type FeatureSmoother } from './features';
import { createHandTracker, toPoints, type HandTracker, type TrackerStatus } from './tracker';
import { liveGesture } from './liveState';
import { createCalibrationSession, type CalibrationSession } from './calibration';
import { ratioToOpenness } from './calibration';
import { playSfx } from '@/music';

/**
 * 手势引擎（连续量版）
 *
 * 数据流：
 *   摄像头 → HandLandmarker → 21 点 → features（openness / pinch / 速度）
 *   → 控制器：
 *       · 连续量：openness → 相机层级进度（每帧推给场景，`stageBridge.zoom`）
 *       · 边沿量：捏合确认、停留确认、拨动、悬停
 *
 * 设计要点：
 *  - 光标每帧 EMA 平滑，写进 liveGesture（覆盖层读，不走 React）
 *  - 手短暂飞出画面时**不隐藏光标、不改缩放**（宽限期在控制器里）
 */
export interface GestureEngineOptions {
  pickPhoto(xNorm: number, yNorm: number): string | null;
  projectPhoto(id: string): { x: number; y: number; radius: number } | null;
  /** 横向拨动（世界单位/秒） */
  onSwipe(velocityScreenPerSec: number): void;
  /** 连续缩放：progress 0..2 */
  onZoom(progress: number): void;
  /** L2 锁定状态变化：锁定时停止滚动惯性 */
  onLock(locked: boolean): void;
}

export interface GestureEngine {
  start(): Promise<void>;
  stop(): void;
  setEnabled(enabled: boolean): void;
  /** 一键校准会话（UI 绑定它） */
  readonly calibration: CalibrationSession;
  readonly tracker: HandTracker;
  readonly status: () => TrackerStatus;
  readonly statusText: () => string;
}

export function createGestureEngine(options: GestureEngineOptions): GestureEngine {
  const machine: GestureMachine = createGestureMachine();

  /**
   * store 的层级被外部改动（缩略图 / 鼠标点击 / Enter）时，同步手势的"提交层级"，
   * 否则用户进了 L2 之后张手仍然只会在 L1 段里动。
   *
   * ⚠️ 必须跳过"连续缩放派生的离散层"：Stage 的渲染循环写 store.layer 只是 HUD 副产物，
   * 如果手势引擎也把它当成确认去 commit，L1↔L2 边界就会反复重置分带（拉锯/死锁）。
   * 订阅放在 start() 里重建 —— App 的 StrictMode 先 stop 再 start 时不能丢。
   */
  let unsubscribeLayer: (() => void) | null = null;
  function syncLayerSubscription(): void {
    if (unsubscribeLayer) return;
    unsubscribeLayer = useRiverStore.subscribe((state, previous) => {
      if (state.layer === previous.layer) return;
      if (isDerivedLayerWrite()) return;
      if (state.layer === 'L0' || state.layer === 'L1' || state.layer === 'L2') {
        machine.commit(state.layer);
      }
    });
  }
  syncLayerSubscription();
  const calibration = createCalibrationSession(() => undefined);
  const smoother: FeatureSmoother = createSmoother();
  let enabled = true;
  let cursorX = 0.5;
  let cursorY = 0.5;
  let hasCursor = false;

  function dispatch(event: MachineEvent): void {
    const store = readRiverState();
    switch (event.signal) {
      case 'handLost':
        // 只隐藏光标，**不动缩放**（手飞出去不该让画面弹回）
        liveGesture.active = false;
        liveGesture.trail.length = 0;
        store.setGestureStatus('lost');
        break;
      case 'pinch': {
        const target = event.targetId ?? null;
        if (target) {
          playSfx('confirm');
          store.focusPhoto(target);
          store.setLayer('L2');
        }
        break;
      }
      case 'dwell': {
        const target = event.targetId ?? null;
        if (target) {
          store.focusPhoto(target);
          store.setLayer('L2');
        }
        break;
      }
      case 'fistEnter': {
        // 握拳进入：直接用当前居中的照片（不需要指）
        if (store.l2Locked) break;
        const target = readRiverState().focusedId;
        if (target) {
          playSfx('confirm');
          store.focusPhoto(target);
          store.setLayer('L2');
        }
        break;
      }
      case 'fistExit': {
        // 最高优先级兜底：任何层级 / 任何聊天状态，握拳保持即回长河。
        // 但 L2 锁定期间不响应，必须先捏合解锁。
        if (store.l2Locked) break;
        playSfx('zoomOut');
        store.closeDialog();
        store.setHovered(null);
        store.setLayer('L0');
        break;
      }
      case 'flick':
        // 手腕甩动 → 给长河一个冲量（锁定期间忽略）
        if (store.l2Locked) break;
        playSfx('swipe');
        options.onSwipe(event.velocityX ?? 0);
        break;
      case 'lockToggle': {
        const next = !readRiverState().l2Locked;
        playSfx('confirm');
        readRiverState().setL2Locked(next);
        readRiverState().setL2LockCooldownUntil(performance.now() + GESTURE.lock.cooldownMs);
        options.onLock(next);
        if (!next) machine.commit('L2');
        break;
      }
      case 'hover':
        store.setHovered(event.targetId ?? null);
        break;
      default:
        break;
    }
  }

  const tracker = createHandTracker({
    onStatus(status) {
      readRiverState().setGestureStatus(
        status === 'ready' ? 'tracking' : status === 'denied' || status === 'unavailable' ? 'unavailable' : 'idle',
      );
    },

    onLandmarks(landmarks, nowMs) {
      if (!enabled) return;

      if (!landmarks) {
        calibration.sample(null);
        const event = machine.feed({ feature: null, now: nowMs, hoverTarget: null });
        if (event) dispatch(event);
        liveGesture.status = machine.status;
        liveGesture.landmarks = null;
        // 宽限期内仍显示光标（最后一帧的位置），超过宽限期才真正隐藏
        if (!machine.cursorVisible) {
          liveGesture.active = false;
          liveGesture.ring = null;
          liveGesture.progress = 0;
          liveGesture.trail.length = 0;
        }
        return;
      }

      const points = toPoints(landmarks);
      const feature = computeFeature(points, true, nowMs, smoother);

      // 校准会话每帧吃一次原始比值
      calibration.sample(feature.rawRatio);

      // 光标 EMA 平滑
      const alpha = GESTURE.smoothing.cursorAlpha;
      if (!hasCursor) {
        cursorX = feature.indexTip.x;
        cursorY = feature.indexTip.y;
        hasCursor = true;
      } else {
        cursorX += (feature.indexTip.x - cursorX) * alpha;
        cursorY += (feature.indexTip.y - cursorY) * alpha;
      }

      // 食指光标只做视觉引导：**不再用它拾取照片**。
      // 悬停/停留的目标永远是"当前居中的那张"（拨盘式焦点）。
      const hoverTarget = readRiverState().focusedId;

      const river = readRiverState();
      const locked = river.l2Locked;
      const scrollActive = river.isSwiping;
      const event = machine.feed({ feature, now: nowMs, hoverTarget, locked, scrollActive });
      if (event) dispatch(event);

      // ★ 连续缩放：锁定期间钉在 L2，其它时候每帧把目标推给相机
      options.onZoom(locked ? 2 : machine.zoomTarget);

      liveGesture.active = true;
      liveGesture.x = cursorX;
      liveGesture.y = cursorY;
      liveGesture.openness = feature.openness;
      liveGesture.rawRatio = feature.rawRatio;
      liveGesture.rawOpenness = ratioToOpenness(feature.rawRatio);
      liveGesture.status = machine.status;
      liveGesture.swiping = machine.status === 'swiping';
      liveGesture.landmarks = points;
      liveGesture.zoomFrozen = machine.debug.zoomFrozen || locked;
      liveGesture.flickSpeed = Math.abs(feature.flickVelocity.x);
      liveGesture.pinchDistance = feature.pinchDistance;

      liveGesture.trail.push({ x: cursorX, y: cursorY, t: nowMs });
      while (liveGesture.trail.length > GESTURE.smoothing.trailSamples) liveGesture.trail.shift();
      const cutoff = nowMs - GESTURE.smoothing.trailLifeMs;
      while (liveGesture.trail.length > 0 && (liveGesture.trail[0]?.t ?? 0) < cutoff) {
        liveGesture.trail.shift();
      }

      const openPhoto = hoverTarget ?? null;
      // 没有"停留确认"了：进度环只作为焦点指示（画满表示"这张是当前焦点"）
      liveGesture.progress = openPhoto ? 1 : 0;
      liveGesture.ring = openPhoto ? options.projectPhoto(openPhoto) : null;
      void options.pickPhoto;

      // 扇风由状态机判定并作为离散事件派发（见 dispatch 的 'flick'）

    },
  });

  return {
    tracker,
    calibration,
    status: () => tracker.status,
    statusText: () => STATUS_TEXT[liveGesture.status],

    async start() {
      enabled = true;
      syncLayerSubscription();
      // 从鼠标模式/摄像头暂停回来时，先对齐当前层级，避免手势把画面拉回旧状态
      const layer = readRiverState().layer;
      if (layer === 'L0' || layer === 'L1' || layer === 'L2') machine.commit(layer);
      tracker.setPaused(false);
      await tracker.start();
    },

    stop() {
      unsubscribeLayer?.();
      unsubscribeLayer = null;
      tracker.stop();
      machine.reset();
      liveGesture.active = false;
      hasCursor = false;
    },

    setEnabled(value) {
      enabled = value;
      if (!value) {
        // 鼠标模式时彻底停掉推理循环（摄像头可以留着，但不再占主线程）
        tracker.setPaused(true);
        machine.reset();
        liveGesture.active = false;
        liveGesture.trail.length = 0;
        liveGesture.zoomFrozen = false;
        return;
      }
      syncLayerSubscription();
      const layer = readRiverState().layer;
      if (layer === 'L0' || layer === 'L1' || layer === 'L2') machine.commit(layer);
      tracker.setPaused(false);
      if (tracker.status !== 'ready' && tracker.status !== 'loading') void tracker.start();
    },
  };
}
