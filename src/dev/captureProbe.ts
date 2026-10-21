/**
 * 开发期视觉验证探针（仅 DEV 生效）
 *
 * 无头浏览器的截屏管线在这台机器上是坏的（SwiftShader 合成出破损图），
 * 所以改成从应用内部导出**真实帧缓冲**：
 *   node 侧：edge --headless=new --dump-dom 'http://127.0.0.1:5273/?capture=1'
 *   再把 <pre id="mr-capture"> 里的 base64 解成 PNG。
 *
 * 生产构建里这个文件不会被引用（import.meta.env.DEV 为 false 时直接返回）。
 */
/** 生成合成示例照片（DEV 专用）：无头验证 L1/L2 时没有真实文件可用 */
async function makeDemoFiles(count: number, startIndex = 0, detailed = false): Promise<File[]> {
  const hues = [28, 196, 214, 42, 168, 320, 8, 250];
  const files: File[] = [];
  for (let i = 0; i < count; i += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = detailed ? 960 : 480;
    canvas.height = detailed ? 640 : 320;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const hue = hues[(i + startIndex) % hues.length] ?? 28;
    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, `hsl(${hue} 65% 62%)`);
    gradient.addColorStop(1, `hsl(${(hue + 40) % 360} 55% 28%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    // 几个几何块，方便一眼看出"照片"而不是纯色块
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.arc(W * 0.25, H * 0.4, H * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(10,14,26,0.42)';
    ctx.fillRect(W * 0.5, H * 0.47, W * 0.4, H * 0.37);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.round(H * 0.09)}px ui-sans-serif, system-ui`;
    ctx.fillText(`记忆 ${i + 1}`, W * 0.07, H * 0.89);

    // ?demoDetail=1：加一片高频细节（棋盘 + 1px 细线 + 小字）。
    // 这是"够不够高清"的测试靶：糊了会立刻看出来，也能被梯度指标量到。
    if (detailed) {
      const cx = W * 0.5;
      const cy = H * 0.5;
      const cell = 8;
      const boardW = W * 0.34;
      const boardH = H * 0.26;
      for (let by = 0; by < boardH; by += cell) {
        for (let bx = 0; bx < boardW; bx += cell) {
          const odd = ((bx / cell) | 0) % 2 !== ((by / cell) | 0) % 2;
          ctx.fillStyle = odd ? 'rgba(255,255,255,0.9)' : 'rgba(16,18,28,0.9)';
          ctx.fillRect(cx - boardW / 2 + bx, cy - boardH / 2 + by, cell, cell);
        }
      }
      // 1px 细线带（最能暴露模糊）
      for (let ly = 0; ly < boardH; ly += 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(cx - boardW / 2 - W * 0.12, cy - boardH / 2 + ly, W * 0.1, 1);
      }
      // 三档字号的小字
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '13px ui-sans-serif, system-ui';
      ctx.fillText('0123456789 MEMORY RIVER 记忆长河', W * 0.06, H * 0.08);
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.fillText('the quick brown fox jumps over the lazy dog', W * 0.06, H * 0.13);
      ctx.font = '8px ui-sans-serif, system-ui';
      ctx.fillText('fine detail · 8px · 记忆 · 河 · 光 · 粒子', W * 0.06, H * 0.17);
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((value) => resolve(value), 'image/png'),
    );
    if (blob) files.push(new File([blob], `demo-${startIndex + i + 1}.png`, { type: 'image/png' }));
  }
  return files;
}

/** ?demoPhotos=N —— 注入合成照片；?layer=L1|L2 + ?focus=i 可直接进入某态 */
async function installDemoPhotos(params: URLSearchParams): Promise<void> {
  const count = Number(params.get('demoPhotos') ?? 0);
  if (!Number.isFinite(count) || count <= 0) return;

  const { ingestFiles } = await import('@/photo/ingest');
  const { useRiverStore } = await import('@/state');

  // ?demoBatches=1 表示"一张一张导入"，用来复现多次 layoutSlots 造成的位置失效
  const batches = Number(params.get('demoBatches') ?? 0);
  if (batches === 1) {
    for (let i = 0; i < count; i += 1) {
      const one = await ingestFiles(await makeDemoFiles(1, i));
      useRiverStore.getState().addPhotos(one);
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
  } else {
    const detailed = params.get('demoDetail') === '1';
    const list = await ingestFiles(await makeDemoFiles(count, 0, detailed));
    useRiverStore.getState().addPhotos(list);
  }

  const focusIndex = params.get('focus');
  if (focusIndex !== null) {
    const photos = useRiverStore.getState().photos;
    const target = photos[Number(focusIndex)] ?? photos[0];
    if (target) useRiverStore.getState().focusPhoto(target.id);
  }

  const layer = params.get('layer');
  if (layer === 'L1' || layer === 'L2') {
    useRiverStore.getState().setLayer(layer);
    // 无头环境里虚拟时间让阻尼过渡推进得极慢，截图验证时直接跳层
    const stage = (window as unknown as { __MR_STAGE?: StageHandle }).__MR_STAGE;
    const shatterParam = params.get('shatter');
    const options = shatterParam ? { shatter: Number(shatterParam) } : undefined;
    stage?.jumpToLayer?.(layer, options);
    window.setTimeout(() => {
      (window as unknown as { __MR_STAGE?: StageHandle }).__MR_STAGE?.jumpToLayer?.(layer, options);
    }, 120);
  }
}

/**
 * 曝光探针：把「渲染出来的照片区域」与「源图片同区域」的 RGB 均值都算出来，
 * 用数字判断照片到底是过曝还是偏暗，而不是靠肉眼猜。
 */
async function measureExposure(dataUrl: string): Promise<Record<string, unknown>> {
  const { useRiverStore } = await import('@/state');
  const state = useRiverStore.getState();
  const focused = state.photos.find((photo) => photo.id === state.focusedId);
  if (!focused) return { error: 'no focused photo' };

  const frame = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('frame decode failed'));
    image.src = dataUrl;
  });

  /**
   * 取一块区域，**统一缩放到同一个尺寸**再统计。
   *
   * 必须统一：梯度是"每像素"的量，两张图缩到不同像素尺寸时没法互相比较
   * （帧缓冲裁出来的块 400px 宽、源图裁出来 330px 宽，直接比就是错的数据）。
   */
  const SAMPLE_W = 320;
  const SAMPLE_H = 200;
  const sample = (
    source: CanvasImageSource,
    width: number,
    height: number,
    box: { cx: number; cy: number; w: number; h: number },
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      source,
      Math.round(width * (box.cx - box.w / 2)),
      Math.round(height * (box.cy - box.h / 2)),
      Math.round(width * box.w),
      Math.round(height * box.h),
      0,
      0,
      SAMPLE_W,
      SAMPLE_H,
    );
    const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    let maxLuma = 0;
    let clipped = 0;
    for (let i = 0; i < data.length; i += 4) {
      const rr = data[i] ?? 0;
      const gg = data[i + 1] ?? 0;
      const bb = data[i + 2] ?? 0;
      r += rr;
      g += gg;
      b += bb;
      n += 1;
      const luma = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      if (luma > maxLuma) maxLuma = luma;
      if (Math.max(rr, gg, bb) >= 250) clipped += 1;
    }
    if (n === 0) return null;

    // 清晰度 = 相邻像素亮度差的平均值（越高越锐）。
    // 这就是"够不够高清"的可量化代理：模糊会把梯度抹平。
    const lumaAt = (x: number, y: number): number => {
      const i = (y * SAMPLE_W + x) * 4;
      return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    };
    let gradSum = 0;
    let gradN = 0;
    for (let y = 0; y < SAMPLE_H - 1; y += 1) {
      for (let x = 0; x < SAMPLE_W - 1; x += 1) {
        const here = lumaAt(x, y);
        gradSum += Math.abs(lumaAt(x + 1, y) - here) + Math.abs(lumaAt(x, y + 1) - here);
        gradN += 1;
      }
    }
    return {
      r: r / n,
      g: g / n,
      b: b / n,
      maxLuma,
      clipRatio: clipped / n,
      sharpness: gradN > 0 ? gradSum / gradN : 0,
    };
  };

  // 取画面正中一块（照片在 L2 居中、占视口 0.72）与源图相同比例的同一块
  const box = { cx: 0.5, cy: 0.5, w: 0.34, h: 0.26 };
  const rendered = sample(frame, frame.naturalWidth, frame.naturalHeight, box);
  const source = sample(focused.image, focused.image.naturalWidth, focused.image.naturalHeight, box);
  if (!rendered || !source) return { error: 'sample failed' };

  const round = (v: number) => Math.round(v);
  const f2 = (v: number) => Math.round(v * 100) / 100;
  return {
    sourceMean: { r: round(source.r), g: round(source.g), b: round(source.b) },
    renderedMean: { r: round(rendered.r), g: round(rendered.g), b: round(rendered.b) },
    meanDelta: {
      r: round(rendered.r - source.r),
      g: round(rendered.g - source.g),
      b: round(rendered.b - source.b),
    },
    sourceMaxLuma: round(source.maxLuma),
    renderedMaxLuma: round(rendered.maxLuma),
    sourceClipRatio: f2(source.clipRatio),
    renderedClipRatio: f2(rendered.clipRatio),
    // 清晰度：rendered / source。1.0 = 和源图一样锐，0.5 = 明显糊了一半。
    sharpness: {
      rendered: f2(rendered.sharpness),
      source: f2(source.sharpness),
      ratio: f2(rendered.sharpness / Math.max(source.sharpness, 1e-6)),
    },
  };
}

