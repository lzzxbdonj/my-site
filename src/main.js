import { createApp } from './ui/app.js';

const root = document.getElementById('app');
if (!root) {
  throw new Error('未找到 #app 容器');
}

const app = createApp({ root });
app.start();

// 便于在浏览器控制台排查，也便于端到端测试读取状态
window.__STUDYMATE__ = app;
