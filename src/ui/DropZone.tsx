import { useCallback, useEffect, useRef, useState } from 'react';
import { PHOTO } from '@/config';
import { ingestFiles } from '@/photo/ingest';
import { useRiverStore } from '@/state';

/**
 * 照片导入入口（阶段 2）
 *
 * 两种方式，都指向同一个 `ingestFiles`：
 *  1. 右下角的「导入照片」按钮 → 系统文件选择器
 *  2. 直接把图片拖到窗口任意位置 → 松手即导入（拖拽时全屏提示）
 *
 * 导入后照片存在内存里（store.photos），并且立刻在长河上得到位置；
 * 阶段 3 会把这里换成 IndexedDB 持久化，交互不变。
 */
export function DropZone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const photos = useRiverStore((s) => s.photos);
  const importing = useRiverStore((s) => s.importing);
  const setImporting = useRiverStore((s) => s.setImporting);
  const addPhotos = useRiverStore((s) => s.addPhotos);

  const ingest = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setImporting(true);
      try {
        const list = await ingestFiles(files);
        const room = PHOTO.maxPhotos - useRiverStore.getState().photos.length;
        addPhotos(room > 0 ? list.slice(0, room) : []);
      } finally {
        setImporting(false);
      }
    },
    [addPhotos, setImporting],
  );

  // 窗口级拖拽：避免落在 canvas 上时被浏览器当作"打开文件"
  useEffect(() => {
    let depth = 0;

    function onDragEnter(event: DragEvent): void {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    }
    function onDragOver(event: DragEvent): void {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
    function onDragLeave(event: DragEvent): void {
      event.preventDefault();
      depth = Math.max(depth - 1, 0);
      if (depth === 0) setDragging(false);
    }
    function onDrop(event: DragEvent): void {
      if (!event.dataTransfer) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      void ingest(files);
    }

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [ingest]);

  return (
    <>
      {/* 拖拽覆盖层 */}
      <div
        className={[
          'pointer-events-none fixed inset-0 z-20 flex items-center justify-center',
          'transition-opacity duration-300',
          dragging ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-hidden={!dragging}
      >
        <div className="absolute inset-6 rounded-3xl border border-dashed border-mood-cyan/40 bg-cosmos-near/55 backdrop-blur-sm" />
        <p className="relative text-[12px] tracking-[0.3em] text-mood-cyan/80">松手，把照片放进长河</p>
      </div>

      {/* 导入按钮 */}
      <div className="pointer-events-auto flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO.accept}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = ''; // 允许重复选择同一张
            void ingest(files);
          }}
        />
        <button
          type="button"
          id="import-photos"
          onClick={() => inputRef.current?.click()}
          disabled={importing || photos.length >= PHOTO.maxPhotos}
          className={[
            'group flex items-center gap-2 rounded-full border px-4 py-1.5',
            'font-mono text-[10px] tracking-[0.2em] uppercase transition-colors duration-300',
            'border-stardust/20 text-stardust/70',
            'hover:border-mood-warm/60 hover:text-mood-warm',
            'disabled:cursor-not-allowed disabled:opacity-40',
          ].join(' ')}
          title="也可以直接把图片拖进窗口"
        >
          <span className="text-[13px] leading-none">＋</span>
          {importing ? '打散中…' : '导入照片'}
          {photos.length > 0 && (
            <span className="text-stardust/35">{photos.length}</span>
          )}
        </button>
      </div>
    </>
  );
}
