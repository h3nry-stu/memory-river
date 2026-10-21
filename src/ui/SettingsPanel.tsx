import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AI } from '@/config';
import { useRiverStore } from '@/state';
import {
  normalizeBaseUrl,
  useSettingsStore,
  visionProviderById,
  visionProviders,
} from '@/ai/settings';
import { envApiKey } from '@/ai/settings';
import { resetRuntime } from '@/ai/runtime';
import {
  getSelectedVoiceURI,
  listChineseVoices,
  previewVoice,
  setSelectedVoice,
  setTtsEnabled,
} from '@/ai/tts';
import {
  distillPersona,
  extractTextFromImage,
  reasonText,
  recognizeMemes,
} from '@/ai/lab';
import {
  imagesFromClipboard,
  imagesFromDataTransfer,
  isImageFile,
} from '@/ai/imageInput';
import {
  personaInstruction,
  personaRawCorpus,
  usePersonaProfilesStore,
} from '@/ai/personaProfiles';
import { useMemeLibraryStore } from '@/ai/memeLibrary';
import { checkApiKey, type KeyCheckResult } from '@/ai/keyCheck';
import { useApiStatusStore } from '@/ai/apiStatus';

/**
 * 设置与配置面板（苹果玻璃拟态）
 * ────────────────────────────────────────────────────────────────
 * 现场可能拿到任意平台的 OpenAI 兼容 Key，所以 Base URL / Key / Model
 * 全部可改；人格 4 选 1；TTS 默认关闭，可选系统中文音色或第三方 /audio/speech。
 *
 * 交互：右上角齿轮打开 → 右侧滑出；Esc / 点遮罩 / × 关闭。
 * 层级：固定挂在 document.body 的 z-[80]，比所有对话/HUD 都高，
 *       且只有面板本身接收指针事件，不会出现"点不到"。
 */

type Draft = {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  personaId: string;
  ttsBaseUrl: string;
  ttsKey: string;
  visionProviderId: string;
  visionBaseUrl: string;
  visionApiKey: string;
  visionModel: string;
  visionHighQuality: boolean;
  visionAutoAnalyze: boolean;
};

const inputClass = [
  'w-full rounded-xl border border-white/12 bg-black/20 px-3 py-2.5',
  'font-mono text-[11px] tracking-[0.04em] text-stardust/90',
  'placeholder:text-stardust/25 outline-none transition',
  'focus:border-mood-cyan/45 focus:bg-black/30',
].join(' ');

const labelClass =
  'mb-1.5 block font-mono text-[9px] tracking-[0.22em] text-stardust/45 uppercase';

