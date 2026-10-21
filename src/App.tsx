import { useEffect, useRef } from 'react';
import { createStage } from '@/scene';
import { Hud, CameraPreview, GestureOverlay, Dialogue, SettingsPanel, SplashScreen } from '@/ui';
import { getGestureEngine } from '@/gesture';
import { useRiverStore } from '@/state';
import { primeVoices, restoreTtsPreference } from '@/ai';
import { syncApiStatusFromEnvironment } from '@/ai/apiStatus';
import { useSettingsStore } from '@/ai/settings';
import { scanPendingPhotoAnalyses } from '@/photo/vlmQueue';
import {
  disposeSfx,
  getMusicEngine,
  releaseMusicEngine,
  setSfxEnabled,
  unlockSfx,
} from '@/music';

/**
 * App：把 WebGL 舞台挂上 DOM，叠三层 UI
 *   1. GestureOverlay —— 全屏 2D canvas：柔光光标 / 拖尾 / 进度环（每帧更新，不走 React）
 *   2. Hud            —— 标题 / 层级 / 遥测 / 缩略图 / 导入
 *   3. CameraPreview  —— 左下角画中画 + 骨架 + 手势状态
 *   4. Dialogue       —— L2 聚焦时滑出的对话面板（玻璃拟态，阶段 4）
 *
 * 事件流：gesture/pointer 输入 → state/store → scene（相机/粒子）+ ui（HUD）
 * 手势引擎在挂载后自动启动；摄像头不可用时自动降级到鼠标模式。
 */