/**
 * 极简三动作专项验证（独立机器实例）
 *   ① 扇风 → 出 flick 事件，且**不改变缩放目标**
 *   ② 静止 + 张合 → 缩放跟随（L0 段）
 *   ③ 捏合 / 快速握拳 → 进入
 *   ④ 慢慢握拳（超过快速窗口）→ 不触发进入，只缩小
 */
async function runBandCheck(): Promise<Record<string, unknown>> {
  const { createGestureMachine: create } = await import('@/gesture/stateMachine');
  const m = create();
  let t = 0;
  const events: string[] = [];

  const feat = (openness: number, palmVx = 0, pinch = 1) => ({
    openness,
    rawRatio: 1.8,
    pinchDistance: pinch,
    indexTip: { x: 0.5, y: 0.5 },
    palmCenter: { x: 0.5, y: 0.5 },
    velocityPerSec: { x: palmVx, y: 0 },
    palmVelocityPerSec: { x: palmVx, y: 0 },
    flickVelocity: { x: palmVx, y: 0 },
    angularVelocity: 0,
    isClosed: openness < 0.3,
    timestampMs: t,
    landmarks: [],
  });

  const feed = (ms: number, openness: number, palmVx = 0, pinch = 1): void => {
    for (let e = 0; e < ms; e += 16) {
      t += 16;
      const ev = m.feed({ feature: feat(openness, palmVx, pinch) as never, now: t, hoverTarget: 'p' });
      if (ev) events.push(ev.signal);
    }
  };

  // ① 静止 + 张开 → L0 段缩放
  feed(200, 0.3);
  const zoomClosed = Number(m.zoomTarget.toFixed(3));
  feed(300, 0.62);
  const zoomOpen = Number(m.zoomTarget.toFixed(3));
  const afterOpen = m.debug.committed;

  // ② 扇风：手张开 + 手掌高速横甩
  const beforeFlick = Number(m.zoomTarget.toFixed(3));
  feed(80, 0.95, 3.2);
  const duringFlick = Number(m.zoomTarget.toFixed(3));
  const flickEvents = events.filter((e) => e === 'flick').length;
  const flickFroze = m.debug.zoomFrozen;

  // ③ 撒手静止后恢复缩放
  feed(400, 0.95, 0);
  const afterFlickZoom = Number(m.zoomTarget.toFixed(3));

  // ④ 捏合
  events.length = 0;
  feed(120, 0.9, 0, 0.02);
  const pinchFired = events.includes('pinch');
  const afterPinch = m.debug.committed;

  // ⑤ 快速握拳（0.9 → 0.1 在 200ms 内）
  events.length = 0;
  feed(120, 0.9);
  m.commit('L1');
  feed(200, 0.1);
  const quickFist = events.includes('fistEnter');

  // ⑥ 慢慢握拳（超过快速窗口 420ms）
  m.commit('L1');
  events.length = 0;
  feed(120, 0.9);
  for (let e = 0; e < 900; e += 16) {
    t += 16;
    const open = 0.9 - (e / 900) * 0.8;
    m.feed({ feature: feat(open) as never, now: t, hoverTarget: 'p' });
  }
  const slowFist = events.includes('fistEnter');

  return {
    zoom: { atClosed: zoomClosed, atOpen: zoomOpen, committed: afterOpen },
    flick: { beforeFlick, duringFlick, flickEvents, zoomFrozen: flickFroze, afterFlickZoom },
    pinch: { fired: pinchFired, committed: afterPinch },
    fist: { quick: quickFist, slow: slowFist },
  };
}

/**
 * ?simMachine=1 —— 连续手势控制器仿真（不需要摄像头）
 *
 * 验证三件事：
 *  ① openness → 层级进度 是连续单调映射（不再跳层）
 *  ② 捏合时缩放被冻结（确认动作不会把画面推远）
 *  ③ 手飞出画面 < 1s 不判定丢失；> 1s 才触发 handLost
 */
async function runMachineSimulation(): Promise<Record<string, unknown>> {
  const { createGestureMachine } = await import('@/gesture/stateMachine');
  const { GESTURE } = await import('@/config');

  // ── 手离开宽限期（独立机器）──
  const m = createGestureMachine();
  let t = 0;
  const feat = (openness: number) => ({
    openness,
    rawRatio: 1.8,
    pinchDistance: 1,
    indexTip: { x: 0.5, y: 0.5 },
    palmCenter: { x: 0.5, y: 0.5 },
    velocityPerSec: { x: 0, y: 0 },
    palmVelocityPerSec: { x: 0, y: 0 },
    flickVelocity: { x: 0, y: 0 },
    angularVelocity: 0,
    isClosed: openness < 0.3,
    timestampMs: t,
    landmarks: [],
  });

  for (let i = 0; i < 20; i += 1) {
    t += 16;
    m.feed({ feature: feat(0.8) as never, now: t, hoverTarget: null });
  }

  // 丢手 600ms（宽限期内）→ 光标应仍显示
  let lostEvents = 0;
  for (let e = 0; e < 608; e += 16) {
    t += 16;
    if (m.feed({ feature: null, now: t, hoverTarget: null })) lostEvents += 1;
  }
  const cursorDuringGrace = m.cursorVisible;

  // 继续丢手到 > 1s → 应触发一次 handLost
  for (let e = 0; e < 900; e += 16) {
    t += 16;
    if (m.feed({ feature: null, now: t, hoverTarget: null })) lostEvents += 1;
  }

  return {
    bandCheck: await runBandCheck(),
    grace: {
      graceMs: GESTURE.lost.graceMs,
      cursorVisibleAt600ms: cursorDuringGrace,
      lostEvents,
    },
  };
}

