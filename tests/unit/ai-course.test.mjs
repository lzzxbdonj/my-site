import test from 'node:test';
import assert from 'node:assert/strict';
import { toAppCourse, slugify } from '../../src/core/ai-course.js';
import { normalizeWorkerUrl, buildGeneratePayload, toVideoLibraryPayload, generateCourseViaWorker } from '../../src/core/ai-client.js';
import { normalizeGeneratedCourse } from '../../src/core/storage.js';
import { makeValidCourse, mutate } from './support/fixture.mjs';
import { VIDEO_LIBRARY } from '../../src/data/videos.js';

const library = [
  { id: 'bili-py-01', title: '安装 Python 解释器', creator: '尚硅谷' },
  { id: 'bili-py-02', title: '变量', creator: '尚硅谷' },
];

test('合法生成结果可转换为应用内课程（含测验、视频与动手单元）', () => {
  const result = toAppCourse(makeValidCourse({ videoIds: ['bili-py-01', 'bili-py-02'] }), { videoLibrary: library, model: 'mock' });
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('；'));
  const course = result.course;
  assert.match(course.id, /^gen-/);
  assert.equal(course.concepts.length, 4);
  assert.equal(Object.keys(course.quizzes).length, 4, '每个单元都应有测验');
  assert.equal(course.source, 'ai');
  assert.match(course.aiMeta.disclaimer, /自行核对/);
  assert.equal(course.concepts[0].videoIds.length, 1);
  assert.ok(course.concepts[3].tasks.length >= 3, '动手单元的任务应保留');
  assert.ok(course.concepts.every((c) => c.quizId), '测验 id 应绑定到单元');
});

test('未在视频库中的 id 会被丢弃并给出警告（不编造链接）', () => {
  const result = toAppCourse(mutate(makeValidCourse({ videoIds: ['bili-py-01'] }), 'concepts.0.videoIds', ['bili-py-01', 'invented-id']), { videoLibrary: library });
  assert.equal(result.ok, true);
  assert.deepEqual(result.course.concepts[0].videoIds, ['bili-py-01']);
  assert.ok(result.warnings.some((w) => w.includes('invented-id')), '应提示丢弃了未知视频 id');
});

test('前端二次校验拦下 HTML、链接、缺测验与依赖环', () => {
  const cases = [
    ['concepts.0.lesson.sections.0.body.0', '<b>带标签的正文</b> 内容长度足够但不应该通过前端校验。'],
    ['concepts.0.summary', '概述里带 https://evil.example.com 链接，长度足够但不应通过。'],
    ['concepts.0.quiz', null],
    ['concepts.0.prerequisites', ['c3']],
  ];
  for (const [path, value] of cases) {
    const result = toAppCourse(mutate(makeValidCourse(), path, value), { videoLibrary: library });
    assert.equal(result.ok, false, `${path} 应被拒绝`);
    assert.ok(result.errors.length >= 1);
  }
});

test('规格外的字段被忽略，缺失的关键信息会明确报错', () => {
  const result = toAppCourse({ title: 'x' }, { videoLibrary: library });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('知识点数量')), '应指出知识点数量问题');
});

test('单字术语（「键」「值」）合法：前端二次校验不再拒绝，空串与超长仍然剔除', () => {
  const oneChar = mutate(makeValidCourse(), 'concepts.0.keyTerms', [
    { term: '键', definition: '字典里用来索引值的那个名字。' },
    { term: '值', definition: '键所对应的内容，可以是任意类型。' },
  ]);
  const result = toAppCourse(oneChar, { videoLibrary: library });
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('；'));
  assert.deepEqual(result.course.concepts[0].keyTerms.map((t) => t.term), ['键', '值']);

  const messy = mutate(makeValidCourse(), 'concepts.0.keyTerms', [
    { term: '', definition: '空术语必须被剔除。' },
    { term: '   ', definition: '只有空白的术语也必须被剔除。' },
    { term: 'x'.repeat(60), definition: '超长术语需要被截断到 40 字以内。' },
    { term: '键', definition: '合法单字术语应当保留。' },
  ]);
  const cleaned = toAppCourse(messy, { videoLibrary: library });
  assert.equal(cleaned.ok, true);
  const terms = cleaned.course.concepts[0].keyTerms;
  assert.deepEqual(terms.map((t) => t.term), ['x'.repeat(40), '键'], '空串与空白应被剔除，超长应被截断');
  assert.equal(terms[0].term.length, 40);
});