export function SettingsPanel() {
  const open = useRiverStore((s) => s.settingsOpen);
  const close = useRiverStore((s) => s.closeSettings);
  const ttsEnabled = useRiverStore((s) => s.ttsEnabled);
  const musicEnabled = useRiverStore((s) => s.musicEnabled);
  const musicVolume = useRiverStore((s) => s.musicVolume);
  const setMusicEnabled = useRiverStore((s) => s.setMusicEnabled);
  const setMusicVolume = useRiverStore((s) => s.setMusicVolume);

  const settings = useSettingsStore();
  const [draft, setDraft] = useState<Draft>(settings);
  const [showKey, setShowKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);
  const [chatKeyStatus, setChatKeyStatus] = useState<KeyCheckResult>({ status: 'idle', latencyMs: 0 });
  const [visionKeyStatus, setVisionKeyStatus] = useState<KeyCheckResult>({ status: 'idle', latencyMs: 0 });
  const [chatCheckNonce, setChatCheckNonce] = useState(0);
  const [visionCheckNonce, setVisionCheckNonce] = useState(0);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [advancedTts, setAdvancedTts] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState(() => getSelectedVoiceURI());

  const personaProfiles = usePersonaProfilesStore((state) => state.profiles);
  const savePersona = usePersonaProfilesStore((state) => state.save);
  const savePersonaRaw = usePersonaProfilesStore((state) => state.saveRaw);
  const clearPersona = usePersonaProfilesStore((state) => state.clear);
  const memeEntries = useMemeLibraryStore((state) => state.entries);
  const mergeMemes = useMemeLibraryStore((state) => state.merge);
  const removeMeme = useMemeLibraryStore((state) => state.remove);

  const [activePersonaId, setActivePersonaId] = useState<string>(AI.defaultPersonaId);
  const [corpora, setCorpora] = useState<Record<string, string>>({});
  const [personaBusy, setPersonaBusy] = useState<'ocr' | 'distill' | null>(null);
  const [personaNotice, setPersonaNotice] = useState<string | null>(null);
  const [memeBusy, setMemeBusy] = useState(false);
  const [memeNotice, setMemeNotice] = useState<string | null>(null);
  const [memeDragging, setMemeDragging] = useState(false);
  const personaFileRef = useRef<HTMLInputElement>(null);
  const memeFileRef = useRef<HTMLInputElement>(null);
  const rawSaveTimer = useRef<number | null>(null);
  const chatCheckSeq = useRef(0);
  const visionCheckSeq = useRef(0);

  const envKey = useMemo(() => envApiKey(), []);
  const hasEnvKey = envKey.length > 0;
  const provider =
    AI.providers.find((item) => item.id === draft.providerId) ?? AI.providers[0]!;
  const vlmProvider = visionProviderById(draft.visionProviderId);
  const vlmOptions = visionProviders();
  const vlmBase = draft.visionBaseUrl.trim() || draft.baseUrl;
  const sameVisionEndpoint =
    normalizeBaseUrl(vlmBase) === normalizeBaseUrl(draft.baseUrl);
  const chatKeyAvailable = Boolean(draft.apiKey.trim() || envKey);
  const vlmKeyMissing =
    Boolean(vlmProvider) &&
    !draft.visionApiKey.trim() &&
    !(sameVisionEndpoint && chatKeyAvailable);

  const chooseProvider = (providerId: string): void => {
    const next = AI.providers.find((item) => item.id === providerId) ?? AI.providers[0]!;
    setDraft((current) => ({
      ...current,
      providerId: next.id,
      baseUrl: next.baseUrl || current.baseUrl,
      model: next.defaultModel || current.model,
    }));
  };

  const chooseVisionProvider = (providerId: string): void => {
    if (!providerId) {
      setDraft((current) => ({
        ...current,
        visionProviderId: '',
        visionModel: '',
      }));
      return;
    }
    const next = visionProviderById(providerId);
    if (!next) return;
    setDraft((current) => ({
      ...current,
      visionProviderId: next.id,
      visionBaseUrl: next.baseUrl || current.visionBaseUrl,
      visionModel: next.defaultVisionModel || current.visionModel,
    }));
  };

  useEffect(() => {
    const load = (): void => setVoices(listChineseVoices());
    load();
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const engine = window.speechSynthesis;
    engine.addEventListener?.('voiceschanged', load);
    return () => engine.removeEventListener?.('voiceschanged', load);
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft({
      providerId: settings.providerId,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      personaId: settings.personaId,
      ttsBaseUrl: settings.ttsBaseUrl,
      ttsKey: settings.ttsKey,
      visionProviderId: settings.visionProviderId,
      visionBaseUrl: settings.visionBaseUrl,
      visionApiKey: settings.visionApiKey,
      visionModel: settings.visionModel,
      visionHighQuality: settings.visionHighQuality,
      visionAutoAnalyze: settings.visionAutoAnalyze,
    });
    setAdvancedTts(settings.ttsBaseUrl.length > 0 || settings.ttsKey.length > 0);
    setVoiceURI(getSelectedVoiceURI());
    setCorpora(
      Object.fromEntries(
        AI.personas.map((persona) => [persona.id, personaRawCorpus(persona.id)]),
      ),
    );
    setActivePersonaId(settings.personaId);
    // 只在打开时同步一次，避免输入过程被 store 覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, close]);

  // 真实联网校验聊天 Key（防抖 800ms；输入变化会取消上一次）
  useEffect(() => {
    if (!open) return;
    const apiKey = draft.apiKey.trim();
    if (!apiKey) {
      chatCheckSeq.current += 1;
      setChatKeyStatus({ status: 'idle', latencyMs: 0 });
      return;
    }

    const seq = chatCheckSeq.current + 1;
    chatCheckSeq.current = seq;
    const controller = new AbortController();
    setChatKeyStatus({ status: 'checking', latencyMs: 0 });

    const timer = window.setTimeout(() => {
      void checkApiKey({
        baseUrl: draft.baseUrl,
        apiKey,
        model: draft.model,
        signal: controller.signal,
      }).then((result) => {
        if (seq !== chatCheckSeq.current) return;
        setChatKeyStatus(result);
        const saved = useSettingsStore.getState();
        const sameAsSaved =
          saved.apiKey.trim() === apiKey &&
          saved.baseUrl.trim() === draft.baseUrl.trim() &&
          saved.model.trim() === draft.model.trim();
        if (!sameAsSaved) return;
        if (result.status === 'valid') useApiStatusStore.getState().setStatus('online', null);
        else if (result.status === 'invalid') {
          useApiStatusStore.getState().setStatus('invalid', result.reason ?? 'Key 无效');
        } else if (result.status === 'error') {
          useApiStatusStore.getState().setStatus('offline', result.reason ?? '接口不可达');
        }
      });
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, draft.apiKey, draft.baseUrl, draft.model, chatCheckNonce]);

  // 独立 VLM Key：Base / Model 留空则跟随聊天
  useEffect(() => {
    if (!open) return;
    const apiKey = draft.visionApiKey.trim();
    if (!apiKey) {
      visionCheckSeq.current += 1;
      setVisionKeyStatus({ status: 'idle', latencyMs: 0 });
      return;
    }

    const seq = visionCheckSeq.current + 1;
    visionCheckSeq.current = seq;
    const controller = new AbortController();
    setVisionKeyStatus({ status: 'checking', latencyMs: 0 });

    const timer = window.setTimeout(() => {
      void checkApiKey({
        baseUrl: draft.visionBaseUrl.trim() || draft.baseUrl,
        apiKey,
        model: draft.visionModel.trim() || draft.model,
        signal: controller.signal,
      }).then((result) => {
        if (seq === visionCheckSeq.current) setVisionKeyStatus(result);
      });
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    open,
    draft.visionApiKey,
    draft.visionBaseUrl,
    draft.visionModel,
    draft.baseUrl,
    draft.model,
    visionCheckNonce,
  ]);

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = (): void => {
    settings.save(draft);
    resetRuntime();
    // 保存后重新校验一次，确保共享状态对应的是“已保存”的 Key
    setChatCheckNonce((value) => value + 1);
    setSavedFlash('已保存，下一次请求生效');
    window.setTimeout(() => setSavedFlash(null), 2200);
  };

  const restore = (): void => {
    settings.reset();
    resetRuntime();
    const next = useSettingsStore.getState();
    setDraft({
      providerId: next.providerId,
      baseUrl: next.baseUrl,
      apiKey: next.apiKey,
      model: next.model,
      personaId: next.personaId,
      ttsBaseUrl: next.ttsBaseUrl,
      ttsKey: next.ttsKey,
      visionProviderId: next.visionProviderId,
      visionBaseUrl: next.visionBaseUrl,
      visionApiKey: next.visionApiKey,
      visionModel: next.visionModel,
      visionHighQuality: next.visionHighQuality,
      visionAutoAnalyze: next.visionAutoAnalyze,
    });
    setAdvancedTts(false);
    setSavedFlash('已恢复默认配置');
    window.setTimeout(() => setSavedFlash(null), 2200);
  };

  const activePersona =
    AI.personas.find((persona) => persona.id === activePersonaId) ?? AI.personas[0]!;
  const activeCorpus = corpora[activePersonaId] ?? '';
  const activeInstruction = personaInstruction(activePersonaId) ?? '';
  const activeProfile = personaProfiles[activePersonaId];

  const setCorpus = (value: string): void => {
    setCorpora((current) => ({ ...current, [activePersonaId]: value }));
    // 原始语料自动落盘（防抖），即使没点生成、直接关面板也不会丢
    if (rawSaveTimer.current) window.clearTimeout(rawSaveTimer.current);
    rawSaveTimer.current = window.setTimeout(() => {
      savePersonaRaw(activePersonaId, value);
    }, 350);
  };

  const persistCorpus = (): void => {
    savePersonaRaw(activePersonaId, activeCorpus);
  };

  const handlePersonaFiles = async (files: File[]): Promise<void> => {
    if (personaBusy) return;
    const images = files.filter(isImageFile);
    if (images.length === 0) {
      setPersonaNotice('请选择图片文件');
      return;
    }

    // 锁定开始时的目标人格：识别途中切 Tab 也不会串到别的人格
    const targetPersonaId = activePersonaId;
    let nextCorpus = corpora[targetPersonaId] ?? '';
    let okCount = 0;
    let duplicateCount = 0;
    let failCount = 0;
    let lastFailure = '';

    setPersonaBusy('ocr');
    try {
      for (let index = 0; index < images.length; index += 1) {
        const file = images[index];
        if (!file) continue;
        setPersonaNotice(`正在识别第 ${index + 1}/${images.length} 张…`);
        const result = await extractTextFromImage(file);
        if (result.ok && result.value) {
          const text = result.value.trim();
          if (!text) {
            failCount += 1;
            lastFailure = 'empty-ocr';
            continue;
          }
          // 重叠截图 / 重复上传：不要重复追加
          if (nextCorpus.includes(text)) {
            duplicateCount += 1;
            continue;
          }
          nextCorpus = nextCorpus.trim() ? `${nextCorpus.trim()}\n\n${text}` : text;
          setCorpora((current) => ({ ...current, [targetPersonaId]: nextCorpus }));
          savePersonaRaw(targetPersonaId, nextCorpus);
          okCount += 1;
        } else {
          failCount += 1;
          lastFailure = result.reason ?? 'ocr-failed';
        }
      }
    } finally {
      setPersonaBusy(null);
    }

    const parts = [`${images.length} 张：识别成功 ${okCount}`];
    if (duplicateCount > 0) parts.push(`重复跳过 ${duplicateCount}`);
    if (failCount > 0) {
      parts.push(`失败 ${failCount}${lastFailure ? `（${reasonText(lastFailure)}）` : ''}`);
    }
    setPersonaNotice(parts.join(' · '));
  };

  const handleDistill = async (): Promise<void> => {
    if (personaBusy) return;
    const corpus = activeCorpus.trim();
    if (!corpus) {
      clearPersona(activePersonaId);
      setPersonaNotice('语料为空，已回退为默认气质');
      return;
    }
    setPersonaBusy('distill');
    setPersonaNotice('正在分析语料、生成人格指令…');
    const result = await distillPersona(corpus, activePersona.name);
    if (result.ok && result.value) {
      const model = useSettingsStore.getState().model;
      savePersona(activePersonaId, {
        instruction: result.value,
        rawCorpus: corpus,
        model,
      });
      setCorpora((current) => ({ ...current, [activePersonaId]: corpus }));
      setPersonaNotice(`已生成「${activePersona.name}」人格，下一次对话生效`);
    } else {
      setPersonaNotice(
        `生成失败：${reasonText(result.reason)}；继续使用${activeProfile?.instruction ? '上一次自定义' : '默认'}人格`,
      );
    }
    setPersonaBusy(null);
  };

  const handleMemeScreenshots = async (files: File[]): Promise<void> => {
    if (memeBusy) return;
    const images = files.filter(isImageFile);
    if (images.length === 0) {
      setMemeNotice('请选择图片文件');
      return;
    }

    setMemeBusy(true);
    let successCount = 0;
    let failCount = 0;
    let added = 0;
    let updated = 0;
    let memeCount = 0;
    let lastFailure = '';
    let attempted = 0;
    let aborted = false;
    const learnedWords: string[] = [];

    try {
      for (let index = 0; index < images.length; index += 1) {
        const file = images[index];
        if (!file) continue;
        attempted = index + 1;
        setMemeNotice(`正在识别第 ${index + 1}/${images.length} 张…`);
        const result = await recognizeMemes(file);
        if (result.ok && result.value) {
          const merged = mergeMemes(result.value);
          added += merged.added;
          updated += merged.updated;
          memeCount += result.value.length;
          successCount += 1;
          for (const item of result.value) {
            if (item.word && !learnedWords.includes(item.word)) learnedWords.push(item.word);
          }
        } else {
          failCount += 1;
          lastFailure = reasonText(result.reason);
          if (
            /no-vision-api-key|vision-circuit-open|401|403/.test(result.reason ?? '')
          ) {
            aborted = true;
            break;
          }
        }
      }
    } finally {
      setMemeBusy(false);
    }

    if (images.length === 1 && successCount === 1) {
      if (added === 0 && updated === 0) {
        setMemeNotice('这张没有新增热梗，内容已存在');
        return;
      }
      const words = learnedWords.slice(0, 3).join('、');
      setMemeNotice(
        `成功学会新梗：${words}${learnedWords.length > 3 ? '…' : ''}（新增 ${added}，更新 ${updated}）`,
      );
      return;
    }

    const parts = [`${images.length} 张：成功 ${successCount} 张`];
    if (memeCount > 0) parts.push(`识别 ${memeCount} 个梗`);
    if (added > 0) parts.push(`新增 ${added}`);
    if (updated > 0) parts.push(`更新 ${updated}`);
    if (failCount > 0) {
      parts.push(`失败 ${failCount}${lastFailure ? `（${lastFailure}）` : ''}`);
    }
    if (aborted && attempted < images.length) {
      parts.push(`剩余 ${images.length - attempted} 张未处理`);
    }
    if (successCount > 0 && added === 0 && updated === 0) {
      parts.push('没有新增，已存在');
    }
    setMemeNotice(parts.join(' · '));
  };

  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent): void => {
      const files = imagesFromClipboard(event);
      if (files.length === 0) return;
      event.preventDefault();
      void handleMemeScreenshots(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end"
      data-settings-root="1"
      role="dialog"
      aria-modal="true"
      aria-label="设置与配置"
    >
      {/* 遮罩：点击关闭；只覆盖视觉，不抢面板事件 */}
      <button
        type="button"
        aria-label="关闭设置"
        onClick={close}
        className="absolute inset-0 cursor-default bg-cosmos-deep/55 backdrop-blur-[2px]"
      />

      {/* 面板：苹果玻璃拟态（渐变描边 + 背景模糊 + 内侧高光） */}
      <aside
        data-settings-panel="1"
        className={[
          'settings-panel relative mr-0 flex h-full w-[min(94vw,430px)] flex-col',
          'overflow-y-auto overscroll-contain',
          'border-l border-white/14 bg-white/[0.075] backdrop-blur-2xl backdrop-saturate-150',
          'shadow-[-24px_0_80px_-24px_rgba(0,0,0,0.9)]',
        ].join(' ')}
        style={{ touchAction: 'auto' }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0.02) 34%, rgba(255,255,255,0) 62%)',
          }}
        />

        <header className="relative flex items-start justify-between gap-4 border-b border-white/10 px-6 pb-5 pt-6">
          <div>
            <p className="font-mono text-[9px] tracking-[0.34em] text-mood-cyan/45 uppercase">
              configuration
            </p>
            <h2 className="mt-2 text-[18px] font-light tracking-[0.16em] text-stardust/92">设置</h2>
            <p className="mt-1.5 text-[10px] leading-relaxed tracking-[0.05em] text-stardust/35">
              接口、人格与语音都只保存在这台设备。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭设置"
            className={[
              'grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/16',
              'bg-white/[0.06] text-[15px] text-stardust/60 backdrop-blur-xl',
              'transition hover:border-white/30 hover:text-stardust',
            ].join(' ')}
          >
            ×
          </button>
        </header>

        <div className="relative flex-1 space-y-8 px-6 py-6">
          {/* ── 接口 ── */}
          <section>
            <SectionTitle index="01" title="模型接口" hint="OpenAI 兼容格式" />
            <div className="space-y-3.5">
              <div>
                <label className={labelClass} htmlFor="settings-provider">
                  AI 服务商
                </label>
                <select
                  id="settings-provider"
                  data-settings-input="providerId"
                  value={draft.providerId}
                  onChange={(event) => chooseProvider(event.target.value)}
                  className={`${inputClass} appearance-none`}
                >
                  {AI.providers.map((item) => (
                    <option key={item.id} value={item.id} className="bg-[#0a0f1f]">
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass} htmlFor="settings-model">
                  LLM 模型
                </label>
                <input
                  id="settings-model"
                  data-settings-input="model"
                  list="settings-model-options"
                  value={draft.model}
                  onChange={(event) => patch('model', event.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder={provider.defaultModel || '模型名称，可手填'}
                  className={inputClass}
                />
                <datalist id="settings-model-options">
                  {provider.models.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                <p className="mt-1.5 text-[9px] leading-relaxed tracking-[0.04em] text-stardust/30">
                  可从下拉建议中选，也可以直接输入任意兼容模型名。
                </p>
              </div>

              <div>
                <label className={labelClass} htmlFor="settings-base-url">
                  Base URL
                </label>
                <input
                  id="settings-base-url"
                  data-settings-input="baseUrl"
                  value={draft.baseUrl}
                  onChange={(event) => patch('baseUrl', event.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder="https://api.deepseek.com/v1"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass} htmlFor="settings-api-key">
                  API Key
                </label>
                <div className="relative">
                  <input
                    id="settings-api-key"
                    data-settings-input="apiKey"
                    type={showKey ? 'text' : 'password'}
                    value={draft.apiKey}
                    onChange={(event) => patch('apiKey', event.target.value)}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder={hasEnvKey ? '留空则使用 .env 里的 Key' : 'sk-...'}
                    className={`${inputClass} pr-[5.5rem]`}
                  />
                  <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-2">
                    <KeyStatusIcon
                      result={chatKeyStatus}
                      label="聊天 API Key"
                      onRetry={() => setChatCheckNonce((value) => value + 1)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((value) => !value)}
                      className="font-mono text-[9px] tracking-[0.12em] text-stardust/40 hover:text-stardust/80"
                    >
                      {showKey ? 'HIDE' : 'SHOW'}
                    </button>
                  </div>
                </div>
                <p className="mt-1.5 text-[9px] leading-relaxed tracking-[0.04em] text-stardust/30">
                  {hasEnvKey
                    ? '检测到 .env Key：这里留空即沿用；填写则覆盖。'
                    : '仅存 localStorage。公网部署请改用服务端代理。'}
                </p>
                {(chatKeyStatus.status === 'invalid' || chatKeyStatus.status === 'error') && (
                  <p className="mt-1 text-[9px] leading-relaxed text-red-300/75">
                    {chatKeyStatus.reason ?? 'Key 校验失败'}
                  </p>
                )}
              </div>

            </div>
          </section>

          {/* ── 人格 ── */}
          <section>
            <SectionTitle index="02" title="AI 人格" hint="仍是同一个「溯」" />
            <div className="grid gap-2">
              {AI.personas.map((persona) => {
                const selected = draft.personaId === persona.id;
                return (
                  <button
                    key={persona.id}
                    type="button"
                    data-persona={persona.id}
                    onClick={() => patch('personaId', persona.id)}
                    aria-pressed={selected}
                    className={[
                      'group relative rounded-2xl border px-4 py-3 text-left transition-all duration-300',
                      selected
                        ? 'border-mood-cyan/45 bg-white/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                        : 'border-white/10 bg-white/[0.035] hover:border-white/22 hover:bg-white/[0.06]',
                    ].join(' ')}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span
                        className={[
                          'text-[12.5px] tracking-[0.08em]',
                          selected ? 'text-stardust/95' : 'text-stardust/70',
                        ].join(' ')}
                      >
                        {persona.name}
                      </span>
                      <span
                        className={[
                          'h-1.5 w-1.5 rounded-full transition',
                          selected
                            ? 'bg-mood-cyan shadow-[0_0_10px_rgba(159,216,255,0.9)]'
                            : 'bg-stardust/20',
                        ].join(' ')}
                      />
                    </span>
                    <span className="mt-1 block text-[10px] leading-relaxed tracking-[0.04em] text-stardust/35">
                      {persona.tagline}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── 语音 ── */}
          <section>
            <SectionTitle index="03" title="语音" hint="TTS · 可选音色 / 可关闭" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11.5px] tracking-[0.06em] text-stardust/78">朗读回复</p>
                  <p className="mt-1 text-[9.5px] leading-relaxed text-stardust/32">
                    默认关闭，不会再自动发出机械音；想听时打开，并可选不同中文系统音色。
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ttsEnabled}
                  onClick={() => {
                    const next = !ttsEnabled;
                    setTtsEnabled(next);
                    useRiverStore.getState().setTtsEnabled(next);
                  }}
                  className={[
                    'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
                    ttsEnabled
                      ? 'border-mood-cyan/50 bg-mood-cyan/25'
                      : 'border-white/15 bg-white/[0.06]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all duration-300',
                      ttsEnabled ? 'left-[22px] bg-mood-cyan' : 'left-[3px] bg-stardust/45',
                    ].join(' ')}
                  />
                </button>
              </div>

              <div className="mt-3 border-t border-white/8 pt-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label className={labelClass} htmlFor="settings-tts-voice">
                      朗读音色
                    </label>
                    <select
                      id="settings-tts-voice"
                      data-settings-input="ttsVoice"
                      value={voiceURI}
                      disabled={voices.length === 0}
                      onChange={(event) => {
                        const next = event.target.value;
                        setSelectedVoice(next);
                        setVoiceURI(next);
                      }}
                      className={`${inputClass} appearance-none disabled:opacity-45`}
                    >
                      <option value="" className="bg-[#0a0f1f]">
                        系统自动（推荐）
                      </option>
                      {voiceURI.length > 0 &&
                        !voices.some(
                          (voice) => voice.voiceURI === voiceURI || voice.name === voiceURI,
                        ) && (
                          <option value={voiceURI} className="bg-[#0a0f1f]">
                            已选音色（当前不可用）
                          </option>
                        )}
                      {voices.map((voice) => (
                        <option
                          key={voice.voiceURI || voice.name}
                          value={voice.voiceURI || voice.name}
                          className="bg-[#0a0f1f]"
                        >
                          {voice.name} · {voice.lang}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={voices.length === 0}
                    onClick={() => previewVoice()}
                    className="shrink-0 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2.5 font-mono text-[10px] tracking-[0.08em] text-stardust/70 transition hover:border-mood-cyan/35 hover:text-stardust/95 disabled:opacity-35"
                  >
                    试听
                  </button>
                </div>
                <p className="mt-2 text-[9px] leading-relaxed text-stardust/28">
                  检测到 {voices.length} 个中文系统音色；选好后需打开上方开关才会自动朗读。试听使用系统音色，不受第三方 TTS 影响。
                  如果系统里只有机械音色，可在 macOS「系统设置 → 辅助功能 → 朗读内容」下载更自然的声音。
                </p>
              </div>

              <button
                type="button"
                onClick={() => setAdvancedTts((value) => !value)}
                className="mt-3 font-mono text-[9px] tracking-[0.16em] text-stardust/32 transition hover:text-stardust/65"
              >
                {advancedTts ? '− 收起第三方 TTS' : '+ 第三方 TTS（可选）'}
              </button>

              {advancedTts && (
                <div className="mt-3 space-y-3 border-t border-white/8 pt-3">
                  <div>
                    <label className={labelClass} htmlFor="settings-tts-base">
                      TTS Base URL
                    </label>
                    <input
                      id="settings-tts-base"
                      data-settings-input="ttsBaseUrl"
                      value={draft.ttsBaseUrl}
                      onChange={(event) => patch('ttsBaseUrl', event.target.value)}
                      spellCheck={false}
                      autoCapitalize="off"
                      placeholder="https://api.openai.com/v1"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="settings-tts-key">
                      TTS API Key
                    </label>
                    <input
                      id="settings-tts-key"
                      data-settings-input="ttsKey"
                      type="password"
                      value={draft.ttsKey}
                      onChange={(event) => patch('ttsKey', event.target.value)}
                      spellCheck={false}
                      autoCapitalize="off"
                      placeholder="sk-..."
                      className={inputClass}
                    />
                  </div>
                  <p className="text-[9px] leading-relaxed text-stardust/28">
                    填好后优先走 /audio/speech；失败会自动回落到系统音色，不会报错。
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* ── 环境音 ── */}
          <section>
            <SectionTitle index="04" title="环境音" hint="程序化 · 仅 L2" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11.5px] tracking-[0.06em] text-stardust/78">光河音景</p>
                  <p className="mt-1 text-[9.5px] leading-relaxed text-stardust/32">
                    进入 L2 播放照片绑定的音乐并淡入；离开淡出；未绑定则静音
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={musicEnabled}
                  data-music-switch="1"
                  onClick={() => setMusicEnabled(!musicEnabled)}
                  className={[
                    'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
                    musicEnabled
                      ? 'border-mood-cyan/50 bg-mood-cyan/25'
                      : 'border-white/15 bg-white/[0.06]',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all duration-300',
                      musicEnabled ? 'left-[22px] bg-mood-cyan' : 'left-[3px] bg-stardust/45',
                    ].join(' ')}
                  />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <span className="font-mono text-[8.5px] tracking-[0.16em] text-stardust/30">VOL</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={musicVolume}
                  data-music-volume="1"
                  onChange={(event) => setMusicVolume(Number(event.target.value))}
                  aria-label="环境音音量"
                  className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/12 accent-[#9fd8ff]"
                />
                <span className="w-8 text-right font-mono text-[9px] tracking-[0.08em] text-stardust/45">
                  {Math.round(musicVolume * 100)}
                </span>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-stardust/26">
                手势音效（扇风 / 确认 / 缩小）与音乐共用这个开关；关闭后完全静音。
              </p>
            </div>
          </section>

          {/* ── 独立视觉模型 ── */}
          <section>
            <SectionTitle index="05" title="视觉模型 (VLM)" hint="照片识图 · 截图 OCR" />
            <div className="space-y-3.5 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3.5">
              <p className="text-[9.5px] leading-relaxed tracking-[0.04em] text-stardust/32">
                用于照片识图、截图提取语料和学热梗。没选择服务商时，照片识图入口不会显示。
                推荐 DeepSeek 的 <span className="text-stardust/55">deepseek-flash</span>（浏览器可直连）；
                智谱 GLM 可能被浏览器 CORS 拦截。
              </p>

              <div>
                <label className={labelClass} htmlFor="settings-vision-provider">
                  VLM 服务商
                </label>
                <select
                  id="settings-vision-provider"
                  data-settings-input="visionProviderId"
                  value={draft.visionProviderId}
                  onChange={(event) => chooseVisionProvider(event.target.value)}
                  className={`${inputClass} appearance-none`}
                >
                  <option value="" className="bg-[#0a0f1f]">
                    未配置（不启用照片识图）
                  </option>
                  {vlmOptions.map((item) => (
                    <option key={item.id} value={item.id} className="bg-[#0a0f1f]">
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              {vlmProvider && (
                <>
                  <div>
                    <label className={labelClass} htmlFor="settings-vision-model">
                      VLM 模型
                    </label>
                    {vlmProvider.id === 'custom' ? (
                      <input
                        id="settings-vision-model"
                        data-settings-input="visionModel"
                        value={draft.visionModel}
                        onChange={(event) => patch('visionModel', event.target.value)}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        placeholder="手填兼容视觉模型名"
                        className={inputClass}
                      />
                    ) : (
                      <select
                        id="settings-vision-model"
                        data-settings-input="visionModel"
                        value={draft.visionModel}
                        onChange={(event) => patch('visionModel', event.target.value)}
                        className={`${inputClass} appearance-none`}
                      >
                        {vlmProvider.visionModels.map((model) => (
                          <option key={model} value={model} className="bg-[#0a0f1f]">
                            {model}
                          </option>
                        ))}
                        {draft.visionModel &&
                          !vlmProvider.visionModels.includes(draft.visionModel) && (
                            <option value={draft.visionModel} className="bg-[#0a0f1f]">
                              {draft.visionModel}
                            </option>
                          )}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="settings-vision-base">
                      VLM Base URL
                    </label>
                    <input
                      id="settings-vision-base"
                      data-settings-input="visionBaseUrl"
                      value={draft.visionBaseUrl}
                      onChange={(event) => patch('visionBaseUrl', event.target.value)}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      placeholder="选择服务商后自动填充"
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label className={labelClass} htmlFor="settings-vision-key">
                      VLM API Key
                    </label>
                    <div className="relative">
                      <input
                        id="settings-vision-key"
                        data-settings-input="visionApiKey"
                        type={showVisionKey ? 'text' : 'password'}
                        value={draft.visionApiKey}
                        onChange={(event) => patch('visionApiKey', event.target.value)}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        placeholder="留空则跟随聊天 Key"
                        className={`${inputClass} pr-[5.5rem]`}
                      />
                      <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-2">
                        <KeyStatusIcon
                          result={visionKeyStatus}
                          label="VLM API Key"
                          onRetry={() => setVisionCheckNonce((value) => value + 1)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowVisionKey((value) => !value)}
                          className="font-mono text-[9px] tracking-[0.12em] text-stardust/40 hover:text-stardust/80"
                        >
                          {showVisionKey ? 'HIDE' : 'SHOW'}
                        </button>
                      </div>
                    </div>
                    {(visionKeyStatus.status === 'invalid' ||
                      visionKeyStatus.status === 'error') && (
                      <p className="mt-1 text-[9px] leading-relaxed text-red-300/75">
                        {visionKeyStatus.reason ?? 'VLM Key 校验失败'}
                      </p>
                    )}
                    {vlmKeyMissing && (
                      <p className="mt-1 text-[9px] leading-relaxed text-mood-warm/75">
                        当前 VLM 与聊天服务商不同，请单独填写 VLM Key；否则会 401。
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[8px] leading-relaxed tracking-[0.04em] text-stardust/26">
                      请求：{vlmBase} · {draft.visionModel || '跟随聊天模型'}
                    </p>
                  </div>

                  <div className="space-y-2 border-t border-white/8 pt-3">
                    <label className="flex items-center justify-between gap-3">
                      <span>
                        <span className="block text-[10.5px] text-stardust/75">高清识图</span>
                        <span className="mt-0.5 block text-[8.5px] text-stardust/28">
                          2800px · JPEG 0.95 · detail high
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        data-vision-high="1"
                        checked={draft.visionHighQuality}
                        onChange={(event) => patch('visionHighQuality', event.target.checked)}
                        className="h-4 w-4 accent-[#9fd8ff]"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3">
                      <span>
                        <span className="block text-[10.5px] text-stardust/75">导入照片时自动识图</span>
                        <span className="mt-0.5 block text-[8.5px] text-stardust/28">
                          只有配置了可用 VLM 才执行
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        data-vision-auto="1"
                        checked={draft.visionAutoAnalyze}
                        onChange={(event) => patch('visionAutoAnalyze', event.target.checked)}
                        className="h-4 w-4 accent-[#9fd8ff]"
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ── 人格语料蒸馏 ── */}
          <section data-persona-lab="1">
            <SectionTitle index="06" title="人格语料蒸馏" hint="只注入蒸馏结果" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3.5">
              <div className="grid grid-cols-2 gap-2">
                {AI.personas.map((persona) => {
                  const active = persona.id === activePersonaId;
                  const custom = Boolean(personaProfiles[persona.id]?.instruction);
                  return (
                    <button
                      key={persona.id}
                      type="button"
                      data-persona-tab={persona.id}
                      onClick={() => setActivePersonaId(persona.id)}
                      className={[
                        'rounded-xl border px-3 py-2 text-left transition',
                        active
                          ? 'border-mood-cyan/45 bg-white/[0.09] text-stardust/90'
                          : 'border-white/10 bg-white/[0.025] text-stardust/55 hover:border-white/22',
                      ].join(' ')}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] tracking-[0.05em]">{persona.name}</span>
                        <span
                          className={[
                            'h-1.5 w-1.5 rounded-full',
                            custom ? 'bg-mood-warm shadow-[0_0_8px_rgba(255,184,107,0.8)]' : 'bg-stardust/20',
                          ].join(' ')}
                        />
                      </span>
                      <span className="mt-0.5 block font-mono text-[8px] tracking-[0.08em] text-stardust/28">
                        {custom ? '已自定义' : '默认气质'}
                      </span>
                    </button>
                  );
                })}
              </div>

              <textarea
                data-persona-corpus="1"
                value={activeCorpus}
                onChange={(event) => setCorpus(event.target.value)}
                onBlur={persistCorpus}
                rows={7}
                placeholder={`粘贴与「${activePersona.name}」相关的聊天记录，或一次上传多张截图自动提取。\n\n原始语料只保存在本机，不会进入聊天请求。`}
                className={`${inputClass} mt-3 resize-y leading-relaxed`}
              />
              <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[8.5px] tracking-[0.08em] text-stardust/28">
                <span>{activeCorpus.length} / {AI.lab.maxRawCorpusChars} 字</span>
                <span>{activeInstruction ? '自定义人格已生效' : '当前使用默认气质'}</span>
              </div>

              <input
                ref={personaFileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length > 0) void handlePersonaFiles(files);
                }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-persona-upload="1"
                  disabled={personaBusy !== null}
                  onClick={() => personaFileRef.current?.click()}
                  className="rounded-full border border-white/16 bg-white/[0.05] px-3 py-1.5 font-mono text-[9px] tracking-[0.12em] text-stardust/65 transition hover:border-mood-cyan/40 hover:text-stardust disabled:opacity-40"
                >
                  上传截图（可多选）
                </button>
                <button
                  type="button"
                  data-persona-distill="1"
                  disabled={personaBusy !== null}
                  onClick={() => void handleDistill()}
                  className="rounded-full border border-mood-cyan/40 bg-mood-cyan/12 px-3 py-1.5 font-mono text-[9px] tracking-[0.12em] text-mood-cyan/90 transition hover:border-mood-cyan/70 hover:bg-mood-cyan/20 disabled:opacity-40"
                >
                  {personaBusy === 'distill' ? '生成中…' : personaBusy === 'ocr' ? '识别中…' : '解析并生成人格'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearPersona(activePersonaId);
                    setPersonaNotice('已恢复默认气质，原始语料仍保留');
                  }}
                  className="font-mono text-[8.5px] tracking-[0.1em] text-stardust/30 transition hover:text-mood-warm/75"
                >
                  恢复默认
                </button>
              </div>
              {personaNotice && (
                <p className="mt-2 text-[9px] leading-relaxed tracking-[0.04em] text-mood-cyan/55">
                  {personaNotice}
                </p>
              )}
              {activeInstruction && (
                <details className="mt-3 border-t border-white/8 pt-2">
                  <summary className="cursor-pointer font-mono text-[8.5px] tracking-[0.12em] text-stardust/35">
                    查看当前蒸馏结果
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[9.5px] leading-relaxed text-stardust/60">
                    {activeInstruction}
                  </pre>
                </details>
              )}
              <p className="mt-2 text-[8.5px] leading-relaxed text-stardust/24">
                原始语料保存在 localStorage，仅用于编辑；聊天 System Prompt 只读蒸馏后的 instruction。
              </p>
            </div>
          </section>

          {/* ── 热梗截图识别 ── */}
          <section data-meme-lab="1">
            <SectionTitle index="07" title="热梗截图识别" hint="学会新梗" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3.5">
              <input
                ref={memeFileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (files.length > 0) void handleMemeScreenshots(files);
                }}
              />
              <button
                type="button"
                data-meme-drop="1"
                disabled={memeBusy}
                onClick={() => memeFileRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setMemeDragging(true);
                }}
                onDragLeave={() => setMemeDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setMemeDragging(false);
                  const files = imagesFromDataTransfer(event.dataTransfer);
                  if (files.length > 0) void handleMemeScreenshots(files);
                }}
                className={[
                  'flex min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-xl',
                  'border border-dashed px-4 py-4 text-center transition',
                  memeDragging
                    ? 'border-mood-cyan/65 bg-mood-cyan/[0.08]'
                    : 'border-white/18 bg-black/10 hover:border-mood-cyan/40',
                  memeBusy ? 'opacity-60' : '',
                ].join(' ')}
              >
                <span className="font-mono text-[10px] tracking-[0.12em] text-stardust/60">
                  {memeBusy ? '正在识别…' : '拖拽 / 点击 / 粘贴热梗截图（可多选）'}
                </span>
                <span className="text-[8.5px] leading-relaxed text-stardust/26">
                  支持 Ctrl/Cmd + V 粘贴；一次可选多张，结果自动去重入库
                </span>
              </button>

              {memeNotice && (
                <p className="mt-2 text-[9px] leading-relaxed tracking-[0.04em] text-mood-cyan/55">
                  {memeNotice}
                </p>
              )}

              <div className="mt-3 flex items-center justify-between">
                <p className="font-mono text-[8.5px] tracking-[0.12em] text-stardust/30">
                  已学会 {memeEntries.length} 个梗
                </p>
                {memeEntries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => useMemeLibraryStore.getState().clear()}
                    className="font-mono text-[8px] tracking-[0.1em] text-stardust/24 hover:text-mood-warm/70"
                  >
                    清空
                  </button>
                )}
              </div>
              {memeEntries.length > 0 && (
                <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {memeEntries.map((entry) => (
                    <li
                      key={entry.word}
                      data-meme-word={entry.word}
                      className="group flex items-start justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.025] px-2.5 py-1.5"
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-[9.5px] tracking-[0.06em] text-mood-cyan/70">
                          {entry.word}
                        </span>
                        <span className="ml-2 text-[9px] leading-relaxed text-stardust/45">
                          {entry.meaning}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMeme(entry.word)}
                        aria-label={`删除热梗 ${entry.word}`}
                        className="shrink-0 text-[10px] text-stardust/18 hover:text-mood-warm/80"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[8.5px] leading-relaxed text-stardust/24">
                只在幽默损友人设、轻松语境下注入最近 {AI.lab.maxMemePromptEntries} 条热梗；情绪低落或问事实时不用。
              </p>
            </div>
          </section>

          <p className="text-[9px] leading-relaxed tracking-[0.04em] text-stardust/22">
            提示：任意 OpenAI 兼容平台都可使用。Key 只保存在本机 localStorage；
            比赛演示可直接使用，公网部署请换成服务端代理。
          </p>
        </div>

        <footer className="relative sticky bottom-0 border-t border-white/10 bg-cosmos-near/55 px-6 py-4 backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={restore}
              className="font-mono text-[9px] tracking-[0.16em] text-stardust/32 transition hover:text-mood-warm/80"
            >
              恢复默认
            </button>
            <div className="flex items-center gap-3">
              {savedFlash && (
                <span className="font-mono text-[9px] tracking-[0.08em] text-mood-cyan/65">
                  {savedFlash}
                </span>
              )}
              <button
                type="button"
                onClick={save}
                id="settings-save"
                className={[
                  'rounded-full border border-mood-cyan/40 bg-mood-cyan/12 px-5 py-2',
                  'font-mono text-[10px] tracking-[0.18em] text-mood-cyan/90',
                  'shadow-[0_0_24px_-8px_rgba(159,216,255,0.55)] transition',
                  'hover:border-mood-cyan/70 hover:bg-mood-cyan/20',
                ].join(' ')}
              >
                保存配置
              </button>
            </div>
          </div>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

function SectionTitle({
  index,
  title,
  hint,
}: {
  index: string;
  title: string;
  hint: string;
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <span className="font-mono text-[8.5px] tracking-[0.2em] text-mood-cyan/40">{index}</span>
      <h3 className="text-[12px] tracking-[0.14em] text-stardust/78">{title}</h3>
      <span className="ml-auto font-mono text-[8.5px] tracking-[0.12em] text-stardust/24">
        {hint}
      </span>
    </div>
  );
}

/**
 * API Key 的真实联网校验状态
 *  - checking：转圈
 *  - valid：绿勾
 *  - invalid / error：红叉
 * 点击图标可手动重试（输入后也会自动防抖检测）。
 */
function KeyStatusIcon({
  result,
  label,
  onRetry,
}: {
  result: KeyCheckResult;
  label: string;
  onRetry: () => void;
}) {
  if (result.status === 'idle') return null;
  const title =
    result.status === 'checking'
      ? `${label}：正在验证…`
      : result.status === 'valid'
        ? `${label}：有效（${result.latencyMs}ms）`
        : `${label}：${result.reason ?? '校验失败'}（点击重试）`;

  return (
    <button
      type="button"
      data-key-status={result.status}
      data-key-label={label}
      aria-label={title}
      title={title}
      onClick={onRetry}
      disabled={result.status === 'checking'}
      className="grid h-5 w-5 place-items-center rounded-full transition hover:bg-white/[0.06] disabled:cursor-wait"
    >
      {result.status === 'checking' && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border border-mood-cyan/25 border-t-mood-cyan/90" />
      )}
      {result.status === 'valid' && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="rgba(124,255,196,0.45)" strokeWidth="1.5" />
          <path
            d="m7.6 12.2 2.9 2.9 5.9-6"
            stroke="#7cffc4"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {(result.status === 'invalid' || result.status === 'error') && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="rgba(255,120,120,0.45)" strokeWidth="1.5" />
          <path
            d="m8.6 8.6 6.8 6.8m0-6.8-6.8 6.8"
            stroke="#ff7a7a"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
