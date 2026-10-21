/**
 * AI 连发消息解析
 * ────────────────────────────────────────────────────────────────
 * 聊天模型用 `<<<MSG>>>` 分隔多条消息。
 * `text` 保存完整自然回复（分隔符替换为换行），`bubbles` 只给 UI。
 */

export const MESSAGE_DELIMITER = '<<<MSG>>>';

export function parseReplyBubbles(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const parts = text
    .split(/<<<MSG>>>/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length <= 1) return [text];
  return parts;
}

/** 完整回复：把多条消息拼回自然文本，绝不带分隔符 */
export function replyTextFromBubbles(bubbles: readonly string[]): string {
  return bubbles.join('\n').trim();
}