export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // StrictMode 下 dev 会 effect 二次挂载，createStage/dispose 必须幂等
    const stage = createStage(host);

    if (import.meta.env.DEV) {
      (window as unknown as { __MR_STAGE?: unknown }).__MR_STAGE = stage;
    }

    return () => {
      stage.dispose();
      if (import.meta.env.DEV) {
        delete (window as unknown as { __MR_STAGE?: unknown }).__MR_STAGE;
      }
    };
  }, []);

  // 手势引擎：启动 + 降级
  useEffect(() => {
    const engine = getGestureEngine();
    const store = useRiverStore.getState();
    if (store.inputMode === 'gesture') void engine.start();

    // 摄像头被拒 → 自动切到鼠标模式（路演不能翻车）
    const unsubscribe = useRiverStore.subscribe((state, previous) => {
      if (state.gestureStatus === previous.gestureStatus) return;
      if (state.gestureStatus === 'unavailable' && state.inputMode === 'gesture') {
        state.setInputMode('pointer');
        engine.setEnabled(false);
      }
    });

    return () => {
      unsubscribe();
      engine.stop();
    };
  }, []);

  // 输入模式切换（G 键或按钮）→ 启停手势引擎
  useEffect(() => {
    const unsubscribe = useRiverStore.subscribe((state, previous) => {
      if (state.inputMode === previous.inputMode) return;
      const engine = getGestureEngine();
      const gesture = state.inputMode === 'gesture';
      engine.setEnabled(gesture);
      if (gesture && engine.status() !== 'ready') void engine.start();
    });
    return unsubscribe;
  }, []);

  // 对话的开关规则（**唯一一处**）：
  //   进入 L2 → 浮出；离开 L2 → 收起；L2 里换了照片 → 跟着换（新的一段记忆）
  // 离开 L2 就收起对话层
  useEffect(() => {
    const unsubscribe = useRiverStore.subscribe((state, previous) => {
      if (state.layer !== previous.layer) {
        if (state.layer === 'L2') state.openDialog();
        else state.closeDialog();
        return;
      }
      if (state.layer === 'L2' && state.focusedId !== previous.focusedId) {
        if (state.focusedId) state.openDialog();
      }
    });
    return unsubscribe;
  }, []);

  // 语音：恢复用户偏好 + 预取中文语音（首次 getVoices 可能是空的）
  useEffect(() => {
    const enabled = restoreTtsPreference();
    useRiverStore.getState().setTtsEnabled(enabled);
    primeVoices();
  }, []);

  // API 可用性：启动 / 设置变化 / 浏览器网络事件时同步
  useEffect(() => {
    const sync = (): void => syncApiStatusFromEnvironment();
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
      if (
        state.apiKey !== previous.apiKey ||
        state.baseUrl !== previous.baseUrl ||
        state.model !== previous.model
      ) {
        sync();
      }
    });
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      unsubscribeSettings();
    };
  }, []);

  // 离开 L2（包括连续缩放派生的层级）自动解除手势锁
  useEffect(() => {
    return useRiverStore.subscribe((state, previous) => {
      if (
        state.layer !== previous.layer &&
        state.layer !== 'L2' &&
        state.l2Locked
      ) {
        useRiverStore.getState().setL2Locked(false);
        useRiverStore.getState().setL2LockCooldownUntil(0);
      }
    });
  }, []);

  // 照片 VLM 自动识图：导入 / 配置变化后扫描未分析照片
  useEffect(() => {
    const scan = (): void => scanPendingPhotoAnalyses();
    scan();
    const unsubscribePhotos = useRiverStore.subscribe((next, previous) => {
      if (next.photos !== previous.photos) scan();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((next, previous) => {
      if (
        next.visionProviderId !== previous.visionProviderId ||
        next.visionBaseUrl !== previous.visionBaseUrl ||
        next.visionApiKey !== previous.visionApiKey ||
        next.visionModel !== previous.visionModel ||
        next.visionHighQuality !== previous.visionHighQuality ||
        next.visionAutoAnalyze !== previous.visionAutoAnalyze ||
        next.baseUrl !== previous.baseUrl ||
        next.apiKey !== previous.apiKey ||
        next.model !== previous.model
      ) {
        scan();
      }
    });
    return () => {
      unsubscribePhotos();
      unsubscribeSettings();
    };
  }, []);

  // 环境音：L2 淡入 / 离开淡出；音量与开关跟随设置
  useEffect(() => {
    const engine = getMusicEngine();
    const state = useRiverStore.getState();
    engine.setEnabled(state.musicEnabled);
    engine.setVolume(state.musicVolume);
    engine.bindLayer(state.layer);
    setSfxEnabled(state.musicEnabled);

    if (import.meta.env.DEV) {
      (window as unknown as { __MR_MUSIC?: unknown }).__MR_MUSIC = engine;
    }

    const syncTrack = (): void => {
      const current = useRiverStore.getState();
      const photo = current.photos.find((item) => item.id === current.focusedId);
      void engine.setTrack(photo?.audio ?? null);
    };
    syncTrack();

    const unsubscribeLayer = useRiverStore.subscribe((next, previous) => {
      if (next.layer !== previous.layer) engine.bindLayer(next.layer);
    });
    const unsubscribePhoto = useRiverStore.subscribe((next, previous) => {
      if (next.focusedId !== previous.focusedId || next.photos !== previous.photos) {
        syncTrack();
      }
    });
    const unsubscribeSound = useRiverStore.subscribe((next, previous) => {
      if (next.musicEnabled !== previous.musicEnabled) {
        engine.setEnabled(next.musicEnabled);
        setSfxEnabled(next.musicEnabled);
      }
      if (next.musicVolume !== previous.musicVolume) {
        engine.setVolume(next.musicVolume);
      }
    });

    // 浏览器只允许在用户手势后启动 AudioContext
    const unlock = (): void => {
      void engine.unlock();
      void unlockSfx();
    };
    window.addEventListener('pointerdown', unlock, { capture: true, once: true });
    window.addEventListener('keydown', unlock, { capture: true, once: true });

    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      unsubscribeLayer();
      unsubscribePhoto();
      unsubscribeSound();
      if (import.meta.env.DEV) {
        delete (window as unknown as { __MR_MUSIC?: unknown }).__MR_MUSIC;
      }
      releaseMusicEngine();
      disposeSfx();
    };
  }, []);

  return (
    <main className="relative h-full w-full overflow-hidden grain">
      <div ref={hostRef} className="absolute inset-0" aria-hidden="true" />
      <GestureOverlay />
      <Hud />
      <Dialogue />
      <CameraPreview />
      <SettingsPanel />
      <SplashScreen />
    </main>
  );
}
