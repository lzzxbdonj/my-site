/**
 * 品牌改名的浏览器端回归：「ai自学通」必须出现在标题、导航与关于页，
 * 且**改名不影响数据**——旧的进度与旧备份依然可用。
 *
 * 使用本地静态站点（dist）+ 本地模拟 Worker，不做任何真实模型调用。
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../../scripts/serve.mjs';
import { launchBrowser, openPage, findBrowser, captureEvidence, cleanupCacheProfiles, evidenceCaptureEnabled } from './cdp.mjs';
import { PRODUCT_NAME } from '../../src/core/brand.js';

const root = path.resolve(import.meta.dirname, '../..');
const evidenceDir = path.join(root, 'docs', 'evidence');

let siteServer;
let browser;
let page;
let baseUrl;

before(async () => {
  assert.ok(findBrowser(), '未找到 Edge/Chrome');
  if (evidenceCaptureEnabled()) await mkdir(evidenceDir, { recursive: true });
  siteServer = createStaticServer(path.join(root, 'dist'));
  await new Promise((resolve) => siteServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${siteServer.address().port}`;
  browser = await launchBrowser({ url: 'about:blank' });
  page = await openPage(browser.port, { url: 'about:blank' });
});

after(async () => {
  page?.close();
  await cleanupCacheProfiles(root);
  if (browser) await browser.close();
  if (siteServer) await new Promise((resolve) => siteServer.close(resolve));
});

async function goto(hash) {
  await page.goto(`${baseUrl}/index.html${hash}`, { waitMs: 400 });
  await page.waitFor('window.__STUDYMATE__');
}

test('静态入口的 title / description 使用新品牌名', async () => {
  const response = await fetch(`${baseUrl}/index.html`);
  const html = await response.text();
  assert.match(html, new RegExp(`<title>${PRODUCT_NAME} ·`), 'index.html 的 title 必须以新品牌名开头');
  assert.match(html, new RegExp(`<meta name="description" content="${PRODUCT_NAME}：`), 'description 必须使用新品牌名');
  assert.ok(!/<title>[^<]*StudyMate Web/.test(html), '静态入口不应再出现旧品牌标题');
});

test('路由切换时 document.title 与导航 logo 都是新品牌名', async () => {
  await goto('#/dashboard');
  assert.equal(await page.evaluate('document.title'), `学习台 · ${PRODUCT_NAME}`, '学习台标题应为「页面 · 新品牌名」');
  const brand = await page.textOf('.brand-text');
  assert.match(brand, new RegExp(PRODUCT_NAME), '导航应显示新品牌名');
  const aria = await page.evaluate('document.querySelector("a.brand")?.getAttribute("aria-label") || ""');
  assert.equal(aria, `${PRODUCT_NAME} 首页`, '品牌链接应有新品牌名的无障碍标签');
  const markLabel = await page.evaluate('document.querySelector(".orbital-mark")?.getAttribute("aria-label") || ""');
  assert.match(markLabel, new RegExp(PRODUCT_NAME), '轨道标记的替代文本也要用新品牌名');

  for (const [hash, expected] of [
    ['#/explore', '课程库'],
    ['#/generate', '智能建课'],
    ['#/videos', '视频课'],
    ['#/profile', '我的进度'],
    ['#/settings', '设置'],
    ['#/about', '关于本项目'],
  ]) {
    await goto(hash);
    const title = await page.evaluate('document.title');
    assert.equal(title, `${expected} · ${PRODUCT_NAME}`, `${hash} 的标题应为「${expected} · ${PRODUCT_NAME}」，实际 ${title}`);
  }
  // 「#/」就是学习台（默认路由），标题同样是「页面 · 品牌名」
  await goto('#/');
  assert.equal(await page.evaluate('document.title'), `学习台 · ${PRODUCT_NAME}`, '#/ 应等价于学习台');

  await goto('#/about');
  const about = await page.textOf('.view-about');
  assert.match(about, new RegExp(PRODUCT_NAME), '关于页应说明当前产品名');
  assert.match(about, /改名不影响本地数据|保持不变/, '关于页应说明改名不影响已有数据');
  assert.match(about, /Miaotofu01\/Study-Mate|Study-Mate/, '上游项目与许可归属必须保留');
  await captureEvidence(page, path.join(evidenceDir, 'brand-about.png'));
});

test('页脚与关于页保留上游 MIT / Cattofu 归属', async () => {
  await goto('#/dashboard');
  const footer = await page.textOf('.app-footer');
  assert.match(footer, new RegExp(PRODUCT_NAME), '页脚应显示新品牌名');
  assert.match(footer, /MIT/, '页脚必须保留 MIT 许可说明');
  assert.match(footer, /Cattofu/, '页脚必须保留上游版权声明');
  const upstream = await page.evaluate('[...document.querySelectorAll(".app-footer a")].map((a) => a.getAttribute("href")).join(" ")');
  assert.match(upstream, /github\.com\/Miaotofu01\/Study-Mate/, '上游仓库链接必须保留');
});

test('改名后旧备份仍可导入、旧进度仍然可用（技术标识不变）', async () => {
  await goto('#/profile');
  const result = await page.evaluate(`(async () => {
    const app = window.__STUDYMATE__;
    // 模拟「改名之前」导出的备份：app 标识与 data 结构都保持旧格式
    const legacy = {
      app: 'StudyMate-Web',
      appVersion: '1.0.0',
      schemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: {
        schemaVersion: 1,
        profile: { name: '老用户', goal: 'exam', level: 'some', weeklyHours: 6, lessonMinutes: 45, interests: [], updatedAt: '2026-01-01T00:00:00.000Z' },
        courses: { 'linear-algebra': { lessons: { 'la-vectors': { status: 'completed', completedAt: '2026-01-01T00:00:00.000Z', minutes: 40, tasks: {} } }, quizAttempts: [], notes: {}, videos: {}, bookmarks: ['la-vectors'], customVideos: [] } },
        generatedCourses: [],
        preferences: { reduceMotion: false, autoLoadVideo: false, fontScale: 1 },
        ai: { endpoint: '', model: '', workerUrl: '', enabled: false, keyStorage: 'session' },
        stats: { studyDays: ['2026-01-01'], totalMinutes: 40 },
        meta: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', app: 'StudyMate-Web' },
      },
    };
    const imported = app.actions.importJson(JSON.stringify(legacy));
    const state = app.getState();
    const lesson = state.courses?.['linear-algebra']?.lessons?.['la-vectors'] || null;
    return {
      imported,
      profileName: state.profile?.name || null,
      lessonStatus: lesson?.status || null,
      lessonMinutes: lesson?.minutes ?? null,
      bookmarks: state.courses?.['linear-algebra']?.bookmarks || null,
      storageKey: Object.keys(localStorage).find((k) => k.includes('studymate')) || null,
    };
  })()`);
  assert.equal(result.imported.ok, true, `旧备份必须仍能导入：${JSON.stringify(result.imported)}`);
  assert.equal(result.profileName, '老用户', '导入后应保留旧备份里的资料');
  assert.equal(result.lessonStatus, 'completed', '导入后应保留旧备份里的课时完成状态');
  assert.equal(result.lessonMinutes, 40, '导入后应保留旧备份里的学习时长');
  assert.deepEqual(result.bookmarks, ['la-vectors'], '导入后应保留旧备份里的收藏');
  assert.equal(result.storageKey, 'studymate.state.v1', '本地存储键必须保持原样（老数据不能丢）');

  // 刷新后进度依然在（写入的是同一个 localStorage 键）
  await page.reload({ waitMs: 500 });
  await page.waitFor('window.__STUDYMATE__');
  const afterReload = await page.evaluate('window.__STUDYMATE__.getState().profile?.name || null');
  assert.equal(afterReload, '老用户', '改名后本地进度仍应持久化在同一个键里');

  // 重新导出：导出体里的应用标识仍是旧技术标识，且不含任何密钥
  const exported = await page.evaluate(`(async () => {
    const { exportState } = await import(new URL('./src/core/storage.js', location.href).href);
    return exportState(window.__STUDYMATE__.getState(), { appVersion: '1.0.0' });
  })()`);
  const parsed = JSON.parse(exported);
  assert.equal(parsed.app, 'StudyMate-Web', '导出体的 app 标识必须保持不变，旧版本才能继续导入');
  assert.equal(parsed.data.profile.name, '老用户');
  assert.ok(!/"apiKey"|sk-/.test(exported), '导出体里不得出现密钥字段或密钥样式字符串');
});
