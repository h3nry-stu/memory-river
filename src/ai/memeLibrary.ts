import { create } from 'zustand';
import { AI } from '@/config';

/**
 * 动态热梗库（localStorage）
 * ────────────────────────────────────────────────────────────────
 * 来源：用户在设置面板上传截图 → VLM 识别 → JSON 数组 → 去重合并。
 * 聊天时只注入最近的少量词条，避免 Prompt 膨胀。
 */

export interface MemeEntry {
  word: string;
  meaning: string;
  addedAt: number;
}

export interface MemeLibraryStore {
  entries: MemeEntry[];
  revision: number;
  merge(list: { word: string; meaning: string }[]): { added: number; updated: number };
  remove(word: string): void;
  clear(): void;
}

const STORAGE_KEY = AI.lab.memeStorageKey;

function clean(value: unknown, maxChars: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxChars) : '';
}

export function normalizeMemeList(input: unknown): { word: string; meaning: string }[] {
  if (!Array.isArray(input)) return [];
  const out: { word: string; meaning: string }[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const word = clean(record.word, AI.lab.maxMemeWordChars);
    const meaning = clean(record.meaning, AI.lab.maxMemeMeaningChars);
    if (!word || !meaning) continue;
    out.push({ word, meaning });
  }
  return out;
}

/**
 * 解析 VLM 返回的 JSON。
 * 正常只接受纯 JSON；同时容忍模型偶尔包一层 ```json 代码块。
 */
export function parseMemeJson(text: string): { word: string; meaning: string }[] {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(withoutFence) as unknown;
  return normalizeMemeList(parsed);
}

function load(): MemeEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeMemeList(parsed).map((item) => {
      const source = (parsed as Record<string, unknown>[]).find(
        (entry) => clean(entry.word, AI.lab.maxMemeWordChars) === item.word,
      );
      return {
        ...item,
        addedAt:
          typeof source?.addedAt === 'number' && Number.isFinite(source.addedAt)
            ? source.addedAt
            : Date.now(),
      };
    });
  } catch {
    return [];
  }
}

function persist(entries: MemeEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 配额满：保留内存状态，聊天仍可继续
  }
}

const initial = load();

export const useMemeLibraryStore = create<MemeLibraryStore>()((set, get) => ({
  entries: initial,
  revision: 0,

  merge(list) {
    const current = get().entries;
    const byWord = new Map(current.map((entry) => [entry.word.toLocaleLowerCase(), entry]));
    let added = 0;
    let updated = 0;

    for (const item of normalizeMemeList(list)) {
      const key = item.word.toLocaleLowerCase();
      const existing = byWord.get(key);
      if (existing) {
        if (existing.meaning !== item.meaning) updated += 1;
        byWord.set(key, { ...existing, ...item, addedAt: Date.now() });
      } else {
        byWord.set(key, { ...item, addedAt: Date.now() });
        added += 1;
      }
    }

    const entries = [...byWord.values()]
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, AI.lab.maxMemeEntries);
    persist(entries);
    set({ entries, revision: get().revision + 1 });
    return { added, updated };
  },

  remove(word) {
    const key = word.toLocaleLowerCase();
    const entries = get().entries.filter((entry) => entry.word.toLocaleLowerCase() !== key);
    persist(entries);
    set({ entries, revision: get().revision + 1 });
  },

  clear() {
    persist([]);
    set({ entries: [], revision: get().revision + 1 });
  },
}));

/** 明显不适合聊天自然使用的词条：不进入候选 */
const UNSAFE_MEME = /擦边|成人色彩|色情|约炮|裸|嫖|性行为|做爱/i;

function bigrams(text: string): string[] {
  const clean = text.replace(/[\s，。、？！…“”"'（）()·—\-~,.!?;:]/g, '');
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) out.push(clean.slice(i, i + 2));
  return out;
}

function memeRelevance(entry: MemeEntry, query: string): number {
  if (!query.trim()) return 0;
  const grams = new Set(bigrams(query));
  let score = 0;
  for (const gram of grams) {
    if (entry.word.includes(gram)) score += 5;
    if (entry.meaning.includes(gram)) score += 2;
  }
  return score;
}

/**
 * 聊天 Prompt 使用的热梗候选（只读快照）
 *
 * - 默认按最近添加排序
 * - 传入 query 时按中文二元组相关度排序，最相关的排第一
 * - 过滤明显不适合自然玩梗的擦边词条
 */
export function memePromptEntries(
  limit: number = AI.lab.maxMemePromptEntries,
  query = '',
): MemeEntry[] {
  const entries = useMemeLibraryStore.getState().entries;
  const usable = entries.filter((entry) => !UNSAFE_MEME.test(`${entry.word} ${entry.meaning}`));
  const pool = usable.length > 0 ? usable : entries;
  return [...pool]
    .sort(
      (a, b) =>
        memeRelevance(b, query) - memeRelevance(a, query) || b.addedAt - a.addedAt,
    )
    .slice(0, limit);
}
