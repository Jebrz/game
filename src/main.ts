import './ui/style.css';
import { App } from './ui/app';

const app = new App();
// 调试用：在控制台可访问 window.__game（仅用于检查，不提供作弊入口）
(window as unknown as { __game: App }).__game = app;