test('slugify 与课程 id 稳定可复现', () => {
  assert.equal(slugify('Python 编程'), 'python-编程');
  const a = toAppCourse(makeValidCourse(), { videoLibrary: library, now: '2026-01-01T00:00:00.000Z' });
  const b = toAppCourse(makeValidCourse(), { videoLibrary: library, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(a.course.id, b.course.id, '相同输入与时间应得到相同 id');
});

test('Worker 地址校验：只接受 https（本机允许 http）并拒绝凭据', () => {
  assert.equal(normalizeWorkerUrl('https://studymate.example.workers.dev').ok, true);
  assert.equal(normalizeWorkerUrl('https://x.workers.dev/').base, 'https://x.workers.dev');
  assert.equal(normalizeWorkerUrl('http://127.0.0.1:8787').ok, true, '本机调试允许 http');
  assert.equal(normalizeWorkerUrl('http://evil.example.com').ok, false);
  assert.equal(normalizeWorkerUrl('https://user:pass@x.workers.dev').ok, false);
  assert.equal(normalizeWorkerUrl('not a url').ok, false);
  assert.equal(normalizeWorkerUrl('').ok, false);
});

test('发送给 Worker 的视频库元数据只含必要字段', () => {
  const payload = buildGeneratePayload({ topic: 'Python', goal: 'starter', level: 'new', weeklyHours: 4, lessonMinutes: 40, videoLibrary: VIDEO_LIBRARY });
  assert.equal(payload.topic, 'Python');
  assert.ok(payload.videoLibrary.length > 0 && payload.videoLibrary.length <= 60);
  for (const item of payload.videoLibrary) {
    assert.deepEqual(Object.keys(item).sort(), ['creator', 'id', 'knowledgePoints', 'subjectId', 'title'].sort());
  }
  const trimmed = toVideoLibraryPayload(VIDEO_LIBRARY, { limit: 3 });
  assert.equal(trimmed.length, 3);
});

test('代理调用：成功、服务端错误、超时与非法地址都有确定返回', async () => {
  const okFetch = async () => new Response(JSON.stringify({ ok: true, course: makeValidCourse(), meta: { model: 'mock' } }), { status: 200 });
  const ok = await generateCourseViaWorker({ workerUrl: 'https://w.example', payload: {}, fetchImpl: okFetch });
  assert.equal(ok.ok, true);
  assert.equal(ok.meta.model, 'mock');

  const badFetch = async () => new Response(JSON.stringify({ ok: false, error: 'visitor-quota-exceeded', message: '额度已用完' }), { status: 429 });
  const bad = await generateCourseViaWorker({ workerUrl: 'https://w.example', payload: {}, fetchImpl: badFetch });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'visitor-quota-exceeded');
  assert.match(bad.error, /额度/);

  const notJson = async () => new Response('<html>oops</html>', { status: 200 });
  const parsed = await generateCourseViaWorker({ workerUrl: 'https://w.example', payload: {}, fetchImpl: notJson });
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /JSON/);

  const throwAbort = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  const timeout = await generateCourseViaWorker({ workerUrl: 'https://w.example', payload: {}, fetchImpl: throwAbort });
  assert.equal(timeout.code, 'timeout');

  const badUrl = await generateCourseViaWorker({ workerUrl: 'http://evil.example.com', payload: {}, fetchImpl: okFetch });
  assert.equal(badUrl.code, 'bad-worker-url');

  const networkError = await generateCourseViaWorker({ workerUrl: 'https://w.example', payload: {}, fetchImpl: async () => { throw new Error('boom'); } });
  assert.equal(networkError.code, 'network-error');
});

test('持久化清洗：非法生成课程被丢弃，合法课程可完整往返', () => {
  const good = toAppCourse(makeValidCourse({ videoIds: ['bili-py-01'] }), { videoLibrary: library }).course;
  const kept = normalizeGeneratedCourse(good, '2026-10-03T00:00:00.000Z');
  assert.ok(kept, '合法课程应被保留');
  assert.equal(kept.concepts.length, 4);
  assert.equal(kept.source, 'ai');
  assert.ok(Object.keys(kept.quizzes).length >= 4);

  const injected = JSON.parse(JSON.stringify(good));
  injected.concepts[0].lesson.sections[0].body[0] = '<img src=x onerror=alert(1)> 恶意正文';
  const cleaned = normalizeGeneratedCourse(injected, '2026-10-03T00:00:00.000Z');
  assert.equal(cleaned.concepts[0].lesson.sections[0].body.length, 0, '带 HTML 的段落应被丢弃');

  assert.equal(normalizeGeneratedCourse({ id: 'x' }, '2026-10-03'), null, '结构不足应整份丢弃');
  assert.equal(normalizeGeneratedCourse(null, '2026-10-03'), null);
});
