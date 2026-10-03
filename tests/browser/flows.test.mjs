/**
 * 真实浏览器端到端流程：学习台 → 定制课程 → 课时/视频 → 测验 → 刷新持久化 → 移动端导航。
 * 使用 Edge/Chrome 无头模式 + CDP，不依赖任何 npm 依赖。
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';

/** 记录证据目录中每个文件的 mtime，用于断言默认运行不改写已交付资源。 */
function evidenceMtimes(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) out[name] = statSync(path.join(dir, name)).mtimeMs;
  return out;
}
import { mkdir, writeFile } from 'node:fs/promises';
import { createStaticServer } from '../../scripts/serve.mjs';
import { launchBrowser, openPage, findBrowser, captureEvidence, cleanupCacheProfiles, evidenceCaptureEnabled } from './cdp.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const distDir = path.join(root, 'dist');
const evidenceDir = path.join(root, 'docs', 'evidence');

let server;
let baseUrl;
let browser;
let page;
const browserAvailable = Boolean(findBrowser());

before(async () => {
  assert.ok(existsSync(path.join(distDir, 'index.html')), '请先运行 npm run build 生成 dist/');
  assert.ok(browserAvailable, '未找到 Edge/Chrome，无法执行浏览器流程测试');
  if (evidenceCaptureEnabled()) await mkdir(evidenceDir, { recursive: true });
  server = createStaticServer(distDir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser({ url: 'about:blank' });
  page = await openPage(browser.port, { url: 'about:blank' });
});

after(async () => {
  page?.close();
  await cleanupCacheProfiles(path.resolve(import.meta.dirname, '../..'));
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function gotoApp(hash = '#/') {
  await page.goto(`${baseUrl}/index.html?e2e=1${hash}`, { waitMs: 400 });
  const ready = await page.waitFor('document.querySelector(".app-header") && window.__STUDYMATE__');
  assert.ok(ready, '应用未在预期时间内渲染');
}

async function resetStorage() {
  await page.evaluate('localStorage.clear(); sessionStorage.clear();');
  await page.reload({ waitMs: 300 });
  await page.waitFor('window.__STUDYMATE__');
}

async function state() {
  return page.evaluate('window.__STUDYMATE__.getState()');
}

test('浏览器信息与首页渲染', async () => {
  await gotoApp('#/');
  // Edge 无头模式的 UA 里品牌是 "Edg/xxx"，Chrome 是 "Chrome/xxx"
  assert.match(browser.browser, /(Edg|Edge|Chrome|Chromium)/i, `浏览器可执行文件应为 Edge/Chrome，实际：${browser.browser}`);
  const h1 = await page.textOf('h1');
  assert.ok(h1 && h1.length > 0, '首页应渲染标题');
  const tiles = await page.count('.stat-tile');
  assert.ok(tiles >= 5, `首页应有至少 5 个统计卡片，实际 ${tiles}`);
  const navLinks = await page.count('.nav-link');
  assert.ok(navLinks >= 7, `导航应包含至少 7 个入口，实际 ${navLinks}`);
  const courses = await page.count('.course-progress-list .progress-row');
  assert.equal(courses, 3, '应展示三门课程的进度行');
  await captureEvidence(page, path.join(evidenceDir, 'dashboard-desktop.png'));
});

test('定制课程向导：四步生成并保存计划', async () => {
  await resetStorage();
  await page.clickByText('.nav-link', '定制课程');
  assert.ok(await page.waitFor('location.hash === "#/plan"'), '应跳转到定制课程页');
  assert.ok(await page.waitFor('document.querySelector(".wizard-steps")'), '应显示向导步骤');
  for (let i = 0; i < 3; i += 1) {
    const clicked = await page.clickByText('.wizard-actions button', '下一步');
    assert.ok(clicked, `第 ${i + 1} 次点击「下一步」失败`);
    await page.wait(120);
  }
  assert.ok(await page.waitFor('document.querySelector(".weeks")'), '预览应渲染周计划');
  const saveClicked = await page.clickByText('.wizard-actions button', '保存为我的课程计划');
  assert.ok(saveClicked, '未找到保存按钮');
  assert.ok(await page.waitFor('Boolean(window.__STUDYMATE__.getState().courses["linear-algebra"]?.customPlan)'), '计划未写入本地状态');
  assert.ok(await page.waitFor('location.hash.startsWith("#/course/")'), '保存后应跳转到课程页');
  const plan = (await state()).courses['linear-algebra'].customPlan;
  assert.ok(plan.weeks.length >= 2, `计划应包含至少 2 周，实际 ${plan.weeks.length}`);
  assert.ok(plan.stats.videos > 0, '计划应引用配套视频');
  const stored = await page.evaluate('JSON.parse(localStorage.getItem("studymate.state.v1")).courses["linear-algebra"].customPlan.weeks.length');
  assert.equal(stored, plan.weeks.length, 'localStorage 中的周数应与内存一致');
});

test('课时页：正文、视频（点击后加载）、测验、笔记、完成标记', async () => {
  await page.clickByText('.tab', '课时列表');
  assert.ok(await page.waitFor('document.querySelector(".lesson-row .card-link")'), '课时列表未渲染');
  const opened = await page.click('.lesson-row .card-link');
  assert.ok(opened, '点击课时链接失败');
  assert.ok(await page.waitFor('location.hash.startsWith("#/lesson/")'), '未进入课时页');

  const objectives = await page.count('.objectives li');
  assert.ok(objectives >= 3, `学完目标应至少 3 条，实际 ${objectives}`);
  const sections = await page.count('.lesson-section');
  assert.ok(sections >= 2, `课时正文应至少 2 节，实际 ${sections}`);

  const iframesBefore = await page.count('iframe.video-frame');
  assert.equal(iframesBefore, 0, '默认不应加载任何第三方播放器');
  const playClicked = await page.clickByText('.video-placeholder button', '加载站内播放器');
  if (playClicked) {
    assert.ok(await page.waitFor('document.querySelector("iframe.video-frame")'), '点击后应出现播放器 iframe');
    const src = await page.evaluate('document.querySelector("iframe.video-frame").getAttribute("src")');
    assert.match(src, /^https:\/\/player\.bilibili\.com\/player\.html\?bvid=BV/, `播放器地址应指向 B 站外链播放器，实际 ${src}`);
  } else {
    const externalLinks = await page.count('.video-foot a');
    assert.ok(externalLinks > 0, '无嵌入播放器时必须提供来源页链接');
  }
  const sourceLink = await page.evaluate('document.querySelector(".video-foot a")?.getAttribute("href") || ""');
  assert.match(sourceLink, /^https:\/\//, '来源页链接必须是 https');

  const questions = await page.count('.question');
  assert.ok(questions >= 3, `测验应至少 3 题，实际 ${questions}`);
  await page.evaluate(`(() => {
    document.querySelectorAll('.question').forEach((q) => {
      const first = q.querySelector('input[type="radio"], input[type="checkbox"]');
      if (first) first.click();
      const text = q.querySelector('input[type="text"]');
      if (text) { text.value = '不知道'; text.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  })()`);
  const submitted = await page.clickByText('.quiz-actions button', '提交并查看解析');
  assert.ok(submitted, '未找到测验提交按钮');
  assert.ok(await page.waitFor('document.querySelectorAll(".feedback-item").length > 0'), '提交后应显示逐题解析');
  const feedback = await page.count('.feedback-item');
  assert.equal(feedback, questions, '每条题目都应有反馈');
  const attempts = await page.evaluate('window.__STUDYMATE__.getState().courses[Object.keys(window.__STUDYMATE__.getState().courses)[0]].quizAttempts.length');
  assert.ok(attempts >= 1, '测验尝试应被记录');

  await page.evaluate(`(() => {
    const area = document.querySelector('.notes-panel textarea');
    area.value = '端到端测试写入的笔记';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.notes-panel form').requestSubmit();
  })()`);
  assert.ok(await page.waitFor('document.querySelectorAll(".notes-panel .note-list li").length === 1'), '笔记应被保存并显示');

  const completeClicked = await page.clickByText('.lesson-actions button', '标记本课已完成');
  assert.ok(completeClicked, '未找到完成按钮');
  assert.ok(await page.waitFor('document.querySelector(".lesson-actions button")?.textContent.includes("标记为未完成")'), '完成后按钮状态应切换');
  await captureEvidence(page, path.join(evidenceDir, 'lesson-desktop.png'));
});

test('刷新后进度、笔记与测验记录仍然存在', async () => {
  const before = await state();
  const courseId = Object.keys(before.courses).find((id) => before.courses[id].customPlan);
  const completedCount = Object.values(before.courses[courseId].lessons).filter((l) => l.status === 'completed').length;
  assert.ok(completedCount >= 1, '刷新前应至少完成一节课');

  await page.reload({ waitMs: 500 });
  await page.waitFor('window.__STUDYMATE__');
  const after = await state();
  const lessons = Object.values(after.courses[courseId].lessons).filter((l) => l.status === 'completed').length;
  assert.equal(lessons, completedCount, '刷新后完成状态应保持');
  const notes = Object.values(after.courses[courseId].notes).flat().length;
  assert.ok(notes >= 1, '刷新后笔记应保持');
  assert.ok(after.courses[courseId].quizAttempts.length >= 1, '刷新后测验记录应保持');
  await gotoApp('#/');
  const streak = await page.evaluate('document.querySelector(".stat-tile .stat-value")?.textContent || ""');
  assert.match(streak, /天/, '首页应显示连续学习天数');
});

test('课程库搜索的命中与空状态', async () => {
  await gotoApp('#/explore');
  await page.evaluate(`(() => {
    const input = document.querySelector('.search-input');
    input.value = '特征值';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.ok(await page.waitFor('document.querySelectorAll(".concept-hits li").length > 0'), '搜索「特征值」应有知识点命中');
  await page.evaluate(`(() => {
    const input = document.querySelector('.search-input');
    input.value = 'zzzz-不存在的关键词';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.ok(await page.waitFor('document.querySelector(".empty-state")'), '无结果时应显示空状态');
  const emptyText = await page.textOf('.empty-state');
  assert.match(emptyText, /没有匹配的课程/);
});

test('视频课页面：来源、理由与筛选', async () => {
  await gotoApp('#/videos');
  const cards = await page.count('.video-card');
  assert.ok(cards >= 30, `视频条目应不少于 30 条，实际 ${cards}`);
  const firstCardText = await page.textOf('.video-card');
  assert.match(firstCardText, /选择理由/, '视频卡片应展示入选理由');
  assert.match(firstCardText, /核实于/, '视频卡片应展示核实日期');
  const external = await page.evaluate('document.querySelector(".video-card .video-foot a")?.getAttribute("href") || ""');
  assert.match(external, /^https:\/\//, '必须提供 https 来源链接');
  const filtered = await page.evaluate(`(() => {
    const select = document.querySelector('.toolbar select');
    const option = [...select.options].find((o) => o.value !== 'all');
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return option.value;
  })()`);
  assert.ok(await page.waitFor(`document.querySelectorAll(".video-card").length < ${cards}`), `按知识点 ${filtered} 筛选后条目应减少`);
});

test('设置页：AI 未配置时如实说明，密钥不进入 localStorage', async () => {
  await gotoApp('#/settings');
  assert.ok(await page.waitFor('document.querySelector(".view-settings")'), '设置页未渲染');
  const secret = 'sk-e2e-should-never-be-persisted';
  await page.evaluate(`(() => {
    const input = document.querySelector('input[type="password"]');
    input.value = ${JSON.stringify(secret)};
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  assert.ok(await page.waitFor('sessionStorage.length > 0'), '密钥应写入 sessionStorage（当前会话）');
  const localDump = await page.evaluate('JSON.stringify(localStorage)');
  assert.ok(!localDump.includes(secret), 'localStorage 绝不能包含密钥');
  const sessionDump = await page.evaluate('JSON.stringify(sessionStorage)');
  assert.ok(sessionDump.includes(secret), 'sessionStorage 应保存密钥（关闭标签页即失效）');
  await gotoApp('#/lesson/linear-algebra/la-vectors');
  const panelText = await page.textOf('.ai-panel');
  assert.match(panelText, /(未启用|不内置任何 AI 服务)/, 'AI 面板应如实说明未配置状态');
});

test('移动端：导航抽屉与课时内容可用', async () => {
  await page.setViewport(390, 844, { mobile: true });
  await gotoApp('#/');
  const toggleVisible = await page.evaluate(`(() => {
    const el = document.querySelector('.nav-toggle');
    return Boolean(el) && getComputedStyle(el).display !== 'none';
  })()`);
  assert.ok(toggleVisible, '移动端应显示菜单按钮（视口 390x844）');
  assert.ok(toggleVisible, '移动端应显示菜单按钮');
  await page.click('.nav-toggle');
  if (!(await page.waitFor('document.querySelector(".primary-nav.is-open")', { timeoutMs: 10000 }))) {
    await page.click('.nav-toggle');
  }
  assert.ok(await page.waitFor('document.querySelector(".primary-nav.is-open")', { timeoutMs: 15000 }), '抽屉应展开');
  const linkClicked = await page.clickByText('.primary-nav .nav-link', '课程库');
  assert.ok(linkClicked, '抽屉中的链接应可点击');
  assert.ok(await page.waitFor('location.hash === "#/explore"', { timeoutMs: 15000 }), '点击后应跳转到课程库');
  assert.ok(await page.waitFor('!document.querySelector(".primary-nav.is-open")', { timeoutMs: 15000 }), '跳转后抽屉应收起');
  await captureEvidence(page, path.join(evidenceDir, 'explore-mobile.png'));

  await gotoApp('#/lesson/python/py-loop');
  const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  assert.ok(overflow <= 2, `移动端不应出现横向滚动，实际溢出 ${overflow}px`);
  const videoButton = await page.count('.video-placeholder button, .video-foot a');
  assert.ok(videoButton > 0, '移动端课时页应能看到视频入口');
  await captureEvidence(page, path.join(evidenceDir, 'lesson-mobile.png'));
  await page.setViewport(1280, 900);
});

test('端到端流程记录', async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    browser: browser.browser,
    baseUrl,
    evidence: ['docs/evidence/dashboard-desktop.png', 'docs/evidence/lesson-desktop.png', 'docs/evidence/explore-mobile.png', 'docs/evidence/lesson-mobile.png'],
    note: '以上流程均由真实浏览器执行；视频播放器仅在点击后加载，测试未对第三方播放成功与否做任何断言。',
  };
  if (evidenceCaptureEnabled()) {
    // 显式开启采集时才写文件（STUDYMATE_CAPTURE_EVIDENCE=1）
    const dashboardShot = path.join(evidenceDir, 'dashboard-desktop.png');
    if (!existsSync(dashboardShot)) {
      await gotoApp('#/');
      await captureEvidence(page, dashboardShot);
    }
    await writeFile(path.join(evidenceDir, 'browser-flow-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    assert.ok(existsSync(dashboardShot), '显式开启证据采集时应产出桌面端截图证据');
  } else {
    // 默认验收模式：不改写任何已交付证据，但仍然做真实交互断言（不是空跑）
    const before = evidenceMtimes(evidenceDir);
    await gotoApp('#/');
    const navLinks = await page.count('.nav-link');
    const statTiles = await page.count('.stat-tile');
    const courses = await page.count('.course-progress-list .progress-row');
    assert.ok(navLinks >= 7, `默认模式仍应渲染可交互导航，实际 ${navLinks}`);
    assert.ok(statTiles >= 5, `默认模式仍应渲染学习台统计，实际 ${statTiles}`);
    assert.equal(courses, 3, '默认模式仍应渲染三门课程进度');
    await page.waitFor('document.querySelector(".toast-region")');
    const after = evidenceMtimes(evidenceDir);
    assert.deepEqual(after, before, '默认运行不得改写 docs/evidence 下已交付的证据文件');
  }
});
