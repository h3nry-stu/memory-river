import { PHOTO } from '@/config';

/**
 * 视觉标签提取（导入时跑一次）
 * ────────────────────────────────────────────────────────────────
 * 问题：之前切片的时间地点是**哈希随机**出来的，跟照片里实际有什么无关，
 * 于是 AI 会对着海边的照片说"便利店的关东煮" —— 就是用户说的"识图不准、瞎聊"。
 *
 * 做法：没有云端视觉模型，就用**像素统计**给出可辩护的具体描述：
 *   亮度 / 对比度 / 色温 / 饱和度、九宫格明暗分布、绿色占比、蓝青占比、
 *   肤色占比、高光占比、暗部占比、边缘密度。
 *
 * 这些指标足以说出「大半是暗的」「上半是天空」「很多绿色」「有一盏暖黄的灯」
 * 这类**画面里看得见**的话 —— 正是"说具体细节，不说抽象情绪"的素材来源。
 *
 * 注意：这是统计推断，不是目标检测。所以话术上一律用"看得出/看起来"这种口吻，
 * 不说"这里有一棵树"这种断言（除非绿色占比高到几乎可以确定）。
 */

export interface VisualAnchor {
  /** 稳定英文键，供代码判断 */
  key: 'person' | 'trees' | 'sky' | 'water' | 'night' | 'lights' | 'wall' | 'indoor' | 'street';
  /** 中文名（"树" "人" "夜景"） */
  label: string;
  /** 可以直接念出来的一句话（"有树。" "像是夜里拍的。"） */
  phrase: string;
  /** 置信度 0..1 */
  confidence: number;
}

export interface VisualProfile {
  /** 平均亮度 0..1 */
  brightness: number;
  /** 对比度（亮度标准差） */
  contrast: number;
  /** 饱和度均值 0..1 */
  saturation: number;
  /** 色温：-1 冷 … 1 暖 */
  warmth: number;
  /** 主色名（暖黄 / 冷蓝 / 灰白 / 暗 / 亮） */
  colorName: string;
  /** 九宫格平均亮度（行优先，0..1） */
  grid: readonly number[];
  green: number;
  blue: number;
  skin: number;
  highlight: number;
  shadow: number;
  /** 边缘密度（"东西多不多"） */
  detail: number;
  /**
   * 视觉锚点：**只报高置信度的"东西"**（树 / 人 / 夜景 / 水 / 墙 …）
   *
   * 这是"严禁瞎编"的硬约束：锚点为空 → AI 只能说"记不清"。
   */
  anchors: readonly VisualAnchor[];
  /** 整体置信度（锚点的最高分；0 = 什么都没认出来） */
  confidence: number;
  /** 中文标签，按显著度排序 */
  tags: readonly string[];
  /** 一句话画面描述（≤15 字，Mock 可直接说） */
  headline: string;
  /** 可用于"具体细节"的短语池（都从统计里推出来，说得出口） */
  details: readonly string[];
}

const T = PHOTO.visual.thresholds;
const A = PHOTO.visual.anchors;

