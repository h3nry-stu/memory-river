// 这些模块持有 WebGL 资源与相机状态，热替换会留下「新几何 + 旧相机」的残影，
// 导致画面莫名其妙偏移。开发期直接接受变更并整页刷新，永远跑一份完整的新代码。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

import * as THREE from 'three';
import { PALETTE, RIPPLE } from '@/config';
import { emotionAtX } from './emotion';
import { pointOnRiverX } from './riverPath';
import rippleVert from '@/shaders/ripple.vert.glsl?raw';
import rippleFrag from '@/shaders/ripple.frag.glsl?raw';

/**
 * 涟漪的着色器槽位（被 river 的 shader 直接消费）
 *
 * 关键设计：这里的 Vector3 / number 是**共享引用** —— 涟漪系统写入，
 * 粒子的 uniform 直接指向同一批对象，每帧零拷贝。
 * 丝带是横向的，涟漪在 XY 平面（正对镜头）扩散，所以 center 用的是 x/y。
 */
export interface RippleSlots {
  center: THREE.Vector3[];
  radius: number[];
  strength: number[];
}

export function createRippleSlots(): RippleSlots {
  const n = RIPPLE.shaderSlots;
  return {
    center: Array.from({ length: n }, () => new THREE.Vector3(0, 1e4, 0)),
    radius: Array.from({ length: n }, () => 0),
    strength: Array.from({ length: n }, () => 0),
  };
}

/** 长河上某个世界 x 处的坐标（涟漪、照片落点共用） */
export function riverPointToWorld(x: number): { x: number; y: number; z: number } {
  return pointOnRiverX(x);
}

export interface RippleSpawnOptions {
  /** 强度 0..1，默认 RIPPLE.strength */
  strength?: number;
  /** 情绪值 0..1，决定环的冷暖（暖年份的涟漪偏金） */
  emotion?: number;
  /** 覆盖颜色（不传则按 emotion 取色） */
  color?: THREE.Color;
}

interface RippleInstance {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  startMs: number;
  durationMs: number;
  strength: number;
  active: boolean;
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
}

export interface RippleField {
  group: THREE.Group;
  slots: RippleSlots;
  spawn(x: number, y: number, z: number, options?: RippleSpawnOptions): void;
  /** 推进到 nowMs；返回当前活跃数量 */
  update(nowMs: number): number;
  dispose(): void;
}

const COOL = new THREE.Color(PALETTE.ripple.color);
const WARM = new THREE.Color(PALETTE.ripple.warmColor);
const CORE = new THREE.Color(PALETTE.ripple.coreColor);

/**
 * 涟漪系统
 * 两层表达：
 *  1. 视觉：正对镜头扩散的加法混合光环（本文件）
 *  2. 物理：波前经过时把附近粒子顶起来、向外推开（river.vert.glsl ⑤）
 * 两者共用同一批 slots，所以光环扫过哪里，粒子就在哪里被顶起来。
 */
