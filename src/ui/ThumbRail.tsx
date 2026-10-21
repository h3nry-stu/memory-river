import { useRiverStore } from '@/state';
import { photoSwatch } from '@/photo/ingest';

/**
 * 缩略图条（阶段 2 的"选中"入口）
 *
 * 点击任意缩略图 = 聚焦这张照片并直接推到 L2，方便用鼠标把整条链路跑通；
 * 阶段 3 接手势后，这里就退化成"最近看过的记忆"备选区。
 */
export function ThumbRail() {
  const photos = useRiverStore((s) => s.photos);
  const focusedId = useRiverStore((s) => s.focusedId);
  const focusPhoto = useRiverStore((s) => s.focusPhoto);
  const setLayer = useRiverStore((s) => s.setLayer);
  const removePhoto = useRiverStore((s) => s.removePhoto);

  if (photos.length === 0) return null;

  return (
    <ul className="pointer-events-auto flex items-end gap-2">
      {photos.map((photo) => {
        const active = photo.id === focusedId;
        return (
          <li key={photo.id} className="group relative">
            <button
              type="button"
              id={`thumb-${photo.index}`}
              onClick={() => {
                focusPhoto(photo.id);
                setLayer('L2');
              }}
              title={`${photo.name} · 情绪 ${photo.emotion.toFixed(2)}`}
              className={[
                'relative block h-10 w-10 overflow-hidden rounded-[3px] border transition-all duration-300',
                active
                  ? 'border-mood-warm/80 opacity-100'
                  : 'border-stardust/25 opacity-55 hover:opacity-95',
              ].join(' ')}
              style={{ boxShadow: active ? `0 0 14px ${photoSwatch(photo)}55` : 'none' }}
            >
              <img
                src={photo.url}
                alt={photo.name}
                className="h-full w-full object-cover"
                draggable={false}
              />
              {/* 情绪色条：左暖右冷的映射一眼可见 */}
              <span
                className="absolute inset-x-0 bottom-0 h-[2px]"
                style={{ background: photoSwatch(photo) }}
              />
            </button>
            <button
              type="button"
              onClick={() => removePhoto(photo.id)}
              aria-label={`移除 ${photo.name}`}
              className={[
                'absolute -top-1.5 -right-1.5 hidden h-4 w-4 items-center justify-center rounded-full',
                'bg-cosmos-near/90 text-[9px] text-stardust/60 group-hover:flex hover:text-mood-warm',
              ].join(' ')}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
