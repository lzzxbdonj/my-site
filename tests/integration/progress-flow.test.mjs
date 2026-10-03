import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryBackend,
  createStore,
  createEmptyState,
  exportState,
  importState,
} from '../../src/core/storage.js';
import * as progress from '../../src/core/progress.js';
import { COURSE_BY_ID, COURSES } from '../../src/data/courses.js';
import { CONCEPT_STATES, conceptStates, recommendNext } from '../../src/core/graph.js';

const la = COURSE_BY_ID.get('linear-algebra');
const at = (iso) => new Date(iso).toISOString();

test('完整学习流程：打开 → 完成 → 测验通过 → 解锁下一层 → 持久化', () => {
  let state = createEmptyState(at('2026-10-01T08:00:00.000Z'));
  state = progress.markLessonOpened(state, la.id, 'la-vectors', at('2026-10-01T08:00:00.000Z'));
  assert.equal(state.courses[la.id].lessons['la-vectors'].status, 'in-progress');

  state = progress.markLessonCompleted(state, la.id, 'la-vectors', 40, at('2026-10-01T08:40:00.000Z'));
  assert.equal(state.courses[la.id].lessons['la-vectors'].status, 'completed');
  assert.equal(state.stats.totalMinutes, 40);

  let states = progress.conceptStateMap(state, la);
  assert.equal(states['la-vectors'].state, CONCEPT_STATES.inProgress, '有随堂测验的概念：只标记完成还不算掌握');
  assert.equal(states['la-span'].state, CONCEPT_STATES.locked, '前置未通过测验时下一层仍锁定');
  assert.deepEqual(states['la-span'].blockedBy, ['la-vectors']);

  state = progress.recordQuizAttempt(state, la.id, { quizId: 'quiz-la-vectors', score: 2, total: 3, passed: true, at: at('2026-10-01T09:00:00.000Z') });
  assert.equal(progress.isConceptMastered(state, la, 'la-vectors'), true, '测验通过即视为掌握');
  states = progress.conceptStateMap(state, la);
  assert.equal(states['la-span'].state, CONCEPT_STATES.available, '前置掌握后第二层解锁');
  assert.equal(states['la-matrices'].state, CONCEPT_STATES.locked, '第三层仍被前置锁住');
  assert.deepEqual(states['la-matrices'].blockedBy, ['la-span']);

  state = progress.recordQuizAttempt(state, la.id, { quizId: 'quiz-la-span', score: 3, total: 3, passed: true, at: at('2026-10-02T09:00:00.000Z') });
  states = progress.conceptStateMap(state, la);
  assert.equal(states['la-matrices'].state, CONCEPT_STATES.available);

  const next = progress.nextConcepts(state, la, 2).map((c) => c.id);
  assert.ok(next.includes('la-matrices'), '推荐应包含刚解锁的概念');

  const backend = createMemoryBackend();
  const store = createStore(backend);
  assert.equal(store.save(state).ok, true);
  const reloaded = store.load();
  assert.equal(reloaded.courses[la.id].lessons['la-vectors'].status, 'completed');
  assert.equal(reloaded.courses[la.id].quizAttempts.length, 2);
});

test('重复完成同一课时不会重复累计学习时长（撤销后再完成也一样）', () => {
  let state = createEmptyState(at('2026-10-01T08:00:00.000Z'));
  state = progress.markLessonCompleted(state, la.id, 'la-vectors', 40, at('2026-10-01T08:40:00.000Z'));
  state = progress.markLessonCompleted(state, la.id, 'la-vectors', 40, at('2026-10-01T09:00:00.000Z'));
  assert.equal(state.stats.totalMinutes, 40, '重复点击完成不应翻倍计时');
  assert.equal(state.courses[la.id].lessons['la-vectors'].minutes, 40);
  assert.equal(state.courses[la.id].lessons['la-vectors'].completedAt, at('2026-10-01T08:40:00.000Z'), '重复完成不应改写首次完成时间');

  state = progress.markLessonUncompleted(state, la.id, 'la-vectors');
  assert.equal(state.courses[la.id].lessons['la-vectors'].status, 'in-progress');
  state = progress.markLessonCompleted(state, la.id, 'la-vectors', 40, at('2026-10-03T08:00:00.000Z'));
  assert.equal(state.stats.totalMinutes, 40, '撤销后重新完成也不应制造额外学习时间');
});

