/**
 * 交互可信度测试（普通模式，不带 e2e 参数）：
 *  - 测验分数与逐题解析必须真正显示给用户（不能被重渲染吞掉）
 *  - 「自动加载视频」偏好必须真的生效；默认不得创建任何第三方 iframe
 *  - 自定义视频表单必须拒绝危险链接，并如实标注未验证来源
 *  - 触发重渲染的输入框必须保持焦点，搜索必须实时过滤
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../../scripts/serve.mjs';
import { launchBrowser, openPage, findBrowser, captureEvidence, cleanupCacheProfiles, evidenceCaptureEnabled } from './cdp.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const evidenceDir = path.join(root, 'docs', 'evidence');
let server;
let baseUrl;
let browser;
let page;

before(async () => {
  assert.ok(findBrowser(), '未找到 Edge/Chrome，无法执行浏览器交互测试');
  if (evidenceCaptureEnabled()) await mkdir(evidenceDir, { recursive: true });
  server = createStaticServer(path.join(root, 'dist'));
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

async function goto(hash) {
  await page.goto(`${baseUrl}/index.html${hash}`, { waitMs: 450 });
  await page.waitFor('window.__STUDYMATE__ && document.querySelector(".app-header")');
}

/** 用课程数据里的正确答案真实点击选项，模拟一个满分用户。 */
async function answerAllCorrectly(courseId, quizId, { wrong = false } = {}) {
  return page.evaluate(`(async () => {
    const data = await import('./src/data/courses.js');
    const course = data.COURSE_BY_ID.get(${JSON.stringify(courseId)});
    const quiz = course.quizzes[${JSON.stringify(quizId)}];
    const fields = [...document.querySelectorAll('.question')];
    quiz.questions.forEach((q, index) => {
      const field = fields[index];
      if (q.type === 'single') {
        const answer = ${wrong ? 'q.answer === 0 ? 1 : 0' : 'q.answer'};
        field.querySelectorAll('input[type="radio"]')[answer].click();
      } else if (q.type === 'judge') {
        const answer = ${wrong ? 'q.answer ? 1 : 0' : 'q.answer ? 0 : 1'};
        field.querySelectorAll('input[type="radio"]')[answer].click();
      } else if (q.type === 'multiple') {
        const picks = ${wrong ? 'q.answer.map((i) => (i + 1) % q.options.length)' : 'q.answer'};
        field.querySelectorAll('input[type="checkbox"]').forEach((box, i) => { if (picks.includes(i)) box.click(); });
      } else {
        const text = field.querySelector('input[type="text"]');
        text.value = ${wrong ? "'__故意写错__'" : 'Array.isArray(q.answer) ? q.answer[0] : q.answer'};
        text.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    return quiz.questions.length;
  })()`);
}

test('普通模式下提交测验：分数与逐题解析对用户可见且仍在文档中', async () => {
  await goto('#/lesson/linear-algebra/la-span');
  const count = await answerAllCorrectly('linear-algebra', 'quiz-la-span');
  assert.ok(count >= 3, '应有至少 3 道题');

  const clicked = await page.clickByText('.quiz-actions button', '提交并查看解析');
  assert.ok(clicked, '未找到提交按钮');
  assert.ok(await page.waitFor('document.querySelector(".quiz-score")?.textContent.includes("通过")', { timeoutMs: 15000 }), '提交后应立即显示分数');

  const score = await page.textOf('.quiz-score');
  assert.match(score, /通过：3\/3/, `分数应可见，实际：${score}`);
  const feedback = await page.count('.feedback-item');
  assert.equal(feedback, count, '每道题都应显示解析');
  const wrongItems = await page.count('.feedback-item.bad');
  assert.equal(wrongItems, 0, '全对时不应出现错误反馈');

  const attached = await page.evaluate(`(() => {
    const score = document.querySelector('.quiz-score');
    const item = document.querySelector('.feedback-item');
    return Boolean(score && item && document.body.contains(score) && document.body.contains(item));
  })()`);
  assert.ok(attached, '分数与解析节点必须仍然挂载在文档中（不能被重渲染丢弃）');

  const persisted = await page.evaluate('JSON.parse(localStorage.getItem("studymate.state.v1")).courses["linear-algebra"].quizAttempts.length');
  assert.ok(persisted >= 1, '这次测验应被持久化');
  const history = await page.textOf('.quiz-head');
  assert.match(history, /历史最佳/, '提交后历史记录文案应更新');
  await captureEvidence(page, path.join(evidenceDir, 'quiz-feedback-desktop.png'));
});

