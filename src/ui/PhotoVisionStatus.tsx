import { useSettingsStore } from '@/ai/settings';
import { hasAvailableVlm } from '@/ai/settings';
import type { PhotoMemory } from '@/photo/types';
import { reanalyzePhoto } from '@/photo/vlmQueue';

/**
 * L2 照片识图状态
 *
 * 没有可用 VLM 时整块返回 null（不显示“未安装/未识图”）。
 * 有 VLM 时才出现：让溯看看 / 识图中 / 已识图 / 失败重试。
 */
export function PhotoVisionStatus({ photo }: { photo: PhotoMemory }) {
  // settings revision 变化时重新判断是否有 VLM
  useSettingsStore((state) => state.revision);

  if (!hasAvailableVlm()) return null;

  const status = photo.vlm?.status;
  const summary = photo.vlm?.summary;
  const error = photo.vlm?.error;

  const retry = (): void => {
    reanalyzePhoto(photo.id);
  };

  if (status === 'analyzing') {
    return (
      <span
        data-photo-vision="analyzing"
        className="pointer-events-none flex items-center gap-1.5 rounded-full border border-mood-cyan/25 bg-mood-cyan/[0.06] px-3 py-1.5 font-mono text-[9px] tracking-[0.12em] text-mood-cyan/60 backdrop-blur-xl"
      >
        <span className="h-3 w-3 animate-spin rounded-full border border-mood-cyan/25 border-t-mood-cyan/80" />
        识图中…
      </span>
    );
  }

  if (status === 'ready') {
    return (
      <button
        type="button"
        data-photo-vision="ready"
        onClick={retry}
        title={summary || '已识图，点击重新识别'}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-[#7cffc4]/25 bg-[#7cffc4]/[0.055] px-3 py-1.5 font-mono text-[9px] tracking-[0.12em] text-[#7cffc4]/70 backdrop-blur-xl transition hover:border-[#7cffc4]/45"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#7cffc4] shadow-[0_0_8px_rgba(124,255,196,0.8)]" />
        已识图
      </button>
    );
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        data-photo-vision="error"
        onClick={retry}
        title={error || '识图失败，点击重试'}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-red-300/25 bg-red-400/[0.06] px-3 py-1.5 font-mono text-[9px] tracking-[0.12em] text-red-200/65 backdrop-blur-xl transition hover:border-red-300/45"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-300/80" />
        识图失败 · 重试
      </button>
    );
  }

  return (
    <button
      type="button"
      data-photo-vision="idle"
      onClick={retry}
      title="让 VLM 仔细观察这张照片"
      className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/14 bg-white/[0.05] px-3 py-1.5 font-mono text-[9px] tracking-[0.12em] text-stardust/50 backdrop-blur-xl transition hover:border-mood-cyan/35 hover:text-stardust/80"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.6" />
      </svg>
      让溯看看
    </button>
  );
}
