/**
 * AI 建课的浏览器流程测试（使用本地模拟的 Worker API，不做任何真实模型调用）。
 * 覆盖：配置代理地址 → 生成 → 预览 → 保存 → 打开课时 → 刷新后仍在 → 错误/额度提示 → 不发送供应商密钥。
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
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
const apiState = {
  mode: 'ok',
  requests: [],
  /** 回显客户端提交的模板 id（服务端真实实现用的是同一份白名单，未知名一律回退 custom）。 */
  templateEcho(body) {
    const known = new Set(['custom', 'starter', 'exam', 'project', 'sprint', 'gap']);
    const id = typeof body?.templateId === 'string' ? body.templateId : 'custom';
    return known.has(id) ? id : 'custom';
  },
};

function startApi() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        apiState.requests.push({ url: req.url, headers: req.headers, body });
        const headers = {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'POST, OPTIONS',
        };
        if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
        if (apiState.mode === 'error') {
          res.writeHead(502, headers);
          res.end(JSON.stringify({ ok: false, error: 'provider-error', message: '调用模型失败（供应商状态 500）。本次不计入配额。' }));
          return;
        }
        if (apiState.mode === 'quota') {
          res.writeHead(429, headers);
          res.end(JSON.stringify({ ok: false, error: 'visitor-quota-exceeded', message: '你今天的 AI 调用额度已用完（10 次/天），明天会重置。' }));
          return;
        }
        if (apiState.mode === 'concurrency') {
          res.writeHead(429, headers);
          res.end(JSON.stringify({ ok: false, error: 'concurrency-limit', message: '当前同时进行的生成请求已达上限（2），请稍后重试。' }));
          return;
        }
        if (apiState.mode === 'truncated') {
          res.writeHead(422, headers);
          res.end(JSON.stringify({ ok: false, error: 'output-truncated', message: '模型输出达到长度上限而被截断，未生成完整课程。' }));
          return;
        }
        if (apiState.mode === 'invalid') {
          res.writeHead(422, headers);
          res.end(JSON.stringify({ ok: false, error: 'invalid-model-output', message: 'AI 生成内容未通过结构校验：内容里带链接', problems: ['concepts[0].lesson.sections[0].body[0] 不允许包含链接或脚本协议'] }));
          return;
        }
        // 分阶段建课：**按路径** 路由。
        // 这里刻意不靠「URL 里出现 /api/course/lesson」或「提示词里出现『大纲』」来判阶段：
        // 那种写法会让每次请求都命中同一个分支，看起来在拼装、其实拿到的是同一份响应。
        const pathname = String(req.url).split('?')[0];
        assert.ok(pathname === '/api/course/outline' || pathname === '/api/course/lesson', `模拟服务只应处理两个建课端点，收到 ${pathname}`);
        const course = makeValidCourse({ videoIds: ['bili-py-01', 'bili-py-02'] });
        const outline = {
          ...course,
          concepts: course.concepts.map(({ lesson, keyTerms, exercises, tasks, project, videoIds, quiz, ...meta }) => meta),
        };
        if (pathname === '/api/course/outline') {
          res.writeHead(200, headers);
          res.end(JSON.stringify({
            ok: true,
            outline,
            meta: {
              model: 'mock-model',
              stage: 'outline',
              conceptCount: outline.concepts.length,
              templateId: apiState.templateEcho(JSON.parse(body || '{}')),
              usage: { prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 },
              disclaimer: 'AI 生成内容，请自行核对。',
            },
          }));
          return;
        }
        const parsed = JSON.parse(body || '{}');
        const source = course.concepts.find((c) => c.id === parsed.conceptId);
        if (!source) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ ok: false, error: 'bad-request', message: '指定的知识点不在大纲中' }));
          return;
        }
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
          meta: {
            model: 'mock-model',
            stage: 'lesson',
            conceptId: source.id,
            matchedVideoIds: source.videoIds || [],
            templateId: apiState.templateEcho(parsed),
            usage: { prompt_tokens: 200, completion_tokens: 800, total_tokens: 1000 },
          },
        }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

