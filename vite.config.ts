import { defineConfig } from 'vite';

// GitHub Pages 项目站点部署在 https://<用户>.github.io/game/ 下，
// 因此构建产物使用 /game/ 作为基础路径；本地开发仍使用根路径。
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/game/' : '/',
  build: {
    chunkSizeWarningLimit: 2000,
  },
}));
