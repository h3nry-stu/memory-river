// 这些模块持有 WebGL 资源与相机状态，热替换会留下「新几何 + 旧相机」的残影，
// 导致画面莫名其妙偏移。开发期直接接受变更并整页刷新，永远跑一份完整的新代码。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

import * as THREE from 'three';
import { AI, GESTURE, INPUT, LOD_TIERS, MUSIC, PALETTE, PARTICLE, PERF, PHOTO, RIPPLE, RIVER, SCROLL, type LodTier } from '@/config';
import {
  createRippleField,
  createRiver,
  createStarDust,
  emotionNearX,
  pointOnRiverX,
  indexFromX,
  clampScroll,
  photoXForIndex,
  waveZAtX,
} from '@/particles';
import {
  createPhotoField,
  disposePhotoAssets,
  photoWorldAtX,
  type PhotoField,
} from './photoField';
import { createLayerRig, type LayerRig } from './layerRig';
import { createCosmosBackground } from './cosmos';
import { createPostFX, type PostFX } from './postfx';
import {
  createFpsMonitor,
  detectTier,
  probeDevice,
  profileFor,
  readGpuString,
  type LodProfile,
} from './lod';
import { markDerivedLayerWrite, useRiverStore } from '@/state';
import { liveGesture, stageBridge } from '@/gesture';
import { getMusicEngine } from '@/music';
import { isTextEntry } from '@/ui/dom';

export interface Stage {
  /** 幂等销毁：取消 rAF、释放 GPU 资源、移除 canvas */
  dispose(): void;
  /** 同步渲染一帧并导出 PNG dataURL（开发期视觉验证用） */
  captureFrame(): string | null;
  /**
   * 瞬时切层（调试 / 深链用）：跳过阻尼过渡，直接把机位、组装度、粒子退场对齐。
   * 正常交互仍然走滚轮 → 阻尼过渡。
   */
  jumpToLayer(layer: 'L0' | 'L1' | 'L2', options?: { shatter?: number }): void;
  /** DEV：直接把长河拨到某个世界坐标（验证吸附 / 自动焦点 / 动态加载） */
  debugScrollTo(x: number): void;
  /**
   * DEV：模拟手势缩放的输入，返回 rig 的目标进度
   * 用来验证「对话打开时静止张合缩放依然生效」这条回归。
   */
  debugZoom?(progress: number): { dialogOpen: boolean; target: number };
  /**
   * DEV：连续缩放体检
   *
   * 逐帧步进 rig（不依赖真实时间），返回这一趟的抖动指标：
   *   · maxStep    单帧进度跳变的最大值（越大越"顿"）
   *   · reversals  进度倒退的帧数（来回拉锯 = L1↔L2 边界 bug）
   *   · driftX     相机横向漂移（张开推到 L2 时照片左右滑 = bug）
   *   · reached    是否真的到达目标
   */
  /**
   * DEV：模拟"渲染循环把连续进度派生成离散层"的那一步
   * 用来验证它**不会**反过来把 rig 的目标拉走（L1↔L2 拉锯的根因）。
   */
  debugDeriveLayer?(): { layer: string; target: number };
  /**
   * DEV：扇风回归体检
   *
   * 模拟真实链路的每一帧顺序：手势引擎调用 `stageBridge.zoom(目标)` **之后**再 updateScroll。
   * （这一条就是为了钉死"缩放路径每帧把滚动惯性清零"的 bug。）
   */
  debugFlickCheck?(velocity: number): {
    from: number;
    to: number;
    expected: number;
    travel: number;
    pass: boolean;
  };
  debugZoomSweep?(from: number, to: number, frames?: number): {
    from: number;
    to: number;
    reached: number;
    maxStep: number;
    reversals: number;
    driftX: number;
    driftY: number;
    samples: number[];
  };
  /** DEV：以给定初速度拨一下，用固定步长跑完惯性+吸附，返回落点 */
  debugScrollSim(velocityScreenPerSec: number): { from: number; to: number; snapped: boolean };
  /**
   * 在丝带上某个位置激起涟漪。
   * 抽成公开 API 的原因：阶段 3 的拨动/确认、阶段 5 的音乐重拍都会调它。
   * @param slot   沿主轴的归一化位置（0 = 左端起点，1 = 右端终点）
   * @param offsetY 相对轴线的上下偏移（世界单位）
   */
  spawnRippleAtSlot(slot: number, offsetY?: number, strength?: number): void;
  /** 运行期自检数据（DEV 探针用）：画布尺寸 / 相机 / 粒子包围盒 */
  debugInfo?(): Record<string, unknown>;
  /**
   * DEV：模拟"连扇几下"的拨盘过程，逐帧计时。
   *
   * 卡顿的本质是**某些帧里 CPU 干了重活**（建节点 / 采样 / 上传缓冲），
   * 所以这里统计的是每帧 CPU 耗时的分布：p50 正常而 max 很大 = 掉帧。
   * 返回 `warm`（第一次经过，含建节点）与 `steady`（回程，全命中缓存）。
   */
  debugSweep?(options?: {
    frames?: number;
    velocity?: number;
    reset?: boolean;
  }): {
    warm: SweepStats & { builds: number; maxBuildsPerFrame: number };
    steady: SweepStats & { builds: number; maxBuildsPerFrame: number };
    photos: {
      nodes: number;
      pending: number;
      builds: number;
      disposes: number;
      sampled: number;
      cacheHits: number;
      cacheMisses: number;
    };
  };
}

const PLANE_Z0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/** 一段拨盘模拟的逐帧耗时统计（单位毫秒） */
export interface SweepStats {
  frames: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
  /** 超过 16.7ms 的帧数（会掉帧的那些） */
  overBudget: number;
  /** 超过 33ms 的帧数（肉眼明显卡） */
  overSevere: number;
}

function summarize(frames: number[]): SweepStats {
  if (frames.length === 0) {
    return { frames: 0, avg: 0, p50: 0, p95: 0, max: 0, overBudget: 0, overSevere: 0 };
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(Math.floor(q * sorted.length), sorted.length - 1)]!;
  const sum = frames.reduce((acc, v) => acc + v, 0);
  return {
    frames: frames.length,
    avg: Number((sum / frames.length).toFixed(2)),
    p50: Number(at(0.5).toFixed(2)),
    p95: Number(at(0.95).toFixed(2)),
    max: Number(Math.max(...frames).toFixed(2)),
    overBudget: frames.filter((v) => v > 16.7).length,
    overSevere: frames.filter((v) => v > 33).length,
  };
}

/**
 * 阶段 1 舞台：深空 + 星尘 + **横向蜿蜒的光丝带** + 涟漪 + bloom + LOD
 *
 * 构图原则（形态决策）：
 *  - 丝带的 X 轴 = 时间主轴，从左到右贯穿画面
 *  - 相机正视丝带、无俯角、无地面、无消失点：这是一条悬浮在宇宙里的发光丝带
 *  - 取景距离按视口比例自动解算，保证任何屏幕比例下丝带都横向撑满、垂直居中
 *
 * 分工：
 *  - GPU 负责一切逐粒子的事（流动 / 起伏 / 涟漪位移 / 情绪取色 / 闪烁）
 *  - CPU 每帧只做：推进时间、更新 4 个涟漪槽位、相机呼吸、FPS 采样
 *  - LOD 降档不重建 buffer，只改 drawRange 与像素比
 */
