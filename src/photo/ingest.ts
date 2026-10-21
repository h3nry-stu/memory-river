import { analyzeImage } from './vision';
import type { VisualProfile } from './vision';
import { emotionToHex } from '@/particles/emotion';
import { photoXForIndex } from '@/particles/riverPath';
import type { PhotoMemory } from './types';

/**
 * 文件 → PhotoMemory
 *
 * 三步：解码 → 采样出平均色 → 平均色映射成「情绪温度」与时间轴位置。
 * 情绪色规则（决策）：暖（偏红黄）落在左侧，冷（偏蓝青）落在右侧。
 */

let counter = 0;

/** 把图片解码成 HTMLImageElement（不依赖 DOM 布局，直接 createImageBitmap 也可以，
 * 但后续要上传成 THREE.Texture，用 Image 最省事且兼容）。 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = url;
  });
}

/** 从图片算平均色（缩到很小再取平均，速度快且稳定） */
function averageColorOf(image: HTMLImageElement): { r: number; g: number; b: number } {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { r: 128, g: 128, b: 128 };

  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = (data[i + 3] ?? 255) / 255;
    if (alpha < 0.02) continue;
    r += (data[i] ?? 0) * alpha;
    g += (data[i + 1] ?? 0) * alpha;
    b += (data[i + 2] ?? 0) * alpha;
    weight += alpha;
  }
  if (weight === 0) return { r: 128, g: 128, b: 128 };
  return { r: r / weight, g: g / weight, b: b / weight };
}

/**
 * 平均色 → 情绪温度 0..1
 * 用「红蓝差」为主、「亮度」为辅：夕阳偏暖、海雾偏冷，正好是我们要的两端。
 */
function emotionFromColor(color: { r: number; g: number; b: number }): number {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const warmth = (r - b) * 1.35 + (g - b) * 0.35;
  const emotion = 0.5 + warmth * 1.15;
  return Math.min(Math.max(emotion, 0), 1);
}

async function readFile(file: File): Promise<PhotoMemory> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const averageColor = averageColorOf(image);
    const emotion = emotionFromColor(averageColor);
    // 视觉标签：导入时算一次，之后 AI 说"画面里"的话全靠它
    const visual: VisualProfile = analyzeImage(image);
    const aspect = image.naturalWidth / Math.max(image.naturalHeight, 1);

    counter += 1;
    return {
      id: `photo-${Date.now().toString(36)}-${counter}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      image,
      url,
      aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
      emotion,
      // 位置先占个坑，导入后由 assignPositions() 统一按顺序铺开
      x: 0,
      averageColor,
      index: counter,
      visual,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * 批量导入 + 沿时间轴排布
 * 同一批里如果有情绪接近的照片，按最小间距顺次错开，避免堆在一个点上。
 */
export async function ingestFiles(files: File[]): Promise<PhotoMemory[]> {
  const accepted = files.filter((file) => file.type.startsWith('image/'));
  if (accepted.length === 0) return [];

  const photos: PhotoMemory[] = [];
  for (const file of accepted) {
    try {
      photos.push(await readFile(file));
    } catch (error) {
      console.warn('[photo] 跳过一张无法解码的图片', file.name, error);
    }
  }
  return photos;
}

/**
 * 沿长河排布：**按导入顺序从左到右**
 *
 * 长河现在是无限长的轨道，照片的世界 x = 序号 × spacing。
 * 新导入的照片落在最右边；删掉一张后面会自动补齐。
 * 情绪只决定粒子的颜色，不再决定位置（位置由时间/顺序决定）。
 */
export function assignPositions(photos: PhotoMemory[]): PhotoMemory[] {
  return photos.map((photo, index) => ({ ...photo, x: photoXForIndex(index) }));
}

/** 给 UI 用：照片情绪对应的色块 */
export function photoSwatch(photo: PhotoMemory): string {
  return emotionToHex(photo.emotion);
}
