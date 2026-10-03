/**
 * 定制课程生成：根据「学习目标 / 现有水平 / 每周时间 / 单次专注时长」生成周计划。
 * 纯函数 + 确定性输出，方便单元测试。
 */

import { buildGraph, prerequisiteClosure } from './graph.js';

export const GOALS = [
  { id: 'starter', label: '零基础入门', hint: '先把直觉和最小可用知识搭起来', examBias: 0 },
  { id: 'exam', label: '应对考试', hint: '优先高频考点与计算类内容', examBias: 1 },
  { id: 'project', label: '做项目 / 实战', hint: '优先动手实践与实验室项目', examBias: 0 },
  { id: 'advanced', label: '进阶补强', hint: '保留全部内容并补充进阶主题', examBias: 0 },
];

export const LEVELS = [
  { id: 'new', label: '完全零基础', hint: '从最基础的概念开始', maxDifficulty: 2 },
  { id: 'some', label: '学过一点', hint: '跳过最简单的重复内容', maxDifficulty: 3 },
  { id: 'advanced', label: '已经学过一遍', hint: '基础内容作为快速复习', maxDifficulty: 3 },
];

export function goalLabel(id) {
  return GOALS.find((g) => g.id === id)?.label || '零基础入门';
}

export function levelLabel(id) {
  return LEVELS.find((l) => l.id === id)?.label || '完全零基础';
}

export function defaultPreferences() {
  return { goal: GOALS[0].id, level: LEVELS[0].id, weeklyHours: 4, lessonMinutes: 40 };
}

/** 单个概念的预计学习分钟数。 */
export function conceptMinutes(concept, { level = 'new' } = {}) {
  const base = Number(concept.estimatedMinutes) || 40;
  if (level === 'advanced' && (concept.difficulty || 1) <= 1) return Math.max(15, Math.round(base * 0.5));
  return base;
}

/**
 * 选择要学的概念（含前置补齐）。
 * @returns {{selectedIds: string[], skipped: Array<{id: string, title: string, reason: string}>, fastTrack: string[]}}
 */
export function selectConcepts(course, prefs = {}) {
  const { goal = 'starter', level = 'new' } = prefs;
  const concepts = course.concepts || [];
  const { byId } = buildGraph(concepts);
  const skipped = [];
  const selected = new Set();
  const fastTrack = [];

  for (const concept of concepts) {
    const difficulty = Number(concept.difficulty) || 1;
    const examWeight = Number(concept.examWeight) || 2;
    if (level === 'new' && difficulty > 2) {
      skipped.push({ id: concept.id, title: concept.title, reason: '难度较高：零基础路线暂不安排，可在课程页单独解锁' });
      continue;
    }
    if (level === 'some' && difficulty <= 1) {
      // 有一点基础的人仍然需要拿测验证明自己，但压缩时间
      fastTrack.push(concept.id);
    }
    if (goal === 'exam' && examWeight <= 1 && difficulty >= 3 && level !== 'advanced') {
      skipped.push({ id: concept.id, title: concept.title, reason: '考试路线优先高频考点：该主题权重较低，作为选修保留' });
      continue;
    }
    selected.add(concept.id);
  }

  // 前置补齐：被跳过的概念如果成了已选内容的前置，必须拉回来
  const required = prerequisiteClosure([...selected], byId);
  const rescued = [];
  for (const id of required) {
    if (selected.has(id)) continue;
    const concept = byId.get(id);
    if (!concept) continue;
    selected.add(id);
    rescued.push({ id, title: concept.title, reason: `作为已选内容的前置知识自动加入（${reasonOf(concept, level)}）` });
  }
  const filteredSkipped = skipped.filter((s) => !selected.has(s.id));
  return { selectedIds: concepts.filter((c) => selected.has(c.id)).map((c) => c.id), skipped: filteredSkipped, rescued, fastTrack };
}

function reasonOf(concept, level) {
  const difficulty = Number(concept.difficulty) || 1;
  if (level === 'new') return difficulty > 2 ? '原本因难度跳过' : '原本未选中';
  return '原本未选中';
}

/** 按每周时间预算把概念打包装进周计划（保持拓扑顺序，不拆分单个概念）。 */
export function packWeeks(items, { weeklyHours = 4, lessonMinutes = 40 } = {}) {
  const weeklyBudget = Math.max(lessonMinutes, Math.round((Number(weeklyHours) || 4) * 60 * 0.9));
  const weeks = [];
  let current = { index: 1, items: [], minutes: 0 };
  for (const item of items) {
    const minutes = Math.max(5, Math.round(item.minutes));
    if (current.items.length > 0 && current.minutes + minutes > weeklyBudget) {
      weeks.push(current);
      current = { index: weeks.length + 1, items: [], minutes: 0 };
    }
    current.items.push({ ...item, minutes });
    current.minutes += minutes;
  }
  if (current.items.length > 0) weeks.push(current);
  return weeks;
}

/**
 * 生成定制课程计划。
 * @param {object} course 课程数据
 * @param {{goal?: string, level?: string, weeklyHours?: number, lessonMinutes?: number}} prefs
 */
