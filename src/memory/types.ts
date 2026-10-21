/**
 * 记忆架构的四层（与 config.MEMORY 对应）
 *
 *  1. 切片记忆 slice     —— 一张照片 = 一个分身。只装这件事本身（人/地/物/情绪）
 *  2. 对话归档 archive   —— 与该分身的对话压缩后的摘要，累积沉淀
 *  3. 全局人物志 persona —— 所有切片共享的总人格事实库（"溯"是谁、和"我"什么关系）
 *  4. 检索层 retrieval   —— 切片不预载全局，但可以**检索**全局与其它切片
 *
 * 一句话：切片不装全局，但能检索全局。
 */

/** 一条事实（人物志 / 切片共用） */
export interface MemoryFact {
  id: string;
  /** 事实正文，一句话，具体 */
  text: string;
  /** 主题标签，用于检索加权 */
  tags: readonly string[];
  /** 重要度 0..1，注入 prompt 时按此截断预算 */
  salience: number;
  /** 来源：照片本身 / 用户对话中说出 / 推断（推断须标记，便于更正） */
  source: 'photo' | 'dialogue' | 'inferred';
}

/** 一个记忆切片 = 一个 AI 分身 */
export interface MemorySlice {
  /** 与 PhotoParticleSource.id 对应 */
  id: string;
  /** 照片地址（阶段 3 由用户导入） */
  imageUrl: string;
  /** 年份（未知则 null，落位见 TIMELINE.unknownYearPosition） */
  year: number | null;
  /** 一句话标题，用于 L2 展示与光河标签 */
  title: string;
  /** 情绪 0..1（0 冷蓝 → 1 暖金），驱动粒子色 */
  emotion: number;
  /** 本切片独有的事实（不预载全局） */
  facts: MemoryFact[];
  /** 已压缩的对话归档 */
  archive: ArchiveSummary[];
}

/** 一轮对话 */
export interface TranscriptTurn {
  role: 'user' | 'persona';
  text: string;
  timestampMs: number;
}

/** 对话归档摘要 */
export interface ArchiveSummary {
  sliceId: string;
  summary: string;
  turnCount: number;
  createdAtMs: number;
}

/** 检索请求：切片向全局/其它切片发起的查询 */
export interface RetrievalQuery {
  sliceId: string;
  text: string;
  topK: number;
}

/** 检索结果：带出处，便于分身说「我好像听谁提起过」 */
export interface RetrievedMemory {
  fact: MemoryFact;
  /** 出自哪个切片；全局人物志为 null */
  fromSliceId: string | null;
  score: number;
}