/** 把 2D canvas（光标层 / 骨架层）导出成 base64，便于无头验收 */
function dumpCanvas(id: string, outId: string): void {
  const canvas = document.getElementById(id) as HTMLCanvasElement | null;
  if (!canvas) return;
  const node = document.createElement('pre');
  node.id = outId;
  try {
    node.textContent = canvas.toDataURL('image/png').split(',')[1] ?? '';
  } catch {
    node.textContent = '';
  }
  document.body.appendChild(node);
}

/** 构造一只"张开度可控"的假手（21 点，归一化坐标） */
function fakeHand(cx: number, cy: number, openness: number) {
  const spread = 0.05 + openness * 0.13;
  const points: { x: number; y: number; z: number }[] = [];
  points.push({ x: cx, y: cy + 0.16, z: 0 });
  const fingers = [
    { dx: -0.62, len: 0.9 },
    { dx: -0.2, len: 1.0 },
    { dx: 0.2, len: 0.95 },
    { dx: 0.58, len: 0.78 },
  ];
  for (const finger of fingers) {
    for (let k = 0; k < 4; k += 1) {
      points.push({
        x: cx + finger.dx * spread * (0.5 + k * 0.28),
        y: cy + 0.16 - spread * finger.len * (0.55 + k * 0.62) * (0.35 + openness * 0.9),
        z: 0,
      });
    }
  }
  for (let k = 0; k < 4; k += 1) {
    points.push({
      x: cx - spread * (0.85 + k * 0.34),
      y: cy + 0.1 - spread * 0.35 * k * (0.3 + openness * 0.7),
      z: 0,
    });
  }
  return points.slice(0, 21);
}

/** ?simCursor=1 —— 没有摄像头时也能验证光标/拖尾/进度环/骨架的渲染 */
async function simulateCursor(): Promise<void> {
  const { liveGesture } = await import('@/gesture/liveState');
  const start = performance.now();
  const tick = (): void => {
    const t = (performance.now() - start) / 1000;
    const open = 0.5 + 0.46 * Math.sin(t * 0.9);
    const x = 0.5 + 0.24 * Math.cos(t * 0.7);
    const y = 0.5 + 0.2 * Math.sin(t * 0.85);

    liveGesture.active = true;
    liveGesture.x = x;
    liveGesture.y = y;
    liveGesture.openness = Math.max(0, Math.min(1, open));
    liveGesture.rawOpenness = Math.max(0, Math.min(1, open));
    liveGesture.rawRatio = 1.22 + Math.max(0, Math.min(1, open)) * 0.8;
    liveGesture.status = open > 0.6 ? 'open' : open < 0.3 ? 'closed' : 'pending';
    liveGesture.swiping = false;
    liveGesture.progress = 1;
    liveGesture.ring = { x: 0.5, y: 0.46, radius: 0.1 };
    liveGesture.trail.push({ x, y, t: performance.now() });
    while (liveGesture.trail.length > 18) liveGesture.trail.shift();
    liveGesture.landmarks = fakeHand(x * 0.9 + 0.05, y * 0.8 + 0.05, liveGesture.openness);

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * ?hitTest=calib-retry,calib-close —— 点击可达性验证
 * 用 elementFromPoint 检查按钮中心最上层是哪个元素。
 */
function runHitTest(ids: string[]): Record<string, unknown> {
  const results = ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, found: false };
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    ) as HTMLElement | null;
    let inButton = false;
    let node: HTMLElement | null = hit;
    while (node) {
      if (node === el) {
        inButton = true;
        break;
      }
      node = node.parentElement;
    }
    const style = window.getComputedStyle(el);
    return {
      id,
      found: true,
      hitTag: hit?.tagName ?? null,
      hitId: hit?.id ?? null,
      clickable: inButton && style.pointerEvents !== 'none',
      pointerEvents: style.pointerEvents,
    };
  });
  return { results };
}

/** ?simCalibration=1 —— 校准流程仿真（注入时钟） */
async function runCalibrationSimulation(): Promise<Record<string, unknown>> {
  const { createCalibrationSession, activeRange, setCalibration, ratioToOpenness } = await import(
    '@/gesture/calibration'
  );
  setCalibration(null);

  let clock = 0;
  let last: Record<string, unknown> = {};
  const session = createCalibrationSession(
    (state) => {
      last = { phase: state.phase, message: state.message, progress: Number(state.progress.toFixed(2)) };
    },
    { durationMs: 400, settleMs: 60, now: () => clock },
  );

  const before = activeRange();
  session.start();

  const drivePhase = (phase: 'fist' | 'open', ratio: number): void => {
    let guard = 0;
    while (session.read().phase === phase && guard < 400) {
      clock += 20;
      session.sample(ratio + Math.sin(guard * 0.7) * 0.012);
      guard += 1;
    }
  };

  drivePhase('fist', 1.25);
  const afterFist = { ...last };
  drivePhase('open', 1.85);
  const afterOpen = { ...last };
  const after = activeRange();

  return {
    beforeCalibration: { lo: Number(before.lo.toFixed(3)), hi: Number(before.hi.toFixed(3)), calibrated: before.calibrated },
    afterFist,
    afterOpen,
    afterCalibration: { lo: Number(after.lo.toFixed(3)), hi: Number(after.hi.toFixed(3)), calibrated: after.calibrated },
    mapping: [1.25, 1.45, 1.65, 1.85, 2.05].map((ratio) => ({
      ratio,
      openness: Number(ratioToOpenness(ratio).toFixed(3)),
    })),
  };
}

export interface StageHandle {
  captureFrame(): string | null;
  spawnRippleAtSlot?(slot: number, offsetY?: number, strength?: number): void;
  jumpToLayer?(layer: 'L0' | 'L1' | 'L2', options?: { shatter?: number }): void;
  debugScrollTo?(x: number): void;
  debugScrollSim?(v: number): { from: number; to: number; snapped: boolean };
  debugInfo?(): Record<string, unknown>;
  debugSweep?(options?: { frames?: number; velocity?: number; reset?: boolean }): unknown;
  debugZoom?(progress: number): { dialogOpen: boolean; target: number };
  debugZoomSweep?(from: number, to: number, frames?: number): Record<string, unknown>;
  debugDeriveLayer?(): { layer: string; target: number };
  debugFlickCheck?(velocity: number): Record<string, unknown>;
}


/* ══════════════ 阶段 4：对话 / 切片人格 / 跨图记忆的端到端仿真 ══════════════ */

/**
 * `?chatSim=1` —— 不需要摄像头、不需要网络、不需要人操作，直接跑一遍：
 *
 *   导入 3 张照片 → 分别生成切片人格（时间/地点/说话风格）
 *   在「图1」说一句带情绪的话 → 切到「图2」说一句相关的 → 看 AI 是否**主动引用**图1
 *   顺便体检：回复字数、客服腔、追问节奏、Mock 与远端来源
 *
 * 这是"跨图记忆"最关键的验收：它必须能给出「你刚在「X」说难过，这张其实也是」这种句子。
 */
