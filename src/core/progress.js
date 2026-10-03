/** 学习进度模型：所有函数都返回新状态（不可变），便于测试与撤销。 */

import { conceptStates, recommendNext, CONCEPT_STATES } from './graph.js';
import { todayKey } from './format.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function courseState(state, courseId) {
  return state.courses[courseId] || { customPlan: null, customVideos: [], lessons: {}, quizAttempts: [], notes: {}, videos: {}, bookmarks: [] };
}

function withCourse(state, courseId, next) {
  return {
    ...state,
    courses: { ...state.courses, [courseId]: next },
    meta: { ...state.meta, updatedAt: new Date().toISOString() },
  };
}

/** 记录某天有学习行为（用于连续天数统计）。 */
function touchDay(state, stamp = new Date().toISOString()) {
  const day = /^\d{4}-\d{2}-\d{2}/.test(String(stamp)) ? String(stamp).slice(0, 10) : todayKey();
  const days = state.stats?.studyDays || [];
  if (days.includes(day)) return state;
  return { ...state, stats: { ...(state.stats || {}), studyDays: [...days, day].sort().slice(-400) } };
}

export function markLessonOpened(state, courseId, conceptId, now = new Date().toISOString()) {
  const cs = courseState(state, courseId);
  const current = cs.lessons[conceptId] || { status: 'not-started', openedAt: null, completedAt: null, minutes: 0 };
  const lessons = {
    ...cs.lessons,
    [conceptId]: { ...current, status: current.status === 'completed' ? 'completed' : 'in-progress', openedAt: now },
  };
  return touchDay(withCourse(state, courseId, { ...cs, lessons }), now);
}

export function markLessonCompleted(state, courseId, conceptId, minutes = 0, now = new Date().toISOString()) {
  const cs = courseState(state, courseId);
  const current = cs.lessons[conceptId] || { status: 'not-started', openedAt: now, completedAt: null, minutes: 0 };
  const alreadyCompleted = current.status === 'completed';
  // 幂等：重复完成不重复计时长（撤销后重新完成也不会凭空制造学习时间）
  const addMinutes = alreadyCompleted || current.minutes > 0 ? 0 : Math.max(0, Math.round(Number(minutes) || 0));
  const lessons = {
    ...cs.lessons,
    [conceptId]: {
      ...current,
      status: 'completed',
      completedAt: alreadyCompleted ? current.completedAt : now,
      minutes: current.minutes + addMinutes,
    },
  };
  const next = withCourse(state, courseId, { ...cs, lessons });
  return touchDay({
    ...next,
    stats: { ...(next.stats || { studyDays: [] }), totalMinutes: (next.stats?.totalMinutes || 0) + addMinutes },
  }, now);
}

export function markLessonUncompleted(state, courseId, conceptId) {
  const cs = courseState(state, courseId);
  const current = cs.lessons[conceptId];
  if (!current) return state;
  return withCourse(state, courseId, {
    ...cs,
    lessons: { ...cs.lessons, [conceptId]: { ...current, status: 'in-progress', completedAt: null } },
  });
}

/** 勾选/取消实战或实验任务清单中的一项。 */
export function toggleTask(state, courseId, conceptId, index, now = new Date().toISOString()) {
  const cs = courseState(state, courseId);
  const current = cs.lessons[conceptId] || { status: 'not-started', openedAt: now, completedAt: null, minutes: 0, tasks: {} };
  const key = String(index);
  const tasks = { ...(current.tasks || {}) };
  if (tasks[key]) delete tasks[key];
  else tasks[key] = true;
  const lessons = { ...cs.lessons, [conceptId]: { ...current, tasks, status: current.status === 'completed' ? 'completed' : 'in-progress', openedAt: current.openedAt || now } };
  return touchDay(withCourse(state, courseId, { ...cs, lessons }), now);
}

export function recordQuizAttempt(state, courseId, attempt, now = new Date().toISOString()) {
  const cs = courseState(state, courseId);
  const entry = {
    quizId: String(attempt.quizId),
    score: Math.max(0, Math.round(Number(attempt.score) || 0)),
    total: Math.max(0, Math.round(Number(attempt.total) || 0)),
    passed: attempt.passed === true,
    at: attempt.at || now,
  };
  return touchDay(withCourse(state, courseId, { ...cs, quizAttempts: [...cs.quizAttempts, entry].slice(-50) }), entry.at);
}

export function setCustomPlan(state, courseId, plan) {
  const cs = courseState(state, courseId);
  return withCourse(state, courseId, { ...cs, customPlan: plan });
}

export function addCustomVideo(state, courseId, video) {
  const cs = courseState(state, courseId);
  return withCourse(state, courseId, { ...cs, customVideos: [...(cs.customVideos || []), video].slice(-50) });
}

export function removeCustomVideo(state, courseId, videoId) {
  const cs = courseState(state, courseId);
  return withCourse(state, courseId, { ...cs, customVideos: (cs.customVideos || []).filter((v) => v.id !== videoId) });
}

