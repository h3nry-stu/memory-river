import { AI, MEMORY } from '@/config';
import type { ChatTurn } from '@/state';
import { memePromptEntries } from './memeLibrary';
import { composePersonaHeader } from './persona';
import type { Citation } from './retrieval';
import type { SliceProfile } from './slices';

/**
 * Prompt 组装（2026-10 交接重构）
 * ────────────────────────────────────────────────────────────────
 * 只喂**真实存在**的资料：
 *   · 用户实际导入的文件名
 *   · 画面统计数据（可能不准，明确标注为参考）
 *   · 之前真实发生过的对话 / 别的照片里真实说过的话
 *
 * 不再注入虚构的年份、城市、住址、人物志。系统没拿到 EXIF 或用户输入时，
 * 明确告诉模型"没有拍摄时间/地点/来源地址"，避免它把不存在的信息说成真的。
 *
 * 输出风格完全交给模型；这里不裁句子、不限制字数、不规定句式。
 */

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 画面资料：只描述统计结果，不伪装成事实 */
export function buildVisualSection(profile: SliceProfile): string {
  const visual = profile.visual;
  const vlm = profile.vlm;

  if (vlm?.status === 'ready' && vlm.summary) {
    const lines = [`- 摘要：${vlm.summary}`];
    if (vlm.scene) lines.push(`- 场景：${vlm.scene}`);
    if (vlm.objects.length > 0) lines.push(`- 物体：${vlm.objects.join('、')}`);
    lines.push(`- 人物：${vlm.people}`);
    if (vlm.lighting) lines.push(`- 光线：${vlm.lighting}`);
    if (vlm.colors.length > 0) lines.push(`- 颜色：${vlm.colors.join('、')}`);
    if (vlm.visibleText) lines.push(`- 画面文字：${vlm.visibleText}`);
    if (vlm.mood) lines.push(`- 氛围：${vlm.mood}`);
    if (vlm.uncertain.length > 0) lines.push(`- 不确定：${vlm.uncertain.join('、')}`);
    return [
      '# VLM 对这张照片的描述',
      `- 文件名：${profile.fileName}`,
      ...lines,
      '',
      '系统没有提供这张照片的拍摄时间、拍摄地点、来源地址或人物身份。',
      '如果对方问起这些，直接说明你不知道；不要把视觉猜测说成确定事实。',
    ].join('\n');
  }

  const anchors = visual.anchors.map((anchor) => anchor.label);
  const lines = anchors.length
    ? [`- 视觉识别到的元素：${anchors.join('、')}`]
    : ['- 视觉识别没有给出可靠元素'];
  lines.push(`- 画面整体：${visual.headline}`);
  lines.push(`- 主色：${visual.colorName}`);
  if (visual.details.length > 0) {
    lines.push(`- 统计细节：${visual.details.slice(0, 4).join('')}`);
  }
  return [
    '# 这张照片的真实资料',
    `- 文件名：${profile.fileName}`,
    ...lines,
    '',
    '系统没有提供这张照片的拍摄时间、拍摄地点、来源地址或人物身份。',
    '如果对方问起这些，直接说明你不知道；不要把视觉猜测说成确定事实。',
  ].join('\n');
}

export function buildSliceSection(profile: SliceProfile): string {
  const facts = profile.facts
    .slice()
    .sort((a, b) => b.salience - a.salience)
    .slice(0, MEMORY.slice.maxFacts)
    .map((fact) => `- ${fact.text}`)
    .join('\n');

  return [
    `# 你正在对话的这张照片`,
    `你会以「${AI.personaName}」的身份，和用户聊这张照片以及用户愿意说的任何事。`,
    facts
      ? `关于这张照片，可参考的画面事实：\n${facts}`
      : '这张照片没有提取到可靠的画面事实。',
    `你也可以使用对话历史里用户亲口说过的信息；不要替用户编造经历。`,
  ].join('\n');
}

export function buildRetrievalSection(
  citations: readonly Citation[],
  sharedEmotions: readonly string[],
): string {
  if (citations.length === 0) return '';
  const lines = citations.map(
    (item) =>
      `- 来自「${item.sliceLabel}」${item.role === 'user' ? '（用户当时说的）' : '（你当时回复的）'}：${item.text}`,
  );
  const emotionLine = sharedEmotions.length
    ? `\n这些内容与当前话题有相近的情绪：${sharedEmotions.join('、')}。`
    : '';
  return [
    `# 你和用户在其它照片里真实聊过的内容`,
    '只在相关时自然提起；不相关就不用管它。',
    ...lines,
    emotionLine,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * 连发消息格式
 *
 * 人格 instruction 里描述的是“这个人习惯怎么连发”。
 * 这里只给一个极轻量的传输协议，让聊天模型把多句话拆成多条消息。
 * 不限制内容、长度或语气。
 */
export function buildReplyFormatSection(): string {
  return [
    '# 消息格式',
    '如果这个人的说话习惯是连发多条消息，请把回复拆成多条。',
    '每条消息之间用单独一行 <<<MSG>>> 分隔。',
    '不要解释这个分隔符，也不要用 markdown 代码块包裹。',
    '如果只适合回一条，就不要使用分隔符。',
  ].join('\n');
}

/** 动态热梗库：只在幽默损友 + 轻松语境注入少量候选 */
export function buildMemeSection(required = false, context = ''): string {
  if (!required) return '';
  const entries = memePromptEntries(AI.lab.maxMemePromptEntries, context);
  if (entries.length === 0) return '';
  const primary = entries[0]!;
  return [
    '# 本轮必须用热梗',
    '你是幽默损友，这轮语境轻松。必须从下面热梗里自然用上 1 个，最多 1 个：',
    ...entries.map((entry) => `- ${entry.word}：${entry.meaning}`),
    '',
    `优先用「${primary.word}」，它和当前话题最接近。`,
    '不要解释这个梗，不要生硬堆砌，直接接进回复。',
  ].join('\n');
}

export function buildSystemPrompt(
  profile: SliceProfile,
  citations: readonly Citation[],
  sharedEmotions: readonly string[],
  personaId: string = AI.defaultPersonaId,
  memeRequired = false,
  memeContext = '',
): string {
  return [
    composePersonaHeader(personaId),
    '',
    buildVisualSection(profile),
    '',
    buildSliceSection(profile),
    '',
    buildRetrievalSection(citations, sharedEmotions),
    '',
    buildMemeSection(memeRequired, memeContext),
    '',
    buildReplyFormatSection(),
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

/** 历史压缩成 messages（只带最近若干轮，超出的已在归档里） */
export function buildHistoryMessages(turns: readonly ChatTurn[]): PromptMessage[] {
  const recent = turns.slice(-MEMORY.slice.maxTranscriptTurns);
  return recent.map((turn) => ({
    role: turn.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: turn.text,
  }));
}

/** 完整请求体（远端使用） */
export function buildMessages(
  profile: SliceProfile,
  turns: readonly ChatTurn[],
  userText: string,
  citations: readonly Citation[],
  sharedEmotions: readonly string[],
  personaId: string = AI.defaultPersonaId,
  memeRequired = false,
): PromptMessage[] {
  return [
    {
      role: 'system',
      content: buildSystemPrompt(
        profile,
        citations,
        sharedEmotions,
        personaId,
        memeRequired,
        userText,
      ),
    },
    ...buildHistoryMessages(turns),
    { role: 'user', content: userText },
  ];
}