async function runChatSimulation(): Promise<Record<string, unknown>> {
  const { ingestFiles } = await import('@/photo/ingest');
  const { useRiverStore } = await import('@/state');
  const { sliceForPhoto } = await import('@/ai/slices');
  const { sendChatMessage, ensureThreadOpened, sliceDebug } = await import('@/ai/chat');
  const { inspect } = await import('@/ai/guard');
  const { runtimeStatus } = await import('@/ai/runtime');

  const store = useRiverStore.getState();
  if (store.photos.length === 0) {
    const list = await ingestFiles(await makeDemoFiles(3));
    useRiverStore.getState().addPhotos(list);
  }

  const photos = useRiverStore.getState().photos.slice(0, 3);
  if (photos.length < 2) return { error: 'need >= 2 photos' };

  const slices = photos.map((photo) => {
    const profile = sliceForPhoto(photo);
    return {
        id: photo.id,
        label: profile.label,
        place: profile.placeName,
        voice: profile.voice,
        city: profile.city,
        cityRelation: profile.cityRelation,
      };
  });

  /** 切到某张照片 → 打一句 → 收回复 */
  const talkTo = async (photoId: string, text: string) => {
    useRiverStore.getState().focusPhoto(photoId);
    useRiverStore.getState().setLayer('L2');
    ensureThreadOpened(photoId);
    const result = await sendChatMessage(text, { allowLocalMock: true });
    const thread = useRiverStore.getState().chatByPhoto[photoId] ?? [];
    const reply = [...thread].reverse().find((turn) => turn.role === 'persona');
    return {
      to: photoId,
      said: text,
      reply: reply?.text ?? null,
      citations: reply?.citations?.map((c) => c.label) ?? [],
      shape: reply ? inspect(reply.text) : null,
      debug: result.debug,
    };
  };

  const first = photos[0];
  const second = photos[1];
  if (!first || !second) return { error: 'need >= 2 photos' };

  // ① 在图1 说一句"难过" → 记下它
  const step1 = await talkTo(first.id, '那天我其实很难过，一直没说话');
  // ② 在图2 说同一种情绪 → 期望它主动引用图1
  const step2 = await talkTo(second.id, '今天也很累，有点难过');
  // ③ 在图2 追问地点 → 期望答案只来自图2 自己的切片
  const step3 = await talkTo(second.id, '这是哪儿来着？');
  // ④ 在图1 再来一句日常 → 期望不连续追问
  const step4 = await talkTo(first.id, '你好');

  // ⑤ 元信息诚实性：系统没有 EXIF / 用户输入时，不许编时间、住址、来源
  const step5 = await talkTo(second.id, '这是什么时候拍的？');
  const step6 = await talkTo(first.id, '我住在哪来着');
  const step7 = await talkTo(first.id, '这张照片是从哪来的？');
  const replies = [step1, step2, step3, step4, step5, step6, step7]
    .map((step) => step.reply ?? '')
    .join(' ');
  const fabricatedMeta = /杭州|武汉|厦门|成都|西安|20\d{2}\s*年/.test(replies);

  // 归档检查：必须按 photoId 分开
  const archive = useRiverStore.getState().chatByPhoto;
  const archiveShape = Object.fromEntries(
    Object.entries(archive).map(([photoId, turns]) => [
      photoId,
      { turns: turns.length, roles: turns.map((turn) => turn.role).join(',') },
    ]),
  );

  return {
    slices,
    steps: [step1, step2, step3, step4, step5, step6, step7],
    /** 不再有虚构城市 / 年份 */
    fabricatedMeta,
    noFabricatedMeta: !fabricatedMeta,
    /** 跨图引用是否真的发生了 */
    crossReferenceWorked: step2.citations.length > 0 && step2.citations.includes(slices[0]?.label ?? ''),
    archiveByPhotoId: archiveShape,
    runtime: runtimeStatus(),
    sliceDetail: sliceDebug(second.id),
  };
}


/**
 * `?chatPanel=1&chatUi=1` —— 真·UI 链路验证：
 *   进入 L2 → 面板滑出 → 在**输入框里打字** → 点发送 → 等回复进气泡
 *
 * 走的是和用户完全一样的路径（原生 setter + input 事件，React 能收到），
 * 所以它同时验证了：面板渲染、输入框可用、快捷键没有抢输入、气泡与引用标签出现。
 */
async function runChatUiProbe(params: URLSearchParams): Promise<Record<string, unknown>> {
  const { useRiverStore } = await import('@/state');
  const { useSettingsStore } = await import('@/ai/settings');
  const { useApiStatusStore } = await import('@/ai/apiStatus');
  const stage = (window as unknown as { __MR_STAGE?: StageHandle }).__MR_STAGE;

  // 探针不访问真实远端：给一个假 Key / 不可达地址，并显式允许本地 Mock
  useSettingsStore.getState().save({
    apiKey: 'dev-mock-key',
    baseUrl: 'http://127.0.0.1:9/v1',
    model: 'dev-mock-model',
  });
  useApiStatusStore.getState().setStatus('online', null);

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, ms));

  const photos = useRiverStore.getState().photos;
  if (photos.length === 0) return { error: 'no photos' };
  const first = photos[0];
  const second = photos[1];
  if (!first) return { error: 'no photos' };

  // ① 让第二张先有"情绪记忆"，这样第一张的回复里才可能出现跨图引用
  const seedOther = params.get('seedOther') !== '0';
  if (second && seedOther) {
    useRiverStore.getState().focusPhoto(second.id);
    useRiverStore.getState().setLayer('L2');
    stage?.jumpToLayer?.('L2');
    const { sendChatMessage } = await import('@/ai/chat');
    await sendChatMessage('那天我很难过，一直没说话');
  }

  // ② 切到第一张，进入 L2（面板会自动滑出）
  useRiverStore.getState().focusPhoto(first.id);
  useRiverStore.getState().setLayer('L2');
  stage?.jumpToLayer?.('L2');
  await wait(240);

  const layerNode = document.querySelector('[data-chat-layer]');
  const bar = document.querySelector('[data-chat-bar]');
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-chat-input]');
  const talkButton = document.querySelector<HTMLButtonElement>('[data-chat-talk]');
  const backButton = document.querySelector<HTMLButtonElement>('[data-chat-back]');
  if (!layerNode || !bar || !textarea || !talkButton) {
    return {
      error: 'chat ui missing',
      hasLayer: !!layerNode,
      hasBar: !!bar,
      hasTextarea: !!textarea,
      hasTalk: !!talkButton,
    };
  }

  // ③ 在输入框里打字（原生 setter + input 事件，React 的受控组件才会更新）
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(textarea, '今天也很累，有点难过');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(80);
  const draftBeforeSend = textarea.value;

  // ④ 回车发送（输入框是"几乎隐形"的那一个，没有发送按钮）
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
  );
  await wait(1600);

  // ⑤ 说话按钮与输入的"可点性"：用 elementFromPoint 验证没有被画布/手势层挡住
  const rectOf = (node: Element | null): { hit: string; clickable: boolean } => {
    if (!(node instanceof HTMLElement)) return { hit: 'missing', clickable: false };
    const rect = node.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      hit: top ? `${top.tagName}${top.id ? `#${top.id}` : ''}` : 'none',
      clickable: Boolean(top && (top === node || node.contains(top))),
    };
  };
  const talkHit = rectOf(talkButton);
  const inputHit = rectOf(textarea);
  const backHit = rectOf(backButton);

  const thread = useRiverStore.getState().chatByPhoto[first.id] ?? [];
  const bubbles = layerNode.querySelectorAll('[data-speech]');
  const citationChips = layerNode.querySelectorAll('.memory-shard');
  const shardCores = layerNode.querySelectorAll('.shard-core');
  const shardDots = layerNode.querySelectorAll('.shard-dot');
  const rect = bar.getBoundingClientRect();
  const overflow = bar.scrollWidth - bar.clientWidth;
  // 最后一条台词是否被底部栏压住（台词栈底边必须 >= 栏顶边）
  const speechNodes = [...layerNode.querySelectorAll('[data-speech]')];
  const lastSpeech = speechNodes[speechNodes.length - 1];
  const speechBottom = lastSpeech ? lastSpeech.getBoundingClientRect().bottom : 0;

  return {
    draftBeforeSend,
    floatsOverPhoto: layerNode.getAttribute('data-chat-layer'),
    hitTargets: { talk: talkHit, input: inputHit, back: backHit },
    turns: thread.length,
    lastUser: [...thread].reverse().find((turn) => turn.role === 'user')?.text ?? null,
    lastReply: [...thread].reverse().find((turn) => turn.role === 'persona')?.text ?? null,
    lastCitations:
      [...thread].reverse().find((turn) => turn.role === 'persona')?.citations?.map((c) => c.label) ??
      [],
    dom: {
      bubbles: bubbles.length,
      citationChips: citationChips.length,
      shardCores: shardCores.length,
      shardDots: shardDots.length,
      inputCleared: textarea.value === '',
      panel: {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
      },
      overflowX: overflow,
      barTop: Math.round(rect.top),
      lastSpeechBottom: Math.round(speechBottom),
      speechClearsBar: speechBottom <= rect.top + 1,
    },
    focusProjection: (() => {
      const id = useRiverStore.getState().focusedId;
      return id ? stage?.debugInfo?.() : null;
    })(),
  };
}