export function createStage(host: HTMLElement): Stage {
  /* ── 渲染器 ── */
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // 粒子场景靠 bloom，不需要 MSAA
    alpha: false, // 背景在 canvas 内画，bloom 才完整
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(new THREE.Color(PALETTE.cosmos.near), 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = PALETTE.glow.exposure;
  host.appendChild(renderer.domElement);

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const respectReducedMotion = PERF.respectReducedMotion && reducedMotionQuery.matches;

  /* ── LOD 启动判定 ── */
  const probe = probeDevice();
  const forcedTier = import.meta.env.DEV
    ? (new URLSearchParams(window.location.search).get('lod') as LodTier | null)
    : null;
  const initialTier: LodTier =
    forcedTier && LOD_TIERS.includes(forcedTier)
      ? forcedTier
      : detectTier({ ...probe, gpu: readGpuString(renderer) });
  let profile: LodProfile = profileFor(initialTier, window.devicePixelRatio || 1);

  const riverMaxCount = Math.min(
    PARTICLE.budget.max,
    Math.round(PARTICLE.budget.river / Math.max(PERF.lod.tiers.high.ratio, 0.01)),
  );
  const starMaxCount = PARTICLE.budget.starDust;

  /* ── 场景与相机 ── */
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(RIVER.camera.fov, 1, 0.1, 600);
  camera.position.set(0, 0, RIVER.camera.distance);
  camera.lookAt(0, 0, 0);

  const cosmos = createCosmosBackground();
  scene.add(cosmos.mesh);

  const starDust = createStarDust(starMaxCount);
  scene.add(starDust);

  const ripples = createRippleField();
  scene.add(ripples.group);

  const river = createRiver({
    count: riverMaxCount,
    trail: profile.trail,
    dpr: profile.dprCap,
    ripples: ripples.slots,
  });
  scene.add(river.group);

  /* ── 照片：贴图平面 + 颗粒重组 ── */
  const photos: PhotoField = createPhotoField();

  // 照片层（高斯泼溅粒子 + 薄底贴图）走独立场景 → 在 bloom 之后叠加，
  // 不参与辉光：照片必须忠实，不能被辉光糊成一片白。
  const overlayScene = new THREE.Scene();
  overlayScene.add(photos.group);

  /* ── 层级相机（L0 ↔ L1 ↔ L2，带阻尼与 L2 锁定回弹） ── */
  const rig: LayerRig = createLayerRig(
    RIVER.windowWidth,
    RIVER.camera.widthFill,
    RIVER.camera.fov,
  );

  // 外部改 focusedId（点缩略图 / 回车 / 捏合确认）→ 把那一张吸附到正中间
  /**
   * 外部改 focusedId（点缩略图 / 回车 / 手势确认）→ 把那一张吸附到正中。
   *
   * ⚠️ 必须排除"自动焦点自己写进去"的情况：否则会形成
   *   自动焦点 → 写 store → 订阅吸附 → 暂停自动焦点 900ms
   * 的反馈环，导致高亮停在旧那张、而居中的是另一张（真机反馈的"不在正中间"）。
   */
  const unsubscribeFocus = useRiverStore.subscribe((state, previous) => {
    if (state.focusedId === previous.focusedId || !state.focusedId) return;
    if (autoFocusGuard) {
      autoFocusGuard = false;
      return;
    }
    const photo = state.photos.find((item) => item.id === state.focusedId);
    if (!photo) return;
    if (Math.abs(photo.x - scrollX) > PHOTO.spacing * 0.4) {
      snapTarget = photo.x;
      autoFocusPausedUntil = performance.now() + 900;
    }
  });

  /**
   * 渲染循环把"连续进度"派生成离散层时用的标记
   *
   * ⚠️ 这是 L1↔L2 抖动的根因：连续张手缩放到进度 1.5 时，渲染循环会把 store.layer
   * 写成 L2 → 下面的订阅立刻 `holdProgress(2, 1300)` 把目标钉死在 2；
   * 手稍微收回一点又变 L1 → 目标被拉回 1。于是 1.5 边界上目标来回拉锯，
   * 画面在 L1↔L2 之间反复"泵"。
   * 现在派生出来的层级变化**不再驱动 rig / 不再上锁**，只用于 HUD 显示。
   */
  let derivedLayerSync = false;

  // UI（缩略图 / 捏合 / 握拳 / 滚轮）改 store.layer 时，才驱动相机装配体
  const unsubscribeLayer = useRiverStore.subscribe((state, previous) => {
    if (state.layer === previous.layer) return;
    if (derivedLayerSync) return;
    if (state.layer === 'L2') {
      // 真实确认聚焦：推到 L2 并锁一小会儿，否则张着的手立刻把画面拉回去
      rig.holdProgress(2, PHOTO.focusHoldMs);
    } else if (state.layer !== rig.layer) {
      rig.setLayer(state.layer);
    }
  });

  /* ── 后处理 ── */
  let bloomEnabled = profile.bloom;
  let postfx: PostFX = createPostFX(renderer, scene, camera, {
    bloom: profile.bloom,
    bloomScale: profile.bloomScale,
    overlayScene,
  });

  /* ── 取景：按视口比例解算相机距离，保证横向撑满、垂直居中 ── */
  let baseDistance: number = RIVER.camera.distance;

  /**
   * 世界尺寸 → 像素 的投影系数（用于高斯泼溅的斑块尺寸）：
   * px = projScale * worldSize / 距离
   * = (视口像素高 / 2) × projectionMatrix[5]
   */
  let projScale = 1000;

  function frameRibbon(): void {
    const aspect = Math.max(camera.aspect, 0.2);
    const vFov = THREE.MathUtils.degToRad(RIVER.camera.fov);
    const requiredWidth = RIVER.windowWidth / Math.max(RIVER.camera.widthFill, 0.2);
    const distForWidth = requiredWidth / (2 * Math.tan(vFov / 2) * aspect);
    baseDistance = Math.min(Math.max(distForWidth, RIVER.camera.distance), 400);
    // 相机位姿交给 rig（它会保持当前层级，不会因为 resize 而跳回 L0）
    rig.snap(camera, camera.aspect);
    // 星尘天球跟随相机 → 任何视口下星星的大小与密度都稳定
    starDust.position.set(0, camera.position.y, camera.position.z * 0.9);
  }

  /* ── 尺寸 ── */
  function sizeFor(width: number, height: number, pixelRatio: number): void {
    renderer.setPixelRatio(pixelRatio);
    // updateStyle = true：把 CSS 尺寸也写成 width/height 像素，
    // 保证 canvas 的布局尺寸与摄像机 aspect 用的是同一组数（DPR 2 下尤其重要）
    renderer.setSize(width, height, true);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    frameRibbon();
    postfx.setSize(width, height, pixelRatio);
    cosmos.setResolution(width * pixelRatio, height * pixelRatio);
    river.setDpr(pixelRatio);
    // 泼溅尺寸要跟着视口像素高与 fov 走，否则不同屏幕上斑块大小会不一致
    projScale = camera.projectionMatrix.elements[5]! * height * pixelRatio * 0.5;
  }

  function resize(): void {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    // 容器尚未完成布局时不要用坏数据去解相机取景（会算出极端距离 → 画面偏小/偏移）
    if (width < 2 || height < 2) return;
    sizeFor(width, height, profile.dprCap);
  }

  /** 拖到另一块屏幕时 devicePixelRatio 会变，需要重新解像素比与取景 */
  function onWindowResize(): void {
    const deviceDpr = window.devicePixelRatio || 1;
    profile = profileFor(profile.tier, deviceDpr);
    resize();
  }

  /** 应用一个 LOD 档位：不重建 buffer，只改变绘制量与像素比 */
  function applyProfile(next: LodProfile, deviceDpr: number): void {
    const previous = profile;
    profile = profileFor(next.tier, deviceDpr);

    river.setActiveCount(Math.round(riverMaxCount * profile.ratio));
    river.setSizeScale(0.95 + 0.1 * profile.ratio);
    // 亮度补偿只作用于粒子/星尘，绝不改全局曝光 —— 照片必须保持忠实
    river.setBrightness(profile.brightnessBoost * profile.exposureBoost);
    renderer.toneMappingExposure = PALETTE.glow.exposure;
    starDust.geometry.setDrawRange(0, Math.max(1, Math.round(starMaxCount * profile.starRatio)));

    if (profile.bloom !== bloomEnabled) {
      // bloom 开关变化才重建 composer（罕见事件，代价可以接受）
      postfx.dispose();
      bloomEnabled = profile.bloom;
      postfx = createPostFX(renderer, scene, camera, {
        bloom: profile.bloom,
        bloomScale: profile.bloomScale,
        overlayScene,
      });
      resize();
    }

    if (previous.tier !== profile.tier) pushTelemetry();
  }

  /* ── 交互：点/拖丝带 → 涟漪（阶段 2 由手势驱动同一套 API） ── */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  const lastSpawn = new THREE.Vector2(Number.POSITIVE_INFINITY, 0);

  /** 屏幕坐标 → 丝带所在平面（z ≈ 0）上的世界坐标 */
  function pointerToRibbon(event: PointerEvent): { x: number; y: number } | null {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(PLANE_Z0, hitPoint);
    if (!hit) return null;
    // 命中的世界坐标直接可用（长河是无线的，不需要区间判断）
    return { x: hit.x, y: hit.y };
  }

  function spawnRippleAt(x: number, y: number, strength: number = RIPPLE.strength): void {
    ripples.spawn(x, y, waveZAtX(x), { emotion: emotionNearX(x), strength });
    lastSpawn.set(x, y);
  }

  /* ── 鼠标/键盘降级（规格模块四）──
     · 悬停 = 高亮（写 store.hoveredId，覆盖层画环）
     · 拖拽 = 拨动长河（带惯性，等价于手势的横向拨动）
     · 点击照片 = 确认进入；点击空处 = 涟漪反馈
     · 滚轮 = 缩放（onWheel）
  */
  let pointerDownAt: { x: number; y: number; t: number } | null = null;
  let dragging = false;

  function normalizedPoint(event: PointerEvent): { x: number; y: number } {
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / Math.max(rect.width, 1),
      y: (event.clientY - rect.top) / Math.max(rect.height, 1),
    };
  }


  function onPointerDown(event: PointerEvent): void {
    pointerDownAt = { x: event.clientX, y: event.clientY, t: performance.now() };
    dragging = false;
    // 指针移出 canvas 后仍能收到 pointerup —— 否则拖拽状态会卡住。
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // 某些浏览器/合成事件不支持捕获，忽略即可
    }

    const photoId = pickPhotoAt(event);
    if (photoId) {
      // 点击 = 确认进入（规格）
      const state = useRiverStore.getState();
      state.focusPhoto(photoId);
      if (rig.layer !== 'L2') {
        state.setLayer('L2');
        rig.setLayer('L2');
      }
      pointerDownAt = null;
      return;
    }
    const point = pointerToRibbon(event);
    if (point) spawnRippleAt(point.x, point.y);
  }

  function onPointerMove(event: PointerEvent): void {
    // 悬停高亮（无按键时）
    if (event.buttons === 0) {
      const norm = normalizedPoint(event);
      const hovered = stageBridge.pick(norm.x, norm.y);
      useRiverStore.getState().setHovered(hovered);
      const ring = hovered ? stageBridge.project(hovered) : null;
      liveGesture.ring = ring;
      liveGesture.progress = 0;
      return;
    }

    // 拖拽 = 拨动长河
    const dx = event.movementX / Math.max(renderer.domElement.clientWidth, 1);
    if (!dragging && pointerDownAt) {
      const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
      if (moved < INPUT.pointer.dragStartThresholdPx) return;
      dragging = true;
    }
    if (dragging) {
      panByDrag(dx);
      const point = pointerToRibbon(event);
      if (point && Math.hypot(point.x - lastSpawn.x, point.y - lastSpawn.y) > RIPPLE.dragSpawnDistance) {
        spawnRippleAt(point.x, point.y, RIPPLE.strength * 0.7);
      }
    }
  }

  function onPointerUp(): void {
    pointerDownAt = null;
    dragging = false;
  }

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  /* ── 滚轮：L0 → L1 → L2（阶段 2 用鼠标替代手势） ── */
  let lastWheelAt = 0;
  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheelAt < 30) return; // 触控板高频事件合并
    lastWheelAt = now;
    // deltaY < 0 = 向上 = 放大
    rig.nudge(event.deltaY < 0 ? 1 : -1);
    syncLayerFromRig();
  }
  canvas.addEventListener('wheel', onWheel, { passive: false });

  /* ── 键盘：↑/W 放大，↓/S 与 Esc 缩小，Enter 聚焦最近的照片 ── */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // 正在对话里打字：一切层级快捷键都要让路（否则空格/回车会拨动长河）
    if (isTextEntry(event.target)) return;
    // 对话打开时：空格 = 按住说话、Esc = 返回，都由对话层接管
    if (useRiverStore.getState().dialogOpen) {
      if (event.code === 'Space' || event.code === 'Escape') return;
    }
    if (INPUT.keyboard.zoomIn.includes(event.code)) {
      rig.nudge(1);
      syncLayerFromRig();
      event.preventDefault();
    } else if (INPUT.keyboard.zoomOut.includes(event.code) || INPUT.keyboard.back.includes(event.code)) {
      rig.nudge(-1);
      syncLayerFromRig();
      event.preventDefault();
    } else if (INPUT.keyboard.confirm.includes(event.code)) {
      focusNearestPhoto();
      event.preventDefault();
    }
  }
  window.addEventListener('keydown', onKeyDown);

  /** rig 的目标层 → store（HUD 与其它 UI 都读 store） */
  function syncLayerFromRig(): void {
    const state = useRiverStore.getState();
    if (state.layer !== rig.layer) state.setLayer(rig.layer);
  }

  /** 点选照片（L1 时点击照片平面即可聚焦） */
  const pickRaycaster = new THREE.Raycaster();
  function pickPhotoAt(event: PointerEvent): string | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    pickRaycaster.setFromCamera(ndc, camera);
    const planes = [...photos.group.children]
      .flatMap((child) => child.children)
      .filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh === true);
    const hits = pickRaycaster.intersectObjects(planes, false);
    const hit = hits.find((item) => item.object.name.startsWith('photoPlane:'));
    if (!hit) return null;
    return hit.object.name.replace('photoPlane:', '');
  }

  /* ── 拨盘滚动（无限长河）──────────────────────────────────────
     拨动 → 惯性滑行 → 停手后自动吸附到最近的一张照片（Snap）。
     scrollX = 相机在长河上的世界坐标（可以是任意大的数，长河是无线的）。 */
  let scrollX = 0;
  let scrollVel = 0;
  let snapTarget: number | null = null;
  let lastPanAt = 0;
  /** 最近一次长河真实运动的时间：用于滑动后 180ms 的缩放冻结尾段 */
  let lastScrollMotionAt = 0;
  let lastRippleX = -Infinity;
  /** 上一帧长河是否已经停稳（用于"停稳瞬间强制对齐焦点"） */
  let scrollSettled = true;
  /** 自动焦点短暂暂停（用户主动选了别的照片时，先让它吸附过去） */
  let autoFocusPausedUntil = 0;
  /** 自动焦点自己写 store 时置位，供订阅判断"这次不是外部操作" */
  let autoFocusGuard = false;
  function autoFocusPaused(): boolean {
    return performance.now() < autoFocusPausedUntil;
  }

  /** 把焦点同步到"离正中最近的那张"；返回当前焦点 id */
  function syncFocusFromScroll(force = false): string | null {
    const photos = useRiverStore.getState().photos;
    if (photos.length === 0) return null;
    const index = Math.min(Math.max(indexFromX(scrollX), 0), photos.length - 1);
    const nearest = photos[index];
    if (!nearest) return null;
    const state = useRiverStore.getState();
    if (nearest.id !== state.focusedId && (force || !autoFocusPaused())) {
      autoFocusGuard = true;
      useRiverStore.setState({ focusedId: nearest.id });
    }
    return nearest.id;
  }

  /** 一屏宽度对应多少世界单位（把"屏幕速度"换算成世界速度） */
  function worldPerScreen(): number {
    const vFov = (RIVER.camera.fov * Math.PI) / 180;
    return 2 * baseDistance * Math.tan(vFov / 2) * Math.max(camera.aspect, 0.2);
  }

  /**
   * 扇风冲量（核心一）
   *
   * 不再用"裸冲量 × 任意系数"，而是直接按**滚几张**算：
   *   photos = clamp(|v| × photosPerSpeed, minPhotos, maxPhotos)
   * 惯性滑行距离 ≈ 初速度 / 衰减率，所以反推初速度 = 距离 × 衰减率。
   *
   * 这样"扇一下至少滚一张"，永远不会出现"拨了没动"；
   * 扇得越猛最多滚 3 张，手感线性可控。
   */
  function flickImpulse(vScreenPerSec: number): void {
    const { photosPerSpeed, minPhotos, maxPhotos } = GESTURE.flick;
    const photos = Math.min(
      Math.max(Math.abs(vScreenPerSec) * photosPerSpeed, minPhotos),
      maxPhotos,
    );
    const distance = photos * PHOTO.spacing * Math.sign(-vScreenPerSec || -1);
    scrollVel = distance * SCROLL.inertiaDecayPerSec;
    snapTarget = null;
    lastPanAt = performance.now();
    lastScrollMotionAt = lastPanAt;
  }

  /** 鼠标拖拽：dxScreen 为屏幕宽度比例（直接位移） */
  function panByDrag(dxScreen: number): void {
    scrollX -= dxScreen * worldPerScreen();
    scrollVel = 0;
    snapTarget = null;
    lastPanAt = performance.now();
    lastScrollMotionAt = lastPanAt;
  }

  /** 吸附目标：离当前位置最近的那张照片 */
  function nearestSnapTarget(): number {
    const photos = useRiverStore.getState().photos;
    if (photos.length === 0) return scrollX;
    const index = Math.min(Math.max(indexFromX(scrollX), 0), photos.length - 1);
    return photoXForIndex(index);
  }

  /**
   * 空闲预热
   *
   * 一张 8 万粒子的点云要采 ~6ms。如果等扇动到它时才建，那一帧就少 6ms 预算。
   * 所以导入之后、手停下来的时候，用 `requestIdleCallback` 一张一张先采好。
   * 用户永远只在高帧预算的空闲时间里付出这个成本。
   */
  let prewarmScheduled = false;
  let prewarmIdleAt = 0;
  function schedulePrewarm(list: { id: string; x: number }[], nowMs: number): void {
    if (prewarmScheduled) return;
    // 手刚动过就别抢时间（滚动/缩放期间一律不预热）
    if (nowMs - lastPanAt < 350) return;
    if (snapTarget !== null || Math.abs(scrollVel) > SCROLL.stopVelocity) return;
    if (nowMs - prewarmIdleAt < 200) return;
    prewarmScheduled = true;
    const run = () => {
      prewarmScheduled = false;
      prewarmIdleAt = performance.now();
      const remaining = photos.prewarm(useRiverStore.getState().photos, profile.ratio);
      if (remaining > 0 && !disposed) schedulePrewarm(list, performance.now());
    };
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (idle) idle(run, { timeout: 800 });
    else window.setTimeout(run, 160);
  }

  function updateScroll(dt: number): void {
    const photos = useRiverStore.getState().photos;
    const now = performance.now();

    if (snapTarget !== null) {
      // 弹簧吸附（临界阻尼附近最稳）
      const accel = (snapTarget - scrollX) * SCROLL.snapStiffness - scrollVel * SCROLL.snapDamping;
      scrollVel += accel * dt;
      scrollX += scrollVel * dt;
      if (Math.abs(snapTarget - scrollX) < SCROLL.snapEpsilon && Math.abs(scrollVel) < 0.05) {
        scrollX = snapTarget;
        scrollVel = 0;
        snapTarget = null;
      }
    } else {
      // 惯性滑行
      scrollVel *= Math.exp(-SCROLL.inertiaDecayPerSec * dt);
      if (Math.abs(scrollVel) < SCROLL.stopVelocity * 0.05) scrollVel = 0;
      scrollX += scrollVel * dt;

      // 停手一段时间后开始吸附（让余量滑完，手感更顺）
      if (Math.abs(scrollVel) < SCROLL.stopVelocity && now - lastPanAt > SCROLL.snapDelayMs) {
        snapTarget = nearestSnapTarget();
      }
    }

    // 两端橡皮筋：可以越过一点，但会被拉回来
    const clamped = clampScroll(scrollX, photos.length);
    if (clamped !== scrollX) {
      scrollX = clamped + (scrollX - clamped) * 0.35;
      scrollVel *= 0.4;
    }

    // 深度聚焦时把滚动拉回当前照片（避免照片被滚出画面）。
    // 门槛从 1.3 提到 1.75：太早回中会让"张开手掌推到 L2"的过程中照片横向漂移。
    const recenter = THREE.MathUtils.smoothstep(rig.progress, 1.75, 2);
    if (recenter > 0) {
      const focusX = nearestSnapTarget();
      if (Math.abs(focusX - scrollX) > 0.05) {
        scrollX += (focusX - scrollX) * Math.min(recenter * dt * 1.8, 1);
        scrollVel *= 1 - Math.min(recenter * dt * 1.8, 1);
      }
    }

    // 停稳后强制把焦点对齐到居中这张：保证"高亮的"永远就是"正中间的那张"
    const settled = snapTarget === null && Math.abs(scrollVel) < SCROLL.stopVelocity * 0.15;
    const wasSettled = scrollSettled;
    scrollSettled = settled;
    if (settled && !wasSettled) {
      syncFocusFromScroll(true);
    }

    /*
     * 滑动/惯性/吸附期间（以及停稳后 180ms）发布 scrollActive。
     * 手势状态机会据此冻结连续缩放 —— 滑动就是滑动，不能顺带把画面推近/拉远。
     * 只在状态变化时写 store，避免每帧触发 React。
     */
    // 注意：吸附完成后 snapTarget 可能在下一帧又被设成"当前位置"，
    // 所以不能只看 snapTarget !== null，否则会永远冻结缩放。
    // 这里看真实位移与速度：只有还在移动/追赶目标才算 scrollActive。
    const snapDistance = snapTarget === null ? 0 : Math.abs(snapTarget - scrollX);
    const moving =
      photos.length > 0 &&
      (Math.abs(scrollVel) > SCROLL.stopVelocity || snapDistance > SCROLL.snapEpsilon);
    if (moving) lastScrollMotionAt = now;
    const scrollActive =
      moving || now - lastScrollMotionAt < GESTURE.flick.zoomFreezeAfterScrollMs;
    const riverState = useRiverStore.getState();
    if (riverState.isSwiping !== scrollActive) {
      riverState.setSwiping(scrollActive, scrollVel);
    }

    rig.setScroll(scrollX);
    river.setScroll(scrollX);
  }

  /** Enter / 拾取不到时：聚焦离画面中心最近的照片 */
  function focusNearestPhoto(): void {
    const state = useRiverStore.getState();
    if (state.photos.length === 0) return;
    const index = Math.min(Math.max(indexFromX(scrollX), 0), state.photos.length - 1);
    const best = state.photos[index];
    if (!best) return;
    state.focusPhoto(best.id);
    // 顺手吸附过去：按下回车 = "把这张拨到正中间"
    snapTarget = best.x;
    if (rig.layer === 'L0') {
      rig.nudge(1);
      syncLayerFromRig();
    }
  }

  /* ── 自动涟漪：没交互时带子也要活 ── */
  let ambientAtMs = performance.now() + RIPPLE.ambient.intervalMs;
  function scheduleAmbient(nowMs: number): void {
    ambientAtMs = nowMs + RIPPLE.ambient.intervalMs + Math.random() * RIPPLE.ambient.jitterMs;
  }

  function maybeAmbientRipple(nowMs: number): void {
    if (!RIPPLE.ambient.enabled || respectReducedMotion) return;
    // 聚焦到一张照片时停掉自动涟漪：光环不做深度测试，会直接盖在照片上
    if (rig.progress > 1.15) return;
    if (nowMs < ambientAtMs) return;
    const x = scrollX + (Math.random() - 0.5) * RIVER.windowWidth * 0.6;
    const { y } = pointOnRiverX(x);
    ripples.spawn(x, y, waveZAtX(x), {
      emotion: emotionNearX(x),
      strength: RIPPLE.strength * RIPPLE.ambient.strengthScale,
    });
    scheduleAmbient(nowMs);
  }

  /**
   * 聚焦相关的视觉量：照片组装度 + 河体退场 + 清场区
   * 抽成函数是为了让 jumpToLayer 与主循环共用同一套公式。
   */
  function applyFocusVisuals(
    layerProgress: number,
    focused: { x: number; id: string } | undefined,
    dt: number,
    instant: boolean,
    shatter = 0,
  ): void {
    // L0 → L1 → L2 三档之间做平滑插值（每档的成型度与不透明度都来自 config）
    const s1 = THREE.MathUtils.smoothstep(layerProgress, 0, 1);
    const s2 = THREE.MathUtils.smoothstep(layerProgress, 1, 2);
    type StageVisuals = { assemble: number; particleOpacity: number; planeOpacity: number };
    const lerpStage = (pick: (stage: StageVisuals) => number): number =>
      THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(pick(PHOTO.stages.l0), pick(PHOTO.stages.l1), s1),
        pick(PHOTO.stages.l2),
        s2,
      );

    // 缩放过程中按速度打散：往回收时照片真的碎成粒子飞回河里，松手后再聚拢
    const shatterK = Math.min(Math.max(shatter, 0), 1);
    // 占位提醒：assemble 只表示层级状态，碎裂由 shatter 单独表达（逐颗粒子剥落）
    const assembleTarget = lerpStage((stage) => stage.assemble);
    const particleOpacity = THREE.MathUtils.lerp(
      lerpStage((stage) => stage.particleOpacity),
      PHOTO.shatter.particleBoost,
      shatterK,
    );
    const planeOpacity = lerpStage((stage) => stage.planeOpacity) * (1 - shatterK);

    lastVisuals.assemble = assembleTarget;
    lastVisuals.particleOpacity = particleOpacity;
    lastVisuals.planeOpacity = planeOpacity;

    lastFade.clear();
    lastFadeMeta = {
      layerProgress: Number(layerProgress.toFixed(3)),
      focusedX: focused ? Number(focused.x.toFixed(2)) : null,
      fadeStart: Number(THREE.MathUtils.lerp(PHOTO.focusFade.l1.start, PHOTO.focusFade.l2.start, s2).toFixed(2)),
      fadeEnd: Number(THREE.MathUtils.lerp(PHOTO.focusFade.l1.end, PHOTO.focusFade.l2.end, s2).toFixed(2)),
    };
    for (const node of photos.nodes.values()) {
      const current = instant
        ? assembleTarget
        : node.assemble +
          (assembleTarget - node.assemble) * (1 - Math.exp(-(1000 / PHOTO.assembleMs) * dt));

      // 只画焦点附近的那几张：相机贴得很近时，邻居都在屏幕外，
      // 却仍要画 3.6 万颗泼溅 —— 纯填充率浪费，是切照片卡顿的大头。
      let nearFade = 1;
      if (focused) {
        const distanceInPhotos = Math.abs(node.x - focused.x) / PHOTO.spacing;
        const fadeStart = THREE.MathUtils.lerp(
          PHOTO.focusFade.l1.start,
          PHOTO.focusFade.l2.start,
          s2,
        );
        const fadeEnd = THREE.MathUtils.lerp(
          PHOTO.focusFade.l1.end,
          PHOTO.focusFade.l2.end,
          s2,
        );
        nearFade = 1 - THREE.MathUtils.smoothstep(distanceInPhotos, fadeStart, fadeEnd);
      }

      node.setVisuals(
        current,
        particleOpacity * nearFade,
        planeOpacity * nearFade,
        shatterK,
        1 + (PHOTO.shatter.sizeBoost - 1) * shatterK,
      );
      // L0 完全隐形（保持"只看光带"）；聚焦的那张优先级最高
      const revealed = layerProgress > PHOTO.revealAtProgress;
      node.group.visible =
        revealed && nearFade > 0.002 && (node.id === focused?.id || layerProgress > 0.55);
      node.group.renderOrder = node.id === focused?.id ? 3 : 0;
      lastFade.set(node.id, { x: Number(node.x.toFixed(2)), nearFade: Number(nearFade.toFixed(3)) });
    }

    // L2 沉浸：背景必须极度纯黑，照片才像"悬浮在自己的一段记忆里"。
    // 河体/星尘/星云一起退到近乎零，只留照片自己的辉光。
    const dim = THREE.MathUtils.smoothstep(layerProgress, 0.6, 2);
    const deep = dim * dim;
    river.setOpacity(1 - 0.985 * deep);
    river.setBrightness(profile.brightnessBoost * (1 - 0.85 * deep));
    starDust.geometry.setDrawRange(
      0,
      Math.max(1, Math.round(starMaxCount * profile.starRatio * (1 - 0.97 * deep))),
    );
    cosmos.setDim(deep);
    river.setClearZone(focused ? focused.x : 0, PHOTO.spacing * 0.55, dim);
  }

  /* ── 对话面板让位（阶段 4） ──────────────────────────────────────
   * 面板从右侧滑出时，照片必须还在画面里 —— 与其移动世界，不如偏一下投影：
   * `camera.setViewOffset` 只平移视锥中心，不改 fov / aspect，
   * 所以 projScale（高斯泼溅的像素尺寸）完全不受影响。
   */
  let chatInset = 0;
  let appliedInsetX = 0;
  let appliedInsetY = 0;

  function applyChatInset(dt: number): void {
    const state = useRiverStore.getState();
    // 只在照片真正"站好了"之后才让位，避免缩放过程中画面横移
    // 只在**基本到位**（1.9）之后才让位：否则张开推 L2 的过程中照片会突然上移一下
    const wantsRoom = state.dialogOpen && rig.progress > 1.9;
    const rate = Math.min((1000 / Math.max(AI.ui.entranceMs, 1)) * dt, 1);
    chatInset += ((wantsRoom ? 1 : 0) - chatInset) * rate;
    if (chatInset < 0.001) chatInset = 0;

    const cssWidth = canvas.clientWidth || window.innerWidth;
    const cssHeight = canvas.clientHeight || window.innerHeight;

    // 台词浮在周围、胶囊在底部 → 照片整体上移一点，底部的字与按钮才有干净的落点。
    // 只动纵向：横向不再需要让位（没有面板挡着了），照片保持正中。
    const targetX = 0;
    const targetY = ((cssHeight * AI.ui.photoLiftVh) / 100) * chatInset;

    if (Math.abs(targetX - appliedInsetX) < 0.5 && Math.abs(targetY - appliedInsetY) < 0.5) {
      return;
    }
    appliedInsetX = targetX;
    appliedInsetY = targetY;

    if (targetX < 0.5 && targetY < 0.5) {
      camera.clearViewOffset();
    } else {
      // offsetX 为正 = 视锥右移 = 主体在屏幕上左移
      camera.setViewOffset(cssWidth, cssHeight, targetX, targetY, cssWidth, cssHeight);
    }
  }

  /* ── 手势桥：命中检测 / 投影 / 拨动（引擎不依赖 scene 实现） ── */
  stageBridge.pick = (xNorm, yNorm) => {
    ndc.set(xNorm * 2 - 1, -(yNorm * 2 - 1));
    pickRaycaster.setFromCamera(ndc, camera);
    const planes = [...photos.group.children]
      .flatMap((child) => child.children)
      .filter((child): child is THREE.Mesh => (child as THREE.Mesh).isMesh === true);
    const hits = pickRaycaster.intersectObjects(planes, false);
    const hit = hits.find((item) => item.object.name.startsWith('photoPlane:'));
    if (!hit) return null;
    // L0 只看得见长河，不做选中
    if (rig.progress < 0.35) return null;
    return hit.object.name.replace('photoPlane:', '');
  };

  stageBridge.project = (id) => {
    const photo = useRiverStore.getState().photos.find((item) => item.id === id);
    if (!photo) return null;
    const center = photoWorldAtX(photo.x);
    const half = PHOTO.planeHeight * 0.5;
    const top = center.clone().add(new THREE.Vector3(0, half, 0)).project(camera);
    const bottom = center.clone().add(new THREE.Vector3(0, -half, 0)).project(camera);
    const ndcCenter = center.clone().project(camera);
    if (!Number.isFinite(ndcCenter.x)) return null;
    const radius = Math.abs(top.y - bottom.y) * 0.5 * 0.72;
    return {
      x: (ndcCenter.x + 1) / 2,
      y: (1 - ndcCenter.y) / 2,
      radius,
    };
  };

  /**
   * 手势缩放入口
   *
   * ⚠️ 这个函数**每帧**都会被手势引擎调用一次（无论用户是否在缩放）。
   * 所以这里绝对不能有任何"副作用式"的逻辑：
   *   之前加过 `if (scrollVel > …) { scrollVel = 0 }`（想顺手停住残留滚动），
   *   结果扇风的惯性每帧都被它清零 —— 滑动直接废掉（真机反馈"滑动又出问题了"）。
   * 结论：缩放只做一件事 —— 把目标交给 rig。
   * "滑动时别顺手缩放"由 scrollActive → 状态机冻结负责，滚动与缩放互不干涉。
   */
  stageBridge.zoom = (progressTarget) => {
    rig.setProgressTarget(progressTarget);
  };

  stageBridge.lock = (locked) => {
    if (!locked) return;
    // 锁定瞬间停止惯性，并把当前最近的照片吸附到正中
    scrollVel = 0;
    snapTarget = null;
    scrollX = nearestSnapTarget();
    syncFocusFromScroll(true);
    autoFocusPausedUntil = performance.now() + 600;
  };

  stageBridge.swipe = (velocityScreenPerSec) => {
    // 扇风冲量：位移只取决于甩得多快，不跟随手的位置
    // 扇风切图在 L2 也生效：聊天时用扇风换记忆是主要操作（不再依赖按钮）
    flickImpulse(velocityScreenPerSec);
    // 拨动时在滚动位置附近激起涟漪（随拨动间距节流）
    if (Math.abs(scrollX - lastRippleX) < SCROLL.rippleStep) return;
    lastRippleX = scrollX;
    const point = pointOnRiverX(scrollX);
    ripples.spawn(point.x, point.y, point.z, {
      emotion: emotionNearX(point.x),
      strength: RIPPLE.strength * 0.5,
    });
  };

  /* ── 遥测（scene → store，唯一允许的反向写入，仅用于 HUD 显示） ── */
  /** 上一帧的装配度快照：新建/重建的照片节点直接继承，避免闪一下 */
  const lastVisuals = { assemble: 0, particleOpacity: 0, planeOpacity: 0 };

  let telemetryAtMs = 0;
  function pushTelemetry(): void {
    useRiverStore.getState().setTelemetry({
      tier: profile.tier,
      particles: river.activeCount,
      bloom: bloomEnabled,
    });
  }

  /* ── 主循环 ── */
  // Timer 取代已弃用的 Clock：同一帧多次读 delta 不变值，并借 Page Visibility API
  // 避免切标签页回来时的巨大跳变。
  const timer = new THREE.Timer();
  timer.connect(document);
  const monitor = createFpsMonitor(initialTier);
  let frame = 0;
  let disposed = false;
  let elapsed = 0;
  /** 上一帧的层级进度，用来算缩放速度（决定碎裂强度） */
  let previousProgress = 0;
  /** 诊断：上一帧算出来的焦点距离淡出因子 */
  const lastFade = new Map<string, { x: number; nearFade: number }>();
  let lastFadeMeta: Record<string, unknown> = {};
  /** 当前碎裂强度（诊断用） */
  let lastShatter = 0;
  /** DEV：?shatter=0.8 强行固定碎裂强度，便于无头验证 */
  const forcedShatter = import.meta.env.DEV
    ? Number(new URLSearchParams(window.location.search).get('shatter') ?? Number.NaN)
    : Number.NaN;

  // 启动时先按档位设定一次绘制量与亮度补偿
  river.setActiveCount(Math.round(riverMaxCount * profile.ratio));
  river.setSizeScale(0.95 + 0.1 * profile.ratio);
  river.setBrightness(profile.brightnessBoost * profile.exposureBoost);
  renderer.toneMappingExposure = PALETTE.glow.exposure;
  starDust.geometry.setDrawRange(0, Math.max(1, Math.round(starMaxCount * profile.starRatio)));

  const glow = PALETTE.glow;
  const cam = RIVER.camera;

  function render(): void {
    if (disposed) return;
    frame = requestAnimationFrame(render);

    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    if (!respectReducedMotion) elapsed += dt;
    const nowMs = performance.now();

    // ① 时间推进（GPU 侧全部由它驱动）
    cosmos.setTime(elapsed);
    if (!respectReducedMotion) river.setTime(elapsed);

    // ② 涟漪：视觉环 + 粒子波前槽位
    ripples.update(nowMs);
    maybeAmbientRipple(nowMs);

    // ②b 照片：store → 节点同步；相机装配体推进；组装度按层级插值
    const riverState = useRiverStore.getState();

    // 音乐驱动：只读能量，未播放时全 0（画面回到纯静态参数）
    const musicEnergy = getMusicEngine().energy();
    river.setMusicEnergy(musicEnergy);

    photos.sync(riverState.photos, lastVisuals, profile.ratio, scrollX);
    schedulePrewarm(riverState.photos, nowMs);

    // ★ 拨盘式焦点：离画面正中心最近的照片自动成为焦点（不需要点）
    syncFocusFromScroll();

    const focused = useRiverStore.getState().photos.find(
      (photo) => photo.id === useRiverStore.getState().focusedId,
    );
    rig.setFocus(
      focused ? photoWorldAtX(focused.x) : null,
      PHOTO.planeHeight,
    );

    updateScroll(dt);
    const layerProgress = rig.update(dt, camera, camera.aspect);
    applyChatInset(dt);

    // （已删除）"握拳就续锁 L2"的规则：它会把缩小也一起锁死，导致聊天时退不出去。
    // 确认后的短暂保护由 LayerRig 的 holdUntil 负责，且只作用于"想更近"。

    // ③④ 照片组装度 + 碎裂 + 河体退场 + 聚焦清场区
    const dim = THREE.MathUtils.smoothstep(layerProgress, 0.6, 2);
    // 层级变化速度 → 碎裂强度：起手/收尾慢、中段最快，正好对应"炸开"与"聚拢"。
    // 注意：层级"瞬移"（跳层/切层）不是缩放，不能触发碎裂 —— 否则会闪一帧全碎。
    const delta = Math.abs(layerProgress - previousProgress);
    const speed = delta > 0.3 ? 0 : delta / Math.max(dt, 1 / 240);
    previousProgress = layerProgress;
    const shatter = Number.isFinite(forcedShatter)
      ? forcedShatter
      : Math.min(speed * PHOTO.shatter.speedGain, PHOTO.shatter.max);
    // forcedShatter 存在时用瞬时应用：否则 dt 阻尼会让无头截图停在中间态
    lastShatter = shatter;
    applyFocusVisuals(layerProgress, focused, dt, Number.isFinite(forcedShatter), shatter);

    // ⑤ 相机呼吸：极慢的漂浮（L2 聚焦时几乎静止，别让照片晃）
    photos.tick(elapsed, projScale, camera);
    const driftScale = 1 - dim;
    camera.position.x += Math.sin(elapsed * cam.driftSpeed) * cam.driftX * driftScale * 0.01;
    camera.position.y += Math.sin(elapsed * cam.driftSpeed * 0.7) * cam.driftY * driftScale * 0.01;
    // 低频让镜头有极轻的呼吸，不抢照片的稳定感
    camera.position.y += musicEnergy.low * MUSIC.drive.lowToCameraBreath * driftScale;
    starDust.position.set(camera.position.x, camera.position.y, camera.position.z * 0.9);

    // ④ 辉光呼吸
    const pulse =
      1 +
      Math.sin((elapsed * 1000) / glow.breathingPeriodMs / 2) * glow.breathingAmplitude;
    postfx.setBloomStrength(
      glow.bloomStrength *
        profile.bloomScale *
        pulse *
        (1 + musicEnergy.low * MUSIC.drive.lowToBloom),
    );

    postfx.render(dt);

    // ③c 焦点环：只在照片真正可见的层级（L1/L2）画。
    //    L0 是纯粒子全景，照片还没显形，圈一个黄环会显得莫名其妙。
    if (liveGesture.progress <= 0.001) {
      const showRing = layerProgress > PHOTO.revealAtProgress + 0.06;
      const focusId = showRing ? useRiverStore.getState().focusedId : null;
      liveGesture.ring = focusId ? stageBridge.project(focusId) : null;
    }

    // ④b 连续缩放时同步离散层级（HUD 导轨、缩略图高亮都读 store.layer）
    const derivedLayer = (['L0', 'L1', 'L2'] as const)[
      Math.min(Math.max(Math.round(layerProgress), 0), 2)
    ];
    if (derivedLayer && useRiverStore.getState().layer !== derivedLayer) {
      // 打标记：这次变化是"连续缩放的副产物"，不是用户确认。
      // 除了 Stage 自己的订阅，手势引擎也订阅 store.layer —— 同步标记让两边都跳过。
      markDerivedLayerWrite();
      derivedLayerSync = true;
      useRiverStore.setState({ layer: derivedLayer });
      derivedLayerSync = false;
    }

    // ⑤ FPS 采样 → 必要时降档
    const sample = monitor.sample(dt);
    if (sample.changed) {
      const deviceDpr = window.devicePixelRatio || 1;
      applyProfile(profileFor(sample.tier, deviceDpr), deviceDpr);
    }

    // ⑥ HUD 遥测：4Hz 足够，别让 React 每帧重渲染
    if (nowMs - telemetryAtMs > 250) {
      telemetryAtMs = nowMs;
      useRiverStore.getState().setTelemetry({
        fps: Math.round(sample.fps),
        tier: profile.tier,
        particles: river.activeCount,
        bloom: bloomEnabled,
        layerProgress,
        photoCount: riverState.photos.length,
      });
    }
  }

  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  window.addEventListener('resize', onWindowResize);
  render();

  return {
    debugSweep(options) {
      const frames = options?.frames ?? 150;
      const velocity = options?.velocity ?? -1.8;
      const reset = options?.reset ?? true;

      /**
       * 跑一段"扇动 → 惯性 → 吸附"。
       *
       * 同时记录两件事：
       *  ① 墙钟耗时（真机上有效；无头虚拟时间下恒为 0）
       *  ② 工作量计数器（任何环境都有效）—— 关键是每帧新建了几个节点：
       *     0 = 这一帧不可能因为照片而卡；> 1 = 又回到了逐节点卡顿
       */
      const runOne = (): SweepStats & { builds: number; maxBuildsPerFrame: number } => {
        if (reset) this.debugScrollTo(0);
        const samples: number[] = [];
        let builds = 0;
        let maxBuildsPerFrame = 0;
        for (let i = 0; i < frames; i += 1) {
          // 每 40 帧补一记扇动，模拟连续扇风
          if (i % 40 === 0) flickImpulse(velocity);
          const before = photos.stats().builds;
          const t0 = performance.now();
          updateScroll(1 / 60);
          const state = useRiverStore.getState();
          photos.sync(state.photos, lastVisuals, profile.ratio, scrollX);
          syncFocusFromScroll();
          const focusedNow = state.photos.find(
            (photo) => photo.id === useRiverStore.getState().focusedId,
          );
          rig.setFocus(focusedNow ? photoWorldAtX(focusedNow.x) : null, PHOTO.planeHeight);
          const progress = rig.update(1 / 60, camera, camera.aspect);
          applyFocusVisuals(progress, focusedNow, 1 / 60, !!focusedNow, 0);
          photos.tick(elapsed, projScale, camera);
          samples.push(performance.now() - t0);

          const frameBuilds = photos.stats().builds - before;
          builds += frameBuilds;
          if (frameBuilds > maxBuildsPerFrame) maxBuildsPerFrame = frameBuilds;
        }
        return { ...summarize(samples), builds, maxBuildsPerFrame };
      };

      // warm = 第一次经过这些照片（要真建节点）；steady = 回程（全部命中缓存）
      const warm = runOne();
      const steady = runOne();
      const stats = photos.stats();
      return {
        warm,
        steady,
        photos: {
          nodes: stats.nodes,
          pending: stats.pending,
          builds: stats.builds,
          disposes: stats.disposes,
          sampled: stats.sampled,
          cacheHits: stats.cacheHits,
          cacheMisses: stats.cacheMisses,
        },
      };
    },

    debugScrollTo(x) {
      scrollX = x;
      scrollVel = 0;
      snapTarget = null;
      lastPanAt = performance.now() - SCROLL.snapDelayMs - 1;
      // 立刻跑一帧物理，让吸附/焦点/加载都对齐
      updateScroll(1 / 60);
      const state = useRiverStore.getState();
      if (state.photos.length > 0) {
        const index = Math.min(Math.max(indexFromX(scrollX), 0), state.photos.length - 1);
        const nearest = state.photos[index];
        if (nearest) useRiverStore.setState({ focusedId: nearest.id });
      }
      photos.sync(useRiverStore.getState().photos, lastVisuals, profile.ratio, scrollX);
      // 立刻把相机也对齐：无头环境里"跳转后可能没有帧再跑"，否则读到的是旧机位。
      // 注意 y/z/距离是低通过的，只跑一帧根本收敛不了 —— 必须同步步进几十帧，
      // 否则量到的"照片没在正中"是探针自己的假象。
      const now = useRiverStore.getState();
      const focusedNow = now.photos.find((photo) => photo.id === now.focusedId);
      rig.setFocus(focusedNow ? photoWorldAtX(focusedNow.x) : null, PHOTO.planeHeight);
      for (let i = 0; i < 60; i += 1) rig.update(1 / 60, camera, camera.aspect);
      applyChatInset(1);
      photos.tick(elapsed, projScale, camera);
      pushTelemetry();
    },

    debugFlickCheck(velocity) {
      const from = scrollX;
      flickImpulse(velocity);
      // 每帧：先像手势引擎那样推一次缩放目标（手是静止张开的 → 目标恒定），再跑滚动
      for (let i = 0; i < 18; i += 1) {
        stageBridge.zoom(2);
        updateScroll(1 / 60);
      }
      lastPanAt = 0;
      let snapStarted = false;
      for (let i = 0; i < 900; i += 1) {
        stageBridge.zoom(2);
        updateScroll(1 / 60);
        if (snapTarget !== null) snapStarted = true;
        else if (snapStarted) break;
      }
      const travel = Math.abs(scrollX - from);
      // 一记扇风至少要滚 ≥1 张照片的 60%
      const expected = PHOTO.spacing * 0.6;
      return {
        from: Number(from.toFixed(2)),
        to: Number(scrollX.toFixed(2)),
        expected: Number(expected.toFixed(2)),
        travel: Number(travel.toFixed(2)),
        pass: travel >= expected,
      };
    },

    debugDeriveLayer() {
      const progress = rig.progress;
      const derivedLayer = (['L0', 'L1', 'L2'] as const)[
        Math.min(Math.max(Math.round(progress), 0), 2)
      ];
      if (derivedLayer && useRiverStore.getState().layer !== derivedLayer) {
        markDerivedLayerWrite();
        derivedLayerSync = true;
        useRiverStore.setState({ layer: derivedLayer });
        derivedLayerSync = false;
      }
      return { layer: derivedLayer ?? 'L0', target: Number(rig.targetProgress.toFixed(2)) };
    },

    debugZoomSweep(from, to, frames = 120) {
      rig.snapLayer((['L0', 'L1', 'L2'] as const)[Math.min(Math.max(Math.round(from), 0), 2)] ?? 'L0');
      rig.update(1 / 60, camera, camera.aspect);
      const startX = camera.position.x;
      const startY = camera.position.y;
      let last = rig.progress;
      let maxStep = 0;
      let reversals = 0;
      let driftX = 0;
      let driftY = 0;
      const samples: number[] = [];

      for (let i = 0; i < frames; i += 1) {
        stageBridge.zoom(to);
        updateScroll(1 / 60);
        const p = rig.update(1 / 60, camera, camera.aspect);
        samples.push(Number(p.toFixed(3)));
        const step = Math.abs(p - last);
        if (step > maxStep) maxStep = step;
        const direction = to > last ? 1 : -1;
        if ((p - last) * direction < -1e-4) reversals += 1;
        last = p;
        driftX = Math.max(driftX, Math.abs(camera.position.x - startX));
        driftY = Math.max(driftY, Math.abs(camera.position.y - startY));
      }

      return {
        from,
        to,
        reached: Number(rig.progress.toFixed(3)),
        maxStep: Number(maxStep.toFixed(4)),
        reversals,
        driftX: Number(driftX.toFixed(3)),
        driftY: Number(driftY.toFixed(3)),
        samples: samples.filter((_, index) => index % 8 === 0),
      };
    },

    debugZoom(progress) {
      stageBridge.zoom(progress);
      return {
        dialogOpen: useRiverStore.getState().dialogOpen,
        target: Number(rig.targetProgress.toFixed(2)),
      };
    },

    debugScrollSim(velocityScreenPerSec) {
      const from = scrollX;
      flickImpulse(velocityScreenPerSec);

      // ① 惯性自由滑行约 0.3 秒（同步步进，不依赖真实时间）
      for (let i = 0; i < 18; i += 1) updateScroll(1 / 60);

      // ② 把"最后一次拨动时间"推到很久以前，让吸附立刻开始
      lastPanAt = 0;
      // 注意：要等吸附真正"开始过"再判断"结束"，否则第一帧就会误判
      let snapStarted = false;
      let snapped = false;
      for (let i = 0; i < 900; i += 1) {
        updateScroll(1 / 60);
        if (snapTarget !== null) snapStarted = true;
        else if (snapStarted) {
          snapped = true;
          break;
        }
      }
      const state = useRiverStore.getState();
      if (state.photos.length > 0) {
        const index = Math.min(Math.max(indexFromX(scrollX), 0), state.photos.length - 1);
        const nearest = state.photos[index];
        if (nearest) useRiverStore.setState({ focusedId: nearest.id });
      }
      photos.sync(useRiverStore.getState().photos, lastVisuals, profile.ratio, scrollX);
      return { from, to: scrollX, snapped };
    },

    jumpToLayer(layer, options) {
      // 顺序很关键：先同步照片 → 再告诉 rig 聚焦点 → 最后吸附
      photos.sync(useRiverStore.getState().photos, lastVisuals, profile.ratio, scrollX);
      const state = useRiverStore.getState();
      const focused = state.photos.find((photo) => photo.id === state.focusedId);
      rig.setFocus(focused ? photoWorldAtX(focused.x) : null, PHOTO.planeHeight);
      rig.snapLayer(layer);
      for (let i = 0; i < 30; i += 1) rig.update(1 / 60, camera, camera.aspect);
      // 无头环境里 dt≈0，插值永远收敛不了 → 探针路径直接推到位
      applyChatInset(1);
      applyFocusVisuals(rig.progress, focused, 1 / 60, true, options?.shatter ?? 0);
      photos.tick(elapsed, projScale, camera);
      pushTelemetry();
    },

    spawnRippleAtSlot(slot, offsetY = 0, strength = RIPPLE.strength) {
      const point = pointOnRiverX(photoXForIndex(Math.max(slot, 0)));
      ripples.spawn(point.x, point.y + offsetY, point.z, {
        emotion: emotionNearX(point.x),
        strength,
      });
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
      timer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      photos.dispose();
      // 模块级 LRU 缓存持有 THREE.Texture / 像素字节 / 点云数组，节点 dispose 不会释放它们。
      // 不在这里清掉，React StrictMode 二次挂载或页面切换都会留下整本相册的显存。
      disposePhotoAssets();
      unsubscribeLayer();
      unsubscribeFocus();

      ripples.dispose();
      river.dispose();
      starDust.geometry.dispose();
      (starDust.material as THREE.Material).dispose();
      cosmos.dispose();
      postfx.dispose();
      scene.clear();
      renderer.dispose();
      // 主动交还 WebGL 上下文：单页反复挂载/卸载时，仅 dispose 仍可能保留 GPU 资源。
      try {
        renderer.forceContextLoss();
      } catch {
        // 某些浏览器/上下文已丢失时忽略
      }
      renderer.domElement.remove();
    },

    debugInfo(): Record<string, unknown> {
      const canvasRect = canvas.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const mesh = river.group.children[0] as THREE.Points | undefined;
      const positionAttr = mesh?.geometry.getAttribute('position');

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      if (positionAttr) {
        for (let i = 0; i < positionAttr.count; i += 1) {
          const x = positionAttr.getX(i);
          const y = positionAttr.getY(i);
          const z = positionAttr.getZ(i);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }

      return {
        window: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        host: { w: hostRect.width, h: hostRect.height },
        canvas: {
          css: { w: canvasRect.width, h: canvasRect.height },
          style: { w: canvas.style.width, h: canvas.style.height },
          buffer: { w: canvas.width, h: canvas.height },
          offset: { x: canvasRect.left, y: canvasRect.top },
        },
        camera: {
          pos: camera.position.toArray(),
          lookAt: [0, 0, 0],
          fov: camera.fov,
          aspect: camera.aspect,
          near: camera.near,
          far: camera.far,
        },
        baseDistance,
        riverActive: river.activeCount,
        particleBounds: { minX, maxX, minY, maxY, minZ, maxZ },
        chat: {
          dialogOpen: useRiverStore.getState().dialogOpen,
          inset: { x: Number(appliedInsetX.toFixed(1)), y: Number(appliedInsetY.toFixed(1)) },
          panel: (() => {
            const node = document.querySelector('[data-chat-bar]');
            if (!(node instanceof HTMLElement)) return null;
            const rect = node.getBoundingClientRect();
            return {
              state: node.dataset.chatPanel,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              width: Math.round(rect.width),
            };
          })(),
        },
        focusFade: {
          meta: lastFadeMeta,
          nodes: [...lastFade.entries()].map(([id, v]) => ({ id: id.slice(-3), ...v })),
        },
        photos: {
          photoNodes: photos.group.children.length,
          lastShatter: Number(lastShatter.toFixed(3)),
          store: useRiverStore.getState().photos.length,
          nodes: photos.nodes.size,
          focused: useRiverStore.getState().focusedId,
          xs: useRiverStore.getState().photos.map((photo) => Number(photo.x.toFixed(2))),
          scrollX: Number(scrollX.toFixed(2)),
          detail: [...photos.nodes.values()].map((node) => ({
            ...node.debugState(),
            id: node.id,
            assemble: Number(node.assemble.toFixed(2)),
            visible: node.group.visible,
            pos: node.position.toArray().map((v) => Number(v.toFixed(2))),
            children: node.group.children.length,
          })),
        },
        rig: {
          layer: rig.layer,
          progress: Number(rig.progress.toFixed(2)),
          target: Number(rig.targetProgress.toFixed(2)),
        },
        ring: {
          visible: liveGesture.ring !== null,
          layerProgress: Number(rig.progress.toFixed(2)),
        },
        focusProjection: (() => {
          const id = useRiverStore.getState().focusedId;
          const proj = id ? stageBridge.project(id) : null;
          return proj
            ? { x: Number(proj.x.toFixed(3)), y: Number(proj.y.toFixed(3)), r: Number(proj.radius.toFixed(3)) }
            : null;
        })(),
      };
    },

    captureFrame(): string | null {
      try {
        // 先把状态推进到当前时刻，再渲染，截图才不是上一帧的残留。
        // 照片节点必须按**当前**滚动位置同步，并且重新套一遍视觉量（含焦点淡出），
        // 否则截到的是"还没被渲染循环刷新过"的旧状态。
        ripples.update(performance.now());
        photos.sync(useRiverStore.getState().photos, lastVisuals, profile.ratio, scrollX);
        const stateNow = useRiverStore.getState();
        const focusedNow = stateNow.photos.find((photo) => photo.id === stateNow.focusedId);
        applyFocusVisuals(rig.progress, focusedNow, 1 / 60, true, 0);
        photos.tick(performance.now() / 1000, projScale, camera);
        // 同一 tick 内「渲染 → 读像素」，不需要 preserveDrawingBuffer
        postfx.render(0.016);
        return renderer.domElement.toDataURL('image/png');
      } catch {
        return null;
      }
    },
  };
}
