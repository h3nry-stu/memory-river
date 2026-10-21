// 这些模块持有 WebGL 资源与相机状态，热替换会留下「新几何 + 旧相机」的残影，
// 导致画面莫名其妙偏移。开发期直接接受变更并整页刷新，永远跑一份完整的新代码。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

import * as THREE from 'three';
import { PALETTE } from '@/config';
import cosmosVert from '@/shaders/cosmos.vert.glsl?raw';
import cosmosFrag from '@/shaders/cosmos.frag.glsl?raw';

/**
 * 深空背景
 *
 * 放在 canvas 里画（而不是用 CSS 渐变），原因有三：
 *  1. bloom 后处理需要整帧都在 GPU 里；透明的 canvas 叠 CSS 背景会让辉光断掉
 *  2. 地平线柔光要跟着光河消失点走，得和相机同源
 *  3. 暗角必须在 bloom 之前压暗，否则辉光会把边缘重新提亮
 */
export interface CosmosBackground {
  mesh: THREE.Mesh;
  setResolution(width: number, height: number): void;
  setTime(seconds: number): void;
  /** 0 = 正常深空；1 = 纯黑（L2 沉浸时用） */
  setDim(value: number): void;
  dispose(): void;
}

export function createCosmosBackground(): CosmosBackground {
  const uniforms = {
    uNear: { value: new THREE.Color(PALETTE.cosmos.near) },
    uFar: { value: new THREE.Color(PALETTE.cosmos.far) },
    uGlow: { value: new THREE.Color(PALETTE.particle.base) },
    uGlowStrength: { value: PALETTE.cosmos.nebulaAlpha * 0.9 },
    uNebulaAlpha: { value: PALETTE.cosmos.nebulaAlpha },
    uVignetteStrength: { value: PALETTE.cosmos.vignetteStrength },
    uVignetteStart: { value: PALETTE.cosmos.vignetteStart },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uDim: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: cosmosVert,
    fragmentShader: cosmosFrag,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 20), material);
  mesh.name = 'cosmos';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;

  return {
    mesh,
    setResolution(width, height) {
      uniforms.uResolution.value.set(width, height);
    },
    setTime(seconds) {
      uniforms.uTime.value = seconds;
    },
    setDim(value) {
      uniforms.uDim.value = Math.min(Math.max(value, 0), 1);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