/**
 * `?toneCheck=1` —— 话术铁律验收（不需要摄像头、不需要网络）
 *
 * 对一组典型输入跑一遍 Mock，逐条检查：
 *   ① 单句 ≤ 15 字  ② 总长 ≤ 45 字  ③ 没有建议腔 / 客服腔 / 抽象情绪
 *   ④ 陈述 : 提问 ≥ 3:1、不连续追问
 *   ⑤ 关键是**具体**：回复里必须带上画面里的细节
 *   ⑥ 跨图：第二张图能引用第一张说过的话
 */
async function runToneCheck(): Promise<Record<string, unknown>> {
  const { ingestFiles } = await import('@/photo/ingest');
  const { useRiverStore } = await import('@/state');
  const { sliceForPhoto } = await import('@/ai/slices');
  const { buildCorpus, retrieve } = await import('@/ai/retrieval');
  const { mockReply } = await import('@/ai/mock');
  const { guard } = await import('@/ai/guard');
  const { AI } = await import('@/config');
  type Turn = { role: 'user' | 'persona'; text: string; tags: string[] };

  const store = useRiverStore.getState();
  if (store.photos.length === 0) {
    const list = await ingestFiles(await makeDemoFiles(2));
    useRiverStore.getState().addPhotos(list);
  }
  const photos = useRiverStore.getState().photos;
  const first = photos[0];
  const second = photos[1];
  if (!first) return { error: 'need >= 1 photo' };

  const profile = sliceForPhoto(first);
  const history: Turn[] = [];

  const ask = (photoId: string, text: string): Record<string, unknown> => {
    const target = useRiverStore.getState().photos.find((photo) => photo.id === photoId);
    const slice = sliceForPhoto(target ?? first);
    const all = useRiverStore.getState().photos
      .map((photo) => sliceForPhoto(photo))
      .filter((item) => item.id !== photoId);
    const corpus = buildCorpus(all, useRiverStore.getState().chatByPhoto, photoId);
    const retrieval = retrieve(text, corpus);
    const reply = mockReply({
      profile: slice,
      turns: history as never,
      userText: text,
      citations: retrieval.items,
      sharedEmotions: retrieval.sharedEmotions,
      sharedPlaces: retrieval.sharedPlaces,
    });
    history.push({ role: 'user', text, tags: [] });
    history.push({ role: 'persona', text: reply.text, tags: [] });
    // 同步写进 store：跨图检索读的是 chatByPhoto，不写就永远引用不到
    useRiverStore.getState().appendChatTurn(photoId, {
      id: `probe-u-${history.length}`,
      role: 'user',
      text,
      atMs: Date.now(),
      tags: [],
    });
    useRiverStore.getState().appendChatTurn(photoId, {
      id: `probe-p-${history.length}`,
      role: 'persona',
      text: reply.text,
      atMs: Date.now(),
      tags: [],
    });
    return { said: text, reply: reply.text, citations: reply.citations.map((c) => c.label) };
  };

  const MEME_KEYS = ['奶龙', '保熟', '尊嘟', '不对劲', '格局', '哭死', '抽象', '憨'];

  const probes = ['那天其实挺难过的。', '今天好累', '这是哪儿？', '你好', '武汉呢', '你还记得那天那个大门吗？'];
  type ProbeRow = { said: string; reply: string; citations: string[]; crossImage?: boolean };
  const results: ProbeRow[] = probes.map((text) => ask(first.id, text) as ProbeRow);

  // 跨图：先在第二张里说一句带情绪的话，再回第一张说同类情绪
  if (second) {
    ask(second.id, '那天我很难过');
    results.push({ ...(ask(first.id, '我也难过') as ProbeRow), crossImage: true });
  }

  const sentences = (text: string): string[] =>
    text.split(/(?<=[。！？…])/).filter((part) => part.trim().length > 0);

  const checks = results.map((item) => {
    const text = String(item.reply ?? '');
    const parts = sentences(text);
    const longest = parts.reduce((max, part) => Math.max(max, part.length), 0);
    const questions = parts.filter((part) => /[？?]/.test(part)).length;
    return {
      said: item.said,
      reply: text,
      chars: text.length,
      longestSentence: longest,
      sentences: parts.length,
      questions,
      /** 铁律检查 */
      shortSentences: longest <= AI.reply.sentenceMaxChars,
      shortTotal: text.length <= AI.reply.hardMaxChars,
      noAdvice: !/建议|应该|需要(多|好好)|注意身体|加油|抱抱|你一定/.test(text),
      /** 具体：必须命中画面细节或切片事实 */
      // 具体：要么说画面/地点，要么是明确的网络热梗（热梗本身是"接话"而不是"泛泛而谈"）
      concrete:
        /画面|暗|亮|天空|绿|颜色|光|阴影|门|窗|墙|桌|杯|椅|车|路|树|人|有树|有人|有水|屋里|室内|街边|开阔地|墙边|夜里|夜景|水边|树底下|杭州|武汉|厦门|成都|西安/.test(
          text,
        ) ||
        MEME_KEYS.some((word) => text.includes(word)) ||
        // 允许"对人的观察"（用户示例：✅「你笑得很用力」）
        /你没看镜头|你笑得很用力|你那天话很少|看不清/.test(text) ||
        // 极短的接话（「嗯。」「难过啊。」）本来就不该硬塞细节
        text.length <= 8,
      guardStable: guard(text) === text,
    };
  });

  const statementCount = checks.reduce(
    (sum, item) => sum + (item.sentences - item.questions),
    0,
  );
  const questionCount = checks.reduce((sum, item) => sum + item.questions, 0);

  return {
    slice: {
      label: profile.label,
      place: profile.placeName,
      city: profile.city,
      visualTags: profile.visual.tags,
      visualHeadline: profile.visual.headline,
      visualFacts: profile.facts.filter((fact) => fact.tags.includes('画面')).map((f) => f.text),
    },
    checks,
    stats: {
      total: checks.length,
      allShortSentences: checks.every((item) => item.shortSentences),
      allShortTotal: checks.every((item) => item.shortTotal),
      allNoAdvice: checks.every((item) => item.noAdvice),
      allConcrete: checks.every((item) => item.concrete),
      /** 网感：轻松语境里出现过热梗，低落语境里没出现 */
      memeCount: checks.filter((item) => MEME_KEYS.some((word) => item.reply.includes(word))).length,
      noFiller: checks.every((item) => !/我记得的|我记忆里|我记得，我/.test(item.reply)),
      guardStable: checks.every((item) => item.guardStable),
      statementToQuestion: `${statementCount}:${questionCount}`,
      noConsecutiveQuestions: checks.every(
        (item, index) => index === 0 || !(item.questions > 0 && (checks[index - 1]?.questions ?? 0) > 0),
      ),
      crossImageCited: results.some(
        (item) => (item.citations ?? []).length > 0 && item.crossImage === true,
      ),
    },
  };
}

