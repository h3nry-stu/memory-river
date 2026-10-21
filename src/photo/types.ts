import type { LayerId } from '@/config';
import type { VisualProfile } from './vision';

/** 一张照片最多绑定一首配乐；重新绑定会覆盖 */
export interface PhotoAudio {
  url: string;
  name: string;
  source: 'file' | 'url';
}

/**
 * 一张照片 = 一个记忆切片在视觉层的化身。
 *
 * 阶段 2 只做视觉与布局：情绪色暂由图片平均色推导（决策：左侧暖金、右侧冷蓝），
 * 阶段 4 接入 AI 后会由切片事实覆盖 emotion 与 title。
 */
export interface PhotoMemory {
  id: string;
  /** 原始文件名（展示用） */
  name: string;
  /** 已解码的图片元素（内存持有；objectURL 在同一生命周期内有效） */
  image: HTMLImageElement;
  /** objectURL，移除时 revoke */
  url: string;
  /** 宽高比（w / h） */
  aspect: number;
  /** 情绪温度 0..1（0 = 冷蓝，1 = 暖金），由平均色推导 */
  emotion: number;
  /**
   * 长河上的世界坐标 x（无限长河的绝对位置）。
   * 由导入顺序决定：第 i 张 = i × PHOTO.spacing —— 新导入的自动落在右边。
   */
  x: number;
  /** 平均色（sRGB，0..255），调试与 UI 色块用 */
  averageColor: { r: number; g: number; b: number };
  /** 导入顺序 */
  index: number;
  /** 这张照片的配乐（L2 循环；一张照片只有一首） */
  audio?: PhotoAudio;
  /** VLM 真实视觉分析（可能尚未开始 / 失败） */
  vlm?: PhotoVlmAnalysis;
  /**
   * 视觉标签（导入时从像素统计出来）
   * AI 说话的具体细节就来自这里 —— 没有它就只能泛泛而谈。
   */
  visual: VisualProfile;
}

/** 一张照片在 3D 世界里的落点（由 slot 决定，Stage 计算后回填给 UI） */
export interface PhotoAnchor {
  id: string;
  layer: LayerId;
}

/** VLM 对照片的真实视觉分析（导入后异步生成） */
export interface PhotoVlmAnalysis {
  status: 'analyzing' | 'ready' | 'error';
  summary: string;
  scene: string;
  objects: string[];
  people: 'none' | 'present' | 'unclear';
  lighting: string;
  colors: string[];
  visibleText: string;
  mood: string;
  tags: string[];
  uncertain: string[];
  confidence: number;
  model: string;
  error?: string;
  updatedAt: number;
}