test('答错时会显示正确答案与解析', async () => {
  await goto('#/lesson/linear-algebra/la-vectors');
  await answerAllCorrectly('linear-algebra', 'quiz-la-vectors', { wrong: true });
  await page.clickByText('.quiz-actions button', '提交并查看解析');
  assert.ok(await page.waitFor('document.querySelectorAll(".feedback-item").length > 0'), '应显示反馈');
  const bad = await page.count('.feedback-item.bad');
  assert.ok(bad >= 1, '应至少有一道错题反馈');
  const firstBad = await page.textOf('.feedback-item.bad');
  assert.match(firstBad, /正确答案/, '错误反馈必须给出正确答案');
  assert.match(firstBad, /有误/, '错误反馈必须明确标注有误');
  const score = await page.textOf('.quiz-score');
  assert.match(score, /未通过/, `全错时应显示未通过，实际：${score}`);
});

test('自动加载视频偏好：默认不发请求，开启后加载，来源页链接始终保留', async () => {
  await goto('#/lesson/linear-algebra/la-vectors');
  const framesBefore = await page.count('iframe.video-frame');
  assert.equal(framesBefore, 0, '默认不得创建任何第三方 iframe');
  const linkBefore = await page.evaluate('document.querySelector(".video-foot a")?.getAttribute("href") || ""');
  assert.match(linkBefore, /^https:\/\//, '默认状态下也必须提供来源页链接');

  await page.evaluate('window.__STUDYMATE__.actions.updatePreferences({ autoLoadVideo: true })');
  assert.ok(await page.waitFor('document.querySelector("iframe.video-frame")', { timeoutMs: 15000 }), '开启「自动加载视频」后应立即创建播放器');
  const src = await page.evaluate('document.querySelector("iframe.video-frame").getAttribute("src")');
  assert.match(src, /^https:\/\/player\.bilibili\.com\/player\.html\?bvid=BV/, '自动加载的播放器地址应指向 B 站外链播放器');
  const linkAfter = await page.evaluate('document.querySelector(".video-foot a")?.getAttribute("href") || ""');
  assert.match(linkAfter, /^https:\/\//, '加载播放器后来源页链接仍必须保留');

  await page.evaluate('window.__STUDYMATE__.actions.updatePreferences({ autoLoadVideo: false })');
  assert.ok(await page.waitFor('!document.querySelector("iframe.video-frame")'), '关闭后不应继续保留播放器');
});

test('自定义视频表单：危险链接被拒绝，合法链接可添加并如实标注未验证', async () => {
  await goto('#/videos');
  const baseline = await page.count('.video-card');

  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="custom-video-url"]');
    input.value = 'javascript:alert(document.cookie)';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="custom-video-title"]');
    input.value = '恶意链接';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page.clickByText('.custom-video-form button', '校验并添加');
  assert.ok(await page.waitFor('document.querySelector(".form-status")?.textContent.length > 0'), '应显示校验结果');
  const rejected = await page.textOf('.form-status');
  assert.match(rejected, /协议|链接/, `危险链接必须被拒绝，实际提示：${rejected}`);
  assert.equal(await page.count('.video-card'), baseline, '被拒绝时不应新增任何条目');

  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="custom-video-url"]');
    input.value = 'https://www.bilibili.com/video/BV1tDsgzxECr?p=35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="custom-video-title"]');
    input.value = '我的补充视频';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page.clickByText('.custom-video-form button', '校验并添加');
  assert.ok(await page.waitFor(`document.querySelectorAll('.video-card').length === ${baseline + 1}`), '合法链接应被添加');
  const customText = await page.textOf('.custom-video-slot');
  assert.match(customText, /我的补充视频/);
  assert.match(customText, /未验证/, '自定义来源必须标注为未验证');
  assert.match(customText, /用户自定义/, '自定义来源不得显示为官方认证账号');

  await page.clickByText('.custom-video-slot button', '删除这条自定义视频');
  assert.ok(await page.waitFor(`document.querySelectorAll('.video-card').length === ${baseline}`), '删除后应回到原状');
});

test('搜索框在重新渲染后保持焦点并实时过滤结果', async () => {
  await goto('#/explore');
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="explore-search"]');
    input.focus();
    input.value = '特征值';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.ok(await page.waitFor('document.querySelectorAll(".concept-hits li").length > 0'), '搜索结果应实时更新');
  const stillFocused = await page.evaluate(`document.activeElement?.dataset?.focusKey || ""`);
  assert.equal(stillFocused, 'explore-search', '重新渲染后输入框必须保持焦点');
  const caret = await page.evaluate('document.activeElement.selectionStart');
  assert.equal(caret, '特征值'.length, '光标位置应保留在末尾');
});