/* ══════════════ 阶段 4：对话 / 切片人格 / 跨图记忆的端到端仿真 ══════════════ */


/**
 * `?gestureChat=1` —— 回归：对话打开时，静止张合缩放（含握拳退出）必须依然生效
 *
 * 之前的 bug：为了让"聊天时别被手拉走"，我在 stageBridge.zoom 里加了
 * `if (dialogOpen) return;` —— 结果真机上聊天时握拳退不出去。
 * 这个探针就是钉住那条修法的：对话打开 + 缩放目标 0 → rig 目标必须变成 0。
 */
async function runGestureChatCheck(): Promise<Record<string, unknown>> {
  const { useRiverStore } = await import('@/state');
  const { PHOTO } = await import('@/config');
  const stage = (window as unknown as { __MR_STAGE?: StageHandle }).__MR_STAGE;
  if (!stage?.debugZoom) return { error: 'no stage' };

  const photos = useRiverStore.getState().photos;
  const first = photos[0];
  if (!first) return { error: 'no photos' };

  useRiverStore.getState().focusPhoto(first.id);
  useRiverStore.getState().setLayer('L2');
  stage.jumpToLayer?.('L2');

  // 对话已经打开（App 的订阅会 openDialog）
  const chatOpen = useRiverStore.getState().dialogOpen;

  // 握拳 → 缩放目标 0（应当**立刻**被接受，哪怕刚确认完、还在 hold 窗口里）
  const out = stage.debugZoom(0);
  // 等过确认锁定窗口，再张手 → 回到 L2（"想更近"受 hold 保护，过后正常）
  await new Promise((resolve) => window.setTimeout(resolve, PHOTO.focusHoldMs + 150));
  const back = stage.debugZoom(2);

  // 扇风是否仍然被接受（聊天时换记忆靠它）
  const scrollBefore = useRiverStore.getState().focusedId;
  stage.debugScrollSim?.(-2.5);
  const scrollAfter = useRiverStore.getState().focusedId;

  return {
    chatOpen,
    /** 关键断言：对话打开时缩放目标依然能改 */
    zoomWhileChatting: out,
    zoomBackWhileChatting: back,
    flickWorksWhileChatting: scrollBefore !== scrollAfter,
    focusedChanged: `${scrollBefore ?? 'null'} → ${scrollAfter ?? 'null'}`,
  };
}


/**
 * `?zoomSweep=1` —— L1↔L2 连续缩放的抖动体检
 *
 * 真机反馈："扩大缩小在 L1 到 L2 的时候有点 bug"。
 * 这里逐帧步进 rig，量三个指标：
 *   maxStep   单帧进度跳变（>0.1 就会看出来"顿一下"）
 *   reversals 进度倒退帧数（>0 说明在边界上来回拉锯）
 *   driftX    横向漂移（张开推到 L2 时照片不该左右滑）
 */
async function runZoomSweep(): Promise<Record<string, unknown>> {
  const { useRiverStore } = await import('@/state');
  const stage = (window as unknown as { __MR_STAGE?: StageHandle }).__MR_STAGE;
  if (!stage?.debugZoomSweep) return { error: 'no stage' };
  const photos = useRiverStore.getState().photos;
  const first = photos[0];
  if (!first) return { error: 'no photos' };

  useRiverStore.getState().focusPhoto(first.id);
  stage.jumpToLayer?.('L1');

  // ★ 关键回归：连续缩放到 1.6（还在 L1↔L2 之间）时，
  //   渲染循环把 store.layer 派生为 L2 —— 这**不能**把 rig 目标拉走，否则边界拉锯
  stage.jumpToLayer?.('L1');
  stage.debugZoom?.(1.6);
  const deriveAfterZoom = stage.debugDeriveLayer?.() ?? null;

  const up = stage.debugZoomSweep(1, 2, 150);
  stage.jumpToLayer?.('L2');
  const down = stage.debugZoomSweep(2, 1, 150);
  stage.jumpToLayer?.('L0');
  const all = stage.debugZoomSweep(0, 2, 200);

  const verdict = (run: Record<string, unknown>): Record<string, unknown> => ({
    reached: run.reached,
    maxStep: run.maxStep,
    reversals: run.reversals,
    driftX: run.driftX,
    /** 合格线：单帧跳变 < 0.1、没有倒退、横向漂移 < 0.2 世界单位 */
    pass:
      Number(run.maxStep) < 0.1 &&
      Number(run.reversals) === 0 &&
      Number(run.driftX) < 0.2 &&
      Math.abs(Number(run.reached) - Number(run.to)) < 0.02,
  });

  return {
    /** 派生层级不动摇缩放目标（target 应仍 ≈1.6，而不是被钉到 2） */
    derivedLayerKeepsTarget: deriveAfterZoom,
    derivedLayerOk: Math.abs((deriveAfterZoom?.target ?? 0) - 1.6) < 0.05,
    'L1→L2': { ...verdict(up), samples: up.samples },
    'L2→L1': verdict(down),
    'L0→L2': verdict(all),
    allPass:
      [verdict(up), verdict(down), verdict(all)].every((item) => item.pass === true) &&
      Math.abs((deriveAfterZoom?.target ?? 0) - 1.6) < 0.05,
  };
}


/**
 * `?flickCheck=1` —— 扇风滑动回归（钉死"缩放路径每帧把滚动清零"的 bug）
 *
 * 真实链路里手势引擎**每帧**都会调一次 `stageBridge.zoom(目标)`。
 * 如果那条路径顺手清了 scrollVel，扇风的惯性就一帧被抹掉 → 滑动失灵。
 * 这里按真实顺序逐帧模拟：先 zoom(2)，再 updateScroll。
 */
async function runFlickCheck(): Promise<Record<string, unknown>> {
  const { useRiverStore } = await import('@/state');
  const stage = (window as unknown as { __MR_STAGE?: StageHandle }).__MR_STAGE;
  if (!stage?.debugFlickCheck) return { error: 'no stage' };
  const photos = useRiverStore.getState().photos;
  if (photos.length === 0) return { error: 'no photos' };

  // 每个用例都要从同一个起点开始（否则会撞到相册两端，量到的 travel 是 0，看起来像 bug）
  const run = (velocity: number): Record<string, unknown> => {
    stage.debugScrollTo?.(0);
    stage.jumpToLayer?.('L0');
    return stage.debugFlickCheck?.(velocity) ?? {};
  };
  const light = run(-1.2);
  const normal = run(-2.5);
  const hard = run(-4);

  return {
    light,
    normal,
    hard,
    allPass: [light, normal, hard].every((item) => item.pass === true),
    /** 顺带核对：轻扇 1 张、正常 2–3 张、猛扇封顶 3 张 */
    distances: [light, normal, hard].map((item) =>
      Math.round(Number(item.to ?? 0) / 7),
    ),
  };
}


/**
 * `?fistExit=1` —— 回归：握拳必须能从 L2 退回长河（最高优先级）
 *
 * 真机 bug：进了 L2 聊天后握拳缩不回去（分带映射把 L2 下限钉在 1.0）。
 * 这里喂一条完整手势时间线：
 *   张开 → 快速握拳（进入 L2）→ 张开一次 → 持续握拳 800ms → 期望 zoomTarget 归 0
 */
