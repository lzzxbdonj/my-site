/** 课程目录检索：按学科过滤、关键词搜索、跨课程概念检索。 */

import { COURSES } from '../data/courses.js';
import { VIDEO_LIBRARY } from '../data/videos.js';

/** AI 生成的课程注册表（由 app 在每次渲染前写入当前状态里的生成课程）。 */
let generatedCourses = [];

/** 替换当前生效的 AI 生成课程列表；返回归一化后的数组。 */
export function registerGeneratedCourses(list = []) {
  generatedCourses = Array.isArray(list) ? list.filter((c) => c && typeof c.id === 'string') : [];
  return generatedCourses;
}

export function resetGeneratedCourses() {
  generatedCourses = [];
}

export function generatedCourseList() {
  return generatedCourses;
}

export function allCourses() {
  return [...COURSES, ...generatedCourses];
}

export function getCourse(courseId) {
  return COURSES.find((c) => c.id === courseId) || generatedCourses.find((c) => c.id === courseId) || null;
}

export function getConcept(courseId, conceptId) {
  const course = getCourse(courseId);
  if (!course) return { course: null, concept: null };
  return { course, concept: (course.concepts || []).find((c) => c.id === conceptId) || null };
}

export function listSubjects() {
  const map = new Map();
  for (const course of allCourses()) {
    for (const subject of course.subjects || []) {
      if (!map.has(subject.id)) map.set(subject.id, { id: subject.id, name: subject.name, courseIds: [] });
      map.get(subject.id).courseIds.push(course.id);
    }
  }
  return [...map.values()];
}

function normalize(text) {
  return String(text || '').toLowerCase().trim();
}

function courseHaystack(course) {
  return normalize([
    course.title,
    course.subtitle,
    course.summary,
    ...(course.tags || []),
    ...(course.subjects || []).map((s) => s.name),
    ...(course.concepts || []).flatMap((c) => [c.title, c.summary, ...(c.keyTerms || []).map((t) => t.term)]),
  ].join(' '));
}

/** 按学科与关键词过滤课程；query 为空时返回全部。 */
export function filterCourses({ subjectId = 'all', query = '' } = {}) {
  const q = normalize(query);
  return allCourses().filter((course) => {
    if (subjectId && subjectId !== 'all' && !(course.subjects || []).some((s) => s.id === subjectId)) return false;
    if (!q) return true;
    return courseHaystack(course).includes(q);
  });
}

/** 跨课程概念搜索，返回带上下文的匹配项。 */
export function searchConcepts(query, { limit = 20 } = {}) {
  const q = normalize(query);
  if (!q) return [];
  const hits = [];
  for (const course of allCourses()) {
    for (const concept of course.concepts || []) {
      const haystack = normalize([concept.title, concept.summary, ...(concept.objectives || []), ...(concept.keyTerms || []).map((t) => t.term)].join(' '));
      if (haystack.includes(q)) {
        hits.push({
          courseId: course.id,
          courseTitle: course.title,
          conceptId: concept.id,
          title: concept.title,
          type: concept.type,
          summary: concept.summary,
        });
      }
    }
  }
  return hits.slice(0, limit);
}

export function videosForCourse(courseId) {
  return VIDEO_LIBRARY.filter((v) => v.subjectId === courseId);
}

export function videoById(videoId) {
  return VIDEO_LIBRARY.find((v) => v.id === videoId) || null;
}

/** 课程视频 = 精选视频 + 用户自定义视频（自定义只存在本地）。 */
export function resolveCourseVideos(course, state, { conceptId = null } = {}) {
  // AI 生成课程的 id 与内置课程不同，它通过「课时上引用的 videoIds」关联已核实视频；
  // 未知 id 会在这里被过滤掉（渲染层不会因为导入的伪造 id 而显示任何视频）。
  const curated = course.source === 'ai'
    ? course.concepts.flatMap((c) => c.videoIds || []).map((id) => videoById(id)).filter(Boolean)
    : VIDEO_LIBRARY.filter((v) => v.subjectId === course.id);
  const custom = (state?.courses?.[course.id]?.customVideos || []).map((v) => ({ ...v, sourceKind: 'user' }));
  const all = [...curated, ...custom];
  if (!conceptId) return all;
  return all.filter((v) => (v.knowledgePoints || []).includes(conceptId) || (v.conceptIds || []).includes(conceptId));
}

/** 课程数据自检：依赖是否成环、测验是否齐备（供测试与开发期排查使用）。 */
export function auditCatalog() {
  const problems = [];
  for (const course of allCourses()) {
    const ids = new Set((course.concepts || []).map((c) => c.id));
    for (const concept of course.concepts || []) {
      for (const prereq of concept.prerequisites || []) {
        if (!ids.has(prereq)) problems.push(`${course.id}/${concept.id} 的前置 ${prereq} 不存在`);
      }
      if (concept.quizId && !(course.quizzes || {})[concept.quizId]) {
        problems.push(`${course.id}/${concept.id} 引用的测验 ${concept.quizId} 不存在`);
      }
      if (!concept.quizId && concept.type === 'concept') problems.push(`${course.id}/${concept.id} 缺少随堂测验`);
    }
  }
  return problems;
}
