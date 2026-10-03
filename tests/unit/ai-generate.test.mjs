/**
 * 分阶段建课状态机的单元测试（不启动浏览器）。
 *
 * 这些断言都对应真实发生过的错误或必须防住的计费风险：
 *  - 续跑身份只看主题 → 换了目标/水平/时长却静默复用旧正文；
 *  - 并发两个知识点时用「队列长度」算完成数 → 进度与完成数算错；
 *  - 重复点击 / 成功后再次点击 → 重复调用（每次调用都可能是已计费的）；
 *  - 失败重试时把已完成的知识点再跑一遍 → 白花钱；
 *  - 畸形大纲或身份不符的知识点被静默拼进课程；
 *  - 用量只取最后一次响应（而不是大纲 + 全部知识点）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runCourseGeneration,
  resumeCourseGeneration,
  buildGenerationIdentity,
  normalizeDraft,
  normalizeOutline,
  normalizeConceptContent,
  mergeUsage,
  summarizeUsage,
  countCompleted,
  planSummary,
  MAX_CONCEPTS,
} from '../../src/core/ai-generate.js';
import { VIDEO_LIBRARY } from '../../src/data/videos.js';
import { makeValidCourse, mutate } from './support/fixture.mjs';

const WORKER = 'https://worker.example';
const OTHER_WORKER = 'https://worker2.example';
const DRAFT = { topic: 'Python 编程', goal: 'starter', level: 'new', weeklyHours: 4, lessonMinutes: 40, templateId: 'custom' };

const course = makeValidCourse({ videoIds: ['bili-py-01', 'bili-py-02'] });
const outlineOf = (source = course) => ({
  ...source,
  concepts: source.concepts.map(({ lesson, keyTerms, exercises, tasks, project, videoIds, quiz, ...meta }) => meta),
});
const contentOf = (concept) => ({
  id: concept.id,
  type: concept.type,
  lesson: concept.lesson,
  keyTerms: concept.keyTerms,
  exercises: concept.exercises,
  quiz: concept.quiz,
  tasks: concept.tasks,
  project: concept.project,
  videoIds: concept.videoIds || [],
});

/** 本地模拟 Worker：按 **路径** 路由（不靠 URL 或提示词里的关键字）。 */
function makeMock({ failOnce = [], outline = outlineOf(), delay = 0, usage = { prompt_tokens: 100, completion_tokens: 200 }, onCall = null, wrongMetaConceptId = null, holdPath = null, hold = null } = {}) {
  const calls = { outline: 0, lessons: [], bodies: [] };
  const failed = new Set();
  const metaReportedWrong = new Set();
  const impl = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    // 请求**到达即记录**（在 hold/onCall 之前）：
    // 「已发出、正在等响应」是本次要观察的状态，若记录放在阻塞之后，
    // 等待条件永远不可能成立，断言就会变成假的。
    calls.bodies.push({ path, body });
    if (path === '/api/course/lesson') calls.lessons.push(body.conceptId);
    if (onCall) await onCall({ path, body, calls });
    if (hold && (holdPath === null || holdPath === path)) await hold;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (path === '/api/course/outline') {
      calls.outline += 1;
      return json({ ok: true, outline, meta: { stage: 'outline', model: 'mock-model', usage } });
    }
    if (path === '/api/course/lesson') {
      const conceptId = body.conceptId;
      if (!failed.has(conceptId) && failOnce.includes(conceptId)) {
        failed.add(conceptId);
        return json({ ok: false, error: 'provider-error', message: '模拟供应商 500' }, 502);
      }
      const source = course.concepts.find((c) => c.id === conceptId);
      if (!source) return json({ ok: false, error: 'bad-request', message: '指定的知识点不在大纲中' }, 400);
      // 正文合法，但 meta.conceptId 谎报成别的知识点：必须视为身份不符（只谎报一次，重试时恢复正常）
      let metaConceptId = conceptId;
      if (wrongMetaConceptId === conceptId && !metaReportedWrong.has(conceptId)) {
        metaReportedWrong.add(conceptId);
        metaConceptId = 'c-not-requested';
      }
      return json({ ok: true, concept: contentOf(source), meta: { stage: 'lesson', conceptId: metaConceptId, model: 'mock-model', usage } });
    }
    return json({ ok: false, error: 'not-found' }, 404);
  };
  return { impl, calls };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const newStore = () => ({ identity: null, genPlan: null });