async function runFistExitCheck(): Promise<Record<string, unknown>> {
  const { createGestureMachine } = await import('@/gesture/stateMachine');
  const { GESTURE } = await import('@/config');
  const machine = createGestureMachine();

  const open = 0.9;
  const closed = 0.08;
  let t = 0;
  const events: string[] = [];
  const trace: { t: number; target: number; committed: string; fistExit: boolean }[] = [];

  const feed = (openness: number, stepMs = 33): void => {
    t += stepMs;
    const feature = {
      openness,
      rawRatio: 2.1,
      pinchDistance: 0.5,
      indexTip: { x: 0.5, y: 0.5 },
      palmCenter: { x: 0.5, y: 0.5 },
      velocityPerSec: { x: 0, y: 0 },
      palmVelocityPerSec: { x: 0, y: 0 },
      flickVelocity: { x: 0, y: 0 },
      angularVelocity: 0,
      isClosed: openness < GESTURE.openness.closeThreshold,
      timestampMs: t,
      landmarks: Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
    };
    const event = machine.feed({ feature, now: t, hoverTarget: null } as never);
    if (event) events.push(`${event.signal}@${t}`);
    trace.push({
      t,
      target: Number(machine.zoomTarget.toFixed(2)),
      committed: machine.debug.committed,
      fistExit: machine.debug.fistExit,
    });
  };

  // ① 张开 → 提交 L1
  for (let i = 0; i < 24; i += 1) feed(open);
  // ② 快速握一下 → 进入 L2
  for (let i = 0; i < 3; i += 1) feed(closed);
  // ③ 张开一次（释放闩锁）
  for (let i = 0; i < 4; i += 1) feed(open);
  const beforeExit = {
    committed: machine.debug.committed,
    target: Number(machine.zoomTarget.toFixed(2)),
  };
  // ④ 持续握拳 900ms → 应当退回长河
  for (let i = 0; i < 28; i += 1) feed(closed);
  const afterExit = {
    committed: machine.debug.committed,
    target: Number(machine.zoomTarget.toFixed(2)),
  };

  if (!GESTURE.fistExit.enabled) {
    return {
      enabled: false,
      note: '握拳退出已按要求关闭（改回之前的手势），此探针跳过',
      skipped: true,
    };
  }

  return {
    holdMs: GESTURE.fistExit.holdMs,
    events,
    beforeExit,
    afterExit,
    fistExitSeen: trace.some((item) => item.fistExit),
    pass:
      beforeExit.committed === 'L2' &&
      Math.abs(afterExit.target - GESTURE.fistExit.target) < 0.02,
    tail: trace.slice(-6),
  };
}


/**
 * `?aiCheck=1` —— 真实模型连通性验收
 *
 * 直接走产品的发送链路（sendChatMessage → runtime → DeepSeek），
 * 输出：有没有 key、这次走的是远端还是 Mock、耗时、模型原话。
 */
async function runAiCheck(): Promise<Record<string, unknown>> {
  const { useRiverStore } = await import('@/state');
  const { ingestFiles } = await import('@/photo/ingest');
  const { sendChatMessage, ensureThreadOpened } = await import('@/ai/chat');
  const { runtimeStatus } = await import('@/ai/runtime');

  if (useRiverStore.getState().photos.length === 0) {
    const list = await ingestFiles(await makeDemoFiles(2));
    useRiverStore.getState().addPhotos(list);
  }
  const photos = useRiverStore.getState().photos;
  const first = photos[0];
  if (!first) return { error: 'no photos' };

  useRiverStore.getState().focusPhoto(first.id);
  useRiverStore.getState().setLayer('L2');
  ensureThreadOpened(first.id);

  const started = performance.now();
  const result = await sendChatMessage('今天好累，随便聊聊');
  const thread = useRiverStore.getState().chatByPhoto[first.id] ?? [];
  const reply = [...thread].reverse().find((turn) => turn.role === 'persona');

  return {
    runtime: runtimeStatus(),
    source: result.debug.source,
    reason: result.debug.reason ?? null,
    latencyMs: Math.round(performance.now() - started),
    promptChars: result.debug.promptChars,
    reply: reply?.text ?? null,
    replyChars: reply?.text.length ?? 0,
    noteCount: (useRiverStore.getState().chatByPhoto[first.id] ?? []).length,
  };
}


/**
 * `?chatLive=1` —— 多轮真实对话（验证"接上模型就能聊"）
 *
 * 连说四句（含追问、换图），看模型是否记得上下文、是否引用跨图记忆。
 */
async function runChatLive(): Promise<Record<string, unknown>> {
  const { useRiverStore } = await import('@/state');
  const { ingestFiles } = await import('@/photo/ingest');
  const { sendChatMessage, ensureThreadOpened } = await import('@/ai/chat');
  const { runtimeStatus } = await import('@/ai/runtime');

  if (useRiverStore.getState().photos.length === 0) {
    const list = await ingestFiles(await makeDemoFiles(2));
    useRiverStore.getState().addPhotos(list);
  }
  const photos = useRiverStore.getState().photos;
  const first = photos[0];
  const second = photos[1];
  if (!first) return { error: 'no photos' };

  useRiverStore.getState().focusPhoto(first.id);
  useRiverStore.getState().setLayer('L2');
  ensureThreadOpened(first.id);

  const turns: Record<string, unknown>[] = [];
  const say = async (photoId: string, text: string): Promise<void> => {
    useRiverStore.getState().focusPhoto(photoId);
    const started = performance.now();
    const result = await sendChatMessage(text);
    const thread = useRiverStore.getState().chatByPhoto[photoId] ?? [];
    const reply = [...thread].reverse().find((turn) => turn.role === 'persona');
    turns.push({
      said: text,
      reply: reply?.text ?? null,
      source: result.debug.source,
      citations: reply?.citations?.map((c) => c.label) ?? [],
      ms: Math.round(performance.now() - started),
    });
  };

  await say(first.id, '今天忙了一天，刚坐下来');
  await say(first.id, '这张照片是在哪拍的来着？');
  await say(first.id, '我现在有点困了');
  if (second) await say(second.id, '换一张，这张你还有印象吗？');

  return {
    runtime: runtimeStatus(),
    turns,
    allRemote: turns.every((turn) => turn.source === 'remote'),
    hasReplies: turns.every((turn) => typeof turn.reply === 'string' && turn.reply.length > 0),
  };
}

