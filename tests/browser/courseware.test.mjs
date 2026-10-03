/**
 * 课件模式（16:9 放映式课时页）的真实浏览器测试。
 * 覆盖：静态课程课件、真实键盘翻页、索引跳转、Esc 退出、打印友好 DOM、
 * 移动端纵向阅读回退，以及 AI 生成课程走同一模板（用本地模拟 API，不调用真实模型）。
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createStaticServer } from '../../scripts/serve.mjs';
import { launchBrowser, openPage, findBrowser, captureEvidence, cleanupCacheProfiles, evidenceCaptureEnabled } from './cdp.mjs';
import { makeValidCourse } from '../unit/support/fixture.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const evidenceDir = path.join(root, 'docs', 'evidence');

let siteServer;
let apiServer;
let browser;
let page;
let baseUrl;
let apiUrl;

before(async () => {
  assert.ok(findBrowser(), '未找到 Edge/Chrome');
  if (evidenceCaptureEnabled()) await mkdir(evidenceDir, { recursive: true });
  siteServer = createStaticServer(path.join(root, 'dist'));
  await new Promise((resolve) => siteServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${siteServer.address().port}`;
  apiServer = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
      const pathname = String(req.url).split('?')[0];
      const course = makeValidCourse({ videoIds: ['bili-py-01', 'bili-py-02'] });
      // 按路径分别返回大纲与单个知识点：否则每一次请求都拿到同一份完整课程，
      // 「AI 生成课程走同一模板」这条测试就没有真的经过「大纲 → 逐知识点」拼装。
      if (pathname === '/api/course/lesson') {
        let parsed = {};
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { parsed = {}; }
        const source = course.concepts.find((c) => c.id === parsed.conceptId) || course.concepts[0];
        res.writeHead(200, headers);
        res.end(JSON.stringify({
          ok: true,
          concept: {
            id: source.id,
            type: source.type,
            lesson: source.lesson,
            keyTerms: source.keyTerms,
            exercises: source.exercises,
            quiz: source.quiz,
            tasks: source.tasks,
            project: source.project,
            videoIds: source.videoIds || [],
          },
          meta: { model: 'mock-model', stage: 'lesson', conceptId: source.id, noVerifiedVideoMatch: false },
        }));
        return;
      }
      if (pathname === '/api/course/outline') {
        const outline = {
          ...course,
          concepts: course.concepts.map(({ lesson, keyTerms, exercises, tasks, project, videoIds, quiz, ...meta }) => meta),
        };
        res.writeHead(200, headers);
        res.end(JSON.stringify({ ok: true, outline, meta: { model: 'mock-model', stage: 'outline', conceptCount: outline.concepts.length } }));
        return;
      }
      res.writeHead(200, headers);
      res.end(JSON.stringify({ ok: true, course, meta: { model: 'mock-model', noVerifiedVideoMatch: false } }));
    });
  });
  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  apiUrl = `http://127.0.0.1:${apiServer.address().port}`;
  browser = await launchBrowser({ url: 'about:blank' });
  page = await openPage(browser.port, { url: 'about:blank' });
});

after(async () => {
  page?.close();
  await cleanupCacheProfiles(path.resolve(import.meta.dirname, '../..'));
  if (browser) await browser.close();
  if (siteServer) await new Promise((resolve) => siteServer.close(resolve));
  if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
});

async function goto(hash) {
  await page.goto(`${baseUrl}/index.html${hash}`, { waitMs: 400 });
  await page.waitFor('window.__STUDYMATE__');
}

async function pressKey(key, code, vk) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await page.wait(220);
}

const activeSlide = () => page.evaluate('document.querySelector(".deck-slide.is-active")?.dataset.slide || ""');

test('静态课程课件：章节页、页码、索引与整页 DOM 都在', async () => {
  await goto('#/slides/linear-algebra/la-vectors');
  assert.ok(await page.waitFor('document.querySelector(".deck")'), '应渲染课件模式');
  const total = await page.evaluate('Number(document.querySelector(".deck").dataset.slideCount)');
  assert.ok(total >= 6, `课件页数应充足，实际 ${total}`);
  assert.equal(await page.count('.deck-slide'), total, '所有页都应存在于 DOM 中（打印需要）');
  assert.equal(await page.count('.deck-slide.is-active'), 1, '同一时间只显示一页');
  assert.equal(await activeSlide(), '1');
  const firstText = await page.textOf('.deck-slide.is-active');
  assert.match(firstText, /CHAPTER · 章节/, '首页应是章节页并带英文微标签');
  assert.match(firstText, /01 \/ \d+/, '应显示 folio 页码');
  assert.equal(await page.count('.deck-dot'), total, '索引点的数量应与页数一致');
  const printRuleExists = await page.evaluate(`(() => {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (rule.type === CSSRule.MEDIA_RULE && rule.conditionText && rule.conditionText.includes('print')) {
          if ([...rule.cssRules].some((r) => r.selectorText && r.selectorText.includes('.deck-slide'))) return true;
        }
      }
    }
    return false;
  })()`);
  assert.ok(printRuleExists, '打印样式表必须包含 .deck-slide 的分页规则');
  await captureEvidence(page, path.join(evidenceDir, 'courseware-desktop.png'));
});

test('真实键盘翻页：→ / ← / End / Home / Esc', async () => {
  await goto('#/slides/linear-algebra/la-vectors');
  await page.waitFor('document.querySelector(".deck")');
  const total = await page.evaluate('Number(document.querySelector(".deck").dataset.slideCount)');

  await pressKey('ArrowRight', 'ArrowRight', 39);
  assert.equal(await activeSlide(), '2', '→ 应前进一页');
  await pressKey('ArrowRight', 'ArrowRight', 39);
  assert.equal(await activeSlide(), '3');
  await pressKey('ArrowLeft', 'ArrowLeft', 37);
  assert.equal(await activeSlide(), '2', '← 应后退一页');
  await pressKey('End', 'End', 35);
  assert.equal(await activeSlide(), String(total), 'End 应跳到最后一页');
  await pressKey('Home', 'Home', 36);
  assert.equal(await activeSlide(), '1', 'Home 应回到第一页');
  await pressKey(' ', 'Space', 32);
  assert.equal(await activeSlide(), '2', '空格应前进一页');

  await pressKey('Escape', 'Escape', 27);
  assert.ok(await page.waitFor('location.hash.startsWith("#/lesson/")'), 'Esc 应返回课时页');
});

test('索引跳转与页码链接可直接深链到某一页', async () => {
  await goto('#/slides/python/py-loop');
  await page.waitFor('document.querySelector(".deck")');
  await page.click('.deck-index li:nth-child(3) .deck-dot');
  assert.ok(await page.waitFor('location.hash.includes("i=3")'), '点击索引应写入页码参数');
  assert.ok(await page.waitFor('document.querySelector(".deck-slide.is-active")?.dataset.slide === "3"'), '应显示第 3 页');

  await goto('#/slides/python/py-loop?i=5');
  assert.ok(await page.waitFor('document.querySelector(".deck-slide.is-active")?.dataset.slide === "5"'), '深链页码应生效');
});

test('课时页提供课件入口，链接指向同一单元', async () => {
  await goto('#/lesson/python/py-setup');
  const href = await page.evaluate('[...document.querySelectorAll(".lesson-actions a")].map((a) => a.getAttribute("href")).find((h) => h && h.includes("/slides/")) || ""');
  assert.match(href, /#\/slides\/python\/py-setup/, `课时页应有课件入口，实际 ${href}`);
  await page.click('.lesson-actions a[href*="/slides/"]');
  assert.ok(await page.waitFor('document.querySelector(".deck")'), '点击后应进入课件模式');
});

test('移动端回退为纵向阅读：所有页可见且没有横向滚动', async () => {
  await page.setViewport(390, 844, { mobile: true });
  await goto('#/slides/machine-learning/ml-gradient');
  assert.ok(await page.waitFor('document.querySelector(".deck")'), '移动端也应渲染课件');
  const visible = await page.evaluate(`(() => {
    const slides = [...document.querySelectorAll('.deck-slide')];
    return slides.filter((s) => getComputedStyle(s).display !== 'none').length;
  })()`);
  const total = await page.evaluate('document.querySelectorAll(".deck-slide").length');
  assert.equal(visible, total, '移动端应把所有页按顺序堆叠显示（纵向阅读）');
  const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  assert.ok(overflow <= 2, `移动端不应出现横向滚动，实际溢出 ${overflow}px`);
  const fontSize = await page.evaluate(`parseFloat(getComputedStyle(document.querySelector('.deck-text')).fontSize)`);
  assert.ok(fontSize >= 15, `课件正文在移动端也要保持可读字号，实际 ${fontSize}px`);
  await captureEvidence(page, path.join(evidenceDir, 'courseware-mobile.png'));
  await page.setViewport(1280, 900);
});

test('AI 生成课程走同一课件模板（使用本地模拟 API）', async () => {
  await goto('#/settings');
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="ai-worker"]');
    input.value = ${JSON.stringify(apiUrl)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await goto('#/generate');
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="generate-topic"]');
    input.value = '用 Python 做数据分析';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page.clickByText('.panel-actions button', '生成完整课程');
  assert.ok(await page.waitFor('document.querySelector(".preview-panel")', { timeoutMs: 45000 }), '应生成预览');
  await page.clickByText('.panel-actions button', '保存到我的课程');
  assert.ok(await page.waitFor('location.hash.startsWith("#/course/gen-")', { timeoutMs: 15000 }), '应保存并跳转到课程页');

  const courseId = await page.evaluate('window.__STUDYMATE__.getState().generatedCourses[0].id');
  await goto(`#/slides/${courseId}/c1`);
  assert.ok(await page.waitFor('document.querySelector(".deck")'), '生成课程也应能进入课件模式');
  const source = await page.evaluate('document.querySelector(".deck").dataset.source');
  assert.equal(source, 'ai', '应标记为 AI 生成');
  const toolbar = await page.textOf('.deck-toolbar');
  assert.match(toolbar, /AI 生成/, '界面必须标注 AI 生成');
  const text = await page.textOf('.deck');
  assert.match(text, /CHAPTER · 章节/, '生成课程使用同一章节页模板');
  assert.match(text, /为什么需要它/, '生成课程的正文应出现在课件里');
  const total = await page.evaluate('Number(document.querySelector(".deck").dataset.slideCount)');
  assert.ok(total >= 6, `生成课程课件页数应充足，实际 ${total}`);
  await captureEvidence(page, path.join(evidenceDir, 'courseware-ai-generated.png'));
});