before(async () => {
  assert.ok(findBrowser(), '未找到 Edge/Chrome');
  if (evidenceCaptureEnabled()) await mkdir(evidenceDir, { recursive: true });
  siteServer = createStaticServer(path.join(root, 'dist'));
  await new Promise((resolve) => siteServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${siteServer.address().port}`;
  apiServer = await startApi();
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

async function configureProxy() {
  await goto('#/settings');
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="ai-worker"]');
    input.value = ${JSON.stringify(apiUrl)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.ok(await page.waitFor('document.querySelector(".view-settings")'), '设置页应保持渲染');
}

async function fillTopic(text) {
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="generate-topic"]');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

test('AI 建课：配置代理 → 生成 → 预览 → 保存 → 打开课时 → 刷新仍在', async () => {
  await configureProxy();
  await goto('#/generate');
  assert.ok(await page.waitFor('document.querySelector(".view-generate")'), 'AI 建课页应渲染');

  await fillTopic('用 Python 做数据分析');
  const clicked = await page.clickByText('.panel-actions button', '生成完整课程');
  assert.ok(clicked, '未找到生成按钮');
  assert.ok(await page.waitFor('document.querySelector(".preview-panel")', { timeoutMs: 45000 }), '应显示预览面板');

  const previewText = await page.textOf('.preview-panel');
  assert.match(previewText, /测试课程：从零到可交付/, '预览应显示课程标题');
  assert.match(previewText, /AI 生成 · 请自行核对/, '必须明确标注 AI 生成');
  const conceptItems = await page.count('.preview-concept');
  assert.ok(conceptItems >= 4, `预览应列出至少 4 个单元，实际 ${conceptItems}`);
  assert.match(previewText, /实战/, '预览应包含动手单元');
  assert.match(previewText, /尚硅谷|安装 Python 解释器/, '预览应显示匹配到的已核实视频');
  await captureEvidence(page, path.join(evidenceDir, 'ai-generate-preview.png'));

  const saved = await page.clickByText('.panel-actions button', '保存到我的课程');
  assert.ok(saved, '未找到保存按钮');
  assert.ok(await page.waitFor('location.hash.startsWith("#/course/gen-")', { timeoutMs: 10000 }), '保存后应跳转到课程页');
  const courseText = await page.textOf('.view-course');
  assert.match(courseText, /测试课程：从零到可交付/);
  const stored = await page.evaluate('(window.__STUDYMATE__.getState().generatedCourses || []).length');
  assert.equal(stored, 1, '生成的课程应写入本地状态');

  await page.reload({ waitMs: 500 });
  await page.waitFor('window.__STUDYMATE__');
  const afterReload = await page.textOf('.view-course');
  assert.match(afterReload, /测试课程：从零到可交付/, '刷新后生成课程仍应可访问');
  await goto('#/generate');
  const listText = await page.textOf('.generated-list');
  assert.match(listText, /测试课程：从零到可交付/, '「我的 AI 课程」应列出已保存课程');

  // 打开该课程的一个课时，确认生成的正文与测验可正常使用
  const courseId = await page.evaluate('window.__STUDYMATE__.getState().generatedCourses[0].id');
  await goto(`#/lesson/${courseId}/c1`);
  const lessonText = await page.textOf('.view-lesson');
  assert.match(lessonText, /为什么需要它|具体怎么做/, '生成的课时正文应渲染');
  const questions = await page.count('.question');
  assert.ok(questions >= 2, '生成的测验题应渲染');
});

test('生成失败时给出如实的错误提示（供应商错误 / 额度用尽 / 结构校验失败 / 并发上限 / 输出截断）', async () => {
  await configureProxy();
  await goto('#/generate');
  await fillTopic('测试错误路径');

  for (const [mode, pattern] of [['error', /模型|服务|失败/], ['quota', /额度/], ['invalid', /校验/], ['concurrency', /并发|上限/], ['truncated', /截断|长度/]]) {
    apiState.mode = mode;
    await page.clickByText('.panel-actions button', '生成完整课程');
    assert.ok(await page.waitFor('document.querySelector(".error-panel")', { timeoutMs: 45000 }), `${mode} 应显示错误面板`);
    const text = await page.textOf('.error-panel');
    assert.match(text, pattern, `${mode} 的错误提示应可读：${text.slice(0, 80)}`);
    apiState.mode = 'ok';
  }
  // 失败文案必须如实说明额度/费用消耗，且不得再出现「本次不占用额度」这种错误承诺
  apiState.mode = 'error';
  await page.clickByText('.panel-actions button', '生成完整课程');
  assert.ok(await page.waitFor('document.querySelector(".error-panel")', { timeoutMs: 45000 }), '应显示错误面板');
  const failureText = await page.textOf('.error-panel');
  assert.match(failureText, /额度/, '失败文案必须说明这次尝试已计入额度');
  assert.match(failureText, /费用/, '失败文案必须说明可能产生费用');
  assert.doesNotMatch(failureText, /不占用额度/, '不得再承诺「失败不占用额度」');
  apiState.mode = 'ok';

  await captureEvidence(page, path.join(evidenceDir, 'ai-generate-error.png'));
  assert.equal(await page.count('.preview-panel'), 0, '错误时不应出现预览');
});

test('浏览器从不向 AI 服务发送供应商密钥，只发送学习需求与视频库元数据', async () => {
  apiState.requests.length = 0;
  await configureProxy();
  await goto('#/generate');
  await fillTopic('检查请求内容');
  await page.clickByText('.panel-actions button', '生成完整课程');
  assert.ok(await page.waitFor('document.querySelector(".preview-panel")', { timeoutMs: 45000 }), '应生成成功');
  assert.ok(apiState.requests.length >= 1, '模拟服务应收到请求');
  const outlineReq = apiState.requests.filter((r) => r.url.includes('/api/course/outline') && r.body).pop();
  const lessonReqs = apiState.requests.filter((r) => r.url.includes('/api/course/lesson') && r.body);
  assert.ok(outlineReq, '应调用 /api/course/outline');
  assert.ok(lessonReqs.length >= 4, `应为每个知识点各调用一次 /api/course/lesson，实际 ${lessonReqs.length}`);
  for (const req of [outlineReq, ...lessonReqs]) {
    assert.equal(req.headers.authorization, undefined, '前端不得发送 authorization 头（供应商密钥只存在于 Worker 机密）');
  }
  const body = JSON.parse(outlineReq.body);
  assert.equal(body.topic, '检查请求内容');
  assert.ok(Array.isArray(body.videoLibrary) && body.videoLibrary.length > 0, '应发送已核实视频库元数据');
  assert.ok(body.videoLibrary.every((v) => typeof v.id === 'string' && v.watchUrl === undefined), '视频库元数据不应包含播放链接');
  assert.ok(!JSON.stringify(body).includes('sk-'), '请求体中不得出现任何密钥样式字符串');
  const lessonBody = JSON.parse(lessonReqs[0].body);
  assert.ok(typeof lessonBody.conceptId === 'string' && lessonBody.conceptId, '知识点请求必须带上要生成的知识点 id');
  assert.ok(Array.isArray(lessonBody.outline?.concepts), '知识点请求必须带上大纲作为上下文');
  assert.ok(!JSON.stringify(lessonBody).includes('sk-'), '知识点请求中也不得出现密钥');
});

/* ---------------------------------------------------------------------------
 * 课程模板（预设）：一键填入推荐值、生成前零请求、模板真正进入请求
 * ------------------------------------------------------------------------- */

const readDraft = () => page.evaluate(`(() => {
  const value = (selector) => {
    const el = document.querySelector(selector);
    return el ? el.value : null;
  };
  return {
    topic: value('[data-focus-key="generate-topic"]'),
    goal: value('[data-focus-key="generate-goal"]'),
    level: value('[data-focus-key="generate-level"]'),
    weeklyHours: value('[data-focus-key="generate-weekly"]'),
    lessonMinutes: value('[data-focus-key="generate-lesson"]'),
    selected: document.querySelector('.template-card.is-selected')?.dataset.templateId || null,
    current: document.querySelector('.template-detail')?.dataset.templateCurrent || null,
    inputs: [...document.querySelectorAll('.view-generate [data-focus-key]')].map((el) => el.dataset.focusKey + '=' + el.value),
  };
})()`);

const clickTemplate = (id) => page.click(`.template-card[data-template-id="${id}"]`);
/** 把主题清空（前面用例可能已经填过），用于验证「主题为空时才填入示例」。 */
const clearTopic = () => page.evaluate(`(() => {
  const input = document.querySelector('[data-focus-key="generate-topic"]');
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
/** 安全解析请求体：只为拿断言所需字段，遇到空体不抛错。 */
const bodyOf = (req) => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } };
const callsTo = (suffix) => apiState.requests.filter((r) => String(r.url).includes(suffix) && r.body);

test('模板选择器：五个预设 + 自定义都可见，选择后一键填入可编辑的推荐值，且生成前零请求', async () => {
  await configureProxy();
  await goto('#/generate');
  assert.ok(await page.waitFor('document.querySelector(".template-picker")'), 'AI 建课页应显示模板选择器');

  const ids = await page.evaluate('[...document.querySelectorAll(".template-card")].map((el) => el.dataset.templateId)');
  assert.deepEqual(ids, ['custom', 'starter', 'exam', 'project', 'sprint', 'gap'], '应列出 5 个预设 + 自定义');
  const labels = await page.textOf('.template-grid');
  for (const label of ['零基础入门', '考试复习', '项目实战', '技能速成', '查漏补缺', '自定义']) {
    assert.match(labels, new RegExp(label), `模板应显示「${label}」`);
  }
  assert.match(await page.textOf('.template-picker'), /适合谁/, '应说明每个模板适合谁');
  assert.match(await page.textOf('.template-picker'), /每周 \d+ 小时 · 单次 \d+ 分钟/, '应给出建议的每周/单次时长');

  // 生成前先清空请求记录：选模板、改模板都不允许发任何网络请求
  apiState.requests.length = 0;
  await clearTopic();
  assert.equal((await readDraft()).topic, '', '前置：主题已被清空');
  assert.equal(await clickTemplate('starter'), true, '应能点击「零基础入门」');
  let draft = await readDraft();
  assert.equal(draft.selected, 'starter');
  assert.equal(draft.topic, 'Python 编程入门', '主题为空时应填入该模板的示例主题');
  assert.equal(draft.goal, 'starter');
  assert.equal(draft.level, 'new');
  assert.equal(draft.weeklyHours, '5');
  assert.equal(draft.lessonMinutes, '40');

  assert.equal(await clickTemplate('exam'), true);
  draft = await readDraft();
  assert.equal(draft.selected, 'exam');
  assert.equal(draft.goal, 'exam');
  assert.equal(draft.level, 'some');
  assert.equal(draft.weeklyHours, '8');
  assert.equal(draft.lessonMinutes, '45');
  assert.equal(draft.topic, '概率论与数理统计 期末复习', '主题仍是上一个模板的示例时应换成本模板的示例');

  assert.equal(await clickTemplate('project'), true);
  assert.equal(await clickTemplate('sprint'), true);
  assert.equal(await clickTemplate('gap'), true);
  draft = await readDraft();
  assert.equal(draft.weeklyHours, '4');
  assert.equal(draft.lessonMinutes, '40');

  // 自定义：不再改动任何字段
  assert.equal(await clickTemplate('custom'), true);
  assert.equal((await readDraft()).goal, 'advanced', '自定义模板不应改写已选好的字段');

  assert.equal(apiState.requests.length, 0, `选模板 / 改模板不得发出任何请求，实际 ${apiState.requests.length} 次`);
});

test('模板只做预设：用户已写的主题不会被覆盖，所有字段仍可编辑', async () => {
  await configureProxy();
  await goto('#/generate');
  await fillTopic('我自己的主题：编译器原理');
  apiState.requests.length = 0;
  await clickTemplate('exam');
  let draft = await readDraft();
  assert.equal(draft.topic, '我自己的主题：编译器原理', '不得覆盖用户自己写的主题');
  assert.equal(draft.goal, 'exam');

  // 选完模板后每个字段都还能改（改完不触发任何请求）
  await fillTopic('我自己的主题：编译器原理（改）');
  await page.evaluate(`(() => {
    const goal = document.querySelector('[data-focus-key="generate-goal"]');
    goal.value = 'project';
    goal.dispatchEvent(new Event('change', { bubbles: true }));
    const weekly = document.querySelector('[data-focus-key="generate-weekly"]');
    weekly.value = '12';
    weekly.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  draft = await readDraft();
  assert.equal(draft.topic, '我自己的主题：编译器原理（改）');
  assert.equal(draft.goal, 'project');
  assert.equal(draft.weeklyHours, '12');
  assert.equal(draft.selected, 'exam', '手动改字段不应悄悄清掉已选模板');
  assert.equal(apiState.requests.length, 0, '编辑字段不得发出任何请求');
});

test('模板进入请求：大纲与知识点请求都带 templateId，并展示真实的累计用量', async () => {
  await configureProxy();
  await goto('#/generate');
  await clickTemplate('project');
  apiState.requests.length = 0;
  await page.clickByText('.panel-actions button', '生成完整课程');
  assert.ok(await page.waitFor('document.querySelector(".preview-panel")', { timeoutMs: 45000 }), '应生成成功');

  const outlineReq = callsTo('/api/course/outline')[0];
  const lessonReqs = callsTo('/api/course/lesson');
  assert.ok(outlineReq, '应调用大纲端点');
  assert.ok(lessonReqs.length >= 4, `应为每个知识点各调用一次，实际 ${lessonReqs.length}`);
  assert.equal(bodyOf(outlineReq).templateId, 'project', '大纲请求必须带上模板 id');
  for (const req of lessonReqs) {
    assert.equal(bodyOf(req).templateId, 'project', '知识点请求也必须带上同一个模板 id');
  }
  // 用量汇总要覆盖大纲 + 全部知识点（模拟响应：1 次 460 + N 次 1000 tokens）
  const previewText = await page.textOf('.preview-panel');
  assert.match(previewText, /模型尝试次数：5 次/, '预览必须给出真实的尝试次数（1 次大纲 + 4 次知识点）');
  assert.match(previewText, /累计用量/, '预览必须展示大纲 + 全部知识点的累计用量');
  assert.match(previewText, /4460 tokens/, `累计输出应是全部响应之和，实际文案：${previewText.slice(0, 400)}`);
  assert.match(previewText, /不等于供应商账单的精确金额/, '必须说明这不是精确账单');
  assert.match(previewText, /AI 生成 · 请自行核对/);
});

test('换模板后不会续用旧需求的大纲（模板属于生成身份）', async () => {
  await configureProxy();
  await goto('#/generate');
  await fillTopic('模板隔离测试');
  await clickTemplate('starter');
  apiState.requests.length = 0;
  await page.clickByText('.panel-actions button', '生成完整课程');
  assert.ok(await page.waitFor('document.querySelector(".preview-panel")', { timeoutMs: 45000 }), '应生成成功');
  assert.equal(callsTo('/api/course/outline').length, 1, '第一次生成只应取一次大纲');
  assert.equal(await page.count('.template-card[disabled]'), 0, '生成结束后模板应恢复可切换');

  // 换模板：之前的进度（身份不同）不再适用，重新生成必须重新取大纲（且不得续用旧模板的大纲）
  await clickTemplate('exam');
  assert.equal((await readDraft()).selected, 'exam', '应能切换到「考试复习」');
  const outlineCallsBefore = callsTo('/api/course/outline').length;
  apiState.requests.length = 0;
  await page.clickByText('.panel-actions button', '生成完整课程');
  assert.ok(await page.waitFor('document.querySelector(".preview-panel")', { timeoutMs: 45000 }), '换模板后应重新生成成功');
  const outlineReqs = callsTo('/api/course/outline');
  assert.equal(outlineReqs.length, 1, `换模板必须且只需重新取一次大纲（此前累计 ${outlineCallsBefore} 次）`);
  assert.equal(bodyOf(outlineReqs[0]).templateId, 'exam');
  assert.ok(callsTo('/api/course/lesson').length >= 4, '换模板后应重新生成全部知识点');
});
