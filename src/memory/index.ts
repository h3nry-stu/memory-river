/**
 * 记忆层
 * ────────────────────────────────────────────────────────────────
 * 阶段 0：类型契约 + 四层结构说明（已可用）。
 * 阶段 3：store.ts（本地持久化：切片导入、事实抽取、对话归档）
 * 阶段 4：retrieval.ts（embedding + topK 检索，参数见 MEMORY.retrieval）
 *
 * 铁律：切片不装全局事实（MEMORY.persona.preloadGlobalIntoSlice = false），
 * 但分身可以检索全局人物志与其它切片（MEMORY.retrieval.allowGlobalLookup）。
 */
export type {
  MemoryFact,
  MemorySlice,
  TranscriptTurn,
  ArchiveSummary,
  RetrievalQuery,
  RetrievedMemory,
} from './types';

/** 四层记忆的固定顺序，UI/日志统一引用，避免各处硬编码中文 */
export const MEMORY_LAYERS = ['slice', 'archive', 'persona', 'retrieval'] as const;
export type MemoryLayer = (typeof MEMORY_LAYERS)[number];
