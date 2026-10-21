import { MEMORY } from '@/config';
import type { PhotoMemory, PhotoVlmAnalysis } from '@/photo/types';
import type { MemoryFact, MemorySlice } from '@/memory';
import type { VisualProfile } from '@/photo/vision';

/**
 * 切片：一张照片 = 溯与这段记忆的连接
 * ────────────────────────────────────────────────────────────────
 * 重要修正：
 *  - **不再**用 photoId 哈希编造年份 / 季节 / 城市。
 *    系统没有拿到 EXIF 或用户输入时，就是不知道时间与地点。
 *  - 标签使用用户实际导入的文件名，引用别的照片时来源对得上。
 *  - 事实只来自画面统计（可能不准，但至少不是凭空生成）。
 */

export interface SliceProfile extends MemorySlice {
  /** 只由视觉锚点推出（水边 / 屋里 / 夜里），认不出就是 null */
  placeName: string | null;
  /** 无真实时间数据时为空串 */
  season: string;
  air: string;
  voice: string;
  youDetail: string;
  props: readonly string[];
  sounds: readonly string[];
  tone: SliceTone;
  place: string | null;
  /** 无真实地点数据时为空串 */
  city: string;
  cityRelation: 'home' | 'visited' | 'unknown';
  /** UI 标签：文件名（+ 视觉场景），引用时能对上是哪一张 */
  label: string;
  /** 原始文件名 */
  fileName: string;
  visual: VisualProfile;
  /** VLM 真实识图结果（ready 时优先于像素统计） */
  vlm?: PhotoVlmAnalysis;
}

export type SliceTone = 'warm' | 'neutral' | 'cold';

function sceneFromAnchors(visual: VisualProfile): string | null {
  const keys = new Set(visual.anchors.map((anchor) => anchor.key));
  if (keys.has('water')) return '水边';
  if (keys.has('trees') && keys.has('sky')) return '树底下';
  if (keys.has('trees')) return '有树的地方';
  if (keys.has('street')) return keys.has('person') ? '人多的地方' : '街边';
  if (keys.has('sky')) return '开阔地';
  if (keys.has('wall')) return '墙边';
  if (keys.has('indoor')) return '屋里';
  if (keys.has('night')) return '夜里';
  if (keys.has('person')) return '有人的地方';
  return null;
}

function toneOf(emotion: number): SliceTone {
  if (emotion >= 0.62) return 'warm';
  if (emotion <= 0.38) return 'cold';
  return 'neutral';
}

const cache = new Map<string, SliceProfile>();

export function sliceForPhoto(photo: PhotoMemory): SliceProfile {
  const cached = cache.get(photo.id);
  if (
    cached &&
    (cached.vlm?.updatedAt ?? 0) === (photo.vlm?.updatedAt ?? 0)
  ) {
    return cached;
  }

  const visual = photo.visual;
  const placeName = sceneFromAnchors(visual);
  const fileName = photo.name.trim() || '未命名照片';
  const label = placeName ? `${fileName} · ${placeName}` : fileName;

  const facts: MemoryFact[] = [];
  const fact = (text: string, tags: readonly string[], salience: number): void => {
    facts.push({
      id: `${photo.id}-f${facts.length + 1}`,
      text,
      tags,
      salience,
      source: 'photo',
    });
  };

  // 只写画面统计能支持的内容；没有时间/城市就不写
  for (const anchor of visual.anchors) {
    fact(anchor.phrase, ['画面', '锚点', anchor.key], 0.99);
  }
  if (placeName) fact(`画面看起来在${placeName}。`, ['画面', '地点'], 0.95);

  // VLM 真实识图优先：摘要、场景、可见物体、画面文字
  if (photo.vlm?.status === 'ready') {
    const vlm = photo.vlm;
    if (vlm.summary) fact(vlm.summary, ['画面', 'vlm'], 1);
    if (vlm.scene) fact(`场景：${vlm.scene}。`, ['画面', 'vlm', '场景'], 0.97);
    if (vlm.objects.length > 0) {
      fact(`画面里有：${vlm.objects.slice(0, 8).join('、')}。`, ['画面', 'vlm', '物体'], 0.96);
    }
    if (vlm.visibleText) fact(`画面文字：${vlm.visibleText.slice(0, 120)}`, ['画面', 'vlm', '文字'], 0.94);
  }

  const profile: SliceProfile = {
    id: photo.id,
    imageUrl: photo.url,
    year: null,
    title: label,
    emotion: photo.emotion,
    facts: facts.slice(0, MEMORY.slice.maxFacts),
    archive: [],
    place: placeName,
    placeName,
    season: '',
    air: '',
    voice: '自然表达',
    youDetail: '',
    props: [],
    sounds: [],
    tone: toneOf(photo.emotion),
    city: '',
    cityRelation: 'unknown',
    label,
    fileName,
    visual,
    ...(photo.vlm ? { vlm: photo.vlm } : {}),
  };

  cache.set(photo.id, profile);
  return profile;
}

/** 第一句话只描述画面；没有可靠信息就不编 */
export function openingFor(profile: SliceProfile): string {
  const anchors = profile.visual.anchors;
  if (anchors.length === 0) return '这张我看不太清。';
  const labels = anchors.slice(0, 2).map((anchor) => anchor.label);
  return labels.length >= 2 ? `${labels[0]}，还有${labels[1]}。` : `${labels[0] ?? ''}。`;
}

/** 某张照片的识图结果更新后丢弃切片缓存 */
export function forgetSlice(photoId: string): void {
  cache.delete(photoId);
}

export function resetSliceCache(): void {
  cache.clear();
}
