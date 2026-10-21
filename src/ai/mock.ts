import { AI } from '@/config';
import type { ChatCitation, ChatTurn } from '@/state';
import type { Citation } from './retrieval';
import type { SliceProfile } from './slices';
import type { VisualAnchor } from '@/photo/vision';
import { guard } from './guard';
import { personaById } from './persona';
import { emotionTagsOf } from './retrieval';

/**
 * Mock 回复引擎（无 key / 断网 / 超时都落这里）
 * ────────────────────────────────────────────────────────────────
 * 【话术铁律】（用户锁定版，改文案前先读这一遍）
 *   ① 安静、温和、记得细节。禁止说教，禁止客服腔，允许说"我记不清了"
 *   ② 陈述 : 提问 ≈ 3:1，**绝不连续追问**
 *   ③ 说画面里看得见的具体细节，不说抽象情绪
 *        ❌「你一定很难过吧」   ✅「你笑得很用力」
 *   ④ 单句 ≤ 15 字（guard 会硬裁）
 *   ⑤ 先接住用户的话，再延伸一句；不总结、不抒情、不劝
 *
 * 结构永远是三段里的一小部分：
 *   [接住 ≤5字] + [具体：画面细节 / 切片事实 / 跨图引用] + [偶尔一个短问句]
 *
 * 具体细节的来源优先级：**画面视觉标签** > 切片事实 > 不确定。
 * 因为"识图准"才是这个分身的可信度来源。
 */

export interface MockInput {
  profile: SliceProfile;
  /** 本切片的历史（不含这一句） */
  turns: readonly ChatTurn[];
  userText: string;
  citations: readonly Citation[];
  sharedEmotions: readonly string[];
  /** 命中的城市（地点串联：武汉 / 杭州 …） */
  sharedPlaces?: readonly string[];
  /** 设置面板选中的气质预设 */
  personaId?: string;
}

export interface MockReply {
  text: string;
  citations: ChatCitation[];
}

/* ───────────────────────── 意图识别 ───────────────────────── */

type Intent =
  | 'greeting'
  | 'identity'
  | 'when'
  | 'where'
  | 'place'
  | 'askHome'
  | 'askAboutUser'
  | 'emotion'
  | 'remember'
  | 'thanks'
  | 'repeat'
  | 'fallback';

const GREETING = ['你好', '嗨', 'hi', 'hello', '在吗', '在不在', '早', '晚上好'];
const IDENTITY = ['你是谁', '你是什么', '你是不是', '你是ai', '你是人', '这是谁'];
const WHEN = ['什么时候', '哪年', '几年', '哪一天', '那天是', '几月', '什么季节'];
const WHERE = ['哪里', '哪儿', '什么地方', '在哪', '这是哪', '哪个城市'];
const THANKS = ['谢谢', '谢了', '再见', '拜拜', '晚安'];
const ABOUT_USER = ['你记得我', '还记得', '你知道我', '我是谁'];
const REMEMBER = ['记得吗', '记得么', '记不记得', '还记得'];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s，。、？！…,.!?]/g, '');
}

function allEmotionWords(): string[] {
  return Object.values(AI.slices.emotions).flatMap((words) => words);
}

function strongEmotionWords(): string[] {
  return allEmotionWords().filter((word) => word.length >= 2);
}

function detectIntent(text: string, profile: SliceProfile, turns: readonly ChatTurn[]): Intent {
  const plain = normalize(text);

  const askedBefore = turns.some(
    (turn) =>
      turn.role === 'user' && normalize(turn.text).length > 2 && normalize(turn.text) === plain,
  );
  if (askedBefore) return 'repeat';

  if (/住在哪|哪儿住|住哪|我住/.test(plain)) return 'askHome';
  if (IDENTITY.some((word) => plain.includes(normalize(word)))) return 'identity';
  if (WHEN.some((word) => plain.includes(normalize(word)))) return 'when';
  if (REMEMBER.some((word) => plain.includes(normalize(word)))) return 'remember';
  if (WHERE.some((word) => plain.includes(normalize(word)))) return 'where';
  if (ABOUT_USER.some((word) => plain.includes(normalize(word)))) return 'askAboutUser';
  // 问候与道谢先于情绪：「你好」里的"好"、「晚安」都不该被当成倾诉
  if (THANKS.some((word) => plain.includes(normalize(word)))) return 'thanks';
  if (GREETING.some((word) => plain.includes(normalize(word)))) return 'greeting';
  if (strongEmotionWords().some((word) => plain.includes(normalize(word)))) return 'emotion';
  if (allEmotionWords().some((word) => plain.includes(normalize(word)))) return 'emotion';
  if (profile.place && plain.includes(normalize(profile.place))) return 'where';
  return 'fallback';
}

