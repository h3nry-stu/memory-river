import { create } from 'zustand';
import { AI } from '@/config';

/**
 * 人格蒸馏结果（localStorage）
 * ────────────────────────────────────────────────────────────────
 * ⚠️ 安全 / 性能铁律：
 *   - `rawCorpus` 只用于编辑回显，**永远不进入聊天 System Prompt**
 *   - `instruction` 才是蒸馏后的可用人格指令
 *   - 聊天请求只读 instruction
 */

export interface PersonaProfile {
  /** LLM 蒸馏出的 300 字人格指令 + 模拟问答案例 */
  instruction: string;
  /** 原始语料：仅本地保存，刷新后可继续编辑 */
  rawCorpus: string;
  updatedAt: number;
  /** 蒸馏时使用的模型（诊断用） */
  model: string;
  /** 原始语料字符数（诊断用） */
  sourceChars: number;
}

type PersonaProfiles = Record<string, PersonaProfile>;

export interface PersonaProfilesStore {
  profiles: PersonaProfiles;
  revision: number;
  save(personaId: string, patch: {
    instruction: string;
    rawCorpus: string;
    model: string;
  }): void;
  saveRaw(personaId: string, rawCorpus: string): void;
  clear(personaId: string): void;
}

const STORAGE_KEY = AI.lab.personaStorageKey;

function clampCorpus(text: string): string {
  return text.length > AI.lab.maxRawCorpusChars
    ? text.slice(0, AI.lab.maxRawCorpusChars)
    : text;
}

function load(): PersonaProfiles {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<PersonaProfile> | undefined>;
    const out: PersonaProfiles = {};
    for (const persona of AI.personas) {
      const item = parsed[persona.id];
      if (!item) continue;
      const instruction = typeof item.instruction === 'string' ? item.instruction.trim() : '';
      const rawCorpus = typeof item.rawCorpus === 'string' ? clampCorpus(item.rawCorpus) : '';
      if (!instruction && !rawCorpus) continue;
      out[persona.id] = {
        instruction,
        rawCorpus,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        model: typeof item.model === 'string' ? item.model : '',
        sourceChars: rawCorpus.length,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function persist(profiles: PersonaProfiles): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // localStorage 满了 / 隐私模式：保留内存状态，不阻断聊天
  }
}

const initial = load();

export const usePersonaProfilesStore = create<PersonaProfilesStore>()((set, get) => ({
  profiles: initial,
  revision: 0,

  save(personaId, patch) {
    const instruction = patch.instruction.trim();
    if (!instruction) return;
    const rawCorpus = clampCorpus(patch.rawCorpus);
    const next: PersonaProfiles = {
      ...get().profiles,
      [personaId]: {
        instruction,
        rawCorpus,
        updatedAt: Date.now(),
        model: patch.model,
        sourceChars: rawCorpus.length,
      },
    };
    persist(next);
    set({ profiles: next, revision: get().revision + 1 });
  },

  saveRaw(personaId, rawCorpus) {
    const current = get().profiles[personaId];
    const corpus = clampCorpus(rawCorpus);
    const next: PersonaProfiles = {
      ...get().profiles,
      [personaId]: {
        instruction: current?.instruction ?? '',
        rawCorpus: corpus,
        updatedAt: current?.updatedAt ?? Date.now(),
        model: current?.model ?? '',
        sourceChars: corpus.length,
      },
    };
    persist(next);
    set({ profiles: next, revision: get().revision + 1 });
  },

  clear(personaId) {
    const current = get().profiles[personaId];
    if (!current) return;
    // 恢复默认 Prompt，但保留原始语料用于继续编辑
    const next: PersonaProfiles = {
      ...get().profiles,
      [personaId]: {
        ...current,
        instruction: '',
        updatedAt: Date.now(),
      },
    };
    persist(next);
    set({ profiles: next, revision: get().revision + 1 });
  },
}));

/** 供 Prompt 读取：只返回蒸馏后的 instruction */
export function personaInstruction(personaId: string): string | null {
  const profile = usePersonaProfilesStore.getState().profiles[personaId];
  return profile?.instruction.trim() ? profile.instruction.trim() : null;
}

export function personaRawCorpus(personaId: string): string {
  return usePersonaProfilesStore.getState().profiles[personaId]?.rawCorpus ?? '';
}

export function hasCustomPersona(personaId: string): boolean {
  return Boolean(personaInstruction(personaId));
}