export function createRippleField(): RippleField {
  const group = new THREE.Group();
  group.name = 'ripples';

  // 单位半径的环，靠 scale 扩散；线宽随半径一起长，像真的水波
  const geometry = new THREE.RingGeometry(1 - RIPPLE.lineWidth, 1, 96, 1);

  const instances: RippleInstance[] = Array.from({ length: RIPPLE.maxConcurrent }, () => {
    // 每个实例自己的 material：颜色/透明度是逐环变化的
    const material = new THREE.ShaderMaterial({
      vertexShader: rippleVert,
      fragmentShader: rippleFrag,
      uniforms: {
        uColor: { value: COOL.clone() },
        uOpacity: { value: 0 },
        uSoftness: { value: RIPPLE.edgeSoftness },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    // 不旋转：环面正对镜头（丝带是横向悬浮的，没有"水面"可躺）
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 5;
    mesh.visible = false;
    mesh.frustumCulled = false;
    group.add(mesh);
    return {
      mesh,
      startMs: 0,
      durationMs: RIPPLE.durationMs,
      strength: 0,
      active: false,
      x: 0,
      y: 0,
      z: 0,
      color: COOL.clone(),
    };
  });

  const slots = createRippleSlots();
  const tint = new THREE.Color();

  /** 取一个空闲实例；全忙则复用最老的那个（视觉上最不显眼） */
  function acquire(): RippleInstance {
    let oldest: RippleInstance | null = null;
    for (const instance of instances) {
      if (!instance.active) return instance;
      if (!oldest || instance.startMs < oldest.startMs) oldest = instance;
    }
    return oldest ?? instances[0]!;
  }

  return {
    group,
    slots,

    spawn(x, y, z, options = {}) {
      const nowMs = performance.now();
      const instance = acquire();
      const strength = options.strength ?? RIPPLE.strength;

      if (options.color) {
        instance.color.copy(options.color);
      } else if (typeof options.emotion === 'number') {
        // 暖年份的涟漪偏金，冷年份偏青 —— 与粒子的情绪光色同源
        tint.copy(COOL).lerp(WARM, Math.min(Math.max(options.emotion, 0), 1));
        instance.color.copy(tint);
      } else {
        instance.color.copy(COOL);
      }

      instance.active = true;
      instance.startMs = nowMs;
      instance.durationMs = RIPPLE.durationMs;
      instance.strength = strength;
      instance.x = x;
      instance.y = y;
      instance.z = z;

      instance.mesh.visible = true;
      // 略微朝镜头偏移，避免和粒子带在同一个深度上打架
      instance.mesh.position.set(x, y, z + RIPPLE.cameraOffset);
      instance.mesh.scale.setScalar(RIPPLE.startRadius);
      instance.mesh.material.uniforms.uColor!.value = instance.color;
      // 出生即可见：不能等到下一次 update 才给透明度，否则中间那一帧是空的
      instance.mesh.material.uniforms.uOpacity!.value = strength;
    },

    update(nowMs) {
      let activeCount = 0;

      // 先清空槽位，再按「最新优先」填回，保证被 shader 消费的是最该被看见的那几圈
      for (let i = 0; i < slots.strength.length; i += 1) {
        slots.strength[i] = 0;
      }

      const recent: RippleInstance[] = [];

      for (const instance of instances) {
        if (!instance.active) continue;

        const t = (nowMs - instance.startMs) / instance.durationMs;
        if (t >= 1) {
          instance.active = false;
          instance.mesh.visible = false;
          instance.mesh.material.uniforms.uOpacity!.value = 0;
          continue;
        }

        activeCount += 1;

        // 半径：easeOutCubic —— 起手快、尾段拖长，像真的水波
        const eased = 1 - Math.pow(1 - t, 3);
        const radius = RIPPLE.startRadius + (RIPPLE.endRadius - RIPPLE.startRadius) * eased;
        instance.mesh.scale.setScalar(radius);
        instance.mesh.material.uniforms.uOpacity!.value = Math.pow(1 - t, 1.6) * instance.strength;

        // 核心色：刚出现时更白，随后沉淀成情绪色
        const ringColor = instance.mesh.material.uniforms.uColor!.value as THREE.Color;
        ringColor.copy(instance.color).lerp(CORE, Math.pow(1 - t, 3) * 0.35);

        recent.push(instance);
      }

      recent.sort((a, b) => b.startMs - a.startMs);
      const slotCount = Math.min(recent.length, slots.strength.length);
      for (let i = 0; i < slotCount; i += 1) {
        const instance = recent[i];
        if (!instance) continue;
        const t = (nowMs - instance.startMs) / instance.durationMs;
        const eased = 1 - Math.pow(1 - t, 3);
        const radius = RIPPLE.startRadius + (RIPPLE.endRadius - RIPPLE.startRadius) * eased;
        const center = slots.center[i];
        if (center) center.set(instance.x, instance.y, 0);
        slots.radius[i] = radius;
        // 强度随寿命衰减，末段自然消失，不会突然「断掉」
        slots.strength[i] = Math.pow(1 - t, 1.3) * instance.strength;
      }

      return activeCount;
    },

    dispose() {
      for (const instance of instances) {
        instance.mesh.material.dispose();
      }
      geometry.dispose();
      group.clear();
    },
  };
}

/** 丝带位置的默认情绪（给自动涟漪用） */
export function emotionNearX(x: number): number {
  return emotionAtX(x);
}
