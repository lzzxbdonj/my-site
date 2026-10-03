/**
 * 中文输入法（IME）回归测试。
 *
 * 背景（真实 bug）：应用是「状态变化 → 全量重渲染」。中文输入法在**组字过程中**也会持续触发
 * input 事件，于是每敲一个拼音就把输入框整个替换掉，浏览器的组字被中断 ——
 * 用户看到的现象就是「输入框只能打英文」。搜索框、笔记、建课主题全都受影响。
 *
 * 修复方式：composing 期间挂起渲染，compositionend 后再统一渲染一次（见 src/ui/app.js）。
 * 本测试直接模拟真实的 compositionstart → input(isComposing) → compositionend 序列。
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createStaticServer } from '../../scripts/serve.mjs';
import { launchBrowser, openPage, findBrowser, cleanupCacheProfiles } from './cdp.mjs';

const root = path.resolve(import.meta.dirname, '../..');
let siteServer;
let browser;
let page;
let baseUrl;

before(async () => {
  assert.ok(findBrowser(), '未找到 Edge/Chrome');
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
  if (siteServer) await new Promise((resolve) => serverClose(siteServer, resolve));
});

function serverClose(server, resolve) { server.close(resolve); }

async function goto(hash) {
  await page.goto(`${baseUrl}/index.html${hash}`, { waitMs: 400 });
  await page.waitFor('window.__STUDYMATE__');
}

/** 在指定输入框上模拟一次完整的中文组字过程。 */
async function composeIn(focusKey, text) {
  return page.evaluate(`(() => {
    const el = document.querySelector('[data-focus-key="${focusKey}"]');
    if (!el) return { ok: false, reason: 'not-found' };
    window.__imeEl = el;
    el.focus();
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: ${JSON.stringify(text)} }));
    return { ok: true };
  })()`);
}

async function imeSnapshot(focusKey) {
  return page.evaluate(`(() => {
    const el = document.querySelector('[data-focus-key="${focusKey}"]');
    return {
      same: el === window.__imeEl,
      value: el ? el.value : null,
      focused: document.activeElement === el,
    };
  })()`);
}

async function endComposition(focusKey, text) {
  await page.evaluate(`(() => {
    const el = document.querySelector('[data-focus-key="${focusKey}"]');
    if (!el) return;
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: ${JSON.stringify(text)} }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(text)} }));
  })()`);
  await page.wait(200);
}

test('建课主题：组字期间输入框不被替换，结束后中文完整保留', async () => {
  await goto('#/generate');
  const started = await composeIn('generate-topic', '数据结构与算法');
  assert.equal(started.ok, true, '应能找到建课主题输入框');

  const during = await imeSnapshot('generate-topic');
  assert.equal(during.same, true, '组字期间绝不能替换输入框（否则输入法会中断，只能打英文）');
  assert.equal(during.value, '数据结构与算法', '组字期间已输入的内容必须保留');
  assert.equal(during.focused, true, '组字期间必须保持焦点');

  await endComposition('generate-topic', '数据结构与算法');
  const topic = await page.evaluate('window.__STUDYMATE__.ui.aiDraft.topic');
  assert.equal(topic, '数据结构与算法', '组字结束后中文应写入草稿状态');
  const after = await imeSnapshot('generate-topic');
  assert.equal(after.value, '数据结构与算法', '重新渲染后输入框仍显示中文');
});

test('连续两轮中文输入都正常（第二轮说明状态没有卡在 composing）', async () => {
  await goto('#/generate');
  await composeIn('generate-topic', '概率论');
  await endComposition('generate-topic', '概率论');
  await composeIn('generate-topic', '概率论与数理统计');
  const during = await imeSnapshot('generate-topic');
  assert.equal(during.same, true, '第二轮组字同样不能被替换');
  await endComposition('generate-topic', '概率论与数理统计');
  const topic = await page.evaluate('window.__STUDYMATE__.ui.aiDraft.topic');
  assert.equal(topic, '概率论与数理统计');
});

test('搜索框同样支持中文组字（全站统一修复，不是只修一处）', async () => {
  await goto('#/explore');
  const started = await composeIn('explore-search', '向量');
  if (!started.ok) {
    // 搜索框的 focus key 若改名，这里如实失败而不是静默跳过
    assert.fail('未找到课程库搜索框（data-focus-key="explore-search"）');
  }
  const during = await imeSnapshot('explore-search');
  assert.equal(during.same, true, '搜索框组字期间也不能被替换');
  await endComposition('explore-search', '向量');
  const value = await page.evaluate(`document.querySelector('[data-focus-key="explore-search"]').value`);
  assert.equal(value, '向量');
});
