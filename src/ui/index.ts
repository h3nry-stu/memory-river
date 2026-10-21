/**
 * UI 层（React 叠层，全部 pointer-events 受控）
 * ────────────────────────────────────────────────────────────────
 * Hud.tsx        标题 / 层级导轨 / 输入模式 / 遥测 / 提示
 * DropZone.tsx   照片导入（拖拽 + 文件选择器）
 * ThumbRail.tsx  已导入照片的缩略图条（点击直接聚焦到 L2）
 *
 * 阶段 3：HandFrame.tsx（半透明手形取景框）、Cursor.tsx（柔光拖尾）、HoverRing.tsx（进度环）
 * 阶段 4：Dialogue.tsx 玻璃拟态对话面板（已实现，输入框就长在面板里）
 *
 * 铁律：UI 只读 store，写操作一律走 action；禁止 UI 直接操作 Three 对象。
 */
export { Hud } from './Hud';
export { DropZone } from './DropZone';
export { ThumbRail } from './ThumbRail';
export { CameraPreview } from './CameraPreview';
export { GestureOverlay } from './GestureOverlay';
export { CalibrationPanel } from './CalibrationPanel';
export { Dialogue } from './Dialogue';
export { SettingsPanel } from './SettingsPanel';
export { MusicBinder } from './MusicBinder';
export { PhotoVisionStatus } from './PhotoVisionStatus';
export { SplashScreen } from './SplashScreen';
