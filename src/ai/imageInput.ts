import { AI } from '@/config';

/**
 * 图片输入工具（VLM Base64）
 * ────────────────────────────────────────────────────────────────
 * 默认给截图用高清 PNG（文字边缘更锐）；
 * 照片分析可传 2800px / JPEG 0.95。
 * 高清 PNG 过大时自动降级 JPEG，避免请求体爆掉。
 */

export interface ImageEncodeOptions {
  maxEdgePx?: number;
  quality?: number;
  format?: 'jpeg' | 'png';
}

const SCREENSHOT_OPTIONS: Required<ImageEncodeOptions> = {
  maxEdgePx: AI.vision.screenshot.maxEdgePx,
  quality: AI.vision.screenshot.quality,
  format: 'png',
};

const PHOTO_OPTIONS: Required<ImageEncodeOptions> = {
  maxEdgePx: AI.vision.photo.maxEdgePx,
  quality: AI.vision.photo.quality,
  format: 'jpeg',
};

const FALLBACK_OPTIONS: Required<ImageEncodeOptions> = {
  maxEdgePx: AI.vision.fallback.maxEdgePx,
  quality: AI.vision.fallback.quality,
  format: 'jpeg',
};

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = url;
  });
}

function drawScaled(
  image: HTMLImageElement | HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
  maxEdgePx: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxEdgePx / Math.max(sourceWidth, sourceHeight, 1));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, options: Required<ImageEncodeOptions>): string {
  if (options.format === 'png') {
    const png = canvas.toDataURL('image/png');
    // 超大截图降级 JPEG，避免超过服务商请求体限制
    if (png.length <= 4_500_000) return png;
    return canvas.toDataURL('image/jpeg', options.quality);
  }
  return canvas.toDataURL('image/jpeg', options.quality);
}

/** HTMLImageElement → data URL（照片分析 / 已解码图片） */
export function imageElementToDataUrl(
  image: HTMLImageElement,
  options: ImageEncodeOptions = PHOTO_OPTIONS,
): string {
  const resolved: Required<ImageEncodeOptions> = {
    maxEdgePx: options.maxEdgePx ?? PHOTO_OPTIONS.maxEdgePx,
    quality: options.quality ?? PHOTO_OPTIONS.quality,
    format: options.format ?? PHOTO_OPTIONS.format,
  };
  const canvas = drawScaled(
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    resolved.maxEdgePx,
  );
  return encode(canvas, resolved);
}

/** File / Blob → data URL（默认截图高清 PNG） */
export async function imageFileToDataUrl(
  file: File,
  options: ImageEncodeOptions = SCREENSHOT_OPTIONS,
): Promise<string> {
  if (!isImageFile(file)) throw new Error('不是图片文件');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return imageElementToDataUrl(image, options);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 高清失败后的降级编码 */
export function imageElementToFallbackDataUrl(image: HTMLImageElement): string {
  return imageElementToDataUrl(image, FALLBACK_OPTIONS);
}

export function imageFileToFallbackDataUrl(file: File): Promise<string> {
  return imageFileToDataUrl(file, FALLBACK_OPTIONS);
}

/** 从剪贴板事件里取出全部图片 */
export function imagesFromClipboard(event: ClipboardEvent): File[] {
  const data = event.clipboardData;
  if (!data) return [];
  const files: File[] = [];
  for (const item of data.items) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length > 0) return files;
  return Array.from(data.files).filter(isImageFile);
}

/** 从剪贴板事件里取第一张图片 */
export function imageFromClipboard(event: ClipboardEvent): File | null {
  return imagesFromClipboard(event)[0] ?? null;
}

/** 从拖拽事件里取出全部图片 */
export function imagesFromDataTransfer(data: DataTransfer | null): File[] {
  return data ? Array.from(data.files).filter(isImageFile) : [];
}

/** 从拖拽事件里取第一张图片 */
export function imageFromDataTransfer(data: DataTransfer | null): File | null {
  return imagesFromDataTransfer(data)[0] ?? null;
}
