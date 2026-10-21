import { AI } from '@/config';
import { imageFileToDataUrl } from './imageInput';
import { parseMemeJson } from './memeLibrary';
import { completeChat, completeVision, hasRemote } from './runtime';
import type { PromptMessage } from './prompt';

/**
 * 人格实验室 / 热梗实验室的纯调用层
 * ────────────────────────────────────────────────────────────────
 * UI 只负责选文件、展示状态；这里负责：
 *   截图 → OCR 文字
 *   原始语料 → 蒸馏人格指令
 *   截图 → 热梗 JSON
 *
 * 任何失败都返回 ok:false + reason，不抛异常。
 */

export const OCR_PROMPT = [
  '逐字提取截图里的聊天/对话文字。',
  '保留说话人、标点与换行，不要总结、不要解释、不要补充图中没有的内容。',
  '只输出提取到的文字。',
].join('\n');

export const DISTILL_PROMPT = [
  '分析以下聊天记录。提取说话人的高频词、情绪节奏、共情逻辑和断句习惯，',
  '生成一段 300 字左右的【人格设定指令】及 2 个经典【模拟问答案例】。',
  '',
  '断句与连发习惯重点观察：句子长短、逗号/句号/省略号/破折号的使用频率、',
  '换行与停顿节奏、是否喜欢短句连发、是否习惯一条一句/连续多条短消息、还是一条讲完。',
  '',
  '只描述断句与连发模式，不要复述原句或具体内容；',
  '模拟问答案例也要保持同样的断句与连发节奏。',
  '绝对不要输出原对话中的具体人名或事件，只保留风格。',
].join('\n');

export const MEME_PROMPT = [
  '识别截图里的所有新梗/黑话，推测含义。',
  '必须严格且只能按 JSON 数组格式输出，不带任何 markdown 标记：',
  '[{"word":"扎啤","meaning":"指代极度抽象的行为"}]',
].join('\n');

export interface LabResult<T> {
  ok: boolean;
  value: T | null;
  reason?: string;
}

function failure<T>(reason: string): LabResult<T> {
  return { ok: false, value: null, reason };
}

/** 截图 → 文字（VLM；未配置独立 VLM 时回退聊天模型） */
export async function extractTextFromImage(file: File): Promise<LabResult<string>> {
  let dataUrl: string;
  try {
    dataUrl = await imageFileToDataUrl(file);
  } catch (error) {
    return failure(error instanceof Error ? error.message : '图片读取失败');
  }

  const result = await completeVision(OCR_PROMPT, dataUrl);
  if (!result.ok) return failure(result.reason ?? 'vision-failed');
  return { ok: true, value: result.text };
}

/** 原始语料 → 人格指令（只在这里使用 rawCorpus，聊天 Prompt 永不使用） */
export async function distillPersona(
  rawCorpus: string,
  personaName: string,
): Promise<LabResult<string>> {
  const corpus = rawCorpus.trim();
  if (!corpus) return failure('empty-corpus');
  if (!hasRemote()) return failure('no-api-key');

  const clipped = corpus.slice(0, AI.lab.maxDistillChars);
  const messages: PromptMessage[] = [
    {
      role: 'system',
      content: '你是一个擅长角色风格分析的编辑。提炼说话风格、情绪节奏与断句习惯，不复述隐私内容。',
    },
    {
      role: 'user',
      content: [
        DISTILL_PROMPT,
        '',
        `目标人格：${personaName}`,
        clipped.length < corpus.length
          ? `（原始语料共 ${corpus.length} 字，以下为前 ${clipped.length} 字）`
          : '',
        '',
        '聊天记录：',
        clipped,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];

  const result = await completeChat(messages, { timeoutMs: 90_000, maxTokens: 1_200 });
  if (result.source !== 'remote' || !result.text.trim()) {
    return failure(result.reason ?? 'distill-failed');
  }
  return { ok: true, value: result.text.trim() };
}

export interface RecognizedMeme {
  word: string;
  meaning: string;
}

/** 截图 → 热梗 JSON（严格解析，失败不改库） */
export async function recognizeMemes(
  file: File,
): Promise<LabResult<RecognizedMeme[]> & { raw?: string }> {
  let dataUrl: string;
  try {
    dataUrl = await imageFileToDataUrl(file);
  } catch (error) {
    return failure(error instanceof Error ? error.message : '图片读取失败');
  }

  const result = await completeVision(MEME_PROMPT, dataUrl);
  if (!result.ok) return { ...failure(result.reason ?? 'vision-failed'), raw: result.text };

  try {
    const items = parseMemeJson(result.text);
    if (items.length === 0) {
      return { ok: false, value: null, reason: 'empty-meme-list', raw: result.text };
    }
    return { ok: true, value: items, raw: result.text };
  } catch (error) {
    return {
      ok: false,
      value: null,
      reason: error instanceof Error ? `json: ${error.message}` : 'json-parse-failed',
      raw: result.text,
    };
  }
}

export function reasonText(reason: string | undefined): string {
  if (!reason) return '未知错误';
  if (reason.includes('no-vision-api-key')) return '未配置视觉模型 Key';
  if (reason.includes('no-api-key')) return '未配置聊天模型 Key';
  if (reason.includes('vision-circuit-open')) return '视觉模型暂时熔断，请稍后重试';
  if (reason.includes('empty-corpus')) return '请先填写或识别一段聊天记录';
  if (reason.includes('empty-meme-list')) return '没有识别到有效热梗';
  if (reason.startsWith('json:')) return '模型返回的不是有效 JSON，请重试';
  if (reason.includes('401')) return 'Key 无效或没有权限';
  if (reason.includes('429')) return '请求太频繁，请稍后重试';
  if (reason.includes('timeout') || reason.includes('aborted')) return '请求超时，请重试';
  if (reason.includes('HTTP')) return '接口请求失败，请检查模型与地址';
  return reason.slice(0, 120);
}
