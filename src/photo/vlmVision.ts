import { AI } from '@/config';
import type { PhotoMemory, PhotoVlmAnalysis } from './types';
import { resolvedVisionConfig } from '@/ai/settings';
import { completeVision } from '@/ai/runtime';
import { imageElementToDataUrl, imageElementToFallbackDataUrl } from '@/ai/imageInput';

/**
 * 照片 VLM 识别
 * ────────────────────────────────────────────────────────────────
 * 导入后异步分析一次，结果存入 PhotoMemory.vlm。
 * 输出优先走 JSON；解析失败时把原文作为 summary，不阻断聊天。
 *
 * 高清模式：2800px / JPEG 0.95 / detail=high。
 * 请求体过大等错误会降级 2048px / 0.92 再试一次。
 */

export const PHOTO_VLM_PROMPT = [
  '仔细观察这张照片，只描述你真正看见的内容，按以下顺序：',
  '1. 画面主体、数量和位置',
  '2. 前景 / 背景环境',
  '3. 人物动作（只写看得见的，不猜身份）',
  '4. 光线方向、明暗、色温',
  '5. 画面里的文字，逐字提取；没有就留空',
  '6. 构图与整体氛围',
  '',
  '不要猜具体地点、人名、时间或事件。看不清的内容放进 uncertain。',
  '只输出 JSON，不要 markdown 代码块：',
  '{"summary":"一句话描述","scene":"室内/水边/街道/看不清","objects":["..."],"people":"none|present|unclear","lighting":"...","colors":["..."],"visibleText":"...","mood":"...","tags":["..."],"uncertain":["..."],"confidence":0.0}',
].join('\n');

/** 空 completion 的纯文本兜底：不要求 JSON，只取一句可用描述 */
const PHOTO_VLM_PROMPT_PLAIN = [
  '看这张照片，用两三句中文直接描述：',
  '主体是什么、周围环境、人物在做什么、光线和氛围。',
  '只写你真正看见的内容，不猜地点、人名、时间或事件。',
  '不要输出 JSON，不要解释，不要思考过程。',
].join('\n');

function cleanString(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function cleanList(value: unknown, maxItems = 12, maxChars = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 1)
    : 0;
}

function parseJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function emptyVlmAnalysis(
  status: PhotoVlmAnalysis['status'] = 'analyzing',
  model = '',
): PhotoVlmAnalysis {
  return {
    status,
    summary: '',
    scene: '',
    objects: [],
    people: 'unclear',
    lighting: '',
    colors: [],
    visibleText: '',
    mood: '',
    tags: [],
    uncertain: [],
    confidence: 0,
    model,
    updatedAt: Date.now(),
  };
}

export function errorVlmAnalysis(reason: string, model = ''): PhotoVlmAnalysis {
  return {
    ...emptyVlmAnalysis('error', model),
    error: reason.slice(0, 240),
  };
}

function toAnalysis(raw: string): PhotoVlmAnalysis {
  const model = resolvedVisionConfig().model;
  const parsed = parseJson(raw);
  if (!parsed) {
    return {
      ...emptyVlmAnalysis('ready', model),
      summary: cleanString(raw, 600),
      confidence: 0.4,
    };
  }

  const peopleRaw = cleanString(parsed.people, 20).toLowerCase();
  const people: PhotoVlmAnalysis['people'] =
    peopleRaw === 'none' || peopleRaw === 'present' || peopleRaw === 'unclear'
      ? peopleRaw
      : 'unclear';

  const summary = cleanString(parsed.summary, 600);
  return {
    status: 'ready',
    summary: summary || cleanString(raw, 600),
    scene: cleanString(parsed.scene, 120),
    objects: cleanList(parsed.objects),
    people,
    lighting: cleanString(parsed.lighting, 160),
    colors: cleanList(parsed.colors, 10, 20),
    visibleText: cleanString(parsed.visibleText, 600),
    mood: cleanString(parsed.mood, 80),
    tags: cleanList(parsed.tags, 16, 20),
    uncertain: cleanList(parsed.uncertain, 12, 80),
    confidence: clampConfidence(parsed.confidence),
    model,
    updatedAt: Date.now(),
  };
}