export function buildCustomCourse(course, prefs = {}, { now = new Date().toISOString() } = {}) {
  const merged = { ...defaultPreferences(), ...prefs };
  const { selectedIds, skipped, rescued, fastTrack } = selectConcepts(course, merged);
  const { byId, order } = buildGraph(course.concepts || []);
  const orderedIds = order.filter((id) => selectedIds.includes(id));
  const goal = merged.goal;
  const items = orderedIds.map((id) => {
    const concept = byId.get(id);
    const minutes = conceptMinutes(concept, { level: merged.level });
    const tags = [];
    if (fastTrack.includes(id) || (merged.level === 'advanced' && (concept.difficulty || 1) <= 1)) tags.push('快速复习');
    if (goal === 'project' && (concept.type === 'practical' || concept.type === 'lab')) tags.push('项目优先');
    if (goal === 'exam' && (Number(concept.examWeight) || 0) >= 3) tags.push('高频考点');
    return {
      conceptId: id,
      title: concept.title,
      type: concept.type || 'concept',
      difficulty: Number(concept.difficulty) || 1,
      minutes,
      videoIds: concept.videoIds || [],
      quizId: concept.quizId || null,
      tags,
    };
  });

  // 项目目标：把实践/实验内容在周内提前（同级内稳定排序，不破坏前置顺序）
  const ordered = goal === 'project'
    ? stablyPrioritizePractical(items, byId)
    : items;

  const weeks = packWeeks(ordered, merged).map((week) => ({
    ...week,
    focus: week.items.map((i) => i.title).slice(0, 3).join(' / '),
    theme: weekTheme(week.items),
  }));

  const totalMinutes = ordered.reduce((sum, i) => sum + i.minutes, 0);
  const videoCount = new Set(ordered.flatMap((i) => i.videoIds)).size;
  const practicalCount = ordered.filter((i) => i.type === 'practical' || i.type === 'lab').length;

  return {
    courseId: course.id,
    courseTitle: course.title,
    generatedAt: now,
    prefs: merged,
    weeks,
    skipped,
    rescued,
    stats: {
      weeks: weeks.length,
      concepts: ordered.length,
      practical: practicalCount,
      minutes: totalMinutes,
      hours: Math.round((totalMinutes / 60) * 10) / 10,
      videos: videoCount,
      quizzes: ordered.filter((i) => i.quizId).length,
      weeklyBudgetMinutes: Math.max(merged.lessonMinutes, Math.round(merged.weeklyHours * 60 * 0.9)),
    },
    rationale: buildRationale(course, merged, { weeks, skipped, rescued, ordered }),
  };
}

function stablyPrioritizePractical(items, byId) {
  const practical = items.filter((i) => i.type === 'practical' || i.type === 'lab');
  const rest = items.filter((i) => i.type !== 'practical' && i.type !== 'lab');
  // 只在同一「依赖层级」内部提前，避免破坏前置关系
  const depthOf = (id) => {
    let depth = 0;
    let cursor = byId.get(id);
    const seen = new Set();
    while (cursor && (cursor.prerequisites || []).length > 0 && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      depth += 1;
      cursor = byId.get(cursor.prerequisites[0]);
    }
    return depth;
  };
  const merged = [...items].sort((a, b) => {
    const da = depthOf(a.conceptId);
    const db = depthOf(b.conceptId);
    if (da !== db) return da - db;
    const pa = practical.includes(a) ? 0 : 1;
    const pb = practical.includes(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return items.indexOf(a) - items.indexOf(b);
  });
  return merged.length === rest.length + practical.length ? merged : items;
}

function weekTheme(items) {
  const hasLab = items.some((i) => i.type === 'lab');
  const hasPractice = items.some((i) => i.type === 'practical');
  if (hasLab) return '综合实验';
  if (hasPractice) return '动手实践';
  if (items.every((i) => Number(i.difficulty) <= 1)) return '打基础';
  return '概念推进';
}

function buildRationale(course, prefs, { weeks, skipped, rescued, ordered }) {
  const lines = [];
  lines.push(`目标「${goalLabel(prefs.goal)}」× 水平「${levelLabel(prefs.level)}」：${weeks.length} 周、${ordered.length} 个学习单元，预计 ${Math.round(ordered.reduce((s, i) => s + i.minutes, 0) / 60 * 10) / 10} 小时。`);
  lines.push(`每周预算按 ${prefs.weeklyHours} 小时的 90% 计算（留出复习与补课余量），单个知识点不会被拆到两周。`);
  if (prefs.level === 'advanced') lines.push('标记为基础的内容按 50% 时长作为快速复习，避免重复消耗时间。');
  if (prefs.level === 'some') lines.push('最简单的概念被标记为「快速复习」，用测验确认掌握即可跳过讲解。');
  if (rescued.length > 0) lines.push(`为保证依赖顺序，自动补入 ${rescued.length} 个前置知识点：${rescued.map((r) => r.title).join('、')}。`);
  if (skipped.length > 0) lines.push(`按当前目标跳过 ${skipped.length} 个主题，随时可以在课程地图里单独解锁。`);
  if (prefs.goal === 'project') lines.push('项目目标下，同一依赖层级中的实践与实验室内容会被提前安排。');
  if (prefs.goal === 'exam') lines.push('考试目标下优先安排高频考点（examWeight ≥ 3），并在每周保留测验时间。');
  return lines;
}