export function installCaptureProbe(): void {
  if (!import.meta.env.DEV) return;

  const params = new URLSearchParams(window.location.search);
  // 只要带了任意调试参数就启用（截图 / 诊断 / 仿真可以分开用）
  const wantCapture = params.has('capture');
  const wantsAnything =
    wantCapture ||
    params.has('diag') ||
    params.has('simMachine') ||
    params.has('demoPhotos') ||
    params.has('exposureProbe') ||
    params.has('captureOverlay') ||
    params.has('simCursor') ||
    params.has('simCalibration') ||
    params.has('hitTest') ||
    params.has('scrollTo') ||
    params.has('sweep') ||
    params.has('chatSim') ||
    params.has('chatPanel') ||
    params.has('toneCheck') ||
    params.has('gestureChat') ||
    params.has('zoomSweep') ||
    params.has('flickCheck') ||
    params.has('fistExit') ||
    params.has('aiCheck') ||
    params.has('chatLive') ||
    params.has('scrollSim');
  if (!wantsAnything) return;

  const delayMs = Number(params.get('captureDelay') ?? 2600);
  // 所有读 store 的探针都要等示例照片真正导入完 —— 否则会读到空相册，
  // 量出来的 "nodes: 0 / focused: null" 是探针的竞态，不是产品的 bug。
  const demoReady = installDemoPhotos(params);

  if (params.has('simCursor')) void simulateCursor();

  const scrollParam = params.get('scrollTo');
  if (scrollParam !== null) {
    window.setTimeout(() => {
      void demoReady.then(() => getStage()?.debugScrollTo?.(Number(scrollParam)));
    }, Math.max(delayMs - 400, 200));
  }

  const simParam = params.get('scrollSim');
  if (simParam !== null) {
    window.setTimeout(() => {
      const result = getStage()?.debugScrollSim?.(Number(simParam));
      const node = document.createElement('pre');
      node.id = 'mr-scrollsim';
      node.textContent = JSON.stringify(result ?? { error: 'no stage' });
      document.body.appendChild(node);
    }, Math.max(delayMs - 300, 200));
  }

  // ?sweep=1 —— 模拟连续扇动，逐帧计时统计。这是"切照片卡不卡"的量化证据。
  if (params.has('sweep')) {
    window.setTimeout(
      () => {
        void demoReady.then(() => {
          const result = getStage()?.debugSweep?.({
            frames: Number(params.get('frames') ?? 150),
            velocity: Number(params.get('sweepVelocity') ?? -1.8),
          });
          const node = document.createElement('pre');
          node.id = 'mr-sweep';
          node.textContent = JSON.stringify(result ?? { error: 'no stage' });
          document.body.appendChild(node);
        });
      },
      Math.max(delayMs - 250, 200),
    );
  }

  if (params.has('hitTest')) {
    window.setTimeout(() => {
      const ids = (params.get('hitTest') ?? '').split(',').filter(Boolean);
      const node = document.createElement('pre');
      node.id = 'mr-hittest';
      node.textContent = JSON.stringify(runHitTest(ids));
      document.body.appendChild(node);
    }, delayMs);
  }

  if (params.has('simCalibration')) {
    void runCalibrationSimulation().then((result) => {
      const node = document.createElement('pre');
      node.id = 'mr-calibration';
      node.textContent = JSON.stringify(result);
      document.body.appendChild(node);
    });
  }

  // ?chatSim=1 —— 切片人格 + 跨图记忆 + Mock 回复的端到端仿真
  if (params.has('chatSim')) {
    window.setTimeout(() => {
      void demoReady
        .then(() => runChatSimulation())
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-chatsim';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-chatsim';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 200, 300));
  }

  // ?chatPanel=1（可加 &chatUi=1）—— 面板渲染 + 输入→发送→气泡的真链路
  if (params.has('chatPanel')) {
    window.setTimeout(() => {
      void demoReady
        .then(() => runChatUiProbe(params))
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-chatpanel';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-chatpanel';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 200, 300));
  }

  // ?toneCheck=1 —— 话术铁律验收（短句 / 无建议腔 / 具体 / 陈述提问比 / 跨图）
  if (params.has('toneCheck')) {
    window.setTimeout(() => {
      void demoReady
        .then(() => runToneCheck())
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-tonecheck';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-tonecheck';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 200, 300));
  }

  // ?gestureChat=1 —— 对话打开时缩放/扇风是否仍然生效（回归探针）
  if (params.has('gestureChat')) {
    window.setTimeout(() => {
      void demoReady
        .then(() => runGestureChatCheck())
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-gesturechat';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-gesturechat';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 200, 300));
  }

  // ?zoomSweep=1 —— L1↔L2 连续缩放抖动体检
  if (params.has('zoomSweep')) {
    window.setTimeout(() => {
      void demoReady
        .then(() => runZoomSweep())
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-zoomsweep';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-zoomsweep';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 200, 300));
  }

  // ?flickCheck=1 —— 扇风滑动回归（每帧 zoom 呼叫不能杀掉惯性）
  if (params.has('flickCheck')) {
    window.setTimeout(() => {
      void demoReady
        .then(() => runFlickCheck())
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-flickcheck';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-flickcheck';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 200, 300));
  }

  // ?fistExit=1 —— 握拳退出（L2 → 长河）回归
  if (params.has('fistExit')) {
    window.setTimeout(() => {
      void runFistExitCheck()
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-fistexit';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-fistexit';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 200, 300));
  }

  // ?aiCheck=1 —— 真实模型连通性
  if (params.has('aiCheck')) {
    window.setTimeout(() => {
      void demoReady
        .then(() => runAiCheck())
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-aicheck';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-aicheck';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 1000, 300));
  }

  // ?chatLive=1 —— 多轮真实对话
  if (params.has('chatLive')) {
    window.setTimeout(() => {
      void demoReady
        .then(() => runChatLive())
        .then((result) => {
          const node = document.createElement('pre');
          node.id = 'mr-chatlive';
          node.textContent = JSON.stringify(result);
          document.body.appendChild(node);
        })
        .catch((error: unknown) => {
          const node = document.createElement('pre');
          node.id = 'mr-chatlive';
          node.textContent = JSON.stringify({ error: String(error) });
          document.body.appendChild(node);
        });
    }, Math.max(delayMs - 1000, 300));
  }

  if (params.has('simMachine')) {
    void runMachineSimulation().then((result) => {
      const node = document.createElement('pre');
      node.id = 'mr-machine';
      node.textContent = JSON.stringify(result);
      document.body.appendChild(node);
    });
  }
  const getStage = (): StageHandle | undefined =>
    (window as unknown as { __MR_STAGE?: StageHandle }).__MR_STAGE;

  // ?ripple=1 —— 错开时间激起三圈，一次截图就能验收涟漪
  let rippleSpawned = 0;
  if (params.has('ripple')) {
    [420, 260, 120].forEach((lead, index) => {
      window.setTimeout(() => {
        getStage()?.spawnRippleAtSlot?.(0.62 - index * 0.04, (index - 1) * 0.34, 0.8);
        rippleSpawned += 1;
      }, delayMs - lead);
    });
  }

  // ?diag=1 —— 把画布/相机/粒子包围盒导出来，排查"画面偏移"这类问题
  if (params.has('diag')) {
    window.setTimeout(() => {
      void demoReady.then(() => {
        const info = getStage()?.debugInfo?.() ?? { error: 'stage not ready' };
        const holder = document.createElement('pre');
        holder.id = 'mr-diag';
        holder.textContent = JSON.stringify(info);
        document.body.appendChild(holder);
      });
    }, delayMs - 200);
  }

  if (params.has('captureOverlay')) {
    window.setTimeout(() => {
      dumpCanvas('gesture-overlay', 'mr-overlay-png');
      dumpCanvas('camera-skeleton', 'mr-skeleton-png');
    }, delayMs);
  }

  if (!wantCapture) return;

  window.setTimeout(() => {
    void demoReady.then(() => {
    const holder = document.createElement('pre');
    holder.id = 'mr-capture';

    const dataUrl = getStage()?.captureFrame() ?? null;

    // ?exposureProbe=1 —— 输出「源图 vs 渲染」的 RGB 均值对比
    if (dataUrl && params.has('exposureProbe')) {
      void measureExposure(dataUrl).then((result) => {
        const node = document.createElement('pre');
        node.id = 'mr-exposure';
        node.textContent = JSON.stringify(result);
        document.body.appendChild(node);
      });
    }
    holder.dataset.status = dataUrl ? 'ok' : 'missing';
    holder.dataset.ripples = String(rippleSpawned);
    holder.textContent = dataUrl ? (dataUrl.split(',')[1] ?? '') : '';
    document.body.appendChild(holder);
    });
  }, delayMs);
}