function shouldRetrySmaller(reason: string | undefined): boolean {
  if (!reason) return false;
  return /400|413|415|too large|payload|image.*(size|large)|context length/i.test(reason);
}

/** 把网络错误翻译成可操作的中文，避免只显示 Load failed */
function explainFailure(reason: string): string {
  if (/Load failed|Failed to fetch|NetworkError|network connection was lost/i.test(reason)) {
    return '无法连接 VLM：可能是该服务商不允许浏览器直连（CORS）或网络失败';
  }
  if (/401|403/.test(reason)) return 'VLM Key 无效或没有权限（401/403）';
  if (/404/.test(reason)) return 'VLM 接口地址不正确（404），请检查 Base URL';
  if (/429/.test(reason)) return 'VLM 请求过于频繁或额度不足（429）';
  if (/no-vision-api-key/.test(reason)) return '没有可用的 VLM API Key';
  if (/vision-circuit-open/.test(reason)) return 'VLM 连续失败后暂时熔断，请保存配置或稍后重试';
  if (/empty vision completion/i.test(reason)) {
    return '模型返回了空内容（可能被思考 token 占满），请点重试';
  }
  return reason;
}

export async function analyzePhotoWithVlm(
  photo: PhotoMemory,
  options: { highQuality: boolean },
): Promise<PhotoVlmAnalysis> {
  const model = resolvedVisionConfig().model;
  let dataUrl: string;
  try {
    dataUrl = options.highQuality
      ? imageElementToDataUrl(photo.image, {
          maxEdgePx: AI.vision.photo.maxEdgePx,
          quality: AI.vision.photo.quality,
          format: 'jpeg',
        })
      : imageElementToFallbackDataUrl(photo.image);
  } catch (error) {
    return errorVlmAnalysis(
      error instanceof Error ? error.message : 'image-encode-failed',
      model,
    );
  }

  let result = await completeVision(PHOTO_VLM_PROMPT, dataUrl, {
    detail: 'high',
    maxTokens: AI.vision.maxTokens,
  });

  if (options.highQuality && !result.ok && shouldRetrySmaller(result.reason)) {
    try {
      // 第二档：小图 + 不强制 detail=high，兼容不支持该字段的 OpenAI 兼容平台
      dataUrl = imageElementToFallbackDataUrl(photo.image);
      result = await completeVision(PHOTO_VLM_PROMPT, dataUrl, {
        detail: 'auto',
        maxTokens: 1200,
      });

      // 第三档：有些服务商不接受 image_url.detail，直接省略
      if (!result.ok && /400|415|detail/i.test(result.reason ?? '')) {
        result = await completeVision(PHOTO_VLM_PROMPT, dataUrl, {
          detail: 'none',
          maxTokens: 1000,
        });
      }
    } catch {
      // keep the original failure
    }
  }

  // 空 completion：改问纯文本，避免整张照片直接失败。
  // 常见于 DeepSeek Flash 的思考预算占满（已在 runtime 关闭 thinking，这里再兜一层）。
  if (!result.ok && /empty vision completion/i.test(result.reason ?? '')) {
    try {
      result = await completeVision(PHOTO_VLM_PROMPT_PLAIN, dataUrl, {
        detail: 'auto',
        maxTokens: 600,
      });
    } catch {
      // keep the original failure
    }
  }

  if (!result.ok) {
    // 只输出非敏感诊断：模型 / 原因，不包含 Key 或图片内容
    const reason = result.reason ?? 'vlm-failed';
    console.warn('[VLM] photo analysis failed', { model, reason });
    return errorVlmAnalysis(explainFailure(reason), model);
  }
  return toAnalysis(result.text);
}
