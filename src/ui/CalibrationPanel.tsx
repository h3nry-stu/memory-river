import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getGestureEngine, activeRange, setCalibration, type CalibrationState } from '@/gesture';

/**
 * 一键手势校准
 *
 * 为什么需要：openness = 指尖到腕距离 / 手掌尺度 的比值，绝对值因人而异。
 * 同一套 lo/hi 有些人张到极限也只有 0.5。校准把**这只手**的握拳/张开两端记下来，
 * 之后所有计算都用这个区间。
 *
 * 流程：点按钮 → 握拳 3 秒 → 张开 3 秒 → 落库（localStorage）
 */
export function CalibrationPanel() {
  const [state, setState] = useState<CalibrationState | null>(null);
  const [range, setRange] = useState(() => activeRange());

  // 绑定引擎的校准会话
  useEffect(() => {
    const engine = getGestureEngine();
    const session = engine.calibration;

    // 用轮询把会话状态映射到 React（低频，不影响性能）
    const timer = window.setInterval(() => {
      const next = session.read();
      setState(next.phase === 'idle' ? null : next);
      if (next.phase === 'done') setRange(activeRange());
    }, 120);
    return () => window.clearInterval(timer);
  }, []);

  const running = state !== null && state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error';
  const { lo, hi, calibrated } = range;

  // DEV 预览：?calibDemo=1 强制显示"已完成"状态的浮层（用于自动化点击验证）
  const demo = import.meta.env.DEV && new URLSearchParams(window.location.search).has('calibDemo');
  const demoState: CalibrationState = {
    phase: 'done',
    progress: 1,
    liveRatio: 1.86,
    samples: 96,
    message: '校准完成：1.24 → 1.86',
    range: { lo: 1.24, hi: 1.86, at: 0 },
    settling: false,
  };
  const modal: CalibrationState | null = demo ? demoState : state;

  // 完成后自动收起（避免用户忘记关就一直挡着），也支持 Esc
  useEffect(() => {
    if (demo || !state || state.phase !== 'done') return;
    const timer = window.setTimeout(() => getGestureEngine().calibration.cancel(), 1800);
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') getGestureEngine().calibration.cancel();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [demo, state]);

  return (
    <>
      {/* 按钮：画中画正下方 */}
      <div className="pointer-events-auto mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          id="calib-open"
          onClick={() => getGestureEngine().calibration.start()}
          disabled={running}
          className={[
            'rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-[0.18em] uppercase',
            'transition-colors duration-300',
            calibrated
              ? 'border-[#4ee89c]/45 text-[#7cffc4] hover:border-[#4ee89c]'
              : 'border-mood-warm/40 text-mood-warm/80 hover:border-mood-warm',
            'disabled:opacity-40',
          ].join(' ')}
        >
          校准手势
        </button>
        <span className="font-mono text-[9px] tracking-[0.12em] text-stardust/35">
          {calibrated ? `已校准 ${lo.toFixed(2)}→${hi.toFixed(2)}` : `默认 ${lo.toFixed(2)}→${hi.toFixed(2)}`}
        </span>
        {calibrated && (
          <button
            type="button"
            onClick={() => {
              setCalibration(null);
              setRange(activeRange());
            }}
            className="font-mono text-[9px] tracking-[0.12em] text-stardust/30 hover:text-mood-warm"
            title="恢复默认区间"
          >
            重置
          </button>
        )}
      </div>

      {/*
        校准浮层用 portal 挂到 body：
        ① 这个组件挂在 CameraPreview 里，而那个容器是 pointer-events-none（不挡画布），
           子元素会继承它 —— 之前按钮点不动就是这个原因；
        ② portal 也顺带避开一切祖先的 transform/filter/overflow 造成的层叠与裁剪问题。
      */}
      {modal &&
        createPortal(
          <div
            className="pointer-events-auto fixed inset-0 z-[85] grid place-items-center bg-cosmos-near/55 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="手势校准"
          >
          <div className="w-[320px] rounded-2xl border border-stardust/20 bg-cosmos-far/80 p-6 text-center shadow-[0_0_60px_rgba(90,200,255,0.15)]">
            <p className="font-mono text-[9px] tracking-[0.3em] text-mood-cyan/60 uppercase">手势校准</p>

            <p className="mt-3 text-[13px] leading-relaxed tracking-[0.06em] text-stardust/90">
              {modal.message || '准备中…'}
            </p>

            {/* 进度环 */}
            <div className="relative mx-auto mt-4 h-16 w-16">
              <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
                <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(223,233,255,0.12)" strokeWidth="3" />
                <circle
                  cx="32"
                  cy="32"
                  r="27"
                  fill="none"
                  stroke={modal.phase === 'fist' ? '#ffb86b' : '#9fd8ff'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 27}
                  strokeDashoffset={2 * Math.PI * 27 * (1 - modal.progress)}
                />
              </svg>
              <span className="absolute inset-0 grid place-items-center font-mono text-[11px] text-stardust/70">
                {modal.liveRatio > 0 ? modal.liveRatio.toFixed(2) : '—'}
              </span>
            </div>

            <p className="mt-3 font-mono text-[9px] tracking-[0.14em] text-stardust/35">
              {modal.phase === 'error' ? '' : `采样 ${modal.samples} 帧`}
            </p>

            <div className="mt-4 flex justify-center gap-2">
              {(modal.phase === 'done' || modal.phase === 'error') && (
                <button
                  type="button"
                  id="calib-retry"
                  onClick={() => getGestureEngine().calibration.start()}
                  className="rounded-full border border-mood-cyan/40 px-3 py-1 font-mono text-[9px] tracking-[0.18em] text-mood-cyan uppercase"
                >
                  再来一次
                </button>
              )}
              <button
                type="button"
                id="calib-close"
                onClick={() => getGestureEngine().calibration.cancel()}
                className="rounded-full border border-stardust/20 px-3 py-1 font-mono text-[9px] tracking-[0.18em] text-stardust/60 uppercase hover:text-stardust"
              >
                关闭
              </button>
            </div>
          </div>
          </div>,
          document.body,
        )}
    </>
  );
}
