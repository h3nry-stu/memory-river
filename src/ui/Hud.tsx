import { useEffect } from 'react';
import { INPUT, LAYERS, LAYER_ORDER, UI_COPY } from '@/config';
import { DropZone } from './DropZone';
import { ThumbRail } from './ThumbRail';
import { useRiverStore } from '@/state';
import { isTextEntry } from './dom';

/**
 * HUD 叠层
 *
 * 现在承担：
 *  1. 层级导轨（L0–L3）+ 当前层级名
 *  2. 输入模式切换（按 G / 点按钮）
 *  3. 渲染遥测：帧率 / LOD 档位 / 粒子数 —— 阶段 1 靠它肉眼验收性能
 *  4. 涟漪提示：告诉观众可以点水面
 *
 * 阶段 2 会长出取景框、光标拖尾、悬停进度环、手势丢失提示。
 */
export function Hud() {
  const layer = useRiverStore((s) => s.layer);
  const inputMode = useRiverStore((s) => s.inputMode);
  const gestureStatus = useRiverStore((s) => s.gestureStatus);
  const telemetry = useRiverStore((s) => s.telemetry);
  const toggleInputMode = useRiverStore((s) => s.toggleInputMode);
  const openSettings = useRiverStore((s) => s.openSettings);
  const musicEnabled = useRiverStore((s) => s.musicEnabled);
  const setMusicEnabled = useRiverStore((s) => s.setMusicEnabled);
  const photos = useRiverStore((s) => s.photos);
  const focusedId = useRiverStore((s) => s.focusedId);
  /**
   * 对话打开时（L2 + 沉浸层）→ 让出底部
   *
   * 底部右上是遥测、左下是缩略图，而对话的胶囊/输入也在底部。
   * 两套控件叠在一起正是"按钮挤成一团"的来源 —— 对话期间底部交给对话层，
   * 遥测与缩略图整体淡出（顶部信息保留）。
   */
  const dialogOpen = useRiverStore((s) => s.dialogOpen);
  const immersive = dialogOpen && layer === 'L2';
  const focusedName = photos.find((photo) => photo.id === focusedId)?.name;

  // 注意：层级键位（↑↓/WASD/Esc）由 scene/layerRig 统一处理，
  // HUD 只负责输入模式切换，避免两处同时响应导致"一次滚两格"。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // 在对话面板里打字时不要被"G 切模式"打断
      if (isTextEntry(event.target)) return;
      if (event.code === INPUT.toggleKey) {
        event.preventDefault();
        toggleInputMode();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleInputMode]);

  const fpsTone =
    telemetry.fps >= 55 ? 'text-stardust/45' : telemetry.fps >= 40 ? 'text-mood-warm/70' : 'text-mood-warm';

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6 select-none sm:p-8">
      {/* ── 顶部：标题 + 层级导轨 + 输入模式 ── */}
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[13px] font-light tracking-[0.42em] text-stardust/85">{UI_COPY.appTitle}</h1>
          <p className="mt-2 font-mono text-[9px] tracking-[0.3em] text-mood-cyan/35 uppercase">
            memory river · v{__APP_VERSION__}
          </p>
        </div>

        <div className="flex items-center gap-5">
          <ol className="flex items-center gap-2" aria-label="层级">
            {LAYER_ORDER.map((id, index) => {
              const active = id === layer;
              return (
                <li key={id} className="flex items-center gap-2">
                  {index > 0 && <span className="h-px w-3 bg-stardust/15" aria-hidden="true" />}
                  <span
                    className={[
                      'font-mono text-[9px] tracking-[0.2em] transition-colors duration-500',
                      active ? 'text-mood-warm' : 'text-stardust/25',
                    ].join(' ')}
                    aria-current={active ? 'true' : undefined}
                  >
                    {id}
                    <span className="sr-only">{LAYERS[id].label}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <DropZone />

          <button
            type="button"
            onClick={toggleInputMode}
            aria-pressed={inputMode === 'gesture'}
            className={[
              'pointer-events-auto rounded-full border px-3 py-1 font-mono text-[9px] tracking-[0.22em] uppercase',
              'transition-colors duration-300 hover:border-mood-cyan/45 hover:text-mood-cyan/90',
              'border-stardust/15 text-stardust/55',
            ].join(' ')}
            title={`按 ${INPUT.toggleKey.replace('Key', '')} 切换`}
          >
            {inputMode === 'gesture' ? '手势' : '鼠标'}
            <span className="ml-2 text-stardust/25">G</span>
          </button>

          {/* 环境音快捷开关（详细音量在设置里） */}
          <button
            type="button"
            id="music-toggle"
            onClick={() => setMusicEnabled(!musicEnabled)}
            aria-pressed={musicEnabled}
            aria-label={musicEnabled ? '关闭环境音与音效' : '打开环境音与音效'}
            title={musicEnabled ? '环境音：开（进入 L2 淡入）' : '环境音：关'}
            className={[
              'pointer-events-auto relative z-[60] grid h-8 w-8 place-items-center rounded-full',
              'border backdrop-blur-xl transition-all duration-300',
              musicEnabled
                ? 'border-mood-cyan/30 bg-mood-cyan/[0.08] text-mood-cyan/70'
                : 'border-stardust/15 bg-white/[0.035] text-stardust/35',
            ].join(' ')}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M11 5 6.8 8.4H3.5v7.2h3.3L11 19V5Z" />
              {musicEnabled ? (
                <>
                  <path d="M15 9.2a4 4 0 0 1 0 5.6" />
                  <path d="M17.8 6.6a7.6 7.6 0 0 1 0 10.8" />
                </>
              ) : (
                <path d="m15.5 9 4.5 6M20 9l-4.5 6" />
              )}
            </svg>
          </button>

          {/* 设置：右上角齿轮。z-[60]，永远在 HUD / 对话之上且只接收自己的点击 */}
          <button
            type="button"
            id="settings-open"
            onClick={openSettings}
            aria-label="打开设置与配置"
            title="设置与配置"
            className={[
              'pointer-events-auto relative z-[60] grid h-8 w-8 place-items-center rounded-full',
              'border border-stardust/18 bg-white/[0.045] text-stardust/55 backdrop-blur-xl',
              'transition-all duration-300 hover:rotate-45 hover:border-mood-cyan/45 hover:text-mood-cyan/90',
            ].join(' ')}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3.1" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.36 1.06V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.06-.36H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .36-1.06V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.36.34.7.6 1 .3.3.68.47 1.06.47H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── 底部：提示 + 遥测（对话打开时整体淡出） ── */}
      <footer
        className={[
          'flex items-end justify-between gap-6 transition-opacity duration-500',
          immersive ? 'pointer-events-none opacity-0' : 'opacity-100',
        ].join(' ')}
      >
        <div className="max-w-[46ch]">
          <p className="text-[11px] leading-relaxed tracking-[0.06em] text-stardust/45">
            {photos.length === 0 ? (
              <>把照片拖进窗口，或点右下角「导入照片」</>
            ) : (
              <>
                {inputMode === 'gesture'
                  ? '手腕左右扇一下 → 换记忆　手停住张合 → 缩放　捏合/握拳 → 进入'
                  : '拖拽换记忆 · 滚轮缩放 · 点击进入'}
                {focusedName && <span className="text-mood-warm/70"> · 正在看「{focusedName}」</span>}
              </>
            )}
          </p>
          {(gestureStatus === 'lost' || (gestureStatus === 'unavailable' && inputMode === 'pointer')) && (
            <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-mood-warm/80">
              {gestureStatus === 'lost' ? '看不到手了 · 可点击鼠标继续' : '摄像头不可用 · 可点击鼠标继续'}
            </p>
          )}
          <p className="mt-1.5 font-mono text-[9px] tracking-[0.16em] text-stardust/25">
            {inputMode === 'gesture'
              ? `${UI_COPY.handFrameHint} · 按 G 切鼠标`
              : `鼠标模式 · 按 G 切手势`}
            {gestureStatus === 'unavailable' && inputMode === 'gesture' && (
              <span className="ml-2 text-mood-warm/60">{UI_COPY.cameraDeniedHint}</span>
            )}
          </p>
          <div className="mt-2">
            <ThumbRail />
          </div>
        </div>

        <div className="flex items-end gap-5">
          {/* 遥测：阶段 1 的验收仪表 */}
          <dl className="flex items-center gap-3 font-mono text-[9px] tracking-[0.14em] text-stardust/30">
            <div className="flex items-center gap-1.5">
              <dt className="uppercase">fps</dt>
              <dd className={fpsTone}>{telemetry.fps || '—'}</dd>
            </div>
            <span className="h-2.5 w-px bg-stardust/15" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              <dt className="uppercase">lod</dt>
              <dd className="text-stardust/50">{telemetry.tier}</dd>
            </div>
            <span className="h-2.5 w-px bg-stardust/15" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              <dt className="uppercase">pts</dt>
              <dd className="text-stardust/50">
                {telemetry.particles ? `${Math.round(telemetry.particles / 1000)}k` : '—'}
              </dd>
            </div>
            <span className="h-2.5 w-px bg-stardust/15" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              <dt className="uppercase">photos</dt>
              <dd className="text-stardust/50">{telemetry.photoCount || photos.length}</dd>
            </div>
            <span className="h-2.5 w-px bg-stardust/15" aria-hidden="true" />
            <div className="flex items-center gap-1.5">
              <dt className="uppercase">zoom</dt>
              <dd className="text-stardust/50">{telemetry.layerProgress.toFixed(2)}</dd>
            </div>
          </dl>

          <p className="font-mono text-[9px] tracking-[0.26em] text-stardust/25 uppercase">
            {LAYERS[layer].label}
          </p>
        </div>
      </footer>
    </div>
  );
}
