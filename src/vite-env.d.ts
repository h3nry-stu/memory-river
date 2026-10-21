/// <reference types="vite/client" />

/** 由 vite.config.ts `define` 注入的应用版本 */
declare const __APP_VERSION__: string;

/** GLSL 以字符串形式导入（shader 文件放 src/shaders，用 ?raw） */
declare module '*.glsl?raw' {
  const source: string;
  export default source;
}

/**
 * 环境变量类型（只有 VITE_ 前缀会被注入前端）
 * 见 .env.example —— 不填 key 时 AI 层自动回落规则 Mock。
 */
interface ImportMetaEnv {
  readonly VITE_DEEPSEEK_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
