/**
 * 资产准备脚本（在 `pnpm install` 之后自动执行一次）
 *
 * 做两件事，让项目**离线可跑**：
 *  1. 把 @mediapipe/tasks-vision 的 wasm 运行时拷进 public/mediapipe/wasm
 *  2. 下载 hand_landmarker.task 模型到 public/mediapipe/models
 *
 * 两者都在 .gitignore 里 —— 它们是可再生的派生产物，不进版本库。
 * 缺网时脚本只打印警告并退出 0，不阻塞开发（运行期会回落 CDN，见 config.VISION）。
 */
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WASM_SRC = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const WASM_DEST = join(root, 'public/mediapipe/wasm');
const MODEL_DEST = join(root, 'public/mediapipe/models/hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** 只拷 SIMD + 非 SIMD 两套，module 版留给未来 worker 化使用 */
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  await mkdir(WASM_DEST, { recursive: true });
  for (const file of WASM_FILES) {
    const from = join(WASM_SRC, file);
    if (!(await exists(from))) {
      console.warn(`[assets] 跳过缺失的 wasm: ${file}`);
      continue;
    }
    await cp(from, join(WASM_DEST, file));
  }
  console.log(`[assets] wasm → public/mediapipe/wasm (${WASM_FILES.length} files)`);
}

async function fetchModel() {
  if (await exists(MODEL_DEST)) {
    console.log('[assets] hand_landmarker.task 已存在，跳过下载');
    return;
  }
  await mkdir(dirname(MODEL_DEST), { recursive: true });
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 1024) throw new Error('模型文件异常小，判定下载失败');
    await writeFile(MODEL_DEST, buf);
    console.log(`[assets] hand_landmarker.task → public/mediapipe/models (${Math.round(buf.byteLength / 1024)} KB)`);
  } catch (err) {
    console.warn(`[assets] 模型下载失败（${err.message}）。手势功能运行期会回落 CDN；鼠标/键盘模式不受影响。`);
  }
}

await copyWasm();
await fetchModel();
