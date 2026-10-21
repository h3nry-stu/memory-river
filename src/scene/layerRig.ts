// 相机装配体：层级过渡 + L2 锁定与阻尼回弹
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

import * as THREE from 'three';
import { GESTURE_CONTINUOUS, INPUT, LAYER_ORDER, LAYERS, PHOTO, type LayerId } from '@/config';
import { distanceForFraction, photoWorldAtX } from './photoField';

/**
 * 层级相机
 *
 * 三档机位都由「目标点 + 距离」决定，层级之间用**临界阻尼**平滑跟随：
 *   L0 全景  —— 目标 (0,0,0)，距离 = 让整条长河横向撑满视口
 *   L1 中景  —— 目标 = 当前聚焦照片（没有就取长河中点），距离 ≈ L0 × l1DistanceScale
 *   L2 聚焦  —— 目标 = 聚焦照片，距离 = 让照片占视口 60–80%（取 0.72）
 *
 * 关键手感：
 *  - 滚轮累积达到阈值才推进一层（触控板惯性不会连跳）
 *  - 到 L2 后继续往里滚 → 只有很小的**过冲**，然后弹簧回弹到锁定位置（阻尼回弹 + 锁定）
 *  - 距离变化用阻尼跟随，所以永远看不到瞬移
 */

export interface RigPose {
  target: THREE.Vector3;
  distance: number;
}

export interface LayerRig {
  /** 每帧推进；返回当前实际使用的层级（0..2 连续值，便于 UI 做过渡效果） */
  update(dtSec: number, camera: THREE.PerspectiveCamera, aspect: number): number;
  /** 目标层级（离散） */
  readonly layer: LayerId;
  /** 连续层级进度：0 = L0，1 = L1，2 = L2（可含过冲） */
  readonly progress: number;
  /** 当前聚焦照片的世界位置（没有聚焦时为 null） */
  setFocus(position: THREE.Vector3 | null, worldHeight: number): void;
  setLayer(layer: LayerId): void;
  /** 无限滚动：相机在长河上的世界坐标（L2 聚焦时由调用方收敛到焦点） */
  setScroll(x: number): void;
  /**
   * 连续缩放：直接给目标进度（0..2）。手势的 openness 就是往这里灌的。
   * 与 nudge/setLayer（滚轮、键盘）共用同一个 targetProgress，互不打架。
   */
  setProgressTarget(progress: number): void;
  /** 锁定目标进度一段时间（确认聚焦后让相机先停稳，忽略连续手势输入） */
  holdProgress(progress: number, durationMs: number): void;
  /** 瞬时切到某层（调试/深链用；正常交互仍走滚轮的阻尼过渡） */
  snapLayer(layer: LayerId): void;
  /** 滚轮累积；direction > 0 放大，< 0 缩小 */
  nudge(direction: number): void;
  /** 立即对齐目标（初始化用） */
  snap(camera: THREE.PerspectiveCamera, aspect: number): void;
  /** 当前照片占视口的比例（供 HUD/调试） */
  readonly viewportFraction: number;
  /** 缩放目标进度（连续量） */
  readonly targetProgress: number;
}

const LAYER_INDEX: Record<LayerId, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

