import { useEffect, useRef, useState } from 'react';
import { DrawingUtils, HandLandmarker } from '@mediapipe/tasks-vision';
import { AI, GESTURE, UI_COPY, VISION } from '@/config';
import { getGestureEngine } from '@/gesture';
import { useRiverStore } from '@/state';
import { CalibrationPanel } from './CalibrationPanel';
import { STATUS_TEXT, type GestureStatusKey } from '@/gesture/stateMachine';
import { liveGesture } from '@/gesture/liveState';

function readManualCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(AI.settings.cameraCollapsedStorageKey) === '1';
  } catch {
    return false;
  }
}

function writeManualCollapsed(value: boolean): void {
  try {
    if (value) {
      window.localStorage.setItem(AI.settings.cameraCollapsedStorageKey, '1');
    } else {
      window.localStorage.removeItem(AI.settings.cameraCollapsedStorageKey);
    }
  } catch {
    // 隐私模式 / 存储不可写：本次会话仍然生效
  }
}

/**
 * 左下角摄像头画中画（路演用的"这个东西是真的在看我"）
 *
 * - 玻璃拟态小窗，水平镜像
 * - 用 MediaPipe 的 DrawingUtils.drawConnectors / drawLandmarks 画绿色发光骨架
 * - 上方实时状态文字（未检测到手 / 张开手掌 / 合拢待定 / 捏合确认 / 拨动中）
 *
 * 绘制走独立 rAF，不参与 React 渲染；React 只负责状态文字。
 */
