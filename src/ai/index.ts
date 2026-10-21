/**
 * AI 层
 * ────────────────────────────────────────────────────────────────
 * 阶段 0：人格定义（persona.ts）。
 * 阶段 4（现在）：
 *   slices.ts    —— 切片人格：一张照片 = 「溯」在某一天的切片（photoId 确定性生成）
 *   prompt.ts    —— 组装：总人格 + 切片 + 跨图检索结果 + 本切片历史
 *   retrieval.ts —— 跨图记忆检索（中文二元组 + 情绪标签，离线可解释）
 *   mock.ts      —— 无 key 时的规则回复引擎（也能跨图串联）
 *   runtime.ts   —— DeepSeek / OpenAI 兼容适配器（超时·重试·熔断·回落 mock）
 *   guard.ts     —— 输出护栏：去客服腔、压字数、去重
 *   tts.ts       —— Web Speech API 朗读（默认关闭，可选中文音色）
 *   chat.ts      —— 对话控制流（UI 只调这里）
 *
 * 铁律：分身只知道自己切片里的事，全局/别处的事实必须**检索**得到而不能预载。
 */
export { SHARED_PERSONA, PERSONA_SAMPLING, composePersonaHeader, personaById } from './persona';
export type { PersonaPreset, PersonaVoice } from './persona';

export { sliceForPhoto, openingFor, resetSliceCache } from './slices';
export type { SliceProfile, SliceTone } from './slices';

export { buildCorpus, retrieve, emotionTagsOf, placeTagsOf, tagsOf } from './retrieval';
export type { Citation, CorpusEntry, RetrievalResult } from './retrieval';

export { buildMessages, buildSystemPrompt } from './prompt';
export type { PromptMessage } from './prompt';

export {
  activePersona,
  activeProvider,
  providerById,
  chatEndpoint,
  envApiKey,
  hasAvailableVlm,
  hasCustomTts,
  normalizeBaseUrl,
  readApiSettings,
  resolvedApiKey,
  resolvedVisionConfig,
  ttsEndpoint,
  useSettingsStore,
  visionProviderById,
  visionProviders,
} from './settings';
export type { ApiSettings, ProviderPreset, SettingsStore, VisionConfig } from './settings';

export { mockReply } from './mock';
export type { MockInput, MockReply } from './mock';

export {
  completeChat,
  completeVision,
  hasRemote,
  apiKey,
  runtimeStatus,
  resetRuntime,
} from './runtime';
export type { CompletionResult, RuntimeSource, VisionResult } from './runtime';

export { guard, clipToChars, clampSentences, inspect } from './guard';
export { parseReplyBubbles, replyTextFromBubbles, MESSAGE_DELIMITER } from './bubbles';

export {
  speak,
  previewVoice,
  cancelSpeech,
  setTtsEnabled,
  isTtsEnabled,
  restoreTtsPreference,
  primeVoices,
  pickVoice,
  listChineseVoices,
  getSelectedVoiceURI,
  setSelectedVoice,
  ttsAvailable,
  splitForSpeech,
} from './tts';

export {
  sendChatMessage,
  ensureThreadOpened,
  activePhotoId,
  threadOf,
  replayLastReply,
  sliceDebug,
  condenseMemory,
} from './chat';
export type { SendResult, CondenseResult } from './chat';

export {
  usePersonaProfilesStore,
  personaInstruction,
  personaRawCorpus,
  hasCustomPersona,
} from './personaProfiles';
export type { PersonaProfile, PersonaProfilesStore } from './personaProfiles';

export {
  useMemeLibraryStore,
  memePromptEntries,
  parseMemeJson,
  normalizeMemeList,
} from './memeLibrary';
export type { MemeEntry, MemeLibraryStore } from './memeLibrary';

export { checkApiKey, completionsEndpoint, modelsEndpoint } from './keyCheck';
export type { KeyCheckOptions, KeyCheckResult, KeyCheckStatus } from './keyCheck';

export {
  OCR_PROMPT,
  DISTILL_PROMPT,
  MEME_PROMPT,
  extractTextFromImage,
  distillPersona,
  recognizeMemes,
  reasonText,
} from './lab';
export type { LabResult, RecognizedMeme } from './lab';