export function createLayerRig(spanWidth: number, widthFill: number, fovDeg: number): LayerRig {
  let targetLayer: LayerId = 'L0';
  /** 连续目标进度：手势直接改它；滚轮/键盘改成整数层 */
  let targetProgress = 0;
  let progress = 0;
  let velocity = 0;

  /** 过冲量 0..1：L2 继续放大时的阻尼回弹 */
  let overshoot = 0;
  let wheelAccum = 0;

  let scrollX = 0;

  const focusPosition = new THREE.Vector3(0, 0, 0);
  let focusHeight: number = PHOTO.planeHeight;
  let hasFocus = false;

  const currentTarget = new THREE.Vector3();
  let currentDistance = 0;
  /** 下一次 update 直接吸附到目标（跳层/初始化用），跳过低通 */
  let pendingSnap = true;
  /** 连续输入被锁定的截止时间（确认聚焦后短暂锁定） */
  let holdUntil = 0;

  const desiredTarget = new THREE.Vector3();
  let desiredDistance = 0;

  /** L0：让长河横向撑满 */
  function l0Distance(aspect: number): number {
    const requiredWidth = spanWidth / Math.max(widthFill, 0.2);
    return requiredWidth / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(aspect, 0.2));
  }

  /** L2：让照片占视口 viewportFraction */
  function l2Distance(): number {
    return distanceForFraction(focusHeight, PHOTO.viewportFraction, fovDeg);
  }

  function l1Distance(aspect: number): number {
    // 中景：比全景近一半；同时保证聚焦照片至少有 ~18% 视口
    const mid = l0Distance(aspect) * LAYERS.l1DistanceScale;
    const minForPhoto = distanceForFraction(focusHeight, 0.18, fovDeg);
    return Math.max(mid, minForPhoto);
  }

  /** 按连续进度算出目标点与距离 */
  function composePose(aspect: number, p: number, out: RigPose): void {
    const l0 = l0Distance(aspect);
    const l1 = l1Distance(aspect);
    const l2 = l2Distance();

    // 横向：
    //   有聚焦照片 → 从"当前滚动位置"逐步对准照片（p 到 1 时完全对准）
    //   没有聚焦照片 → 就停在滚动位置（L0 全景漫游）
    // ⚠️ 只能加一次 scrollX：早期这里既在聚焦分支加了，又在外层按滚动权重加了一次，
    //    相机跑到 2×scrollX，于是只有第一张（x=0）居中，越往右偏得越多。
    //
    // ⚠️ 纵向和横向用**不同的**权重：
    //    纵向（抬到照片高度）在 L0→L1 就该完成；
    //    横向如果也在这个区间就锁死到"最近那张"，扇动时焦点一变相机就整段跳一下
    //    —— 真机反馈的"切照片卡、僵硬、不流畅"就是这个。
    //    所以 L1 阶段横向完全跟着 scrollX 连续滑，只在快进 L2 时才对准焦点。
    const focusWeightY = hasFocus ? THREE.MathUtils.smoothstep(p, 0.35, 1) : 0;
    const focusWeightX = hasFocus ? THREE.MathUtils.smoothstep(p, 1.55, 1.95) : 0;
    const targetX = hasFocus
      ? scrollX + (focusPosition.x - scrollX) * focusWeightX
      : scrollX;

    out.target.set(
      targetX,
      focusPosition.y * focusWeightY,
      focusPosition.z * focusWeightY,
    );

    if (p <= 1) {
      out.distance = THREE.MathUtils.lerp(l0, l1, THREE.MathUtils.smoothstep(p, 0, 1));
    } else {
      out.distance = THREE.MathUtils.lerp(l1, l2, THREE.MathUtils.smoothstep(p, 1, 2));
    }

    // 阻尼回弹：向内过冲时距离再缩一点，然后弹回
    out.distance *= 1 - overshoot * INPUT.pointer.overshootLimit;
  }

  const pose: RigPose = { target: new THREE.Vector3(), distance: 0 };

  const rig: LayerRig = {
    get layer() {
      return targetLayer;
    },
    get progress() {
      return progress;
    },
    get targetProgress() {
      return targetProgress;
    },
    get viewportFraction() {
      return progress >= 1.95 ? PHOTO.viewportFraction : 0;
    },

    setFocus(position, worldHeight) {
      if (position) {
        focusPosition.copy(position);
        hasFocus = true;
      } else {
        hasFocus = false;
      }
      focusHeight = Math.max(worldHeight, 0.2);
    },

    setLayer(layer) {
      if (LAYER_INDEX[layer] > 2) return; // 阶段 2 只到 L2
      targetLayer = layer;
      targetProgress = LAYER_INDEX[layer];
    },

    holdProgress(next, durationMs) {
      const clamped = Math.min(Math.max(next, 0), 2);
      targetProgress = clamped;
      targetLayer = LAYER_ORDER[Math.min(Math.max(Math.round(clamped), 0), 2)] ?? 'L0';
      holdUntil = performance.now() + durationMs;
    },

    setProgressTarget(next) {
      const clamped = Math.min(Math.max(next, 0), 2);
      /**
       * 锁定只在"想更近"时生效
       *
       * 真机反馈的 bug：聊天时握拳退不出去 —— 因为确认聚焦后有一段 hold，
       * 而 hold 把**缩小**也一起挡住了。
       * 现在的规则：往小走（离开）永远立刻生效；往大走才受 hold 保护。
       */
      const leaving = clamped < progress - 0.02;
      if (!leaving && performance.now() < holdUntil) return;
      targetProgress = clamped;
      // 同步离散层，让 HUD 的层级导轨跟着走
      const rounded = Math.round(targetProgress);
      const layer = LAYER_ORDER[Math.min(Math.max(rounded, 0), 2)] ?? 'L0';
      if (layer !== targetLayer) targetLayer = layer;
    },

    setScroll(x) {
      scrollX = x;
    },

    snapLayer(layer) {
      if (LAYER_INDEX[layer] > 2) return;
      targetLayer = layer;
      targetProgress = LAYER_INDEX[layer];
      progress = LAYER_INDEX[layer];
      velocity = 0;
      overshoot = 0;
      pendingSnap = true;
    },

    nudge(direction) {
      wheelAccum += direction * INPUT.pointer.wheelStepThreshold;
      if (Math.abs(wheelAccum) < INPUT.pointer.wheelStepThreshold) return;
      const step = Math.sign(wheelAccum);
      wheelAccum = 0;

      // 从当前（可能是连续值）进度跳到下一个整数层
      const base = step > 0 ? Math.floor(progress + 1e-3) : Math.ceil(progress - 1e-3);
      const next = Math.min(Math.max(base + step, 0), 2);
      targetProgress = next;
      targetLayer = LAYER_ORDER[next] ?? 'L0';
      if (next === Math.floor(progress + 1e-3) && Math.abs(next - progress) < 1e-3) {
        // 已经到头了，轻轻顶一下表示"没有更多"
        if (step > 0) overshoot = Math.min(overshoot + 0.35, 1);
      }
    },

    snap(camera, aspect) {
      const pose = { target: new THREE.Vector3(), distance: 0 };
      composePose(aspect, progress, pose);
      currentTarget.copy(pose.target);
      currentDistance = pose.distance;
      camera.position.set(pose.target.x, pose.target.y, pose.target.z + pose.distance);
      camera.lookAt(pose.target);
    },

    update(dtSec, camera, aspect) {
      // 过冲与滚轮累积的自然衰减
      overshoot *= Math.exp(-INPUT.pointer.overshootDecayPerSec * dtSec);
      wheelAccum *= Math.exp(-INPUT.pointer.wheelAccumDecayPerSec * dtSec);

      // 有聚焦照片时不能把进度推过 L2；没有聚焦照片时最多到 L1（别 Zoom 到一片空河）
      const goal = hasFocus ? Math.min(targetProgress, 2) : Math.min(targetProgress, 1.05);
      // 连续模式要跟手，用更大的阻尼；目标离得远时才用层级阻尼（更"沉"）
      const damping =
        Math.abs(goal - progress) > 0.35
          ? Math.max(GESTURE_CONTINUOUS.damping, LAYERS.damping.l2)
          : LAYERS.damping.l2;

      // 临界阻尼弹簧：让 progress 平滑逼近目标层，且不会来回振荡
      const stiffness = damping * damping * 0.25;
      const accel = (goal - progress) * stiffness - velocity * damping;
      velocity += accel * dtSec;
      progress += velocity * dtSec;

      composePose(aspect, progress, pose);
      desiredTarget.copy(pose.target);
      desiredDistance = pose.distance;

      if (pendingSnap) {
        currentTarget.copy(desiredTarget);
        currentDistance = desiredDistance;
        pendingSnap = false;
      } else {
        const follow = 1 - Math.exp(-damping * dtSec);

        // ⚠️ 横向（沿长河）**不加二次平滑**：
        // 滚动本身已经有弹簧/惯性平滑了，相机再低通一次会让照片"追不上"正中间
        // —— 端点处最明显（真机反馈的"边缘照片不在正中间"）。
        currentTarget.x = desiredTarget.x;

        // 纵向与纵深仍做低通：层级切换时这两轴变化剧烈，直接跟会抖
        currentTarget.y += (desiredTarget.y - currentTarget.y) * follow;
        currentTarget.z += (desiredTarget.z - currentTarget.z) * follow;
        currentDistance += (desiredDistance - currentDistance) * follow;
      }

      camera.position.set(
        currentTarget.x,
        currentTarget.y,
        currentTarget.z + currentDistance,
      );
      camera.lookAt(currentTarget);

      return progress;
    },
  };

  return rig;
}

/** 聚焦照片的世界坐标（没有照片时退回长河中点） */
export function focusPointFor(x: number | null): THREE.Vector3 {
  return photoWorldAtX(x ?? 0);
}
