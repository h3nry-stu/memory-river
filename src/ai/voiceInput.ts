import { AI } from '@/config';

/**
 * 语音输入（按住说话）
 * ────────────────────────────────────────────────────────────────
 * 用浏览器自带的 Web Speech Recognition（Chrome / Edge 支持）。
 * 设计取舍：
 *  - **按住说话**：按下开始识别、松开结束并把结果交给上层发送（不自动上屏）
 *  - 识别期间把中间结果实时抛给 UI（用户看得见自己在说什么）
 *  - 不可用 / 被拒绝 / 出错都只回调，不抛异常 —— 按钮永远可以按
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function voiceInputAvailable(): boolean {
  return typeof window !== 'undefined' && ctor() !== null;
}

export interface VoiceSession {
  /** 结束并拿到最终文本（松手时调用） */
  stop(): Promise<string>;
  /** 直接放弃（连按两次 / 出错） */
  cancel(): void;
}

/**
 * 开始一次"按住说话"
 *
 * @param onPartial 中间结果回调（边说边显示）
 * @returns 会话句柄；浏览器不支持时返回 null
 */
export function startVoiceInput(
  onPartial: (text: string) => void,
  onError?: (reason: string) => void,
): VoiceSession | null {
  const Ctor = ctor();
  if (!Ctor) {
    onError?.('unsupported');
    return null;
  }

  const recognition = new Ctor();
  recognition.lang = AI.tts.lang;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = '';
  let stopped = false;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      const transcript = result[0]?.transcript ?? '';
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    onPartial((finalText + interim).trim());
  };

  recognition.onerror = (event) => {
    // no-speech / aborted 是常见且无害的，不要当成失败弹提示
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      onError?.(event.error);
    }
  };

  try {
    recognition.start();
  } catch {
    onError?.('start-failed');
    return null;
  }

  return {
    stop() {
      return new Promise<string>((resolve) => {
        if (stopped) {
          resolve(finalText);
          return;
        }
        stopped = true;
        // onend 会在识别结束后触发；给一个兜底超时，避免卡住不返回
        const timer = window.setTimeout(() => resolve(finalText.trim()), 900);
        recognition.onend = () => {
          window.clearTimeout(timer);
          resolve(finalText.trim());
        };
        try {
          recognition.stop();
        } catch {
          window.clearTimeout(timer);
          resolve(finalText.trim());
        }
      });
    },
    cancel() {
      stopped = true;
      try {
        recognition.abort();
      } catch {
        // 已经结束就无所谓
      }
    },
  };
}