export function markVideoOpened(state, courseId, videoId, now = new Date().toISOString()) {
  const cs = courseState(state, courseId);
  return touchDay(withCourse(state, courseId, { ...cs, videos: { ...cs.videos, [videoId]: { opened: true, lastAt: now } } }), now);
}

export function addNote(state, courseId, conceptId, text, now = new Date().toISOString()) {
  const clean = String(text || '').trim().slice(0, 2000);
  if (!clean) return state;
  const cs = courseState(state, courseId);
  const list = cs.notes[conceptId] || [];
  const note = { id: `${conceptId}-${Date.now().toString(36)}-${list.length}`, text: clean, at: now };
  return touchDay(withCourse(state, courseId, { ...cs, notes: { ...cs.notes, [conceptId]: [...list, note].slice(-30) } }), now);
}

export function removeNote(state, courseId, conceptId, noteId) {
  const cs = courseState(state, courseId);
  const list = cs.notes[conceptId] || [];
  return withCourse(state, courseId, { ...cs, notes: { ...cs.notes, [conceptId]: list.filter((n) => n.id !== noteId) } });
}

export function toggleBookmark(state, courseId, targetId) {
  const cs = courseState(state, courseId);
  const list = cs.bookmarks || [];
  const next = list.includes(targetId) ? list.filter((x) => x !== targetId) : [...list, targetId];
  return withCourse(state, courseId, { ...cs, bookmarks: next });
}

/**
 * 概念是否已掌握：有测验的概念以「测验通过」为准，没有测验的概念以「课程完成」为准。
 */
export function isConceptMastered(state, course, conceptId) {
  const cs = courseState(state, course.id);
  const concept = (course.concepts || []).find((c) => c.id === conceptId);
  if (!concept) return false;
  if (concept.quizId) {
    return cs.quizAttempts.some((a) => a.quizId === concept.quizId && a.passed);
  }
  return cs.lessons[conceptId]?.status === 'completed';
}

/** 给 graph.conceptStates 用的状态映射。 */
export function statusMapFor(state, course) {
  const map = {};
  for (const concept of course.concepts || []) {
    const lesson = courseState(state, course.id).lessons[concept.id];
    map[concept.id] = {
      mastered: isConceptMastered(state, course, concept.id),
      started: lesson?.status === 'in-progress' || lesson?.status === 'completed',
    };
  }
  return map;
}

export function conceptStateMap(state, course) {
  return conceptStates(course.concepts || [], statusMapFor(state, course));
}

export function courseProgress(state, course) {
  const concepts = course.concepts || [];
  const mastered = concepts.filter((c) => isConceptMastered(state, course, c.id));
  const started = concepts.filter((c) => courseState(state, course.id).lessons[c.id]?.status === 'in-progress');
  const minutes = Object.values(courseState(state, course.id).lessons).reduce((sum, l) => sum + (l.minutes || 0), 0);
  return {
    courseId: course.id,
    total: concepts.length,
    mastered: mastered.length,
    inProgress: started.length,
    percent: concepts.length === 0 ? 0 : Math.round((mastered.length / concepts.length) * 100),
    minutes,
    masteredIds: mastered.map((c) => c.id),
  };
}

export function nextConcepts(state, course, limit = 3) {
  return recommendNext(course.concepts || [], statusMapFor(state, course), limit);
}

/**
 * 学习统计：连续天数、近 7 天活跃、掌握总数、待复习队列。
 */
export function studyStats(state, catalog, now = Date.now()) {
  const days = [...(state.stats?.studyDays || [])].sort();
  let streak = 0;
  const cursor = new Date(now);
  for (let i = 0; i < 400; i += 1) {
    const key = todayKey(cursor);
    if (days.includes(key)) streak += 1;
    else if (i > 0) break;
    cursor.setTime(cursor.getTime() - DAY_MS);
  }
  const weekAgo = now - 7 * DAY_MS;
  const weekDays = days.filter((d) => new Date(`${d}T00:00:00`).getTime() >= weekAgo);
  let masteredTotal = 0;
  const reviewQueue = [];
  for (const course of catalog) {
    const cs = courseState(state, course.id);
    for (const concept of course.concepts || []) {
      if (cs.lessons[concept.id]?.status === 'completed') {
        const completedAt = cs.lessons[concept.id].completedAt ? new Date(cs.lessons[concept.id].completedAt).getTime() : 0;
        if (completedAt && now - completedAt > 7 * DAY_MS && !cs.quizAttempts.some((a) => a.quizId === concept.quizId && a.passed && now - new Date(a.at).getTime() < 7 * DAY_MS)) {
          reviewQueue.push({ courseId: course.id, courseTitle: course.title, conceptId: concept.id, conceptTitle: concept.title, completedAt: cs.lessons[concept.id].completedAt });
        }
      }
      if (isConceptMastered(state, course, concept.id)) masteredTotal += 1;
    }
  }
  return {
    streak,
    activeThisWeek: weekDays.length,
    studyDays: days,
    totalMinutes: state.stats?.totalMinutes || 0,
    masteredTotal,
    reviewQueue: reviewQueue.slice(0, 12),
  };
}




