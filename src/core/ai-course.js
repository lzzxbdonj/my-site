/**
 * 把 Worker 返回的「AI 生成课程」转换成应用内课程结构，并做前端侧的二次校验。
 *
 * 双重防线：服务端已有严格 schema；前端再次校验（尤其是视频 id 白名单与测验答案），
 * 因为即使服务端被替换成恶意实现，前端也不能因此渲染任意内容或崩溃。
 */

import { validateQuestion } from './quiz.js';
import { buildGraph } from './graph.js';
import { containsHtmlMarkup } from './markup-guard.js';

const NV = {
  title: [4, 80],
  subject: [2, 40],
  summary: [40, 600],
  conceptTitle: [2, 80],
  conceptSummary: [20, 300],
  body: [30, 800],
  explanation: [10, 400],
  // 术语名允许 1 个字（「键」「值」「熵」这类单字术语是合法的）；空串仍然被剔除
  keyTerm: [1, 40],
};

function isString(value, [min, max] = [1, 1000]) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
}

function hasForbiddenMarkup(text) {
  const value = String(text || '');
  return containsHtmlMarkup(value) || /(https?:\/\/|javascript:|data:text\/html)/i.test(value);
}

export function slugify(text, fallback = 'course') {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return base || fallback;
}

function shortHash(text) {
  let hash = 2166136261;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

/**
 * 校验 AI 生成课程（前端侧）。
 * @returns {{ok: true, course: object, warnings: string[]} | {ok: false, errors: string[]}}
 */
export function toAppCourse(generated, { videoLibrary = [], now = new Date().toISOString(), model = '' } = {}) {
  const errors = [];
  const warnings = [];
  if (!generated || typeof generated !== 'object') return { ok: false, errors: ['生成结果不是对象'] };

  const checkText = (value, label, range) => {
    if (!isString(value, range)) {
      errors.push(`${label} 不合法`);
      return '';
    }
    if (hasForbiddenMarkup(value)) {
      errors.push(`${label} 含 HTML 或链接`);
      return '';
    }
    return value.trim();
  };

  const title = checkText(generated.title, '课程标题', NV.title);
  const subject = checkText(generated.subject, '学科', NV.subject);
  const summary = checkText(generated.summary, '课程简介', NV.summary);
  const level = ['入门', '中级', '进阶'].includes(generated.level) ? generated.level : '入门';
  const estimatedHours = Number(generated.estimatedHours);
  const outcomes = Array.isArray(generated.outcomes)
    ? generated.outcomes.filter((o) => isString(o, [4, 120])).slice(0, 6)
    : [];

  const libraryIds = new Set(videoLibrary.map((v) => v.id));
  const rawConcepts = Array.isArray(generated.concepts) ? generated.concepts : [];
  if (rawConcepts.length < 4 || rawConcepts.length > 12) errors.push('知识点数量需在 4-12 之间');

  const courseId = `gen-${slugify(subject)}-${shortHash(`${title}|${now}`)}`;
  const quizzes = {};
  const conceptIds = new Set();
  const concepts = [];

  for (const [index, raw] of rawConcepts.entries()) {
    const label = `知识点 ${index + 1}`;
    if (!raw || typeof raw !== 'object') { errors.push(`${label} 不是对象`); continue; }
    const id = String(raw.id || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) { errors.push(`${label} 的 id 不合法`); continue; }
    if (conceptIds.has(id)) { errors.push(`知识点 id 重复：${id}`); continue; }
    conceptIds.add(id);

    const type = ['concept', 'practical', 'lab'].includes(raw.type) ? raw.type : 'concept';
    let droppedMarkup = 0;
    const sections = (Array.isArray(raw.lesson?.sections) ? raw.lesson.sections : []).slice(0, 5).map((section) => ({
      heading: checkText(section?.heading, `${label} 小节标题`, [2, 60]) || '小节',
      body: (Array.isArray(section?.body) ? section.body : []).filter((p) => {
        if (isString(p, NV.body) && !hasForbiddenMarkup(p)) return true;
        droppedMarkup += 1;
        return false;
      }),
      points: (Array.isArray(section?.points) ? section.points : []).filter((p) => isString(p, [2, 120])).slice(0, 4),
    }));
    if (droppedMarkup > 0) errors.push(`${label} 的正文包含 HTML 或链接，已拒绝该单元`);
    if (sections.length < 1 || sections.every((s) => s.body.length === 0)) errors.push(`${label} 缺少正文内容`);

    let quiz = null;
    const rawQuiz = raw.quiz;
    if (rawQuiz && Array.isArray(rawQuiz.questions) && rawQuiz.questions.length >= 2) {
      const questions = rawQuiz.questions.slice(0, 6).map((q, qi) => ({
        id: String(q.id || `q${qi + 1}`).slice(0, 40),
        type: ['single', 'multiple', 'judge', 'fill'].includes(q.type) ? q.type : 'single',
        stem: String(q.stem || '').slice(0, 300),
        options: Array.isArray(q.options) ? q.options.map((o) => String(o).slice(0, 200)).slice(0, 5) : [],
        answer: q.answer,
        explanation: String(q.explanation || '').slice(0, 400),
        knowledgePoint: String(q.knowledgePoint || '综合').slice(0, 60),
      }));
      const quizProblems = questions.flatMap((q) => validateQuestion(q).map((p) => `${label} 第 ${q.id} 题：${p}`));
      const forbidden = questions.some((q) => hasForbiddenMarkup(q.stem) || hasForbiddenMarkup(q.explanation) || q.options.some((o) => hasForbiddenMarkup(o)) || hasForbiddenMarkup(q.knowledgePoint));
      if (forbidden) quizProblems.push(`${label} 的测验含 HTML 或链接`);
      if (quizProblems.length > 0) errors.push(...quizProblems);
      else {
        const quizId = `quiz-${courseId}-${id}`;
        quizzes[quizId] = { id: quizId, courseId, conceptId: id, passScore: 0.6, questions };
        quiz = quizId;
      }
    } else {
      errors.push(`${label} 缺少随堂测验`);
    }

    const videoIds = (Array.isArray(raw.videoIds) ? raw.videoIds : [])
      .filter((v) => typeof v === 'string')
      .filter((v) => {
        if (libraryIds.has(v)) return true;
        warnings.push(`已丢弃未在视频库中的视频 id：${v}`);
        return false;
      })
      .slice(0, 4);

    concepts.push({
      id,
      type,
      title: checkText(raw.title, `${label} 标题`, NV.conceptTitle) || id,
      summary: checkText(raw.summary, `${label} 概述`, NV.conceptSummary) || '（概述缺失）',
      difficulty: [1, 2, 3].includes(Number(raw.difficulty)) ? Number(raw.difficulty) : 2,
      estimatedMinutes: Math.min(180, Math.max(10, Number(raw.estimatedMinutes) || 40)),
      examWeight: 2,
      prerequisites: (Array.isArray(raw.prerequisites) ? raw.prerequisites : []).filter((p) => typeof p === 'string').slice(0, 4),
      objectives: (Array.isArray(raw.objectives) ? raw.objectives : []).filter((o) => isString(o, [4, 120])).slice(0, 5),
      // 单字术语（「键」「值」）合法；空串或超长（>40）仍被剔除
      keyTerms: (Array.isArray(raw.keyTerms) ? raw.keyTerms : [])
        .map((t) => ({ term: String(t?.term ?? '').trim().slice(0, 40), definition: String(t?.definition ?? '').slice(0, 200) }))
        .filter((t) => isString(t.term, NV.keyTerm) && t.definition)
        .slice(0, 6),
      lesson: {
        sections,
        takeaways: (Array.isArray(raw.lesson?.takeaways) ? raw.lesson.takeaways : []).filter((t) => isString(t, [10, 200])).slice(0, 4),
        pitfalls: (Array.isArray(raw.lesson?.pitfalls) ? raw.lesson.pitfalls : []).filter((t) => isString(t, [10, 200])).slice(0, 3),
      },
      exercises: (Array.isArray(raw.exercises) ? raw.exercises : [])
        .map((e) => ({ prompt: String(e?.prompt || '').slice(0, 300), hint: String(e?.hint || '').slice(0, 200) }))
        .filter((e) => e.prompt)
        .slice(0, 5),
      tasks: (Array.isArray(raw.tasks) ? raw.tasks : [])
        .map((t) => ({ title: String(t?.title || '').slice(0, 60), detail: String(t?.detail || '').slice(0, 300), acceptance: String(t?.acceptance || '').slice(0, 200) }))
        .filter((t) => t.title && t.detail)
        .slice(0, 6),
      project: raw.project && typeof raw.project === 'object'
        ? {
            goal: String(raw.project.goal || '').slice(0, 400),
            steps: [],
            deliverables: (Array.isArray(raw.project.deliverables) ? raw.project.deliverables : []).map((d) => String(d).slice(0, 120)).slice(0, 5),
            rubric: (Array.isArray(raw.project.rubric) ? raw.project.rubric : [])
              .map((r) => ({ criterion: String(r?.criterion || '').slice(0, 80), weight: Math.min(100, Math.max(1, Number(r?.weight) || 20)) }))
              .slice(0, 5),
          }
        : null,
      videoIds,
      quizId: quiz,
      source: 'ai',
    });
  }

  // 前置关系：必须存在、无环
  for (const concept of concepts) {
    concept.prerequisites = concept.prerequisites.filter((p) => {
      if (p === concept.id) { errors.push(`知识点 ${concept.id} 不能把自己作为前置`); return false; }
      if (!conceptIds.has(p)) { errors.push(`知识点 ${concept.id} 的前置 ${p} 不存在`); return false; }
      return true;
    });
  }
  const graph = buildGraph(concepts);
  if (graph.cycles.length > 0) errors.push(`依赖存在环：${graph.cycles.join(' → ')}`);
  if (graph.missing.length > 0) errors.push('存在缺失的前置引用');
  if (!concepts.some((c) => c.type === 'practical' || c.type === 'lab')) errors.push('课程缺少实战或实验室单元');

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)].slice(0, 12) };

  const matchedVideos = new Set(concepts.flatMap((c) => c.videoIds));
  const course = {
    id: courseId,
    title,
    subtitle: `AI 生成 · ${subject} · ${level}`,
    summary,
    subjects: [{ id: 'ai-generated', name: 'AI 生成课程' }],
    tags: ['AI 生成', subject, level].filter(Boolean),
    level,
    accent: 'indigo',
    estimatedHours: Number.isFinite(estimatedHours) ? Math.min(200, Math.max(1, Math.round(estimatedHours))) : 12,
    outcomes,
    concepts,
    quizzes,
    source: 'ai',
    aiMeta: {
      generatedAt: now,
      model: model || '（未标注）',
      disclaimer: 'AI 生成内容，请自行核对；视频仅从已核实视频库中匹配。',
      matchedVideoCount: matchedVideos.size,
      noVerifiedVideoMatch: matchedVideos.size === 0,
      subject,
    },
  };
  return { ok: true, course, warnings: [...new Set(warnings)] };
}
