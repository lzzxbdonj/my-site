import test from 'node:test';
import assert from 'node:assert/strict';
import { toAppCourse } from '../../src/core/ai-course.js';
import { createEmptyState, normalizeState, exportState, importState, createStore, createMemoryBackend } from '../../src/core/storage.js';
import { registerGeneratedCourses, resetGeneratedCourses, allCourses, getCourse, filterCourses, searchConcepts, listSubjects, resolveCourseVideos } from '../../src/core/catalog.js';
import { buildCustomCourse } from '../../src/core/personalize.js';
import { courseProgress, markLessonCompleted, recordQuizAttempt, conceptStateMap } from '../../src/core/progress.js';
import { CONCEPT_STATES } from '../../src/core/graph.js';
import { VIDEO_LIBRARY } from '../../src/data/videos.js';
import { makeValidCourse } from '../unit/support/fixture.mjs';

const libraryIds = new Set(VIDEO_LIBRARY.map((v) => v.id));
const firstTwo = [...libraryIds].slice(0, 2);

test('生成课程 → 保存 → 进入目录检索 → 定制计划 → 做题 → 导出导入', () => {
  let state = createEmptyState('2026-10-03T00:00:00.000Z');
  const generated = toAppCourse(makeValidCourse({ videoIds: firstTwo }), { videoLibrary: VIDEO_LIBRARY, model: 'mock-model', now: '2026-10-03T00:00:00.000Z' });
  assert.equal(generated.ok, true, generated.ok ? '' : generated.errors.join('；'));
  const course = generated.course;
  state = { ...state, generatedCourses: [course] };

  const store = createStore(createMemoryBackend());
  assert.equal(store.save(state).ok, true);
  state = store.load();
  assert.equal(state.generatedCourses.length, 1, '生成课程应被持久化');

  registerGeneratedCourses(state.generatedCourses);
  try {
    assert.equal(allCourses().length, 4, '目录应包含 3 门内置课程 + 1 门生成课程');
    assert.ok(getCourse(course.id), '按 id 能查到生成课程');
    assert.equal(filterCourses({ query: '测试学科' }).length, 1, '生成课程可被搜索');
    assert.ok(searchConcepts('知识点 2').some((hit) => hit.courseId === course.id), '生成课程的知识点可被检索');
    assert.ok(listSubjects().some((s) => s.id === 'ai-generated'), 'AI 生成课程应有自己的学科分组');
    const videos = resolveCourseVideos(course, state);
    assert.equal(videos.length, firstTwo.length, '生成课程只关联已核实视频库中的条目');
    assert.ok(videos.every((v) => libraryIds.has(v.id)));

    const plan = buildCustomCourse(course, { goal: 'starter', level: 'new', weeklyHours: 3, lessonMinutes: 30 });
    assert.ok(plan.weeks.length >= 1, '生成课程也能生成定制计划');
    assert.ok(plan.stats.videos <= firstTwo.length);

    state = markLessonCompleted(state, course.id, course.concepts[0].id, 40, '2026-10-03T08:00:00.000Z');
    const quizId = course.concepts[0].quizId;
    state = recordQuizAttempt(state, course.id, { quizId, score: 2, total: 2, passed: true, at: '2026-10-03T09:00:00.000Z' });
    const states = conceptStateMap(state, getCourse(course.id));
    assert.equal(states[course.concepts[0].id].state, CONCEPT_STATES.mastered, '生成课程的测验通过后应视为掌握');
    assert.ok(courseProgress(state, getCourse(course.id)).percent > 0);

    const json = exportState(state, { now: '2026-10-04T00:00:00.000Z' });
    const back = importState(json, { now: '2026-10-04T00:00:00.000Z' });
    assert.equal(back.ok, true);
    assert.equal(back.state.generatedCourses.length, 1, '导出导入后生成课程仍在');
    assert.equal(back.state.generatedCourses[0].concepts.length, course.concepts.length);
    assert.equal(back.state.courses[course.id].quizAttempts[0].passed, true, '生成课程的进度也能往返');
  } finally {
    resetGeneratedCourses();
  }
});

test('恶意备份中的生成课程会被清洗或丢弃', () => {
  const good = toAppCourse(makeValidCourse({ videoIds: firstTwo }), { videoLibrary: VIDEO_LIBRARY }).course;
  const evil = JSON.parse(JSON.stringify(good));
  evil.concepts[0].lesson.sections[0].body = ['<script>alert(1)</script> 恶意段落'];
  evil.concepts[0].videoIds = ['javascript:alert(1)', 'invented-id'];
  evil.quizzes = { hacked: { questions: [{ id: 'x', type: 'single', stem: '<b>x</b>', options: [], answer: 99, explanation: '' }] } };
  const state = createEmptyState();
  state.generatedCourses = [evil, { id: 'broken' }, null];
  const normalized = normalizeState(state);
  assert.equal(normalized.generatedCourses.length, 1, '只有结构完整的生成课程被保留');
  const kept = normalized.generatedCourses[0];
  assert.deepEqual(kept.concepts[0].lesson.sections[0].body, [], 'HTML 段落被丢弃');
  assert.ok(!kept.concepts[0].videoIds.includes('javascript:alert(1)'), '带协议的危险 id 必须被丢弃');
  assert.ok(kept.concepts[0].videoIds.includes('invented-id'), '语法合法但未知的 id 会保存在数据里…');
  const resolved = resolveCourseVideos(kept, {});
  assert.ok(resolved.every((v) => libraryIds.has(v.id)), '解析出的视频必须都来自已核实视频库');
  assert.ok(!resolved.some((v) => v.id === 'invented-id' || v.id.startsWith('javascript')), '未知或危险 id 不会解析成视频');
  assert.deepEqual(Object.keys(kept.quizzes), [], '非法测验被丢弃');
  assert.ok(kept.concepts.every((c) => c.quizId === null), '被丢弃的测验不应留下悬空引用');
});
