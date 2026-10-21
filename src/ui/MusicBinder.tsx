import { useRef, useState } from 'react';
import { useRiverStore } from '@/state';
import type { PhotoAudio, PhotoMemory } from '@/photo/types';
import { getMusicEngine } from '@/music';

/**
 * L2 照片配乐入口
 * ────────────────────────────────────────────────────────────────
 * 一张照片只能绑定一首歌；重新绑定会覆盖。
 * 进入 L2 循环播放，离开 L1/L0 淡出。
 */
export function MusicBinder({ photo }: { photo: PhotoMemory }) {
  const setPhotoAudio = useRiverStore((s) => s.setPhotoAudio);
  const [open, setOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = photo.audio;

  const apply = (audio: PhotoAudio | null): void => {
    setPhotoAudio(photo.id, audio);
    void getMusicEngine().unlock();
    setMessage(audio ? `已绑定：${audio.name}` : '已清除配乐（该照片静音）');
    setUrlDraft('');
  };

  const chooseFile = (file: File): void => {
    if (!file.type.startsWith('audio/')) {
      setMessage('请选择音频文件');
      return;
    }
    const url = URL.createObjectURL(file);
    apply({ url, name: file.name.replace(/\.[^.]+$/, ''), source: 'file' });
  };

  const useUrl = (): void => {
    const value = urlDraft.trim();
    if (!value) return;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setMessage('只支持 http / https 音频链接');
        return;
      }
    } catch {
      setMessage('链接格式不正确');
      return;
    }
    const name = decodeURIComponent(value.split('/').pop()?.split('?')[0] ?? '') || '网络音频';
    apply({ url: value, name: name.replace(/\.[^.]+$/, ''), source: 'url' });
  };

  return (
    <div className="relative flex justify-end">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) chooseFile(file);
        }}
      />

      <button
        type="button"
        data-music-bind="1"
        onClick={() => {
          setOpen((value) => !value);
          void getMusicEngine().unlock();
        }}
        title="为这张照片绑定一首配乐（L2 循环）"
        className={[
          'pointer-events-auto flex items-center gap-1.5 rounded-full border px-3 py-1.5',
          'bg-white/[0.06] font-mono text-[9px] tracking-[0.12em] backdrop-blur-xl transition',
          current
            ? 'border-mood-cyan/35 text-mood-cyan/75'
            : 'border-white/14 text-stardust/45 hover:border-mood-cyan/35 hover:text-stardust/75',
        ].join(' ')}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18V5l10-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="16" cy="16" r="3" />
        </svg>
        <span className="max-w-[10rem] truncate">{current ? current.name : '配乐'}</span>
      </button>

      {open && (
        <div
          data-music-bind-panel="1"
          className={[
            'absolute bottom-full right-0 z-[70] mb-2.5 w-[min(19rem,calc(100vw-2rem))]',
            'rounded-2xl border border-white/16 bg-cosmos-near/80 p-3.5 backdrop-blur-2xl',
            'shadow-[0_18px_50px_-18px_rgba(0,0,0,0.95)]',
          ].join(' ')}
        >
          <p className="font-mono text-[8.5px] tracking-[0.18em] text-mood-cyan/45">
            照片配乐 · L2 循环
          </p>
          <p className="mt-1 text-[9px] leading-relaxed text-stardust/30">
            一张照片一首；重新绑定会覆盖。
          </p>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-3 w-full rounded-xl border border-white/16 bg-white/[0.06] px-3 py-2 text-left font-mono text-[9.5px] tracking-[0.08em] text-stardust/70 transition hover:border-mood-cyan/40 hover:text-stardust"
          >
            选择本地音频文件
          </button>

          <div className="mt-2 flex gap-1.5">
            <input
              type="url"
              value={urlDraft}
              onChange={(event) => setUrlDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  useUrl();
                }
              }}
              placeholder="或粘贴音频 URL"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-white/12 bg-black/20 px-2.5 py-1.5 font-mono text-[9px] text-stardust/80 outline-none placeholder:text-stardust/22 focus:border-mood-cyan/40"
            />
            <button
              type="button"
              onClick={useUrl}
              className="shrink-0 rounded-lg border border-mood-cyan/30 bg-mood-cyan/10 px-2.5 py-1.5 font-mono text-[9px] text-mood-cyan/80 transition hover:bg-mood-cyan/18"
            >
              使用
            </button>
          </div>

          {current && (
            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-white/8 pt-2">
              <span className="min-w-0 truncate font-mono text-[8.5px] text-stardust/40">
                当前：{current.name}
              </span>
              <button
                type="button"
                onClick={() => apply(null)}
                className="shrink-0 font-mono text-[8.5px] text-stardust/28 hover:text-mood-warm/75"
              >
                清除
              </button>
            </div>
          )}

          {message && (
            <p className="mt-2 text-[8.5px] leading-relaxed text-mood-cyan/55">{message}</p>
          )}
        </div>
      )}
    </div>
  );
}
