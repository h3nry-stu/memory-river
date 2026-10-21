// 这些模块持有 WebGL 资源与相机状态，热替换会留下「新几何 + 旧相机」的残影，
// 导致画面莫名其妙偏移。开发期直接接受变更并整页刷新，永远跑一份完整的新代码。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

import * as THREE from 'three';
import { MUSIC, PALETTE, PARTICLE, RIPPLE, RIVER } from '@/config';
import type { MusicEnergy } from '@/music';
import { emotionAtX } from './emotion';
import { pointOnTubeAtX } from './riverPath';
import type { RippleSlots } from './ripples';
import { assertUniforms } from '@/scene/shaderGuard';
import riverVert from '@/shaders/river.vert.glsl?raw';
import riverFrag from '@/shaders/river.frag.glsl?raw';

/** 着色器里涟漪槽位是写死的 4（GLSL 数组长度必须是常量） */
const SHADER_RIPPLE_SLOTS = 4;

export interface RiverSystem {
  group: THREE.Group;
  /** 实际分配的粒子上限（高画质基准），实际绘制数由 setActiveCount 决定 */
  capacity: number;
  /** 当前绘制数量 */
  activeCount: number;
  setTime(seconds: number): void;
  setActiveCount(count: number): void;
  setDpr(dpr: number): void;
  /** LOD 的额外尺寸缩放 */
  setSizeScale(scale: number): void;
  setOpacity(opacity: number): void;
  /** 全局亮度补偿（LOD 关 bloom 时抬亮，保证「光」还在） */
  setBrightness(scale: number): void;
  /** 聚焦清场区：L2 时让照片附近的粒子退开（strength 0 = 不生效） */
  setClearZone(centerX: number, radius: number, strength: number): void;
  /** 无限滚动：相机在长河上的位置（世界单位） */
  setScroll(x: number): void;
  /** 音乐驱动：低/中/高频能量 0..1（只读，未播放时传 0） */
  setMusicEnergy(energy: MusicEnergy): void;
  dispose(): void;
}

export interface RiverOptions {
  /** 粒子上限（= PARTICLE.budget.river × LOD.ratio） */
  count: number;
  /** 是否创建拖尾层（低画质档关闭） */
  trail: boolean;
  /** 设备像素比 */
  dpr: number;
  /** 与涟漪共享的 uniform 槽位 */
  ripples: RippleSlots;
}

/** 标准正态（Box–Muller），用于「中心密、边缘稀」的断面分布 */
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * 螺旋相位：把粒子聚成 `strands` 股（像 DNA 双螺旋/时光隧道）。
 * 每股占 1/strands 的角向空间，股内用随机抖动铺开；
 * strandWidth < 1 时股与股之间留空 → 管子中间更通透。
 */
function helixPhase(strands: number, strandWidth: number): number {
  const count = Math.max(1, Math.round(strands));
  const strand = Math.floor(Math.random() * count);
  const jitter = (Math.random() - 0.5) * Math.min(Math.max(strandWidth, 0.05), 1);
  return fract((strand + 0.5 + jitter) / count);
}

/**
 * 光丝带主体（横向蜿蜒）
 *
 * 设计原则：
 *  - 粒子位置每帧由 GPU 从 aSlot 重新算出，CPU 不逐点更新（10 万点也没压力）
 *  - 断面用高斯分布 + 一部分「飘散尘埃」：中心紧、边缘散，像星尘而不是水面
 *  - 拖尾是**同一批粒子的「稍早时刻」**：另起 Points 共享 geometry，
 *    只把 uTime + uTimeOffset 往前挪 —— 物理意义上的运动模糊，沿 X 方向拉成光丝
 *  - 涟漪通过共享的 uniform 槽位参与顶点位移，零额外带宽
 */
