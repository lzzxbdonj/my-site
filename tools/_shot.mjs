/**
 * 界面截图：把主要页面渲染成 PNG，放进 docs/evidence/，用于人工核对视觉效果。
 *
 * 用法：`npm run build` 之后执行 `node tools/_shot.mjs`。
 * 它只启动本地静态服务 + 真实浏览器，不访问任何外部服务。
 */
import path from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';
import { launchBrowser, openPage, findBrowser } from '../tests/browser/cdp.mjs';

const root = path.resolve(import.meta.dirname, '..');
console.log('browser:', Boolean(findBrowser()));
const site = createStaticServer(path.join(root, 'dist'));
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${site.address().port}`;

const browser = await launchBrowser({ url: 'about:blank' });
const page = await openPage(browser.port, { url: 'about:blank' });
await page.setViewport(1440, 980);

const targets = [
  ['dashboard', '#/'],
  ['explore', '#/explore'],
  ['generate', '#/generate'],
  ['settings', '#/settings'],
  ['lesson', '#/lesson/python/py-setup'],
];

for (const [name, hash] of targets) {
  await page.goto(`${base}/index.html${hash}`, { waitMs: 700 });
  await page.waitFor('window.__STUDYMATE__', { timeoutMs: 8000 }).catch(() => {});
  await page.wait(400);
  const file = path.join(root, 'docs', 'evidence', `design-${name}.png`);
  await page.screenshot(file);
  console.log('shot:', name);
}

page?.close();
await browser.close();
await new Promise((r) => site.close(r));