test('笔记、收藏与任务勾选都能保存并恢复', () => {
  let state = createEmptyState();
  state = progress.addNote(state, la.id, 'la-vectors', '向量 = 方向 + 长度', at('2026-10-01T10:00:00.000Z'));
  assert.equal(progress.addNote(state, la.id, 'la-vectors', '   ', at('2026-10-01T10:01:00.000Z')), state, '空白笔记应被忽略');
  state = progress.toggleBookmark(state, la.id, 'la-vectors');
  state = progress.toggleTask(state, la.id, 'la-lab', 0);
  state = progress.toggleTask(state, la.id, 'la-lab', 2);
  state = progress.toggleTask(state, la.id, 'la-lab', 2);
  const course = state.courses[la.id];
  assert.equal(course.notes['la-vectors'].length, 1);
  assert.deepEqual(course.bookmarks, ['la-vectors']);
  assert.deepEqual(course.lessons['la-lab'].tasks, { 0: true });
  const noteId = course.notes['la-vectors'][0].id;
  state = progress.removeNote(state, la.id, 'la-vectors', noteId);
  assert.equal(state.courses[la.id].notes['la-vectors'].length, 0);
});

test('学习统计：连续天数、活跃天数与复习队列', () => {
  let state = createEmptyState();
  state = progress.markLessonCompleted(state, la.id, 'la-vectors', 40, at('2026-10-01T08:00:00.000Z'));
  state = progress.recordQuizAttempt(state, la.id, { quizId: 'quiz-la-vectors', score: 3, total: 3, passed: true, at: at('2026-10-01T09:00:00.000Z') });
  const stats = progress.studyStats(state, COURSES, new Date('2026-10-01T12:00:00.000Z').getTime());
  assert.equal(stats.streak, 1);
  assert.equal(stats.activeThisWeek, 1);
  assert.equal(stats.masteredTotal, 1);
  assert.equal(stats.totalMinutes, 40);

  const later = progress.studyStats(state, COURSES, new Date('2026-10-20T12:00:00.000Z').getTime());
  assert.equal(later.streak, 0, '超过一天没有记录时连续天数归零');
  assert.ok(later.reviewQueue.some((item) => item.conceptId === 'la-vectors'), '完成超过 7 天应进入复习队列');
});

test('跨课程进度互不影响，且导入导出后保持一致', () => {
  let state = createEmptyState();
  const py = COURSE_BY_ID.get('python');
  state = progress.markLessonCompleted(state, la.id, 'la-vectors', 40, at('2026-10-01T08:00:00.000Z'));
  state = progress.recordQuizAttempt(state, la.id, { quizId: 'quiz-la-vectors', score: 3, total: 3, passed: true, at: at('2026-10-01T08:30:00.000Z') });
  state = progress.markLessonCompleted(state, py.id, 'py-setup', 40, at('2026-10-01T09:00:00.000Z'));
  state = progress.recordQuizAttempt(state, py.id, { quizId: 'quiz-py-setup', score: 3, total: 3, passed: true, at: at('2026-10-01T09:30:00.000Z') });
  const laProgress = progress.courseProgress(state, la);
  const pyProgress = progress.courseProgress(state, py);
  assert.equal(laProgress.mastered, 1);
  assert.equal(pyProgress.mastered, 1);
  assert.ok(laProgress.percent > 0 && pyProgress.percent > 0);

  const json = exportState(state, { now: at('2026-10-02T00:00:00.000Z') });
  const back = importState(json, { now: at('2026-10-02T00:00:00.000Z') });
  assert.equal(back.ok, true);
  assert.equal(progress.courseProgress(back.state, la).mastered, 1);
  assert.equal(progress.courseProgress(back.state, py).mastered, 1);
  assert.equal(progress.conceptStateMap(back.state, py)['py-setup'].state, CONCEPT_STATES.mastered);
});

test('自定义计划保存后可在状态中恢复，删除后清空', () => {
  let state = createEmptyState();
  const plan = { courseId: la.id, courseTitle: la.title, weeks: [{ index: 1, items: [{ conceptId: 'la-vectors', title: '向量', type: 'concept', minutes: 40 }] }], prefs: { goal: 'starter', level: 'new', weeklyHours: 4, lessonMinutes: 40 }, stats: { weeks: 1 } };
  state = progress.setCustomPlan(state, la.id, plan);
  assert.equal(state.courses[la.id].customPlan.weeks.length, 1);
  state = progress.setCustomPlan(state, la.id, null);
  assert.equal(state.courses[la.id].customPlan, null);
});

test('概念状态计算不会因为单层依赖被误判', () => {
  const concepts = [{ id: 'a' }, { id: 'b', prerequisites: ['a'] }, { id: 'c', prerequisites: ['b'] }];
  const states = conceptStates(concepts, { a: { mastered: true }, b: { started: true } });
  assert.equal(states.b.state, CONCEPT_STATES.inProgress);
  assert.equal(states.c.state, CONCEPT_STATES.locked);
  assert.deepEqual(recommendNext(concepts, { a: { mastered: true }, b: { started: true } }).map((c) => c.id), ['b']);
});