export function createRiver(options: RiverOptions): RiverSystem {
  if (import.meta.env.DEV && RIPPLE.shaderSlots !== SHADER_RIPPLE_SLOTS) {
    throw new Error(
      `[river] config.RIPPLE.shaderSlots (${RIPPLE.shaderSlots}) 必须等于着色器里的 ${SHADER_RIPPLE_SLOTS}`,
    );
  }

  const capacity = Math.max(1, Math.floor(options.count));

  const aSlot = new Float32Array(capacity);
  const aPhase = new Float32Array(capacity);
  const aRadius = new Float32Array(capacity);
  const aSeed = new Float32Array(capacity);
  const aEmotion = new Float32Array(capacity);
  const aSize = new Float32Array(capacity);
  // three 内部会用到 position（包围盒/调试），给一份 t=0 的基准布局
  const positions = new Float32Array(capacity * 3);

  const clusterCenters = Array.from({ length: RIVER.clusters.count }, () => Math.random());
  const { hollowRatio, strands, strandWidth, wallBias, dustRatio, dustSpread } = RIVER.tube;

  for (let i = 0; i < capacity; i += 1) {
    // ── 时间主轴位置：一部分粒子聚成「记忆结节」，其余均匀铺开 ──
    let s = Math.random();
    if (Math.random() < RIVER.clusters.boost && clusterCenters.length > 0) {
      const center = clusterCenters[i % clusterCenters.length] ?? 0.5;
      s = center + gaussian() * (RIVER.clusters.spread / RIVER.poolWidth);
    }
    s = fract(s);
    aSlot[i] = s;

    // ── 管壁：相位聚成螺旋股 + 半径贴外壁（管心中空） ──
    aPhase[i] = helixPhase(strands, strandWidth);

    const isDust = Math.random() < dustRatio;
    if (isDust) {
      // 飘散尘埃：散到管壁之外，亮度更低
      aRadius[i] = 1 + Math.random() * (dustSpread - 1);
    } else {
      // 壁内分布：wallBias 越大越贴外壁（管壁才有体积感）
      const u = 1 - Math.pow(1 - Math.random(), 1 + wallBias * 3);
      aRadius[i] = hollowRatio + (1 - hollowRatio) * u;
    }

    aSeed[i] = Math.random();

    // ── 情绪：以「年份温度」为主，叠加个体差异 ──
    const bandEmotion = emotionAtX((s - 0.5) * RIVER.poolWidth);
    aEmotion[i] = Math.min(Math.max(bandEmotion * 0.68 + Math.random() * 0.32, 0), 1);

    // ── 尺寸：多数是小点，少数是大亮星 ──
    aSize[i] = Math.pow(Math.random(), 1.7);

    // ── 基准位置（与 shader 中 t=0 的算法一致：轴线 + Frenet 偏移） ──
    const base = pointOnTubeAtX((s - 0.5) * RIVER.poolWidth, aPhase[i]!, aRadius[i]!);
    const i3 = i * 3;
    positions[i3] = base.x;
    positions[i3 + 1] = base.y;
    positions[i3 + 2] = base.z;
  }

  if (import.meta.env.DEV) {
    // 自检：断面有界 + 中轴围绕 y≈0（画面居中由相机正视保证）
    let minY = Infinity, maxY = -Infinity, sumY = 0;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < capacity; i += 1) {
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      sumY += y;
    }
    const meanY = sumY / capacity;
    console.info(
      `[river] tube · ${capacity} pts · y ∈ [${minY.toFixed(2)}, ${maxY.toFixed(2)}] ` +
        `· z ∈ [${minZ.toFixed(2)}, ${maxZ.toFixed(2)}] · meanY ${meanY.toFixed(3)}`,
    );
    if (Math.abs(meanY) > 0.5) {
      console.warn(`[river] 中轴偏离画面中心：meanY=${meanY.toFixed(3)}，检查 RIVER.wave 基准`);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSlot', new THREE.BufferAttribute(aSlot, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geometry.setAttribute('aEmotion', new THREE.BufferAttribute(aEmotion, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geometry.setDrawRange(0, capacity);

  /** 拖尾与主体共用 ripple 槽位，但时间/透明度各自独立 */
  /**
   * 音乐驱动的基线：LOD / 层级退场会改这些值，音乐只在基线上叠加，
   * 所以关掉音乐后画面一定回到原本的静态参数。
   */
  let baseSizeScale = 1;
  let baseBrightness = PALETTE.particle.hdrBoost;
  let baseFlowSpeed = PARTICLE.motion.flowSpeed;
  let baseDriftSway = RIVER.driftSway;
  const baseWaveAmp = RIVER.wave.amp;
  const baseWaveAmp2 = RIVER.wave.amp2;
  let music: MusicEnergy = { low: 0, mid: 0, high: 0, playing: false };

  function applyMusicUniforms(): void {
    const drive = MUSIC.drive;
    const flow = baseFlowSpeed * (1 + music.low * drive.lowToFlowSpeed);
    const size = baseSizeScale * (1 + music.mid * drive.midToParticleSize);
    const brightness =
      baseBrightness *
      (1 + music.low * drive.lowToBloom * 0.8 + music.high * drive.highToTwinkle * 0.25);
    const drift = baseDriftSway * (1 + music.mid * drive.midToTurbulence);
    // 低频鼓点 → 长河起伏（振幅变大，但中轴位置不漂移）
    const waveScale = 1 + music.low * drive.lowToWaveAmp;

    for (const material of materials) {
      material.uniforms.uWaveAmp!.value = baseWaveAmp * waveScale;
      material.uniforms.uWaveAmp2!.value = baseWaveAmp2 * waveScale;
      material.uniforms.uFlowSpeed!.value = flow;
      material.uniforms.uSizeScale!.value = size * (material.userData.trailScale ?? 1);
      material.uniforms.uHdrBoost!.value = brightness;
      material.uniforms.uDriftSway!.value = drift;
      material.uniforms.uMusicHigh!.value = music.high;
    }
  }

  function makeUniforms(timeOffset: number, opacity: number): Record<string, THREE.IUniform> {
    return {
      uTime: { value: 0 },
      uTimeOffset: { value: timeOffset },
      uDpr: { value: options.dpr },
      uSizeScale: { value: baseSizeScale },
      uMusicHigh: { value: 0 },
      uOpacity: { value: opacity },

      uPoolWidth: { value: RIVER.poolWidth },
      uWaveAmp: { value: baseWaveAmp },
      uWaveFreq: { value: RIVER.wave.freq },
      uWaveAmp2: { value: baseWaveAmp2 },
      uWaveFreq2: { value: RIVER.wave.freq2 },
      uWavePhase2: { value: RIVER.wave.phase2 },
      uBreatheAmp: { value: RIVER.wave.breatheAmp },
      uBreatheSpeed: { value: RIVER.wave.breatheSpeed },
      uDepthAmp: { value: RIVER.depth.amp },
      uDepthFreq: { value: RIVER.depth.freq },
      uDepthPhase: { value: RIVER.depth.phase },
      uTubeRadius: { value: RIVER.tube.radius },
      uHollowRatio: { value: RIVER.tube.hollowRatio },
      uTwistTurns: { value: RIVER.tube.twistTurnsPerUnit },
      uDustSpread: { value: RIVER.tube.dustSpread },
      uDustDim: { value: RIVER.tube.dustDim },
      uFrontBoost: { value: RIVER.depthCue.frontBoost },
      uBackDim: { value: RIVER.depthCue.backDim },
      uBackCoolShift: { value: RIVER.depthCue.backCoolShift },
      uDepthSizeBoost: { value: RIVER.depthCue.sizeBoost },
      uInnerGlow: { value: RIVER.innerGlow },
      uClearZone: { value: new THREE.Vector3(0, 0, 0) },
      uScroll: { value: 0 },
      uEdgeFadeS: { value: RIVER.poolEdgeFade / RIVER.poolWidth },
      uEdgeFadeStart: { value: RIVER.edgeFade.start },
      uEdgeFadeEnd: { value: RIVER.edgeFade.end },
      uEdgeFadeMin: { value: RIVER.edgeFade.min },
      uDriftSway: { value: baseDriftSway },
      uFlowSpeed: { value: baseFlowSpeed },
      uFlowSpeedVariance: { value: PARTICLE.motion.flowSpeedVariance },

      uSizeMin: { value: PARTICLE.size.minPx },
      uSizeMax: { value: PARTICLE.size.maxPx },
      uRefDistance: { value: PARTICLE.size.referenceDistance },
      uAttenuation: { value: PARTICLE.size.attenuation },
      uMaxPointPx: { value: PARTICLE.size.maxScreenPx },

      uCold: { value: new THREE.Color(PALETTE.emotion.coldBlue) },
      uCyan: { value: new THREE.Color(PALETTE.emotion.cyanWhite) },
      uWarm: { value: new THREE.Color(PALETTE.emotion.warmGold) },
      uBlendWarmCyan: { value: PARTICLE.color.blendWarmCyan },
      uColorJitter: { value: PARTICLE.color.jitter },
      uHdrBoost: { value: baseBrightness },
      uEnergyLow: { value: PARTICLE.intensity.energyLow },
      uEnergyHigh: { value: PARTICLE.intensity.energyHigh },
      uEnergyCurve: { value: PARTICLE.intensity.energyCurve },
      // 片元着色器要用：核心/光晕权重（漏了会让每个像素都被 discard）
      uCoreWeight: { value: PARTICLE.intensity.core },
      uHaloWeight: { value: PARTICLE.intensity.halo },

      uRippleCenter: { value: options.ripples.center },
      uRippleRadius: { value: options.ripples.radius },
      uRippleStrength: { value: options.ripples.strength },
      uRippleFalloff: { value: RIPPLE.falloff },
      uRippleLift: { value: RIPPLE.particleLift },
      uRipplePush: { value: RIPPLE.particlePush },
    };
  }

  function makeMaterial(timeOffset: number, opacity: number): THREE.ShaderMaterial {
    const uniforms = makeUniforms(timeOffset, opacity);
    assertUniforms(`river@${timeOffset}`, riverVert, riverFrag, uniforms);
    return new THREE.ShaderMaterial({
      vertexShader: riverVert,
      fragmentShader: riverFrag,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
  }

  const mainMaterial = makeMaterial(0, 1);
  const river = new THREE.Points(geometry, mainMaterial);
  river.name = 'river';
  river.frustumCulled = false; // 位置在 GPU 里算，包围盒不可信

  const group = new THREE.Group();
  group.name = 'riverSystem';
  group.add(river);

  /**
   * 拖尾：同一 geometry，采样「更早的时刻」，位移沿 X → 横向光丝。
   * 多层叠加把「点」拉成「丝」；全部共享 geometry，只有 uniform 不同。
   */
  const trailMaterials: THREE.ShaderMaterial[] = [];
  if (options.trail) {
    PARTICLE.trail.layers.forEach((layer, index) => {
      const material = makeMaterial(-layer.lagSec, layer.opacity);
      material.userData.trailScale = layer.sizeScale;
      material.uniforms.uSizeScale!.value = layer.sizeScale;
      const trail = new THREE.Points(geometry, material);
      trail.name = `riverTrail${index}`;
      trail.frustumCulled = false;
      group.add(trail);
      trailMaterials.push(material);
    });
  }

  const materials = [mainMaterial, ...trailMaterials];

  return {
    group,
    capacity,
    activeCount: capacity,

    setTime(seconds) {
      for (const material of materials) {
        material.uniforms.uTime!.value = seconds;
      }
    },

    setActiveCount(count) {
      const n = Math.max(1, Math.min(Math.floor(count), capacity));
      this.activeCount = n;
      geometry.setDrawRange(0, n);
    },

    setDpr(dpr) {
      for (const material of materials) {
        material.uniforms.uDpr!.value = dpr;
      }
    },

    setSizeScale(scale) {
      baseSizeScale = scale;
      applyMusicUniforms();
    },

    setOpacity(opacity) {
      mainMaterial.uniforms.uOpacity!.value = opacity;
    },

    setBrightness(scale) {
      baseBrightness = PALETTE.particle.hdrBoost * scale;
      applyMusicUniforms();
    },

    setMusicEnergy(energy) {
      music = energy;
      applyMusicUniforms();
    },

    setScroll(x) {
      for (const material of materials) {
        material.uniforms.uScroll!.value = x;
      }
    },

    setClearZone(centerX, radius, strength) {
      for (const material of materials) {
        const zone = material.uniforms.uClearZone!.value as THREE.Vector3;
        zone.set(centerX, radius, strength);
      }
    },

    dispose() {
      geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
