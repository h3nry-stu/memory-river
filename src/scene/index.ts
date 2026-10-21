/**
 * 场景层
 * ────────────────────────────────────────────────────────────────
 * Stage.ts   编排：渲染器 / 相机 / 粒子 / 涟漪 / 后处理 / LOD / 主循环
 * cosmos.ts  深空背景（canvas 内绘制，才能被 bloom 完整处理）
 * postfx.ts  bloom 后处理链（阈值 → bloom → ACES 输出）
 * lod.ts     设备判定 + 运行期帧率换档
 *
 * 阶段 2：LayerRig.ts（L0–L3 相机轨），阶段 3：hitTest / swipe。
 * 铁律：scene 只吃 config + 输入层状态，唯一的反向写入是 HUD 遥测。
 */
export { createStage } from './Stage';
export type { Stage } from './Stage';
export { createPostFX } from './postfx';
export type { PostFX } from './postfx';
export { createCosmosBackground } from './cosmos';
export { detectTier, createFpsMonitor, profileFor, readGpuString, probeDevice } from './lod';
export type { LodProfile, FpsMonitor, TierProbe } from './lod';
