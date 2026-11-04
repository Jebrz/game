import { defineConfig } from 'vite';

// 生产构建使用 /game/ 基础路径（与原 GitHub Pages 项目站点一致），
// 本地开发仍使用根路径。本分支不自动发布。
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/game/' : '/',
  build: {
    chunkSizeWarningLimit: 2000,
  },
}));
