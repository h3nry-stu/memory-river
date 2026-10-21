// 这些模块持有 WebGL 资源与相机状态，热替换会留下「新几何 + 旧相机」的残影，
// 导致画面莫名其妙偏移。开发期直接接受变更并整页刷新，永远跑一份完整的新代码。
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { PALETTE } from '@/config';

/**
 * 后处理：阈值 → bloom → 色调映射输出
 *
 * 顺序很重要：
 *  RenderPass 把场景渲进线性 HDR buffer → UnrealBloomPass 只拾取超过阈值的亮部
 *  → OutputPass 统一做 ACES 色调映射 + sRGB 转换（它每帧读 renderer.toneMapping，
 *  所以改 config 里的 exposure 会立刻生效）。
 *
 * 低画质档（LOD.low）直接不创建 bloom pass：省掉 5 次 mip 降采样，帧率立刻回来。
 */
export interface PostFX {
  render(dtSec: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  setBloomStrength(strength: number): void;
  dispose(): void;
}

export interface PostFXOptions {
  bloom: boolean;
  /** bloom 的内部分辨率缩放（低档更小，省带宽） */
  bloomScale: number;
  /**
   * 叠加层场景：在 bloom 之后、色调映射之前单独渲染。
   * 照片平面走这条路 —— 照片是"可读的记忆"，不该被辉光糊掉。
   */
  overlayScene?: THREE.Scene;
}

export function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: PostFXOptions,
): PostFX {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  let bloomPass: UnrealBloomPass | null = null;

  if (options.bloom) {
    const { bloomStrength, bloomRadius, bloomThreshold } = PALETTE.glow;
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1), // 真实尺寸在 setSize 里给
      bloomStrength * options.bloomScale,
      bloomRadius,
      bloomThreshold,
    );
    composer.addPass(bloomPass);
  }

  // 照片等"需要忠实还原"的内容：在 bloom 之后叠加，不参与辉光
  if (options.overlayScene) {
    const overlayPass = new RenderPass(options.overlayScene, camera);
    overlayPass.clear = false;
    overlayPass.clearDepth = false;
    composer.addPass(overlayPass);
  }

  composer.addPass(new OutputPass());

  return {
    render(dtSec) {
      composer.render(dtSec);
    },

    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      if (bloomPass) {
        const scale = Math.max(options.bloomScale, 0.35);
        bloomPass.setSize(
          Math.max(1, Math.round(width * scale)),
          Math.max(1, Math.round(height * scale)),
        );
      }
    },

    setBloomStrength(strength) {
      if (!bloomPass) return;
      bloomPass.strength = strength;
    },

    dispose() {
      bloomPass?.dispose();
      composer.dispose();
    },
  };
}
