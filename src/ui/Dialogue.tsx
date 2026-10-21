import { useEffect, useMemo, useRef, useState } from 'react';
import { AI, UI_COPY } from '@/config';
import { useRiverStore } from '@/state';
import type { ChatTurn } from '@/state';
import { photoSwatch } from '@/photo/ingest';
import { isTextEntry } from './dom';
import { ensureThreadOpened, sendChatMessage } from '@/ai';
import { hasRemote } from '@/ai/runtime';
import { activePersona, useSettingsStore } from '@/ai/settings';
import { useApiStatusStore } from '@/ai/apiStatus';
import { sliceForPhoto } from '@/ai/slices';
import { startVoiceInput, voiceInputAvailable, type VoiceSession } from '@/ai/voiceInput';
import { MusicBinder } from './MusicBinder';
import { PhotoVisionStatus } from './PhotoVisionStatus';

/**
 * 沉浸式对话层（**没有面板**）
 * ────────────────────────────────────────────────────────────────
 * 台词像电影字幕一样浮在粒子照片周围 —— AI 的话在左，你的话在右，
 * 越旧越淡、最多同时 5 条，文字带柔和阴影，压在亮粒子上也读得清。
 * 底部只有一枚极简胶囊（按住说话 / 空格）+「凝聚记忆」+ 一行几乎隐形的输入框。
 *
 * 交互约定：
 *  - 进入 L2 自动开始这段记忆（第一句是切片开场白），离开 L2 自动收起
 *  - 空格 = 按住说话（对话打开且没有在输入框里打字时）
 *  - Esc = 退回长河
 */

/** 稳定的小抖动：让台词像"漂浮"而不是"列表"（同一条消息永远是同一个位置） */
function hash2(text: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 8) & 1023) / 1023;
  const b = ((h >>> 20) & 1023) / 1023;
  return { x: a * 2 - 1, y: b * 2 - 1 };
}

/**
 * 苹果玻璃拟态的两个共享样式
 *
 *  外层（WRAP）：1px 的**渐变细描边** —— 上亮下暗，模拟光线打在玻璃边缘的高光
 *  内层（INNER）：bg-white/10 半透明底 + 背景模糊 + 内侧顶部高光 + 细腻深投影
 *
 * 用法：外层做边框与投影，内层放内容（按钮/输入框），点击区域在内层上。
 */
const GLASS_WRAP = [
  'rounded-full p-[1px]',
  'bg-[linear-gradient(160deg,rgba(255,255,255,0.42),rgba(255,255,255,0.10)_38%,rgba(255,255,255,0.04))]',
  'shadow-[0_10px_30px_-14px_rgba(0,0,0,0.95)]',
].join(' ');

const GLASS_INNER = [
  'bg-white/[0.10] backdrop-blur-2xl backdrop-saturate-150',
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.20),inset_0_-1px_0_rgba(0,0,0,0.25)]',
  'transition-colors duration-300',
].join(' ');

