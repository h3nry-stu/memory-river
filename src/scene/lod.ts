import { LOD_TIERS, PERF, type LodTier } from '@/config';

/**
 * LOD（决策 5：保 Mac M 系列与现代手机，老 Intel 自动降档即可）
 *
 * 两个阶段：
 *  1. **启动判定** —— 读 GPU 字符串 / 核心数 / 内存 / UA，给出初始档位
 *  2. **运行期回退** —— 持续低帧就降一档，持续高帧再升回来（带迟滞，避免抖动）
 *
 * 降档不重建 buffer：粒子几何按最高档分配，用 drawRange 控制实际绘制量，
 * 所以切换是瞬间的、没有卡顿，也不会释放显存再重新申请。
 */

export interface LodProfile {
  tier: LodTier;
  /** 粒子预算乘子（× PARTICLE.budget） */
  ratio: number;
  dprCap: number;
  bloom: boolean;
  bloomScale: number;
  starRatio: number;
  trail: boolean;
  /** 粒子亮度补偿（关 bloom 的档位需要） */
  brightnessBoost: number;
  /** 色调映射曝光补偿 */
  exposureBoost: number;
}

export interface TierProbe {
  /** WEBGL_debug_renderer_info 拿到的 GPU 名称（可能为 null） */
  gpu: string | null;
  cores: number;
  memoryGb: number;
  isMobile: boolean;
}

export function profileFor(tier: LodTier, deviceDpr: number): LodProfile {
  const config = PERF.lod.tiers[tier];
  return {
    tier,
    ratio: config.ratio,
    dprCap: Math.min(config.dprCap, Math.max(deviceDpr, PERF.dpr.min)),
    bloom: config.bloom,
    bloomScale: config.bloomScale,
    starRatio: config.starRatio,
    trail: config.trail,
    brightnessBoost: config.brightnessBoost,
    exposureBoost: config.exposureBoost,
  };
}

function tierIndex(tier: LodTier): number {
  const index = LOD_TIERS.indexOf(tier);
  return index < 0 ? LOD_TIERS.length - 1 : index;
}

/** 启动判定：按「证据强度」从高到低检查 */
export function detectTier(probe: TierProbe): LodTier {
  const gpu = probe.gpu ?? '';

  // Apple M 系列 / Apple GPU（macOS + iOS）：统一显存、带宽足够，直接最高档
  if (/Apple\s*M\d/i.test(gpu) || /Apple\s*GPU/i.test(gpu)) return 'high';

  // 明显的独显关键字（桌面端）
  if (/RTX|Radeon\s*(RX|Pro)|Arc\s*A\d|GTX\s*1[6-9]/i.test(gpu)) return 'high';

  const weakHardware =
    probe.cores > 0 &&
    (probe.cores < PERF.lod.coresFloor ||
      (probe.memoryGb > 0 && probe.memoryGb < PERF.lod.memoryFloorGb));

  if (weakHardware) return 'low';

  // 手机/平板：最多 mid（GPU 带宽与发热都有限）
  if (probe.isMobile) return 'mid';

  // 老 Intel 核显 / 未知集成显卡：mid 起步，靠运行期 FPS 继续降到 low
  if (/Intel/i.test(gpu)) return 'mid';

  return 'high';
}

export function readGpuString(renderer: { getContext(): WebGLRenderingContext | WebGL2RenderingContext }): string | null {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (!info) return null;
    const value = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function probeDevice(): TierProbe {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    gpu: null, // 由调用方在拿到 renderer 后填入
    cores: nav.hardwareConcurrency ?? 0,
    memoryGb: nav.deviceMemory ?? 0,
    isMobile: PERF.lod.mobileUa.some((token) => navigator.userAgent.includes(token)),
  };
}

export interface FpsMonitor {
  /** 每帧喂一次 dt（秒）；返回当前 fps 与本次是否换档 */
  sample(dtSec: number): { fps: number; tier: LodTier; changed: boolean };
  readonly tier: LodTier;
  readonly fps: number;
}

/**
 * 帧率监控 + 自动换档
 * - 每 PERF.sampleWindow 帧结算一次平均 fps
 * - 低帧持续超过 settleMs 才降档（避免启动抖动误判）
 * - 高帧持续同样时长才升档，且升档比降档更保守
 */
export function createFpsMonitor(initialTier: LodTier): FpsMonitor {
  let tier = initialTier;
  let frames = 0;
  let accumulated = 0;
  let fps = PERF.targetFps;
  let lowStreakMs = 0;
  let highStreakMs = 0;

  const api: FpsMonitor = {
    get tier() {
      return tier;
    },
    get fps() {
      return fps;
    },
    sample(dtSec) {
      frames += 1;
      accumulated += dtSec;
      lowStreakMs += dtSec * 1000;
      highStreakMs += dtSec * 1000;

      let changed = false;

      if (frames >= PERF.sampleWindow) {
        fps = frames / Math.max(accumulated, 1e-6);
        frames = 0;
        accumulated = 0;

        const canDegrade = tierIndex(tier) < LOD_TIERS.length - 1;
        const canRestore = tierIndex(tier) > 0;

        if (fps < PERF.degradeThresholdFps && canDegrade && lowStreakMs >= PERF.lod.settleMs) {
          tier = LOD_TIERS[tierIndex(tier) + 1] ?? tier;
          lowStreakMs = 0;
          highStreakMs = 0;
          changed = true;
        } else if (
          fps > PERF.restoreThresholdFps &&
          canRestore &&
          highStreakMs >= PERF.lod.settleMs * 3
        ) {
          tier = LOD_TIERS[tierIndex(tier) - 1] ?? tier;
          lowStreakMs = 0;
          highStreakMs = 0;
          changed = true;
        } else {
          if (fps >= PERF.degradeThresholdFps) lowStreakMs = 0;
          if (fps <= PERF.restoreThresholdFps) highStreakMs = 0;
        }
      }

      return { fps, tier, changed };
    },
  };

  return api;
}
