import { AI } from '@/config';

/**
 * 输出护栏
 * ────────────────────────────────────────────────────────────────
 * 不管是 Mock 还是远端模型，说话都得像「溯」：短、具体、没有客服腔。
 * 这里做三件事（都是纯函数，可单测）：
 *   ① 拆掉客服腔 / AI 自我暴露
 *   ② 压到字数上限（在标点处断，不腰斩）
 *   ③ 去掉重复的口头禅与前缀空白
 */

/** 客服腔 / AI 腔：出现就整句删掉 */
const BANNED_PATTERNS: readonly RegExp[] = [
  /请问[^。！？…]{0,20}[？?]?/g,
  /有什么可以帮(到)?(您|你)[^。！？…]{0,10}[？?]?/g,
  /很高兴为您(服务|解答)/g,
  /作为(一个)?(AI|人工智能)[^。！？…]{0,12}[。，]?/g,
  /我是(一个)?(AI|人工智能|语言模型)[^。！？…]{0,12}[。，]?/g,
  /希望能(帮到你|对你有所帮助)[^。！？…]{0,8}[。]?/g,
  /抱歉[，,]?/g,
  /好的[，,]?(?=[我你])/g,
];

/**
 * 建议腔 / 说教腔：树洞不说话，只记得
 *
 * 「今天好累」不该得到"建议你早点休息" —— 那是客服，不是溯。
 * 只要句子里出现"建议/应该/可以试试/你需要"，整句删掉。
 */
const ADVICE_PATTERNS: readonly RegExp[] = [
  /[^。！？…]*建议[^。！？…]*[。！？…]?/g,
  /[^。！？…]*应该[^。！？…]*[。！？…]?/g,
  /[^。！？…]*(可以|不妨|不如)(试试|试着|试一下)[^。！？…]*[。！？…]?/g,
  /[^。！？…]*(你|您)需要[^。！？…]*[。！？…]?/g,
  /[^。！？…]*(要|得)(多|好好)(休息|照顾自己|注意身体)[^。！？…]*[。！？…]?/g,
  /[^。！？…]*注意身体[^。！？…]*[。！？…]?/g,
  /[^。！？…]*(如果|要是)(你)?(想|需要)[^。！？…]*(随时|可以)(找|告诉)我[^。！？…]*[。！？…]?/g,
];

/**
 * 抽象情绪 / 猜测情绪 → 直接删
 *
 * 铁律：说具体细节，不说抽象情绪。
 *   ❌「你一定很难过吧」「我很心疼你」「希望你能好起来」
 * 这类句子即使模型吐出来也要被拆掉 —— 它们让分身变成安慰机器。
 */
const ABSTRACT_EMOTION: readonly RegExp[] = [
  /[^。！？…]*你一定[^。！？…]*[。！？…]?/g,
  /[^。！？…]*我(很|也)心疼[^。！？…]*[。！？…]?/g,
  /[^。！？…]*(希望|愿你)[^。！？…]*[。！？…]?/g,
  /[^。！？…]*抱抱[^。！？…]*[。！？…]?/g,
  /[^。！？…]*(加油|振作|坚强)[^。！？…]*[。！？…]?/g,
  /[^。！？…]*(温暖|治愈)的?(人|光|陪伴)[^。！？…]*[。！？…]?/g,
];

/** 拦掉"总结陈词"式的抒情结尾（铁律：不写抒情总结） */
const SENTIMENTAL_TAIL =
  /[，,]?\s*(那(真|是)(是|一段)?(美好|很好|难忘)的(时光|日子|回忆)|愿(你|一切)[^。！？…]*|时间过得真快)[。！？…]?/g;

/** 严格模式（默认不再使用；想恢复“拦截建议腔/客服腔”时调用它） */
export function stripBanned(text: string): string {
  let out = text;
  for (const pattern of BANNED_PATTERNS) out = out.replace(pattern, '');
  for (const pattern of ADVICE_PATTERNS) out = out.replace(pattern, '');
  for (const pattern of ABSTRACT_EMOTION) out = out.replace(pattern, '');
  out = out.replace(SENTIMENTAL_TAIL, '');
  return out.replace(/^[\s。，,、]+/, '').trim();
}

/** 在标点处截断到 max 字（尽量不留半句） */
export function clipToChars(text: string, max: number = AI.reply.hardMaxChars): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;

  const window = clean.slice(0, max);
  const lastPunct = Math.max(
    window.lastIndexOf('。'),
    window.lastIndexOf('！'),
    window.lastIndexOf('？'),
    window.lastIndexOf('…'),
  );
  if (lastPunct >= Math.max(6, max * 0.4)) return window.slice(0, lastPunct + 1);
  // 退一步找逗号，避免读起来像被切断
  const lastComma = Math.max(window.lastIndexOf('，'), window.lastIndexOf('、'));
  if (lastComma >= Math.max(6, max * 0.5)) return `${window.slice(0, lastComma)}。`;
  return `${window}…`;
}

/**
 * 单句限长：超过 `maxChars` 的句子在标点处断开，断不开就裁掉后面
 *
 * 铁律「短句为主（不超过 15 个字）」就靠这一条守。
 */
export function clampSentences(text: string, maxChars: number = AI.reply.sentenceMaxChars): string {
  const sentences = text
    .split(/(?<=[。！？…；])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    // 先试逗号：切成两句
    const pieces = sentence.split(/(?<=[，、])/).map((part) => part.trim()).filter(Boolean);
    if (pieces.length > 1 && pieces.every((piece) => piece.length <= maxChars)) {
      for (const piece of pieces) {
        out.push(/[。！？…]$/.test(piece) ? piece : `${piece.replace(/[，、]$/, '')}。`);
      }
      continue;
    }
    // 还是太长：硬裁并收句
    out.push(`${sentence.slice(0, maxChars)}。`);
  }
  return out.join('');
}

/**
 * 最终过一遍护栏：客服腔 → 建议腔 → 抽象情绪 → 抒情尾 → 单句限长 → 总字数 → 去重
 *
 * @param raw 模型/Mock 的原始输出
 */
export function guard(text: string, _options: { maxChars?: number } = {}): string {
  // 不再裁句、不再删建议/抒情、不再压字数：模型想怎么说就怎么说。
  // 只做最基本的首尾空白清理，保留模型自己的换行与语气。
  return text.replace(/\r\n/g, '\n').trim();
}

/** 字数/句数体检（DEV 探针用） */
export function inspect(text: string): { chars: number; sentences: number; asksQuestion: boolean } {
  const sentences = text.split(/[。！？…]/).filter((part) => part.trim().length > 0).length;
  return {
    chars: text.length,
    sentences,
    asksQuestion: /[？?]/.test(text),
  };
}