export function Dialogue() {
  const dialogOpen = useRiverStore((s) => s.dialogOpen);
  const layer = useRiverStore((s) => s.layer);
  const focusedId = useRiverStore((s) => s.focusedId);
  const photos = useRiverStore((s) => s.photos);
  const chatByPhoto = useRiverStore((s) => s.chatByPhoto);
  const chatBusy = useRiverStore((s) => s.chatBusy);
  const setLayer = useRiverStore((s) => s.setLayer);
  const closeDialog = useRiverStore((s) => s.closeDialog);
  const settingsRevision = useSettingsStore((s) => s.revision);
  const providerId = useSettingsStore((s) => s.providerId);
  const modelName = useSettingsStore((s) => s.model);
  const personaName = activePersona().name;
  const providerName = useMemo(
    () => AI.providers.find((item) => item.id === providerId)?.name ?? 'LLM',
    [providerId],
  );

  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const talkRef = useRef<HTMLButtonElement>(null);
  const tapAtRef = useRef(0);
  /** 底部栏实际高度：台词栈要浮在它上面，不能压到按钮 */
  const [barHeight, setBarHeight] = useState<number>(AI.ui.bubbles.bottomInsetPx);
  const voiceRef = useRef<VoiceSession | null>(null);
  const toastTimer = useRef<number | null>(null);

  const photo = photos.find((item) => item.id === focusedId);
  const open = dialogOpen && layer === 'L2' && Boolean(photo);
  const thread = useMemo(
    () => (photo ? (chatByPhoto[photo.id] ?? []) : []),
    [photo, chatByPhoto],
  );
  const profile = photo ? sliceForPhoto(photo) : null;
  const accent = photo ? photoSwatch(photo) : '#ffb86b';
  // Base URL / Key 在设置面板保存后，底部的「在线/离线」要立刻更新。
  const online = useMemo(() => hasRemote(), [settingsRevision]);
  const apiStatus = useApiStatusStore((state) => state.status);
  const l2Locked = useRiverStore((state) => state.l2Locked);
  const l2LockCooldownUntil = useRiverStore((state) => state.l2LockCooldownUntil);
  const [lockNowMs, setLockNowMs] = useState(() => performance.now());

  useEffect(() => {
    if (l2LockCooldownUntil <= performance.now()) return;
    const tick = (): void => {
      const now = performance.now();
      setLockNowMs(now);
      if (now >= l2LockCooldownUntil) window.clearInterval(timer);
    };
    const timer = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(timer);
  }, [l2LockCooldownUntil]);

  const lockCooldownMs = Math.max(0, l2LockCooldownUntil - lockNowMs);
  const lockCooldownSeconds = Math.ceil(lockCooldownMs / 1000);
  const showLockChip = l2Locked || lockCooldownSeconds > 0;
  const canChat = apiStatus === 'unknown' || apiStatus === 'online';
  const statusHint =
    apiStatus === 'no-key'
      ? '未配置 API Key · 点右上角设置'
      : apiStatus === 'invalid'
        ? 'API Key 无效 · 点右上角设置'
        : apiStatus === 'offline'
          ? '当前离线或接口不可达'
          : '';

  const visible = useMemo(() => thread.slice(-AI.ui.bubbles.maxVisible), [thread]);

  /** 短提示（语音不可用 / 记忆已凝聚） */
  const flash = (text: string): void => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  // 打开这张图 → 补开场白（只第一次）
  useEffect(() => {
    if (!open || !photo) return;
    ensureThreadOpened(photo.id);
  }, [open, photo]);

  /**
   * 底部栏实际占了多少高度 → 台词栈要浮在它上面
   *
   * 用「视口高 - 栏顶边」而不是栏自身高度：栏是贴底的，
   * 这样算出来连它自己的内边距一起包含，永远不会因为"提示行突然出现"而算漏。
   */
  const measureBar = (): void => {
    const node = barRef.current;
    if (!node) return;
    const next = Math.round(window.innerHeight - node.getBoundingClientRect().top) + 12;
    setBarHeight((prev) => (Math.abs(prev - next) > 2 ? next : prev));
  };

  useEffect(() => {
    const node = barRef.current;
    if (!node) return;
    measureBar();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureBar());
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 提示行 / 语音状态会改变栏高，但 ResizeObserver 在某些环境不及时 → 显式再量一次
  useEffect(() => {
    measureBar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, listening, open]);

  // 收起时停掉语音
  useEffect(() => {
    if (open) return;
    voiceRef.current?.cancel();
    voiceRef.current = null;
    setListening(false);
  }, [open]);

  // 输入框自适应高度
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 20 * AI.ui.inputMaxRows)}px`;
  }, [draft]);

  const send = (text: string): void => {
    const value = text.trim();
    if (value.length === 0 || chatBusy) return;
    if (!canChat) {
      flash(statusHint || '当前无法对话');
      return;
    }
    setDraft('');
    void sendChatMessage(value).then((result) => {
      if (result.ok) return;
      const reason = result.reason ?? '';
      flash(
        /no-api-key|401|403|invalid|unauthorized|forbidden/i.test(reason)
          ? 'API Key 无效或未配置'
          : '发送失败：当前离线或接口不可达',
      );
    });
  };

  const leave = (): void => {
    closeDialog();
    setLayer('L1');
  };

  /** 按住说话：开始 */
  const beginVoice = (): void => {
    if (chatBusy || listening) return;
    if (!canChat) {
      flash(statusHint || '当前无法对话');
      return;
    }
    if (!voiceInputAvailable()) {
      flash(AI.ui.capsule.voiceUnavailable);
      return;
    }
    const session = startVoiceInput(
      (partial) => setDraft(partial),
      (reason) => {
        setListening(false);
        voiceRef.current = null;
        flash(
          reason === 'not-allowed' ? '麦克风被拒绝，直接打字吧' : AI.ui.capsule.voiceUnavailable,
        );
      },
    );
    if (!session) return;
    voiceRef.current = session;
    setListening(true);
  };

  /** 按住说话：松手 → 发送 */
  const endVoice = (): void => {
    const session = voiceRef.current;
    if (!session) return;
    voiceRef.current = null;
    setListening(false);
    void session.stop().then((text) => {
      if (text.length > 0) {
        send(text);
        return;
      }
      // 没识别到内容：如果是短按（更像是想打字），直接把光标放进输入框
      if (performance.now() - tapAtRef.current < 900) {
        inputRef.current?.focus();
        flash('没听清，直接打字吧');
      }
    });
  };

  // 空格 = 按住说话；Esc = 返回（对话打开时才接管）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') {
        event.preventDefault();
        leave();
        return;
      }
      if (event.code !== 'Space' || event.repeat) return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      beginVoice();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      endVoice();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  if (photos.length === 0) return null;


  return (
    <>
      {/* ── 悬浮台词：AI 在左，你在右，越旧越淡 ── */}
      <div
        data-chat-layer={open ? 'open' : 'closed'}
        className={[
          'pointer-events-none absolute inset-0 z-30 flex flex-col justify-end gap-2',
          'transition-opacity duration-500',
          open ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        style={{
          paddingLeft: `${AI.ui.gutterPx}px`,
          paddingRight: `${AI.ui.gutterPx}px`,
          paddingBottom: `${barHeight}px`,
        }}
        aria-hidden={!open}
        aria-live="polite"
      >
        {visible.map((turn, index) => {
          const fromNewest = visible.length - 1 - index;
          const fade = AI.ui.bubbles.fadeByAge[fromNewest] ?? 0.12;
          const isAi = turn.role === 'persona';
          const drift = hash2(turn.id);
          return (
            <div
              key={turn.id}
              className={['flex', isAi ? 'justify-start' : 'justify-end'].join(' ')}
              style={{
                opacity: open ? fade : 0,
                transform: `translateX(${drift.x * AI.ui.bubbles.driftXPct}%) translateY(${drift.y * AI.ui.bubbles.driftYPx}px)`,
                transition: `opacity ${AI.ui.entranceMs}ms ease`,
              }}
            >
              <Speech turn={turn} isAi={isAi} enterMs={AI.ui.bubbles.enterMs} />
            </div>
          );
        })}

        {/* 思考中：极轻的一行 */}
        {chatBusy && open && (
          <div className="mt-1 flex justify-start">
            <span className="inline-flex items-center gap-1.5 pl-1">
              <span className="font-mono text-[9px] tracking-[0.3em] text-mood-cyan/45">
                {AI.personaName} · {personaName}
              </span>
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-[3px] w-[3px] animate-pulse rounded-full bg-stardust/45"
                  style={{ animationDelay: `${dot * 180}ms`, animationDuration: '1.15s' }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* ── 底部：苹果玻璃拟态（渐变细描边 + bg-white/10 + 背景模糊 + 细腻投影） ── */}
      <div
        ref={barRef}
        data-chat-bar={open ? 'open' : 'closed'}
        data-chat-api-status={apiStatus}
        className={[
          'absolute bottom-0 left-0 right-0 z-50 flex items-end justify-between gap-4',
          'transition-opacity duration-500',
          open ? 'pointer-events-none opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        style={{ padding: `${AI.ui.gutterPx}px` }}
      >
        {/* 左：这段记忆的标签（很淡，两行，不抢视线） */}
        <div className="hidden min-w-0 pb-2 sm:block">
          <p className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-mood-cyan/45">
            <span
              className="inline-block h-1 w-1 rounded-full"
              style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
            />
            {profile?.label ?? '—'}
          </p>
          <p className="mt-1 truncate font-mono text-[8.5px] tracking-[0.14em] text-stardust/22">
            {!canChat
              ? statusHint
              : listening
                ? '在听…说完松手'
                : (toast ?? '按住说话 · 空格 · 扇风换一张')}
            <span className="ml-2 text-stardust/18">
              {online ? `· ${providerName} · ${modelName}` : '· 未配置模型 · 点齿轮填 Key'}
            </span>
          </p>
        </div>

        {/* 右：配乐 + 语音条 + 输入 + 按住说话 + 关闭 */}
        <div className="pointer-events-auto ml-auto flex flex-col items-end gap-2.5">
          {showLockChip && (
            <div
              data-l2-lock={l2Locked ? '1' : undefined}
              data-l2-lock-cooldown={l2Locked ? undefined : '1'}
              className={[
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[9px] tracking-[0.12em] backdrop-blur-xl',
                l2Locked
                  ? 'border-mood-cyan/30 bg-mood-cyan/[0.07] text-mood-cyan/70'
                  : 'border-white/14 bg-white/[0.05] text-stardust/45',
              ].join(' ')}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              {l2Locked
                ? lockCooldownSeconds > 0
                  ? `已锁定 · ${lockCooldownSeconds}s 后可解锁`
                  : UI_COPY.l2LockedHint
                : `${UI_COPY.l2LockCooldownHint} ${lockCooldownSeconds}s`}
            </div>
          )}

          {photo && (
            <div className="flex items-center gap-2">
              <PhotoVisionStatus photo={photo} />
              <MusicBinder photo={photo} />
            </div>
          )}

          {/* 语音条：只在说话时出现，玻璃质感 */}
          {listening && (
            <div className={GLASS_WRAP}>
              <div
                className={[
                  GLASS_INNER,
                  'flex max-w-[19rem] items-center gap-2 rounded-full px-3.5 py-1.5',
                ].join(' ')}
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mood-warm/70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-mood-warm" />
                </span>
                <span className="truncate font-mono text-[10px] tracking-[0.08em] text-stardust/80">
                  {draft.length > 0 ? draft : '在听…'}
                </span>
              </div>
            </div>
          )}

          {!canChat && (
            <div className="rounded-full border border-red-300/18 bg-red-400/[0.07] px-3.5 py-1.5 font-mono text-[9px] tracking-[0.08em] text-red-200/65 backdrop-blur-xl">
              {statusHint}
            </div>
          )}

          <div className="flex items-center gap-2.5">
            {/* 输入：玻璃输入框（不再是隐形下划线） */}
            <div className={GLASS_WRAP}>
              <div className={[GLASS_INNER, 'rounded-full'].join(' ')}>
                <textarea
                  ref={inputRef}
                  id="chat-input"
                  data-chat-input="1"
                  value={draft}
                  rows={1}
                  disabled={!canChat}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      send(draft);
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      leave();
                    }
                  }}
                  placeholder={canChat ? AI.ui.capsule.inputPlaceholder : statusHint}
                  className={[
                    'w-[6.5rem] resize-none bg-transparent py-1.5 pl-3.5 pr-2 text-[12px] leading-5',
                    'text-stardust/90 tracking-[0.02em] placeholder:text-stardust/32',
                    'transition-[width] duration-300 focus:w-[15rem] focus:outline-none',
                    'disabled:cursor-not-allowed disabled:opacity-45',
                  ].join(' ')}
                />
              </div>
            </div>

            {/* 按住说话：主按钮，玻璃胶囊 */}
            <button
              type="button"
              id="chat-talk"
              data-chat-talk="1"
              ref={talkRef}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                tapAtRef.current = performance.now();
                beginVoice();
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                endVoice();
              }}
              onPointerCancel={() => endVoice()}
              onClick={(event) => {
                event.stopPropagation();
                if (performance.now() - tapAtRef.current > 400) beginVoice();
                if (voiceRef.current) endVoice();
              }}
              disabled={chatBusy || !canChat}
              aria-pressed={listening}
              title={`按住说话（或按住 ${AI.ui.capsule.keyHint}）`}
              style={{ touchAction: 'none', zIndex: 50 }}
              className={[
                GLASS_WRAP,
                'pointer-events-auto transition-transform duration-200 active:scale-[0.985]',
                chatBusy || !canChat ? 'opacity-45' : '',
              ].join(' ')}
            >
              <span
                className={[
                  GLASS_INNER,
                  'flex h-10 items-center gap-2 rounded-full px-4 font-mono text-[10.5px] tracking-[0.14em]',
                  listening ? 'text-mood-warm' : 'text-stardust/88',
                ].join(' ')}
                style={
                  listening
                    ? { background: 'linear-gradient(160deg, rgba(255,184,107,0.30), rgba(255,184,107,0.12))' }
                    : undefined
                }
              >
                <span
                  className={[
                    'inline-block h-1.5 w-1.5 rounded-full',
                    listening ? 'bg-mood-warm' : 'bg-stardust/75',
                  ].join(' ')}
                  style={{
                    boxShadow: listening
                      ? '0 0 12px rgba(255,184,107,0.9)'
                      : '0 0 10px rgba(223,233,255,0.55)',
                  }}
                />
                {listening ? AI.ui.capsule.holdActiveLabel : AI.ui.capsule.holdLabel}
              </span>
            </button>

            {/* 关闭：玻璃圆钮 */}
            <button
              type="button"
              data-chat-back="1"
              onClick={leave}
              title="返回长河（Esc / 握拳）"
              style={{ touchAction: 'manipulation', zIndex: 50 }}
              className={[GLASS_WRAP, 'pointer-events-auto'].join(' ')}
            >
              <span
                className={[
                  GLASS_INNER,
                  'flex h-9 w-9 items-center justify-center rounded-full text-[13px] text-stardust/60',
                  'transition-colors duration-300 hover:text-stardust',
                ].join(' ')}
              >
                ×
              </span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * 一轮台词 / AI 连发多条
 *
 * AI turn 可以带 bubbles[]：每条气泡按 replyDelayMs 错峰浮现。
 * turn.text 仍是完整回复，用于历史、检索和 TTS。
 */
function Speech({
  turn,
  isAi,
  enterMs,
}: {
  turn: ChatTurn;
  isAi: boolean;
  enterMs: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), 16);
    return () => window.clearTimeout(timer);
  }, []);

  const bubbles =
    isAi && turn.bubbles && turn.bubbles.length > 0 ? turn.bubbles : [turn.text];

  return (
    <div
      data-speech={isAi ? 'persona' : 'user'}
      data-bubbles={bubbles.length}
      className={['flex flex-col gap-1.5', isAi ? 'items-start' : 'items-end'].join(' ')}
    >
      {isAi && (
        <span
          className="block pl-1 font-mono text-[8px] tracking-[0.34em] text-mood-cyan/38"
          style={{ opacity: shown ? 1 : 0, transition: `opacity ${enterMs}ms ease-out` }}
        >
          {AI.personaName}
        </span>
      )}

      {bubbles.map((text, index) => (
        <div
          key={`${turn.id}-bubble-${index}`}
          data-bubble-index={index}
          className={[
            'relative rounded-2xl border px-3.5 py-2 backdrop-blur-xl backdrop-saturate-150',
            'shadow-[0_10px_36px_-22px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.13)]',
            isAi
              ? 'border-white/12 bg-white/[0.075] text-left'
              : 'border-mood-warm/18 bg-mood-warm/[0.055] text-right',
          ].join(' ')}
          style={{
            maxWidth: `min(${AI.ui.bubbles.maxWidthCh}ch, ${AI.ui.bubbles.maxWidthVw}vw)`,
            opacity: shown ? 1 : 0,
            transform: shown ? 'translateY(0)' : 'translateY(8px)',
            transitionDelay: `${index * AI.ui.bubbles.replyDelayMs}ms`,
            transition: `opacity ${enterMs}ms ease-out ${index * AI.ui.bubbles.replyDelayMs}ms, transform ${enterMs}ms cubic-bezier(0.22,0.61,0.36,1) ${index * AI.ui.bubbles.replyDelayMs}ms`,
          }}
        >
          <p
            className={[
              'relative text-[13.5px] leading-[1.75] tracking-[0.02em]',
              isAi ? 'text-stardust/92' : 'text-mood-warm/90',
            ].join(' ')}
            style={{
              textShadow: isAi
                ? '0 1px 2px rgba(0,0,0,0.98), 0 0 12px rgba(0,0,0,0.9), 0 0 34px rgba(0,0,0,0.75)'
                : '0 1px 2px rgba(0,0,0,0.98), 0 0 12px rgba(0,0,0,0.85), 0 0 30px rgba(0,0,0,0.7)',
            }}
          >
            {text}
          </p>
        </div>
      ))}

      {turn.citations && turn.citations.length > 0 && (
        <ul
          className="flex flex-wrap gap-2.5 pl-1"
          style={{
            opacity: shown ? 1 : 0,
            transition: `opacity ${enterMs}ms ease-out ${(bubbles.length - 1) * AI.ui.bubbles.replyDelayMs}ms`,
          }}
        >
          {turn.citations.map((citation) => (
            <li key={`${turn.id}-${citation.sliceId}`}>
              <span
                className="memory-shard font-mono text-[8.5px] tracking-[0.12em] text-mood-cyan/40"
                title={`记忆碎片 · ${citation.label}
${citation.text}`}
                style={{ textShadow: '0 1px 10px rgba(0,0,0,0.9)' }}
              >
                <span className="relative inline-flex" aria-hidden="true">
                  <span className="shard-core" />
                  <span className="shard-dot" />
                  <span className="shard-dot" />
                  <span className="shard-dot" />
                </span>
                {citation.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
