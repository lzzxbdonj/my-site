import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomCourse, selectConcepts, packWeeks, conceptMinutes, defaultPreferences } from '../../src/core/personalize.js';
import { COURSES, COURSE_BY_ID } from '../../src/data/courses.js';
import { buildGraph } from '../../src/core/graph.js';

const la = COURSE_BY_ID.get('linear-algebra');

test('零基础路线会跳过难度 3 的内容，但保留前置闭包', () => {
  const { selectedIds, skipped } = selectConcepts(la, { goal: 'starter', level: 'new' });
  assert.ok(!selectedIds.includes('la-lab'), '难度 3 的实验课不应出现在零基础路线');
  assert.ok(skipped.some((s) => s.id === 'la-lab'), '应记录跳过原因');
  for (const id of selectedIds) {
    const concept = la.concepts.find((c) => c.id === id);
    for (const prereq of concept.prerequisites || []) {
      assert.ok(selectedIds.includes(prereq), `${id} 的前置 ${prereq} 必须一起被选中`);
    }
  }
});

test('零基础 + 考试目标不会安排低权重的高难主题，且理由可解释', () => {
  const { selectedIds, skipped } = selectConcepts(la, { goal: 'exam', level: 'new' });
  assert.ok(selectedIds.includes('la-determinant'), '高频考点必须保留');
  assert.ok(skipped.length > 0, '应至少跳过一项并给出理由');
  assert.ok(skipped.every((s) => s.reason.length > 4), '每条跳过都要有可读理由');
});

test('进阶路线包含全部单元，并把基础内容标为快速复习', () => {
  const plan = buildCustomCourse(la, { goal: 'advanced', level: 'advanced', weeklyHours: 6, lessonMinutes: 45 });
  assert.equal(plan.stats.concepts, la.concepts.length, '进阶路线应包含所有单元');
  const fast = plan.weeks.flatMap((w) => w.items).filter((i) => i.tags.includes('快速复习'));
  assert.ok(fast.length > 0, '难度 1 的内容应被标记为快速复习');
  const basic = plan.weeks.flatMap((w) => w.items).find((i) => i.conceptId === 'la-vectors');
  assert.ok(basic.minutes <= (la.concepts[0].estimatedMinutes * 0.5) + 1, '快速复习应压缩时长');
});

test('周计划遵守前置顺序，且单个知识点不会被拆到两周', () => {
  const plan = buildCustomCourse(la, { goal: 'starter', level: 'some', weeklyHours: 3, lessonMinutes: 30 });
  const order = plan.weeks.flatMap((w) => w.items.map((i) => i.conceptId));
  const positionOf = new Map(order.map((id, index) => [id, index]));
  for (const concept of la.concepts) {
    for (const prereq of concept.prerequisites || []) {
      if (positionOf.has(prereq) && positionOf.has(concept.id)) {
        assert.ok(positionOf.get(prereq) < positionOf.get(concept.id), `${prereq} 应排在 ${concept.id} 之前`);
      }
    }
  }
  const seen = new Set();
  for (const week of plan.weeks) {
    for (const item of week.items) {
      assert.ok(!seen.has(item.conceptId), `${item.conceptId} 出现在了多个周计划里`);
      seen.add(item.conceptId);
    }
  }
});

test('每周内容不超过预算（超出预算的单个知识点独占一周）', () => {
  for (const weeklyHours of [1, 2, 4, 8, 12]) {
    const plan = buildCustomCourse(COURSE_BY_ID.get('machine-learning'), { goal: 'project', level: 'some', weeklyHours, lessonMinutes: 40 });
    const budget = Math.max(40, Math.round(weeklyHours * 60 * 0.9));
    for (const week of plan.weeks) {
      if (week.items.length === 1) continue;
      assert.ok(week.minutes <= budget, `每周 ${week.minutes} 分钟超出预算 ${budget}（weeklyHours=${weeklyHours}）`);
    }
  }
});

test('输出是确定性的（同样输入产生同样计划）', () => {
  const prefs = { goal: 'project', level: 'some', weeklyHours: 5, lessonMinutes: 35 };
  const a = buildCustomCourse(la, prefs, { now: '2026-10-03T00:00:00.000Z' });
  const b = buildCustomCourse(la, prefs, { now: '2026-10-03T00:00:00.000Z' });
  assert.deepEqual(a, b, '相同输入必须产生完全相同的结果');
});

test('三门课程 × 四种目标 × 三种水平都能生成非空且统计自洽的计划', () => {
  for (const course of COURSES) {
    for (const goal of ['starter', 'exam', 'project', 'advanced']) {
      for (const level of ['new', 'some', 'advanced']) {
        const plan = buildCustomCourse(course, { goal, level, weeklyHours: 4, lessonMinutes: 40 });
        assert.ok(plan.weeks.length > 0, `${course.id}/${goal}/${level} 生成了空计划`);
        assert.equal(plan.stats.concepts, plan.weeks.flatMap((w) => w.items).length, '统计的单元数与实际条目数一致');
        assert.equal(plan.stats.weeks, plan.weeks.length);
        assert.ok(plan.stats.minutes > 0);
        assert.ok(plan.rationale.length >= 2, '计划必须给出可解释的理由');
      }
    }
  }
});

test('packWeeks 不丢内容、不产生空周', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ conceptId: `c${i}`, minutes: 45 }));
  const weeks = packWeeks(items, { weeklyHours: 2, lessonMinutes: 30 });
  assert.equal(weeks.flatMap((w) => w.items).length, 9);
  assert.ok(weeks.every((w) => w.items.length > 0));
  assert.deepEqual(weeks.map((w) => w.index), weeks.map((_, i) => i + 1));
});

test('conceptMinutes 依据水平压缩基础内容时长', () => {
  const concept = { estimatedMinutes: 60, difficulty: 1 };
  assert.equal(conceptMinutes(concept, { level: 'new' }), 60);
  assert.equal(conceptMinutes(concept, { level: 'advanced' }), 30);
  assert.equal(conceptMinutes({ estimatedMinutes: 60, difficulty: 3 }, { level: 'advanced' }), 60);
});

test('依赖图对课程数据无成环、无缺失前置', () => {
  for (const course of COURSES) {
    const { cycles, missing } = buildGraph(course.concepts);
    assert.deepEqual(cycles, [], `${course.id} 存在依赖环`);
    assert.deepEqual(missing, [], `${course.id} 存在缺失前置`);
    assert.equal(defaultPreferences().weeklyHours, 4);
  }
});