/** sRGB → 亮度（0..1） */
function lumaOf(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 肤色近似判定：R 明显高于 G/B，且在合理亮度区间 */
function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r > 60 && g > 30 && b > 15 && r >= g && g >= b && max - min > 12 && max - min < 130;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/**
 * 分析一张已解码的图片
 *
 * @param image 已 load 完成的 HTMLImageElement
 */
export function analyzeImage(image: HTMLImageElement): VisualProfile {
  const size = PHOTO.visual.sampleSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const emptyAnchors: VisualAnchor[] = [];
  const fallback: VisualProfile = {
    brightness: 0.5,
    contrast: 0.2,
    saturation: 0.3,
    warmth: 0,
    colorName: '灰白',
    grid: new Array<number>(9).fill(0.5),
    green: 0,
    blue: 0,
    skin: 0,
    highlight: 0,
    shadow: 0,
    detail: 0.2,
    anchors: emptyAnchors,
    confidence: 0,
    tags: ['看不出什么'],
    headline: '看不出什么。',
    details: ['照片有点模糊。'],
  };
  if (!ctx) return fallback;

  ctx.drawImage(image, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return fallback;
  }

  const grid = new Array<number>(9).fill(0);
  const gridCount = new Array<number>(9).fill(0);
  let sumL = 0;
  let sumL2 = 0;
  let sumSat = 0;
  let sumWarm = 0;
  let green = 0;
  let blue = 0;
  let skin = 0;
  let highlight = 0;
  let shadow = 0;
  let count = 0;

  // 亮度平面（算边缘密度用）
  const plane = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const l = lumaOf(r, g, b);
      plane[y * size + x] = l;

      sumL += l;
      sumL2 += l * l;
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      sumSat += max <= 0 ? 0 : (max - min) / max;
      sumWarm += (r - b) / 255;

      if (g > r * 1.06 && g > b * 1.12) green += 1;
      if (b > r * 1.1 && b > g * 0.98) blue += 1;
      if (isSkin(r, g, b)) skin += 1;
      if (l > 0.82) highlight += 1;
      if (l < 0.16) shadow += 1;

      const gx = Math.min(Math.floor((x / size) * 3), 2);
      const gy = Math.min(Math.floor((y / size) * 3), 2);
      const cell = gy * 3 + gx;
      grid[cell] = (grid[cell] ?? 0) + l;
      gridCount[cell] = (gridCount[cell] ?? 0) + 1;

      count += 1;
    }
  }

  if (count === 0) return fallback;

  const brightness = sumL / count;
  const contrast = Math.sqrt(Math.max(sumL2 / count - brightness * brightness, 0));
  const saturation = sumSat / count;
  const warmth = clamp01((sumWarm / count) * 2.2 + 0.5) * 2 - 1;
  const gridAvg = grid.map((sum, index) => sum / Math.max(gridCount[index] ?? 1, 1));

  // 边缘密度：相邻像素亮度差的平均值（越"东西多"越高）
  let edges = 0;
  let edgeCount = 0;
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const here = plane[y * size + x] ?? 0;
      edges += Math.abs((plane[y * size + x + 1] ?? here) - here);
      edges += Math.abs((plane[(y + 1) * size + x] ?? here) - here);
      edgeCount += 2;
    }
  }
  const detail = edgeCount > 0 ? edges / edgeCount : 0;

  const greenRatio = green / count;
  const blueRatio = blue / count;
  const skinRatio = skin / count;
  const highlightRatio = highlight / count;
  const shadowRatio = shadow / count;

  const top = ((gridAvg[0] ?? 0) + (gridAvg[1] ?? 0) + (gridAvg[2] ?? 0)) / 3;
  const middle = ((gridAvg[3] ?? 0) + (gridAvg[4] ?? 0) + (gridAvg[5] ?? 0)) / 3;

  /* ── 归纳标签（按"说得出口的程度"排序） ── */
  const tags: string[] = [];
  const details: string[] = [];

  if (brightness < T.dark) {
    tags.push('暗');
    details.push('大半是暗的。', '只有几处亮。');
  } else if (brightness > T.bright) {
    tags.push('亮');
    details.push('整张都很亮。', '光很足，几乎没阴影。');
  } else {
    details.push('光很平。', '没有很亮的地方。');
  }

  if (top - middle > T.skyGap && blueRatio > T.blueStrong * 0.6) {
    tags.push('天空在上半');
    details.push('上半是天空。', '上边比下边亮。');
  }
  if (greenRatio > T.greenStrong) {
    tags.push('绿色很多');
    details.push('绿色占了很大一片。', '画面里树影很重。');
  } else if (greenRatio > T.greenSome) {
    tags.push('有些绿色');
    details.push('角落有些绿色。');
  }
  if (blueRatio > T.blueStrong) {
    tags.push('大面积的蓝');
    details.push('蓝色占了大半。');
  }
  if (skinRatio > T.skin) {
    tags.push('画面里有人');
    details.push('画面里有人。', '有人站在光里。');
  }
  if (highlightRatio > T.highlight) {
    tags.push(warmth > T.warm ? '暖色的亮光' : '很亮的点');
    details.push(
      warmth > T.warm ? '有一盏暖黄的灯。' : '有一块很亮的地方。',
      '亮处很亮，像有灯。',
    );
  }
  if (shadowRatio > T.shadow) {
    tags.push('大半在阴影里');
    details.push('大半在阴影里。', '暗部很多。');
  }
  if (detail > T.busy) {
    tags.push('东西很多');
    details.push('画面里东西很多。', '细节很碎。');
  } else if (detail < T.flat) {
    tags.push('大片留白');
    details.push('大片是空的。', '背景很干净。');
  }
  if (warmth > T.warm) {
    tags.push('偏暖');
    details.push('颜色偏暖。', '光是暖的。');
  } else if (warmth < T.cool) {
    tags.push('偏冷');
    details.push('颜色偏冷。', '光是冷的。');
  }
  if (contrast > 0.3) {
    details.push('明暗差很大。');
  }

  /* ── 视觉锚点：只在证据够硬时报，认不出就空 ── */
  const anchors: VisualAnchor[] = [];
  const pushAnchor = (
    key: VisualAnchor['key'],
    label: string,
    phrase: string,
    confidence: number,
  ): void => {
    if (confidence < A.minConfidence) return;
    anchors.push({ key, label, phrase, confidence: Math.min(confidence, 1) });
  };

  // 人：肤色占比（0.06 起算，0.18 满分）
  if (skinRatio > A.person) {
    pushAnchor('person', '人', '有人。', 0.5 + ((skinRatio - A.person) / 0.12) * 0.5);
  }
  // 树/植被：绿色占比
  if (greenRatio > A.green) {
    pushAnchor(
      'trees',
      greenRatio > A.greenStrong ? '很多树' : '树',
      greenRatio > A.greenStrong ? '树很多。' : '有树。',
      0.5 + ((greenRatio - A.green) / 0.2) * 0.5,
    );
  }
  // 天空：上方明显更亮 + 有蓝
  if (top - middle > A.skyGap && blueRatio > A.skyBlue) {
    pushAnchor('sky', '天空', '上方是天空。', 0.5 + (top - middle) * 2);
  }
  // 水：蓝青多 + 细节少
  if (blueRatio > A.waterBlue && detail < A.waterDetail) {
    pushAnchor('water', '水面', '有水。', 0.55 + (blueRatio - A.waterBlue));
  }
  // 夜景：暗 + 有亮点
  if (brightness < A.nightDark && highlightRatio > A.nightHighlight) {
    pushAnchor('night', '夜景', '像是夜里拍的。', 0.6 + (A.nightDark - brightness));
  }
  // 灯光：暖 + 有亮点
  if (highlightRatio > A.lightHighlight && warmth > T.warm) {
    pushAnchor('lights', '暖光', '有暖光。', 0.5 + highlightRatio * 2);
  }
  // 墙/建筑：细节少 + 低饱和
  if (detail < A.wallDetail && saturation < A.wallSat) {
    pushAnchor('wall', '墙', '大面是墙。', 0.55 + (A.wallDetail - detail) * 2);
  }
  // 室内：绿很少 + （偏暖 或 偏暗）
  if (greenRatio < 0.06 && (warmth > A.indoorWarm || brightness < A.nightDark)) {
    pushAnchor('indoor', '室内', '像在室内。', 0.55);
  }
  // 街景/户外：细节多
  if (detail > A.streetDetail && greenRatio < A.greenStrong) {
    pushAnchor('street', '街景', '像在街边。', 0.5 + (detail - A.streetDetail));
  }

  anchors.sort((left, right) => right.confidence - left.confidence);
  const confidence = anchors[0]?.confidence ?? 0;

  const colorName =
    brightness < T.dark
      ? '偏暗'
      : warmth > T.warm
        ? '暖黄'
        : warmth < T.cool
          ? '冷蓝'
          : saturation < 0.12
            ? '灰白'
            : '中间调';

  const headline = (details[0] ?? '看不太清。').replace(/。$/, '。');

  return {
    brightness,
    contrast,
    saturation,
    warmth,
    colorName,
    grid: gridAvg,
    green: greenRatio,
    blue: blueRatio,
    skin: skinRatio,
    highlight: highlightRatio,
    shadow: shadowRatio,
    detail,
    anchors: anchors.slice(0, 4),
    confidence,
    tags: tags.slice(0, PHOTO.visual.maxTags),
    headline,
    details: [...new Set(details)].slice(0, PHOTO.visual.maxTags * 2),
  };
}
