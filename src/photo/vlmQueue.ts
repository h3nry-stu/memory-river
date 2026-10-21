import { useRiverStore } from '@/state';
import {
  hasAvailableVlm,
  readApiSettings,
  resolvedVisionConfig,
} from '@/ai/settings';
import { forgetSlice } from '@/ai/slices';
import { emptyVlmAnalysis, analyzePhotoWithVlm } from './vlmVision';

/**
 * 照片 VLM 分析队列
 * ────────────────────────────────────────────────────────────────
 * - 串行，避免一次导入多张时并发刷爆接口
 * - 同一张照片不会重复排队
 * - 照片被删除时丢弃结果
 * - 自动扫描只在配置了可用 VLM 时执行
 */

const queue: string[] = [];
const queued = new Set<string>();
let running = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const photoId = queue.shift();
      if (!photoId) continue;
      if (!hasAvailableVlm()) {
        queued.delete(photoId);
        continue;
      }

      const before = useRiverStore.getState().photos.find((photo) => photo.id === photoId);
      if (!before) {
        queued.delete(photoId);
        continue;
      }

      const result = await analyzePhotoWithVlm(before, {
        highQuality: readApiSettings().visionHighQuality,
      });

      // 分析期间照片可能被删除 / 清空
      const still = useRiverStore.getState().photos.some((photo) => photo.id === photoId);
      if (still) {
        useRiverStore.getState().setPhotoVlm(photoId, result);
        forgetSlice(photoId);
      }
      queued.delete(photoId);
      await delay(250);
    }
  } finally {
    running = false;
  }
}

/** 手动重新识图 / 自动扫描都走这里；force=true 时忽略已有 ready/error */
export function enqueuePhotoAnalysis(photoId: string, force = false): boolean {
  if (!hasAvailableVlm()) return false;
  const photo = useRiverStore.getState().photos.find((item) => item.id === photoId);
  if (!photo) return false;
  if (queued.has(photoId)) return false;
  if (!force && (photo.vlm?.status === 'ready' || photo.vlm?.status === 'error')) {
    return false;
  }
  if (photo.vlm?.status === 'analyzing' && !force) return false;

  queued.add(photoId);
  queue.push(photoId);
  useRiverStore.getState().setPhotoVlm(
    photoId,
    emptyVlmAnalysis('analyzing', resolvedVisionConfig().model),
  );
  void drain();
  return true;
}

/** 导入 / 设置变化后扫描：只处理尚未识图的照片 */
export function scanPendingPhotoAnalyses(): void {
  const settings = readApiSettings();
  if (!settings.visionAutoAnalyze) return;
  if (!hasAvailableVlm()) return;
  for (const photo of useRiverStore.getState().photos) {
    if (!photo.vlm) enqueuePhotoAnalysis(photo.id);
  }
}

/** 手动重试 */
export function reanalyzePhoto(photoId: string): boolean {
  return enqueuePhotoAnalysis(photoId, true);
}