/* ───────────────────────── 话术工具 ───────────────────────── */

function personaTurns(turns: readonly ChatTurn[]): ChatTurn[] {
  return turns.filter((turn) => turn.role === 'persona');
}

/**
 * 选一句，但**不选刚才说过的**
 *
 * 固定索引轮询（turns.length % n）是"人机感"的主要来源：
 * 同样的开场白会以可预测的顺序反复出现。这里改成随机 + 排除最近说过的。
 */
function pickFresh(list: readonly string[], said: string, fallback: string): string {
  if (list.length === 0) return fallback;
  const fresh = list.filter((item) => !said.includes(item.replace(/[。，]/g, '')));
  const pool = fresh.length > 0 ? fresh : list;
  return pool[Math.floor(Math.random() * pool.length)] ?? fallback;
}

/** 用户话里的情绪词（用来"回声"，比模板更像在听） */
function echoOf(text: string): string | null {
  const words = Object.values(AI.slices.emotions)
    .flatMap((list) => list)
    .sort((a, b) => b.length - a.length);
  for (const word of words) {
    if (text.includes(word)) return word;
  }
  return null;
}

/**
 * 一条回复的"形状"
 *
 * 真人不会每句都是"接住 + 具体 + 追问"的三段式。
 * 这里随机挑形状，且**不能和上一句同一种**，长度也随之呼吸。
 */
type Shape =
  | 'react'
  | 'reactDetail'
  | 'reactMeme'
  | 'echoDetail'
  | 'detailOnly'
  | 'crossDetail'
  | 'memeOnly';

function shapePool(hasDetail: boolean, hasCross: boolean, light: boolean): Shape[] {
  // 默认就是"有态度的一句话"，而不是"嗯。+ 细节"这种捧哏式组合
  const pool: Shape[] = ['react'];
  if (hasDetail) pool.push('reactDetail', 'detailOnly');
  if (light) pool.push('reactMeme', 'memeOnly');
  if (hasCross) pool.push('crossDetail');
  if (hasDetail) pool.push('echoDetail');
  return pool;
}

/** 按情绪挑一句朋友式反应（有态度，不是附和） */
function reactFor(emotions: readonly string[]): string {
  const table = AI.mock.voice.react as Readonly<Record<string, readonly string[]>>;
  const key =
    emotions.find((emotion) => (table[emotion]?.length ?? 0) > 0) ?? 'neutral';
  const list = table[key] ?? table.neutral ?? ['行吧。'];
  return list[Math.floor(Math.random() * Math.max(list.length, 1))] ?? '行吧。';
}

/** 接住用户的话（永远很短） */
function hold(turns: readonly ChatTurn[]): string {
  const said = personaTurns(turns)
    .slice(-2)
    .map((turn) => turn.text)
    .join(' ');
  return pickFresh(AI.mock.voice.hold, said, '嗯。');
}

/**
 * 从画面里挑一句**具体细节**
 *
 * 优先用视觉分析得到的事实（"大半是暗的""绿色占了大片"），
 * 说过的就不再说（避免复读）。视觉细节用完才退到切片事实。
 */
function visualDetail(
  profile: SliceProfile,
  turns: readonly ChatTurn[],
  excludeKeys: readonly string[] = [],
): string | null {
  const said = saidAboutVisual(turns);
  // ① 锚点优先（"有树。"）—— 这是"识图准"的主证据
  for (const anchor of profile.visual.anchors) {
    if (excludeKeys.includes(anchor.key)) continue;
    if (said.includes(anchor.label)) continue;
    return anchor.phrase;
  }
  // ② 统计层面的描述（"大半是暗的。"）—— 不会撒谎，但也不算"东西"
  for (const detail of profile.visual.details) {
    if (said.includes(detail.slice(0, 4))) continue;
    return detail;
  }
  return null;
}