export function CameraPreview() {
  const videoHostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<GestureStatusKey>('noHand');
  const [ready, setReady] = useState(false);
  const gestureStatus = useRiverStore((s) => s.gestureStatus);
  const [frozen, setFrozen] = useState(false);
  const [readout, setReadout] = useState({ open: 0, raw: 0, flick: 0, pinch: 1 });
  const inputMode = useRiverStore((s) => s.inputMode);
  const l2Locked = useRiverStore((s) => s.l2Locked);
  const layer = useRiverStore((s) => s.layer);
  const manualCollapsedRef = useRef(readManualCollapsed());
  const [expanded, setExpanded] = useState(
    () =>
      !manualCollapsedRef.current &&
      window.innerWidth >= AI.ui.mobileBreakpointPx &&
      layer !== 'L2',
  );

  const expandCamera = (): void => {
    manualCollapsedRef.current = false;
    writeManualCollapsed(false);
    setExpanded(true);
  };

  const collapseCamera = (): void => {
    manualCollapsedRef.current = true;
    writeManualCollapsed(true);
    setExpanded(false);
  };

  // 桌面展开；进入 L2 自动收成状态胶囊；窄屏默认胶囊。
  // 用户手动收起后，切层 / resize 都不再自动展开，直到点胶囊。
  useEffect(() => {
    if (manualCollapsedRef.current) return;
    setExpanded(window.innerWidth >= AI.ui.mobileBreakpointPx && layer !== 'L2');
  }, [layer]);

  useEffect(() => {
    const onResize = (): void => {
      const wide = window.innerWidth >= AI.ui.mobileBreakpointPx;
      if (!wide) setExpanded(false);
      else if (!manualCollapsedRef.current && layer !== 'L2') setExpanded(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [layer]);

  // ① 把 tracker 的 video 元素挂进小窗
  // 收起时只隐藏卡片，不卸载 video —— 否则 L2 一进入视频就被 detach，展开后黑屏。
  useEffect(() => {
    let raf = 0;
    let lastReady = false;
    const attach = (): void => {
      const engine = getGestureEngine();
      const video = engine.tracker.video;
      const host = videoHostRef.current;
      if (video && host) {
        if (!host.contains(video)) {
          video.className = 'h-full w-full object-cover';
          video.style.transform = VISION.camera.mirrored ? 'scaleX(-1)' : 'none';
          host.appendChild(video);
        }
        // 元素被重新挂载 / 后台恢复 / 浏览器自动暂停时，主动恢复播放
        if (video.paused && video.srcObject) {
          void video.play().catch(() => undefined);
        }
        const nextReady = video.readyState >= 2 && !video.paused;
        if (nextReady !== lastReady) {
          lastReady = nextReady;
          setReady(nextReady);
        }
      }
      raf = requestAnimationFrame(attach);
    };
    const onVisibilityChange = (): void => {
      if (document.hidden) return;
      const video = getGestureEngine().tracker.video;
      if (video?.paused && video.srcObject) {
        void video.play().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const video = getGestureEngine().tracker.video;
    if (video?.paused && video.srcObject) {
      void video.play().catch(() => undefined);
    }
  }, [expanded]);

  // ② 画骨架 + 同步状态文字（折叠时不绘制）
  useEffect(() => {
    if (!expanded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawing = new DrawingUtils(ctx);
    let raf = 0;
    let textTick = 0;

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      const landmarks = liveGesture.landmarks;
      // 骨架只依赖关键点；video 只影响底图（无摄像头时也能画，方便调试与降级演示）
      if (!landmarks) {
        // 状态文字不需要每帧更新
        if (performance.now() - textTick > 120) {
          textTick = performance.now();
          setStatus(liveGesture.status);
        }
        return;
      }

      // 小窗是镜像的（video 用 CSS 翻转），骨架也要镜像才能贴合
      const mirrored = VISION.camera.mirrored;
      const pts = landmarks.map((point) => ({
        x: mirrored ? 1 - point.x : point.x,
        y: point.y,
        z: point.z,
        visibility: 1,
      }));

      ctx.save();

      // 外发光：先粗后细画两遍，得到"发光连线"
      ctx.shadowColor = 'rgba(80, 255, 170, 0.9)';
      ctx.shadowBlur = 12;
      drawing.drawConnectors(pts, HandLandmarker.HAND_CONNECTIONS, {
        color: 'rgba(64, 232, 156, 0.85)',
        lineWidth: 3,
      });
      ctx.shadowBlur = 4;
      drawing.drawConnectors(pts, HandLandmarker.HAND_CONNECTIONS, {
        color: 'rgba(190, 255, 225, 0.95)',
        lineWidth: 1.2,
      });

      ctx.shadowColor = 'rgba(80, 255, 170, 0.95)';
      ctx.shadowBlur = 10;
      drawing.drawLandmarks(pts, {
        color: 'rgba(120, 255, 190, 0.95)',
        fillColor: 'rgba(220, 255, 240, 0.95)',
        radius: 2.4,
        lineWidth: 1,
      });

      ctx.restore();

      if (performance.now() - textTick > 120) {
        textTick = performance.now();
        setStatus(liveGesture.status);
        setFrozen(liveGesture.zoomFrozen);
        setReadout({
          open: liveGesture.rawOpenness,
          raw: liveGesture.rawRatio,
          flick: liveGesture.flickSpeed,
          pinch: liveGesture.pinchDistance,
        });
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [expanded]);

  const statusText = l2Locked
    ? `状态：${UI_COPY.l2LockedHint}`
    : (STATUS_TEXT[status] ?? STATUS_TEXT.noHand);
  const tone = l2Locked
    ? 'text-mood-cyan'
    : status === 'pinch' || status === 'hovering'
      ? 'text-mood-warm'
      : status === 'swiping'
        ? 'text-mood-cyan'
        : status === 'noHand'
          ? 'text-stardust/45'
          : 'text-[#7cffc4]';

  const pillText = inputMode === 'gesture' ? statusText.replace('状态：', '') : '鼠标模式';

  return (
    <div className="pointer-events-none absolute left-6 top-[92px] z-20 select-none sm:left-8">
      {!expanded && (
        <button
          type="button"
          data-camera-pill="1"
          onClick={expandCamera}
          aria-label="展开手势摄像头"
          title="展开手势摄像头"
          className={[
            'pointer-events-auto flex max-w-[15rem] items-center gap-2 rounded-full border px-3 py-1.5',
            'bg-white/[0.055] font-mono text-[9px] tracking-[0.12em] backdrop-blur-xl',
            'shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)] transition',
            l2Locked
              ? 'border-mood-cyan/30 text-mood-cyan/70'
              : 'border-white/14 text-stardust/50 hover:border-mood-cyan/35 hover:text-stardust/80',
          ].join(' ')}
        >
          <span
            className={[
              'h-1.5 w-1.5 shrink-0 rounded-full',
              inputMode === 'gesture'
                ? 'bg-[#4ee89c] shadow-[0_0_8px_#4ee89c]'
                : 'bg-mood-warm shadow-[0_0_8px_#ffb86b]',
            ].join(' ')}
          />
          <span className="truncate">{pillText}</span>
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m8 10 4 4 4-4" />
          </svg>
        </button>
      )}

      <div
        data-camera-panel="1"
        aria-hidden={!expanded}
        className={[
          'rounded-2xl border border-stardust/16 bg-cosmos-near/35 p-2.5',
          'shadow-[0_0_28px_rgba(90,200,255,0.10)] backdrop-blur-xl transition-opacity duration-300',
          expanded
            ? 'pointer-events-auto relative opacity-100'
            : 'pointer-events-none absolute left-0 top-0 opacity-0',
        ].join(' ')}
      >
        <div className="mb-2 flex items-center gap-2">
          <span
            className={[
              'h-1.5 w-1.5 shrink-0 rounded-full',
              inputMode === 'gesture'
                ? 'bg-[#4ee89c] shadow-[0_0_8px_#4ee89c]'
                : 'bg-mood-warm shadow-[0_0_8px_#ffb86b]',
            ].join(' ')}
          />
          <p className={['min-w-0 flex-1 truncate font-mono text-[9.5px] tracking-[0.14em]', tone].join(' ')}>
            {inputMode === 'gesture' ? statusText : '状态：鼠标模式'}
          </p>
          {frozen && inputMode === 'gesture' && (
            <span className="shrink-0 font-mono text-[8px] tracking-[0.1em] text-mood-warm/60">缩放暂停</span>
          )}
          <button
            type="button"
            data-camera-collapse="1"
            onClick={collapseCamera}
            aria-label="收起手势摄像头"
            title="收起"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-stardust/35 transition hover:bg-white/[0.06] hover:text-stardust/75"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
        </div>

        <div
          className={[
            'relative h-[112px] w-full overflow-hidden rounded-xl',
            'border border-stardust/20 bg-cosmos-near/40 backdrop-blur-md',
            'shadow-[0_0_28px_rgba(90,200,255,0.12)]',
          ].join(' ')}
        >
          <div ref={videoHostRef} className="absolute inset-0" />
          <canvas id="camera-skeleton" ref={canvasRef} className="absolute inset-0 h-full w-full" />

          <div className="pointer-events-none absolute left-2 top-2 font-mono text-[8.5px] leading-tight tracking-[0.08em]">
            <div className="text-[#7cffc4]">
              open <span className="text-[12px] font-semibold">{readout.open.toFixed(2)}</span>
            </div>
            <div className="text-stardust/45">ratio {readout.raw.toFixed(2)}</div>
            <div className={readout.flick > 0.95 ? 'text-mood-warm' : 'text-stardust/30'}>
              扇 {readout.flick.toFixed(2)}
            </div>
            <div className={readout.pinch < GESTURE.pinch.distanceThreshold ? 'text-mood-warm' : 'text-stardust/30'}>
              捏 {readout.pinch.toFixed(3)}
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-2 right-2 h-9 w-1.5 overflow-hidden rounded-full bg-stardust/15">
            <div
              className="absolute bottom-0 w-full rounded-full bg-[#7cffc4]"
              style={{ height: `${Math.round(readout.open * 100)}%` }}
            />
          </div>
          {(!ready || gestureStatus === 'unavailable') && (
            <div className="absolute inset-0 grid place-items-center px-3 text-center">
              <p className="font-mono text-[8.5px] leading-relaxed tracking-[0.16em] text-stardust/40">
                {gestureStatus === 'unavailable'
                  ? '摄像头不可用\n已切到鼠标模式（按 G 重试）'
                  : '摄像头启动中…'}
              </p>
            </div>
          )}
          <span className="pointer-events-none absolute left-1.5 top-1.5 h-2.5 w-2.5 border-l border-t border-[#4ee89c]/60" />
          <span className="pointer-events-none absolute right-1.5 top-1.5 h-2.5 w-2.5 border-r border-t border-[#4ee89c]/60" />
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 h-2.5 w-2.5 border-b border-l border-[#4ee89c]/60" />
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 h-2.5 w-2.5 border-b border-r border-[#4ee89c]/60" />
        </div>

        <CalibrationPanel />
      </div>
    </div>
  );
}
