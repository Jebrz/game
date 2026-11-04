import { defineConfig } from 'vite';

// 星空列车试玩版部署在 GitHub Pages 子路径 /game/star-train/（原地下城仍在 /game/）。
// 可用环境变量 BASE_PATH 覆盖；本地开发使用根路径。
const base = process.env.BASE_PATH || '/game/star-train/';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? base : '/',
  build: {
    chunkSizeWarningLimit: 2000,
  },
}));
