import { useEffect, useRef } from 'react';
import { PALETTE, GESTURE } from '@/config';
import { liveGesture } from '@/gesture/liveState';

/**
 * 光标覆盖层（全屏 2D canvas）
 *
 * 只保留与"界面锁定/焦点"有关的信息：
 *   1. 当前照片焦点环
 *   2. 张开度指示弧
 *
 * 食指光标 / 拖尾 / 拨动扩散圈已移除（不再用于拾取）。
 */
export function GestureOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let dpr = 1;

    const resize = (): void => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const state = liveGesture;

      // ── 焦点 / 悬停环 ──
      const ring = state.ring;
      if (ring) {
        const rx = ring.x * w;
        const ry = ring.y * h;
        const radius = Math.max(ring.radius * Math.min(w, h), 34 * dpr);

        ctx.strokeStyle = `${PALETTE.hover.ringColor}44`;
        ctx.lineWidth = PALETTE.hover.ringWidthPx * dpr;
        ctx.setLineDash([PALETTE.hover.ringDashPx * dpr, PALETTE.hover.ringGapPx * dpr]);
        ctx.beginPath();
        ctx.arc(rx, ry, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.strokeStyle = PALETTE.hover.ringColor;
        ctx.lineWidth = PALETTE.hover.ringWidthPx * 1.6 * dpr;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(rx, ry, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.progress);
        ctx.stroke();
      }

      // ── 张开度指示（左下角小弧，方便现场调试）──
      if (state.active && state.openness > 0.001) {
        const r = 26 * dpr;
        const ox = 34 * dpr;
        const oy = h - 118 * dpr;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.stroke();

        const openTone = state.openness > GESTURE.openness.zoomInThreshold
          ? '#7cffc4'
          : state.openness < GESTURE.openness.closeThreshold
            ? '#ffb86b'
            : '#9fd8ff';
        ctx.strokeStyle = openTone;
        ctx.lineWidth = 2.4 * dpr;
        ctx.beginPath();
        ctx.arc(ox, oy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * state.openness);
        ctx.stroke();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="gesture-overlay"
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      aria-hidden="true"
    />
  );
}
