// 摄像头 + MediaPipe HandLandmarker（主线程版，30fps 节流）
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { GESTURE, VISION } from '@/config';
import type { LandmarkPoint } from './types';

/**
 * 追踪器
 *
 * 职责边界：只负责「拿到摄像头画面」和「拿到每帧的 21 个关键点」。
 * 不做任何手势语义判断（那是 stateMachine 的事），也不碰 UI。
 *
 * 资产：public/mediapipe/{wasm,models} 由 `pnpm prepare:assets` 生成；
 * 本地缺失时回落 CDN（见 config.VISION.assets）。
 */

export type TrackerStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable';

export interface TrackerCallbacks {
  /** 每帧检测结果（没有手时 landmarks 为 null） */
  onLandmarks(landmarks: NormalizedLandmark[] | null, nowMs: number): void;
  onStatus(status: TrackerStatus, detail?: string): void;
}

export interface HandTracker {
  start(): Promise<void>;
  stop(): void;
  /** 暂停/恢复推理（鼠标模式时不再占用主线程；摄像头流保留） */
  setPaused(paused: boolean): void;
  readonly status: TrackerStatus;
  /** 摄像头预览用的 video 元素（画中画 UI 直接挂它） */
  readonly video: HTMLVideoElement | null;
  readonly detectFps: number;
}

async function createLandmarker(): Promise<HandLandmarker> {
  const { landmarker } = VISION;

  const build = async (wasmBase: string, modelPath: string): Promise<HandLandmarker> => {
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate: landmarker.delegate },
      runningMode: 'VIDEO',
      numHands: landmarker.numHands,
      minHandDetectionConfidence: landmarker.minHandDetectionConfidence,
      minHandPresenceConfidence: landmarker.minHandPresenceConfidence,
      minTrackingConfidence: landmarker.minTrackingConfidence,
    });
  };

  try {
    // 先用本地资产（离线可跑）
    return await build(VISION.assets.wasmBasePath, VISION.assets.modelPath);
  } catch (error) {
    console.warn('[gesture] 本地模型不可用，回落 CDN', error);
    return await build(VISION.assets.cdnWasmBasePath, VISION.assets.cdnModelPath);
  }
}

export function createHandTracker(callbacks: TrackerCallbacks): HandTracker {
  let landmarker: HandLandmarker | null = null;
  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let raf = 0;
  let lastDetectAt = 0;
  let paused = false;
  let stopping = false;
  let detectFailures = 0;
  let status: TrackerStatus = 'idle';
  const intervalMs = 1000 / Math.max(GESTURE.detectFps, 1);

  /** 释放摄像头与 video 元素（加载失败时也要收干净，不能留着摄像头灯） */
  function releaseCamera(): void {
    for (const track of stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    stream = null;
    if (video) {
      video.onerror = null;
      video.onpause = null;
      video.onstalled = null;
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.srcObject = null;
      // CameraPreview 会把 video 挂进画中画；卸载时一并摘掉，避免 G 键反复切换后堆积。
      video.remove();
      video = null;
    }
  }

  function setStatus(next: TrackerStatus, detail?: string): void {
    if (status === next) return;
    status = next;
    callbacks.onStatus(next, detail);
  }

  function loop(): void {
    raf = requestAnimationFrame(loop);
    if (paused || document.hidden) return;
    const now = performance.now();
    if (now - lastDetectAt < intervalMs) return;
    lastDetectAt = now;

    if (!landmarker || !video) return;
    if (video.paused && video.srcObject && !stopping && !document.hidden) {
      void video.play().catch(() => undefined);
    }
    if (video.readyState < 2) return;

    try {
      // MediaPipe 的 detectForVideo 是同步主线程调用。限制在 30fps，
      // 并在鼠标模式/后台标签页时直接跳过（见 paused / document.hidden）。
      const result = landmarker.detectForVideo(video, now);
      const hand = result.landmarks?.[0];
      detectFailures = 0;
      if (status === 'unavailable') setStatus('ready');
      callbacks.onLandmarks(hand && hand.length >= 21 ? hand : null, now);
    } catch (error) {
      detectFailures += 1;
      console.warn('[gesture] detectForVideo 失败', error);
      if (detectFailures >= 3 && status !== 'unavailable') {
        setStatus('unavailable', 'detect-failed');
      }
    }
  }

  return {
    get status() {
      return status;
    },
    get video() {
      return video;
    },
    get detectFps() {
      return GESTURE.detectFps;
    },

    setPaused(value) {
      paused = value;
    },

    async start() {
      if (status === 'ready' || status === 'loading') return;
      setStatus('loading');
      paused = false;
      stopping = false;
      detectFailures = 0;

      // ① 摄像头
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: VISION.camera.width },
            height: { ideal: VISION.camera.height },
            facingMode: VISION.camera.facingMode,
            frameRate: { ideal: VISION.camera.frameRate },
          },
          audio: false,
        });
      } catch (error) {
        console.warn('[gesture] 摄像头不可用', error);
        setStatus('denied', error instanceof Error ? error.message : '摄像头不可用');
        return;
      }

      video = document.createElement('video');
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      video.srcObject = stream;

      const activeVideo = video;
      activeVideo.onerror = (): void => {
        if (!stopping) setStatus('unavailable', 'video-error');
      };
      activeVideo.onpause = (): void => {
        if (stopping || document.hidden || !activeVideo.srcObject) return;
        window.setTimeout(() => {
          if (activeVideo.paused && !stopping && activeVideo.srcObject) {
            void activeVideo.play().catch(() => undefined);
          }
        }, 80);
      };
      activeVideo.onstalled = (): void => {
        if (!stopping && activeVideo.srcObject) {
          void activeVideo.play().catch(() => undefined);
        }
      };
      for (const track of stream.getVideoTracks()) {
        track.onended = (): void => {
          if (stopping) return;
          setStatus('unavailable', 'camera-ended');
          releaseCamera();
        };
      }

      await video.play().catch(() => undefined);

      // ② 模型
      try {
        landmarker = await createLandmarker();
      } catch (error) {
        console.warn('[gesture] 模型加载失败', error);
        releaseCamera();
        setStatus('unavailable', error instanceof Error ? error.message : '模型加载失败');
        return;
      }

      setStatus('ready');
      loop();
    },

    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      paused = false;
      stopping = true;
      landmarker?.close();
      landmarker = null;
      releaseCamera();
      setStatus('idle');
    },
  };
}

/** MediaPipe 关键点 → 精简点（只保留 x/y/z，去掉 visibility） */
export function toPoints(landmarks: NormalizedLandmark[]): LandmarkPoint[] {
  return landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z }));
}