/** 条件等待：给异步状态机一点时间，避免依赖固定毫秒数造成的抖动。 */
async function waitFor(condition, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待超时：${message}`);
}

async function run(store, mock, draft = DRAFT, workerUrl = WORKER, extra = {}) {
  return runCourseGeneration({
    store,
    workerUrl,
    draft,
    videoLibrary: VIDEO_LIBRARY,
    fetchImpl: mock.impl,
    ...extra,
  });
}

test('完整链路：大纲 1 次 + 每个知识点各 1 次，拼装通过前端二次校验', async () => {
  const store = newStore();
  const mock = makeMock();
  const result = await run(store, mock);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.equal(mock.calls.outline, 1);
  assert.deepEqual([...mock.calls.lessons].sort(), ['c1', 'c2', 'c3', 'c4']);
  assert.equal(result.preview.course.concepts.length, 4);
  assert.ok(result.preview.course.concepts.every((c) => c.quizId), '每个单元都应有测验');
});

test('两个并发调用下完成数仍然正确：只统计已确认返回的知识点', async () => {
  const store = newStore();
  const gate = new Promise((resolve) => setTimeout(resolve, 30));
  const mock = makeMock({ onCall: async ({ path, body }) => { if (path === '/api/course/lesson' && body.conceptId === 'c2') await gate; } });
  const seen = [];
  const result = await run(store, mock, DRAFT, WORKER, { lessonConcurrency: 2, onProgress: (patch) => seen.push(patch.done || 0) });
  assert.equal(result.ok, true);
  for (const done of seen) assert.ok(Number.isInteger(done) && done >= 0 && done <= 4, `完成数必须在 0-4 之间，实际 ${done}`);
  assert.ok(seen.includes(4), '最终进度必须到达 4/4');
  const summary = planSummary(store.genPlan);
  assert.equal(summary.done, 4);
  assert.equal(summary.total, 4);
  assert.equal(store.genPlan.totals.lessonsCompleted, 4);
});

test('同一输入重复点击：不会发出第二份请求（复用已有成功结果）', async () => {
  const store = newStore();
  const mock = makeMock();
  assert.equal((await run(store, mock)).ok, true);
  const before = { outline: mock.calls.outline, lessons: mock.calls.lessons.length };
  const again = await run(store, mock);
  assert.equal(again.ok, true);
  assert.equal(again.reused, true, '第二次必须复用而不是重新生成');
  assert.equal(mock.calls.outline, before.outline, '不得再次请求大纲');
  assert.equal(mock.calls.lessons.length, before.lessons, '不得再次请求任何知识点');
});

test('并发点击同一需求：两次调用只产生一份请求（进行中去重）', async () => {
  const store = newStore();
  const mock = makeMock({ delay: 20 });
  const [a, b] = await Promise.all([run(store, mock), run(store, mock)]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(mock.calls.outline, 1, '并发重复点击不得发出第二份大纲请求');
  assert.equal(mock.calls.lessons.length, 4, '并发重复点击不得重复请求知识点');
  assert.ok(a.reused || b.reused, '其中一次应报告为复用同一份进行中的结果');
});

test('失败后重试：只补未完成的知识点，已完成的绝不再请求', async () => {
  const store = newStore();
  const mock = makeMock({ failOnce: ['c3'] });
  const first = await run(store, mock, DRAFT, WORKER, { lessonConcurrency: 1 });
  assert.equal(first.ok, false);
  assert.equal(first.code, 'provider-error');
  const summary = planSummary(store.genPlan);
  assert.equal(summary.done, 2, '失败前完成的两个知识点应被保留');
  assert.equal(summary.resumable, true);
  assert.deepEqual(mock.calls.lessons, ['c1', 'c2', 'c3'], '第一次请求顺序与内容');

  const second = await resumeCourseGeneration({
    store, workerUrl: WORKER, draft: DRAFT, videoLibrary: VIDEO_LIBRARY, fetchImpl: mock.impl, lessonConcurrency: 1,
  });
  assert.equal(second.ok, true, second.ok ? '' : second.error);
  assert.deepEqual(mock.calls.lessons, ['c1', 'c2', 'c3', 'c3', 'c4'], '重试只应重发失败的知识点 + 未完成的知识点');
  assert.equal(mock.calls.outline, 1, '重试不得重新请求大纲');
});

test('换输入（目标 / 主题 / 时长 / Worker）都必须从头开始，不复用旧正文', async () => {
  const changes = [
    ['goal', { ...DRAFT, goal: 'exam' }],
    ['level', { ...DRAFT, level: 'advanced' }],
    ['weeklyHours', { ...DRAFT, weeklyHours: 10 }],
    ['lessonMinutes', { ...DRAFT, lessonMinutes: 30 }],
    ['topic', { ...DRAFT, topic: '线性代数' }],
  ];
  for (const [field, draft] of changes) {
    const store = newStore();
    const mock = makeMock({ failOnce: ['c3'] });
    const first = await run(store, mock, DRAFT, WORKER, { lessonConcurrency: 1 });
    assert.equal(first.ok, false);
    const lessonsAfterFirst = [...mock.calls.lessons];
    let discarded = null;
    const second = await run(store, mock, draft, WORKER, { lessonConcurrency: 1, onDiscarded: (plan) => { discarded = plan; } });
    assert.equal(second.ok, true, `${field} 改变后应能重新生成`);
    assert.ok(discarded, `${field} 改变时界面应收到「旧进度不再适用」的通知`);
    assert.equal(mock.calls.outline, 2, `${field} 改变后必须重新取大纲`);
    assert.equal(mock.calls.lessons[lessonsAfterFirst.length], 'c1', `${field} 改变后必须从第一个知识点重新生成`);
    assert.equal(mock.calls.lessons.length, lessonsAfterFirst.length + 4, `${field} 改变后必须重新生成全部知识点`);
  }
});

test('换 Worker 地址：旧进度不再续用（身份包含规范化后的 Worker 地址）', async () => {
  const store = newStore();
  const mock = makeMock({ failOnce: ['c2'] });
  await run(store, mock, DRAFT, WORKER, { lessonConcurrency: 1 });
  const second = await run(store, mock, DRAFT, OTHER_WORKER, { lessonConcurrency: 1 });
  assert.equal(second.ok, true);
  assert.equal(mock.calls.outline, 2);
  assert.equal(mock.calls.lessons.length, 2 + 4);
});

test('身份包含全部草稿字段与规范化 Worker 地址（含尾部斜杠与大小写主机名）', () => {
  const base = buildGenerationIdentity(WORKER, DRAFT);
  assert.notEqual(base, buildGenerationIdentity(WORKER, { ...DRAFT, goal: 'exam' }));
  assert.notEqual(base, buildGenerationIdentity(WORKER, { ...DRAFT, level: 'advanced' }));
  assert.notEqual(base, buildGenerationIdentity(WORKER, { ...DRAFT, weeklyHours: 10 }));
  assert.notEqual(base, buildGenerationIdentity(WORKER, { ...DRAFT, lessonMinutes: 30 }));
  assert.notEqual(base, buildGenerationIdentity(WORKER, { ...DRAFT, topic: '线性代数' }));
  assert.notEqual(base, buildGenerationIdentity(OTHER_WORKER, DRAFT));
  assert.notEqual(base, buildGenerationIdentity(WORKER, { ...DRAFT, templateId: 'exam' }));
  assert.equal(base, buildGenerationIdentity('https://worker.example/', { ...DRAFT, weeklyHours: '4' }), '尾部斜杠与字符串数字应归一化');
  assert.equal(buildGenerationIdentity(WORKER, DRAFT), buildGenerationIdentity('https://WORKER.example', DRAFT), '主机名大小写不影响身份');
});

test('畸形大纲被拒绝：不发任何知识点请求，也不保留可续跑进度', async () => {
  const cases = [
    ['不是对象', 'not-an-object'],
    ['缺知识点', { title: '课程标题', subject: '学科', summary: '一段够长的课程简介，用于验证畸形大纲被拒绝后的行为。' }],
    ['知识点缺 id', { title: '课程标题', subject: '学科', summary: '一段够长的课程简介，用于验证畸形大纲被拒绝后的行为。', concepts: [{ title: '知识点' }] }],
    ['重复 id', { ...outlineOf(), concepts: [{ ...outlineOf().concepts[0] }, { ...outlineOf().concepts[0] }] }],
    ['知识点过多', { ...outlineOf(), concepts: Array.from({ length: MAX_CONCEPTS + 1 }, (_, i) => ({ ...outlineOf().concepts[0], id: `x${i}` })) }],
  ];
  for (const [label, outline] of cases) {
    const store = newStore();
    const mock = makeMock({ outline });
    const result = await run(store, mock);
    assert.equal(result.ok, false, `${label} 应被拒绝`);
    assert.equal(result.code, 'invalid-outline', `${label} 应报告 invalid-outline，实际 ${result.code}`);
    assert.equal(mock.calls.lessons.length, 0, `${label} 之后不得发起知识点请求`);
    assert.equal(planSummary(store.genPlan)?.resumable, false, `${label} 之后不应声称可以续跑`);
  }
});

test('返回的知识点身份不符（id 不匹配）时中止，不拼出错误课程', async () => {
  const store = newStore();
  const impl = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    if (path === '/api/course/outline') return json({ ok: true, outline: outlineOf(), meta: { stage: 'outline', usage: { prompt_tokens: 10, completion_tokens: 20 } } });
    const source = course.concepts.find((c) => c.id === body.conceptId);
    // 故意返回另一个知识点的内容
    const wrong = source.id === 'c1' ? course.concepts[1] : source;
    return json({ ok: true, concept: contentOf(wrong), meta: { stage: 'lesson', conceptId: wrong.id } });
  };
  const result = await runCourseGeneration({ store, workerUrl: WORKER, draft: DRAFT, videoLibrary: VIDEO_LIBRARY, fetchImpl: impl, lessonConcurrency: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-concept');
  assert.match(result.error, /不匹配/);
});

test('用量汇总覆盖大纲 + 全部知识点，而不是只取最后一次响应', async () => {
  const store = newStore();
  let n = 0;
  const mock = makeMock({ usage: null });
  const impl = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    n += 1;
    const usage = { prompt_tokens: 100 * n, completion_tokens: 200 * n };
    if (path === '/api/course/outline') return json({ ok: true, outline: outlineOf(), meta: { stage: 'outline', model: 'mock-model', usage } });
    const source = course.concepts.find((c) => c.id === body.conceptId);
    return json({ ok: true, concept: contentOf(source), meta: { stage: 'lesson', conceptId: body.conceptId, usage } });
  };
  const result = await runCourseGeneration({ store, workerUrl: WORKER, draft: DRAFT, videoLibrary: VIDEO_LIBRARY, fetchImpl: impl, lessonConcurrency: 1 });
  assert.equal(result.ok, true);
  // 5 次调用（1 大纲 + 4 知识点），第 n 次的 usage 是 100n/200n
  const expectedPrompt = 100 * (1 + 2 + 3 + 4 + 5);
  const expectedCompletion = 200 * (1 + 2 + 3 + 4 + 5);
  assert.equal(result.usage.prompt_tokens, expectedPrompt, `输入用量应是全部响应之和，实际 ${result.usage.prompt_tokens}`);
  assert.equal(result.usage.completion_tokens, expectedCompletion);
  assert.equal(planSummary(store.genPlan).usage.prompt_tokens, expectedPrompt, '保留的计划里也要有完整汇总');
  const text = summarizeUsage(result.usage, { model: 'mock-model', attempts: 5 }).text;
  assert.match(text, new RegExp(`输入 ${expectedPrompt} tokens`));
  assert.match(text, /不等于供应商账单的精确金额/, '必须说明这不是精确账单');
});

test('失败时也保留已产生的用量汇总（只统计真正拿到用量的响应）', async () => {
  const store = newStore();
  const mock = makeMock({ failOnce: ['c2'], usage: { prompt_tokens: 50, completion_tokens: 80 } });
  const result = await run(store, mock, DRAFT, WORKER, { lessonConcurrency: 1 });
  assert.equal(result.ok, false);
  const summary = planSummary(store.genPlan);
  // 失败的响应没有 usage（真实 Worker 的错误响应也只带 note，不带 usage），
  // 因此汇总只有大纲 + c1 两份；但尝试次数必须把失败那次也数进去。
  assert.equal(summary.usage.prompt_tokens, 50 * 2);
  assert.equal(summary.usage.completion_tokens, 80 * 2);
  assert.equal(summary.attempts, 3, '失败的那次尝试也要计入「已发出的模型尝试」');
});

test('时间预算耗尽后不再发起新的调用（有界重试，不无限烧钱）', async () => {
  const store = newStore();
  const mock = makeMock();
  let clock = 0;
  const result = await runCourseGeneration({
    store,
    workerUrl: WORKER,
    draft: DRAFT,
    videoLibrary: VIDEO_LIBRARY,
    fetchImpl: mock.impl,
    lessonConcurrency: 1,
    now: () => { clock += 10 * 60 * 1000; return clock; },
    budgetMs: 25 * 60 * 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'budget-exhausted');
  assert.ok(mock.calls.lessons.length < 4, `预算内不应把全部知识点都请求完，实际 ${mock.calls.lessons.length}`);
  assert.equal(mock.calls.outline, 1);
});

test('规范化草稿会夹紧数值并把未知模板退化为自定义', () => {
  assert.deepEqual(normalizeDraft({ topic: ' x ', goal: 'exam', level: 'some', weeklyHours: 99, lessonMinutes: 1 }), {
    topic: 'x', goal: 'exam', level: 'some', weeklyHours: 20, lessonMinutes: 15, templateId: 'custom',
  });
  assert.equal(normalizeDraft({ templateId: 'not-a-template' }).templateId, 'custom');
  assert.equal(normalizeDraft({ templateId: { evil: 'x'.repeat(500) } }).templateId, 'custom');
});

test('countCompleted 只统计已确认返回知识点的内容', () => {
  const outline = { concepts: [{ id: 'a' }, { id: 'b' }] };
  assert.equal(countCompleted(outline, {}), 0);
  assert.equal(countCompleted(outline, { a: { id: 'a' } }), 1);
  assert.equal(countCompleted(outline, { a: {}, b: {} }), 2);
});

test('mergeUsage / summarizeUsage 对缺失与非法用量保持安全', () => {
  assert.deepEqual(mergeUsage({ prompt_tokens: 10 }, null), { prompt_tokens: 10 });
  assert.deepEqual(mergeUsage({}, { usage: { prompt_tokens: -5, completion_tokens: 'x' } }), {});
  assert.equal(summarizeUsage({}, { attempts: 0 }), null);
  assert.match(summarizeUsage({ prompt_tokens: 1, completion_tokens: 2 }, { attempts: 1 }).text, /合计 3 tokens/);
});

test('服务端返回缺正文/缺测验的知识点内容会被拒绝', () => {
  const ok = normalizeConceptContent(contentOf(course.concepts[0]), 'c1');
  assert.equal(ok.ok, true);
  assert.equal(normalizeConceptContent(mutate(contentOf(course.concepts[0]), 'quiz', null), 'c1').ok, false);
  assert.equal(normalizeConceptContent(mutate(contentOf(course.concepts[0]), 'lesson', { sections: [] }), 'c1').ok, false);
  assert.equal(normalizeConceptContent(null, 'c1').ok, false);
});

test('normalizeOutline 通过时补齐小写 id，不修改其他字段', () => {
  const raw = { ...outlineOf(), concepts: [{ ...outlineOf().concepts[0], id: 'C1' }] };
  const checked = normalizeOutline(raw);
  assert.equal(checked.ok, true);
  assert.equal(checked.outline.concepts[0].id, 'c1');
});

test('meta.conceptId 谎报时不得被记为已完成：重试会重发它，合法兄弟仍然复用', async () => {
  const store = newStore();
  const mock = makeMock({ wrongMetaConceptId: 'c2' });
  const first = await run(store, mock, DRAFT, WORKER, { lessonConcurrency: 1 });
  assert.equal(first.ok, false);
  assert.equal(first.code, 'invalid-concept');
  assert.match(first.error, /不匹配/);
  const summary = planSummary(store.genPlan);
  assert.equal(store.genPlan.contents.c2, undefined, "谎报 meta 的那个知识点不能被记为已完成");
  assert.equal(summary.done, 1, "只应把真正完成的知识点算进来");

  const second = await resumeCourseGeneration({
    store, workerUrl: WORKER, draft: DRAFT, videoLibrary: VIDEO_LIBRARY, fetchImpl: mock.impl, lessonConcurrency: 1,
  });
  assert.equal(second.ok, true, second.ok ? '' : second.error);
  assert.equal(mock.calls.lessons.filter((id) => id === 'c2').length, 2, '谎报的知识点必须在重试时重新请求');
  assert.equal(mock.calls.lessons.filter((id) => id === 'c1').length, 1, '合法完成的知识点不得重发');
  assert.equal(mock.calls.lessons.filter((id) => id === 'c3').length, 1);
  assert.equal(mock.calls.outline, 1, '重试不得重新请求大纲');
  assert.equal(planSummary(store.genPlan).done, 4);
});

test('两个不同身份并发：串行化，不交叉、不互相覆盖，且都只发自己的一份请求', async () => {
  const store = newStore();
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  const mockA = makeMock({ holdPath: '/api/course/lesson', hold: gateA });
  const mockB = makeMock();
  const draftA = { ...DRAFT, topic: '第一个需求' };
  const draftB = { ...DRAFT, topic: '第二个需求' };

  const pA = run(store, mockA, draftA, WORKER, { lessonConcurrency: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const pB = run(store, mockB, draftB, WORKER, { lessonConcurrency: 1 });
  await waitFor(() => mockA.calls.lessons.length >= 1, 'A 应停在第一个知识点上');
  assert.equal(mockA.calls.outline, 1, 'A 已经取到自己的大纲');
  assert.equal(mockA.calls.lessons.length, 1, 'A 停在第一个知识点上');
  assert.equal(mockB.calls.bodies.length, 0, 'B 在 A 结算前不得发出任何请求');
  releaseA();
  const [resA, resB] = await Promise.all([pA, pB]);
  assert.equal(resA.ok, true, `A 应完成：${resA.error || ''}`);
  assert.equal(resB.ok, true, `B 应完成：${resB.error || ''}`);
  assert.equal(mockA.calls.outline, 1, 'A 只应取一次大纲');
  assert.equal(mockA.calls.lessons.length, 4, 'A 只应请求自己的 4 个知识点');
  assert.ok(mockB.calls.outline <= 1, "B 不会在 A 结算前开始");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(mockB.calls.outline, 1, 'B 随后应自己取一次大纲');
  assert.equal(mockB.calls.lessons.length, 4);
  const final = planSummary(store.genPlan);
  assert.equal(final.done, 4, '最终保留的应是最后那个身份（B）的完整计划');
  assert.equal(JSON.parse(store.genPlan.identity).topic, '第二个需求', '旧身份不得覆盖新计划');
});

test('生成中被丢弃（discard）后：旧运行不得复活进度，也不得提前跳过新运行的请求', async () => {
  const store = newStore();
  let releaseA;
  const gateA = new Promise((resolve) => { releaseA = resolve; });
  let aLessons = 0;
  const progress = [];
  const mockA = makeMock({
    onCall: async ({ path }) => { if (path === '/api/course/lesson') { aLessons += 1; if (aLessons === 1) await gateA; } },
  });
  const mockB = makeMock();
  const draftA = { ...DRAFT, topic: '会被丢弃的需求' };
  const draftB = { ...DRAFT, topic: '丢弃之后的新需求' };

  const pA = run(store, mockA, draftA, WORKER, { lessonConcurrency: 1, onProgress: (p) => progress.push(p) }).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // 用户放弃并重新开始：先丢弃计划，再用新身份生成
  store.genPlan = null;
  const pB = run(store, mockB, draftB, WORKER, { lessonConcurrency: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseA();
  await Promise.all([pA, pB]);

  assert.equal(mockB.calls.outline, 1, '新身份必须自己重新取大纲');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(mockB.calls.lessons.length, 4, '新身份必须完整生成自己的知识点');
  assert.equal(planSummary(store.genPlan).done, 4);
  assert.equal(JSON.parse(store.genPlan.identity).topic, '丢弃之后的新需求', '被丢弃的旧进度绝不能复活');
  assert.ok(progress.some((p) => p.phase === 'stale'), '被丢弃的运行应如实报告进度已失效');
  const staleAfterNewStarted = progress.slice(progress.findIndex((p) => p.phase === 'stale')).some((p) => (p.done || 0) === 4);
  assert.equal(staleAfterNewStarted, false, '旧运行不得在失效后继续宣称完成 4 个知识点');
});