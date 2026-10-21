import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 记忆长河 · 构建配置
 * 注意：不开启 COOP/COEP 跨域隔离 —— MediaPipe tasks-vision 的 wasm 走 CDN 时
 * 会被隔离策略拦下；默认单线程 wasm 已够 30fps 手部推理。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5273,
    open: false,
  },
  build: {
    // WebGL + wasm 场景：现代浏览器即可，无需给老引擎兜底
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // three 与 mediapipe 体积大且版本稳定，单独切块利于缓存
        // （Vite 8 底层是 rolldown，manualChunks 只接受函数形式）
        manualChunks(id: string): string | null {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('@mediapipe')) return 'mediapipe';
          return null;
        },
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
});