/** 已经说过的画面内容（避免复读） */
function saidAboutVisual(turns: readonly ChatTurn[]): string {
  return personaTurns(turns)
    .map((turn) => turn.text)
    .join(' ');
}

/** 一句具体的切片事实（时间/地点），同样避免重复 */
function sliceDetail(profile: SliceProfile, turns: readonly ChatTurn[]): string | null {
  const said = personaTurns(turns)
    .map((turn) => turn.text)
    .join(' ');
  for (const fact of profile.facts) {
    if (fact.tags.includes('画面')) continue;
    if (said.includes(fact.text.slice(0, 5))) continue;
    return fact.text;
  }
  return null;
}

/**
 * 现在适合抛梗吗
 *
 * 只在轻松语境；用户情绪低落时**绝不**用（那不叫幽默，叫没眼力）。
 */
function canMeme(
  turns: readonly ChatTurn[],
  emotions: readonly string[],
  chance: number = AI.mock.memes.chance,
): boolean {
  if (!AI.mock.memes.enabled || chance <= 0) return false;
  const avoid = AI.mock.memes.avoidEmotions as readonly string[];
  if (emotions.some((tag) => avoid.includes(tag))) return false;
  const said = personaTurns(turns);
  const cooldown = AI.mock.memes.cooldownTurns;
  const recent = said.slice(-cooldown);
  if (recent.some((turn) => AI.mock.memes.lines.some((line) => turn.text.includes(line)))) {
    return false;
  }
  return Math.random() < chance;
}

/** 抛一句梗（不带任何画面断言，纯接话） */
function memeLine(turns: readonly ChatTurn[], chance?: number): string | null {
  if (!canMeme(turns, [], chance)) return null;
  const lines = AI.mock.memes.lines;
  return lines[Math.floor(Math.random() * lines.length)] ?? null;
}

/** 用认出来的锚点抛梗：只有真的认出了东西才敢比 */
function anchorMeme(
  profile: SliceProfile,
  turns: readonly ChatTurn[],
  emotions: readonly string[],
  chance?: number,
): string | null {
  const anchor = profile.visual.anchors[0];
  if (!anchor) return null;
  if (!canMeme(turns, emotions, chance)) return null;
  const pool = AI.mock.memes.compare;
  const template = pool[Math.floor(Math.random() * pool.length)] ?? '这{anchor}有点憨。';
  return template.replace('{anchor}', anchor.label);
}

/**
 * 用户提到的具体东西 → 对应的锚点
 *
 * 用来实现"严禁编造"：只有画面里真认出这类东西，才敢说"记得"。
 */
const OBJECT_TO_ANCHOR: readonly {
  words: readonly string[];
  key: VisualAnchor['key'];
}[] = [
  { words: ['树', '叶子', '枝'], key: 'trees' },
  // 注意：不要放单字"天"—— 「那天」「今天」会误判成天空
  { words: ['天空', '云'], key: 'sky' },
  { words: ['水面', '海边', '河里', '湖水'], key: 'water' },
  { words: ['人', '小孩'], key: 'person' },
  { words: ['门', '窗', '墙', '楼', '房子'], key: 'wall' },
  { words: ['灯', '光'], key: 'lights' },
  { words: ['街', '路', '巷'], key: 'street' },
];

/** 用户这句话里提到的、我们可能需要表态的东西（返回命中的原词，好用原话说回去） */
function objectsIn(text: string): { key: VisualAnchor['key']; word: string }[] {
  const out: { key: VisualAnchor['key']; word: string }[] = [];
  for (const entry of OBJECT_TO_ANCHOR) {
    const hit = entry.words.find((word) => text.includes(word));
    if (hit) out.push({ key: entry.key, word: hit });
  }
  return out;
}

