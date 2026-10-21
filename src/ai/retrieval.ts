import { AI, MEMORY } from '@/config';
import type { ChatTurn } from '@/state';
import type { RetrievedMemory } from '@/memory';
import type { SliceProfile } from './slices';

/**
 * 检索层：切片不预载全局，但可以**检索**
 * ────────────────────────────────────────────────────────────────
 * 这是「一张图一个分身，但总体是同一个人」能被说出来（而不是被设定）的关键：
 *   当前切片说话之前，先去**别的切片**的对话归档里查一遍：
 *   用户是不是在另一张照片里说过相关的话？情绪是不是同一个？
 *
 * 实现取舍：不引入 embedding 模型（体积/网络/首帧成本都不划算），
 * 用「中文二元组 + 情绪标签」的轻量词法匹配。对这种短句、口语化、情绪高度重复的
 * 对话来说，词法匹配的召回已经够用，而且完全离线、可解释、可复现。
 */

/** 一条可被检索的记忆（来自某个切片的对话或事实） */
export interface CorpusEntry {
  sliceId: string;
  sliceLabel: string;
  /** 文本正文 */
  text: string;
  /** 角色：用户说过的话权重更高，那才是"你刚才说" */
  role: 'user' | 'persona' | 'fact';
  atMs: number;
  tags: readonly string[];
}

/**
 * 地点标签：系统没有真实的照片地点数据，因此不再从虚构城市池里匹配。
 * 保留函数是为了兼容旧调用；跨图检索现在只依赖对话文本本身。
 */
export function placeTagsOf(_text: string): string[] {
  return [];
}

/** 一句话的可检索标签：情绪 */
export function tagsOf(text: string): string[] {
  return [...emotionTagsOf(text)];
}

/** 情绪 → 归一化标签（把"难受/想哭/沉"都收进 sad） */
export function emotionTagsOf(text: string): string[] {
  const tags: string[] = [];
  for (const [tag, words] of Object.entries(AI.slices.emotions)) {
    if (words.some((word) => text.includes(word))) tags.push(tag);
  }
  return tags;
}

/** 中文二元组（去掉标点与空白） */
function bigrams(text: string): Set<string> {
  const clean = text.replace(/[\s，。、？！…“”"'（）()·—\-~,.!?;:]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i += 1) out.add(clean.slice(i, i + 2));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const gram of a) if (b.has(gram)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

/** 建索引：把「其它切片」的对话与事实摊平成可检索的条目 */
export function buildCorpus(
  profiles: readonly SliceProfile[],
  chatByPhoto: Readonly<Record<string, readonly ChatTurn[]>>,
  excludeSliceId: string,
  digestsByPhoto: Readonly<Record<string, readonly { text: string; atMs: number }[]>> = {},
): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  for (const profile of profiles) {
    if (profile.id === excludeSliceId) continue;
    const turns = chatByPhoto[profile.id] ?? [];

    // 摘要排在最前：它们是"被压实确认过"的事，检索权重更高
    for (const digest of digestsByPhoto[profile.id] ?? []) {
      entries.push({
        sliceId: profile.id,
        sliceLabel: profile.label,
        text: digest.text,
        role: 'fact',
        atMs: digest.atMs,
        tags: [...tagsOf(digest.text)],
      });
    }
    for (const turn of turns) {
      entries.push({
        sliceId: profile.id,
        sliceLabel: `${profile.label}`,
        text: turn.text,
        role: turn.role,
        atMs: turn.atMs,
        tags: [...tagsOf(turn.text), ...turn.tags],
      });
    }
    for (const fact of profile.facts) {
      entries.push({
        sliceId: profile.id,
        sliceLabel: profile.label,
        text: fact.text,
        role: 'fact',
        atMs: 0,
        tags: [...fact.tags],
      });
    }
  }
  return entries;
}

/** 一条可引用的跨图记忆 */
export interface Citation extends RetrievedMemory {
  /** 来源切片 id（= 那张照片的 photoId） */
  sliceId: string;
  sliceLabel: string;
  text: string;
  role: CorpusEntry['role'];
}

export interface RetrievalResult {
  /** 跨图引用（按分数降序） */
  items: Citation[];
  /** 命中的情绪标签（跨图串联的口语化依据） */
  sharedEmotions: string[];
  /** 命中的城市标签（地点串联的依据：武汉 / 杭州 …） */
  sharedPlaces: string[];
}

/**
 * 检索：给定用户这句话，去别的切片里找"呼应"
 *
 * 打分 = 词法重合 × 0.55 + 情绪标签重合 × 0.30 + 用户发言加成 × 0.15
 * 门槛 `MEMORY.retrieval.minScore`：低于它宁可不引用，也不要硬拽关系
 * （硬拽会让分身听起来像在做检索任务，而不是在回忆）。
 */
export function retrieve(
  query: string,
  corpus: readonly CorpusEntry[],
  options: { topK?: number } = {},
): RetrievalResult {
  const topK = options.topK ?? MEMORY.retrieval.topK;
  if (corpus.length === 0 || query.trim().length === 0) {
    return { items: [], sharedEmotions: [], sharedPlaces: [] };
  }

  const queryGrams = bigrams(query);
  const queryEmotions = new Set(emotionTagsOf(query));
  const scored: (Citation & { score: number })[] = [];

  for (const entry of corpus) {
    const lexical = overlap(queryGrams, bigrams(entry.text));
    const emotionHit = entry.tags.some((tag) => queryEmotions.has(tag));
    const userBonus = entry.role === 'user' ? 1 : entry.role === 'persona' ? 0.4 : 0.25;
    const score =
      lexical * 0.6 +
      (emotionHit ? 0.4 : 0) +
      (lexical > 0.2 ? 0.15 * userBonus : 0);
    if (score < MEMORY.retrieval.minScore) continue;
    scored.push({
      fact: {
        id: `${entry.sliceId}:${entry.atMs}:${entry.text.slice(0, 8)}`,
        text: entry.text,
        tags: entry.tags,
        salience: score,
        source: entry.role === 'fact' ? 'photo' : 'dialogue',
      },
      fromSliceId: entry.sliceId,
      score,
      sliceId: entry.sliceId,
      sliceLabel: entry.sliceLabel,
      text: entry.text,
      role: entry.role,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // 每个切片最多贡献 perSliceLimit 条，避免被同一张图刷屏
  const perSlice = new Map<string, number>();
  const items: Citation[] = [];
  for (const item of scored) {
    const sliceId = item.fromSliceId ?? item.sliceId;
    const used = perSlice.get(sliceId) ?? 0;
    if (used >= MEMORY.retrieval.perSliceLimit) continue;
    perSlice.set(sliceId, used + 1);
    items.push(item);
    if (items.length >= topK) break;
  }

  // 只在"当前这句话确实表达了情绪"时才算共享情绪，避免无中生有
  const sharedEmotions = queryEmotions.size
    ? [...queryEmotions].filter((tag) => items.some((item) => item.fact.tags.includes(tag)))
    : [];
  return { items, sharedEmotions, sharedPlaces: [] };
}
