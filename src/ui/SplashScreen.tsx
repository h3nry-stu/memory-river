import { useEffect, useState } from 'react';
import { SPLASH } from '@/config';

/**
 * 极简开场
 * ────────────────────────────────────────────────────────────────
 * 页面加载时盖住仍在后台渲染的长河：
 *   · 居中停留 2s
 *   · 再用 1.5s 淡出
 *   · 淡出结束从 DOM 移除
 *
 * 整个图层始终 pointer-events-none，绝不拦截鼠标 / 手势。
 * DEV 探针 / ?splash=0 时直接跳过，避免截图拍到黑屏。
 */

type SplashPhase = 'hold' | 'fading' | 'gone';

const PROBE_PARAMS = [
  'capture',
  'captureOverlay',
  'diag',
  'simMachine',
  'simCursor',
  'simCalibration',
  'hitTest',
  'scrollTo',
  'scrollSim',
  'sweep',
  'exposureProbe',
  'chatSim',
  'chatPanel',
  'toneCheck',
  'gestureChat',
  'zoomSweep',
  'flickCheck',
  'fistExit',
  'aiCheck',
  'chatLive',
  'calibDemo',
] as const;

function shouldSkipSplash(): boolean {
  if (typeof window === 'undefined') return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get('splash') === '0') return true;
  if (!import.meta.env.DEV) return false;
  return PROBE_PARAMS.some((key) => params.has(key));
}

export function SplashScreen() {
  const [skip] = useState(shouldSkipSplash);
  const [phase, setPhase] = useState<SplashPhase>(() => (skip ? 'gone' : 'hold'));

  useEffect(() => {
    if (skip) {
      setPhase('gone');
      return;
    }
    const fadeTimer = window.setTimeout(() => setPhase('fading'), SPLASH.holdMs);
    const doneTimer = window.setTimeout(
      () => setPhase('gone'),
      SPLASH.holdMs + SPLASH.fadeMs + 80,
    );
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [skip]);

  if (phase === 'gone') return null;

  const fading = phase === 'fading';

  return (
    <div
      data-splash={phase}
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center"
      style={{
        background:
          'radial-gradient(70% 55% at 50% 46%, #0a0f1f 0%, #05060f 52%, #03040a 100%)',
        opacity: fading ? 0 : 1,
        transition: `opacity ${SPLASH.fadeMs}ms ease-in-out`,
        willChange: 'opacity',
      }}
      aria-hidden="true"
    >
      <div className="flex flex-col items-center px-6 text-center">
        <h1
          className="pl-[0.36em] text-[clamp(2.4rem,7vw,5rem)] font-light tracking-[0.36em]"
          style={{
            color: '#e8f4ff',
            textShadow:
              '0 0 24px rgba(159,216,255,0.34), 0 0 68px rgba(255,184,107,0.16)',
          }}
        >
          {SPLASH.title}
        </h1>

        <div className="mt-6 h-px w-24 bg-gradient-to-r from-transparent via-stardust/35 to-transparent" />

        <p className="mt-5 font-mono text-[9px] tracking-[0.24em] text-stardust/40 sm:text-[10px]">
          {SPLASH.subtitle}
        </p>
      </div>
    </div>
  );
}