/** 场景词与锚点的对应（避免"屋里。像在室内。"这种重复） */
const SCENE_ANCHOR: Readonly<Record<string, string>> = {
  水边: 'water',
  树底下: 'trees',
  有树的地方: 'trees',
  人多的地方: 'person',
  街边: 'street',
  开阔地: 'sky',
  墙边: 'wall',
  屋里: 'indoor',
  夜里: 'night',
  有人的地方: 'person',
};

function uniqueCitations(items: readonly Citation[], limit: number): ChatCitation[] {
  const seen = new Set<string>();
  const out: ChatCitation[] = [];
  for (const item of items) {
    if (seen.has(item.sliceId)) continue;
    seen.add(item.sliceId);
    out.push({ sliceId: item.sliceId, label: item.sliceLabel, text: item.text });
    if (out.length >= limit) break;
  }
  return out;
}

/* ───────────────────────── 主流程 ───────────────────────── */

export function mockReply(input: MockInput): MockReply {
  const { profile, turns, userText, citations, sharedEmotions, sharedPlaces } = input;
  const preset = personaById(input.personaId ?? AI.defaultPersonaId);
  const intent = detectIntent(userText, profile, turns);

  const crossUser = citations.find((item) => item.role === 'user') ?? null;
  const clueless = profile.visual.anchors.length === 0;
  const crossAny = crossUser ?? citations[0] ?? null;
  const detail = visualDetail(profile, turns) ?? sliceDetail(profile, turns);

  let text: string;

  switch (intent) {
    case 'greeting': {
      // 不再"嗯。"开头：要么吐槽画面里的东西，要么直接说看到的
      const meme = anchorMeme(profile, turns, sharedEmotions, preset.memeChance) ?? memeLine(turns, preset.memeChance);
      text = meme ?? detail ?? pickFresh(AI.mock.voice.react.neutral, '', '行吧。');
      break;
    }

    case 'identity':
      text = `${AI.personaName}。这张里的。`;
      break;

    case 'when':
      text = `照片里没有拍摄时间。${detail ?? ''}`;
      break;

    case 'where': {
      const placeKey = profile.place
        ? SCENE_ANCHOR[profile.place] ?? null
        : null;
      const extra = visualDetail(profile, turns, placeKey ? [placeKey] : []);
      text = profile.place ? `${profile.place}。${extra ?? ''}` : `看不出这是哪儿。`;
      break;
    }

    case 'askHome':
      text = '我不知道你住在哪。你没告诉过我。';
      break;

    case 'askAboutUser':
      text = `你告诉我的，我才记得。${detail ?? ''}`;
      break;

    case 'place':
      text = `照片里没有地点信息。${detail ?? ''}`;
      break;

    case 'remember': {
      // 被问"记得…吗"：只承认画面里**真认出来**的东西；认不出就直说看不清
      const asked = objectsIn(userText);
      const anchorKeys = new Set(profile.visual.anchors.map((anchor) => anchor.key));
      const confirmed = asked.filter((item) => anchorKeys.has(item.key));
      const missing = asked.filter((item) => !anchorKeys.has(item.key));

      if (missing.length > 0) {
        // 用户问的东西画面里没有 → 绝不顺着编，明说看不清
        text = `看不清${missing[0]?.word ?? '那个'}。${detail ?? ''}`;
        break;
      }
      if (confirmed.length > 0 || profile.visual.anchors.length > 0) {
        const remember = pickFresh(AI.mock.voice.remember, saidAboutVisual(turns), '记得。');
        const meme = anchorMeme(profile, turns, sharedEmotions, preset.memeChance);
        const target = confirmed[0]?.word;
        text = meme
          ? `${remember}${meme}`
          : `${remember}${target ? `${target}还在。` : (detail ?? '')}`;
        break;
      }
      text = pickFresh(AI.mock.voice.clueless, saidAboutVisual(turns), '我记不清了。');
      break;
    }

    case 'thanks':
      text = hold(turns);
      break;

    case 'repeat':
      text = '这个说过了。';
      break;

    case 'emotion': {
      const echo = echoOf(userText);
      const said = saidAboutVisual(turns);
      // ⚠️ 轻松与否要看**用户这句话本身**：第一轮没有跨图命中，
      //    用 sharedEmotions 判断会让"我很难过"得到一句梗（很没眼力）。
      const userEmotions = emotionTagsOf(userText);
      const light = !userEmotions.some((tag) =>
        (AI.mock.memes.avoidEmotions as readonly string[]).includes(tag),
      );
      const hasCross = Boolean(crossAny) && sharedEmotions.length > 0;

      if (clueless) {
        // 什么都没认出来 → 直说记不清，绝不编景物
        text = pickFresh(AI.mock.voice.clueless, said, '我记不清了。');
        break;
      }

      const canInferAboutYou = profile.visual.skin > 0.05;
      const shapes = shapePool(Boolean(detail), hasCross, light && !hasCross);
      const shape = shapes[Math.floor(Math.random() * shapes.length)] ?? 'react';
      const react = reactFor(userEmotions.length > 0 ? userEmotions : sharedEmotions);
      const meme = anchorMeme(profile, turns, sharedEmotions, preset.memeChance);

      switch (shape) {
        case 'reactDetail':
          text = `${react}${detail ?? ''}`;
          break;
        case 'reactMeme':
          text = `${react}${meme ?? pickFresh(AI.mock.voice.blind, said, '这瓜保熟吗。')}`;
          break;
        case 'detailOnly':
          text = detail ?? react;
          break;
        case 'crossDetail':
          text = `${pickFresh(AI.mock.voice.crossRef, said, '另一张你也这样。')}${detail ?? ''}`;
          break;
        case 'memeOnly':
          text = meme ?? pickFresh(AI.mock.voice.blind, said, '照片里看不出来。');
          break;
        case 'echoDetail':
          text = echo ? `${echo}啊。${detail ?? ''}` : `${react}${detail ?? ''}`;
          break;
        default:
          // 纯反应：像朋友那样一句话表态（不再有"嗯。"前缀）
          text = canInferAboutYou && Math.random() < AI.mock.voice.blindInferenceChance
            ? pickFresh(AI.mock.voice.inference, said, react)
            : react;
          break;
      }
      break;
    }

    default: {
      const said = saidAboutVisual(turns);
      const hasCross = Boolean(crossAny) || (sharedPlaces ?? []).length > 0;
      if (clueless && !detail) {
        // 认不出画面 + 没有跨图线索 → 诚实说记不清（铁律）
        text = pickFresh(AI.mock.voice.clueless, said, '我记不清了。');
        break;
      }
      const echo = echoOf(userText);
      const light = !sharedEmotions.some((tag) =>
        (AI.mock.memes.avoidEmotions as readonly string[]).includes(tag),
      );
      const shapes = shapePool(Boolean(detail), hasCross, light);
      const shape = shapes[Math.floor(Math.random() * shapes.length)] ?? 'react';
      const react = reactFor(sharedEmotions);
      const meme = anchorMeme(profile, turns, sharedEmotions, preset.memeChance) ?? memeLine(turns, preset.memeChance);
      if (shape === 'reactMeme' || shape === 'memeOnly') {
        text = meme ?? detail ?? react;
      } else if (shape === 'echoDetail' && echo) {
        text = `${echo}啊。${detail ?? ''}`;
      } else if (shape === 'crossDetail') {
        text = `${pickFresh(AI.mock.voice.crossRef, said, '另一张你也这样。')}${detail ?? ''}`;
      } else if (shape === 'detailOnly') {
        text = detail ?? react;
      } else if (shape === 'reactDetail') {
        text = `${react}${detail ?? ''}`;
      } else {
        text = react;
      }
      break;
    }
  }

  // 预设气质的轻量落地（无 Key 时也能听出切换了人格）
  if (preset.id === 'cyber') {
    // 赛博向导不反问，改成陈述
    text = text.replace(/[？?]/g, '。');
  } else if (preset.id === 'listener') {
    // 树洞不追问
    text = text.replace(/[^。！？…]*[？?]/g, '').trim();
    if (text.length === 0) text = '我在。';
  }

  return {
    text: guard(text, { maxChars: AI.reply.hardMaxChars }),
    citations: uniqueCitations(citations, AI.mock.maxCitations),
  };
}
