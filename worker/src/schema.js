/**
 * 严格的「AI 生成课程」结构校验。
 *
 * 立场：模型输出是不可信输入。
 *  - 不接受任何 HTML 标签、实体或 http(s) 链接；
 *  - 所有数组与字符串都有上界，避免超大响应拖垮前端或 Durable Object；
 *  - 概念 id 必须唯一、prerequisites 必须引用存在的 id 且不能成环；
 *  - 测验答案必须与选项匹配，且必须有非空解析；
 *  - videoIds 只能来自调用方提供的「已核实视频库」白名单，禁止模型发明 id 或 URL。
 */

import { containsHtmlMarkup } from '../../src/core/markup-guard.js';

const LIMITS = {
  title: [4, 80],
  subject: [2, 40],
  summary: [40, 600],
  outcomes: [2, 6],
  concepts: [4, 12],
  conceptId: [2, 40],
  conceptTitle: [2, 80],
  conceptSummary: [20, 300],
  objectives: [2, 5],
  keyTerms: [1, 6],
  // 术语名允许 1 个字：中文里「键」「值」「熵」「域」这类单字术语是合法且常见的，
  // 之前 2-40 的下限会把完全正确的模型输出判成非法（空串仍然被拒绝）。
  keyTerm: [1, 40],
  sections: [2, 5],
  sectionBody: [1, 4],
  takeaways: [1, 4],
  pitfalls: [0, 3],
  exercises: [1, 5],
  questions: [2, 6],
  options: [2, 5],
  videoIdsPerConcept: 4,
  estimatedMinutes: [10, 180],
  estimatedHours: [1, 200],
};

const URL_PATTERN = /(https?:\/\/|javascript:|data:text\/html)/i;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const QUESTION_TYPES = new Set(['single', 'multiple', 'judge', 'fill']);
const CONCEPT_TYPES = new Set(['concept', 'practical', 'lab']);

export class SchemaError extends Error {
  constructor(errors) {
    super(`AI 生成内容未通过结构校验：${errors.slice(0, 6).join('；')}`);
    this.name = 'SchemaError';
    this.errors = errors;
    this.status = 422;
  }
}

function text(value, path, [min, max], errors, { allowUrl = false } = {}) {
  if (typeof value !== 'string') {
    errors.push(`${path} 必须是字符串`);
    return '';
  }
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.push(`${path} 长度需在 ${min}-${max} 之间（实际 ${trimmed.length}）`);
    return trimmed.slice(0, max);
  }
  if (containsHtmlMarkup(trimmed)) {
    errors.push(`${path} 不允许包含 HTML 标签`);
    return trimmed.replace(/<\/?[a-z][^<>]*>/gi, '');
  }
  if (!allowUrl && URL_PATTERN.test(trimmed)) {
    errors.push(`${path} 不允许包含链接或脚本协议`);
    return trimmed.replace(URL_PATTERN, '');
  }
  return trimmed;
}

function array(value, path, [min, max], errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`);
    return [];
  }
  if (value.length < min || value.length > max) {
    errors.push(`${path} 的元素个数需在 ${min}-${max} 之间（实际 ${value.length}）`);
  }
  return value.slice(0, max);
}

function int(value, path, [min, max], errors, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${path} 必须是数字`);
    return fallback;
  }
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) {
    errors.push(`${path} 需在 ${min}-${max} 之间（实际 ${rounded}）`);
    return Math.min(max, Math.max(min, rounded));
  }
  return rounded;
}

function normalizeLevel(value, errors) {
  const map = { beginner: '入门', intermediate: '中级', advanced: '进阶', 入门: '入门', 中级: '中级', 进阶: '进阶' };
  const level = map[String(value || '').trim().toLowerCase()] || map[String(value || '').trim()];
  if (!level) {
    errors.push('level 必须是 入门/中级/进阶（或 beginner/intermediate/advanced）');
    return '入门';
  }
  return level;
}

/** 校验并规范化「已核实视频库」白名单（由前端提供，worker 仅作为白名单与提示词素材）。 */
export function validateVideoLibrary(raw, errors = []) {
  const list = array(raw, 'videoLibrary', [0, 80], errors);
  const out = [];
  const seen = new Set();
  for (const [index, item] of list.entries()) {
    if (!item || typeof item !== 'object') {
      errors.push(`videoLibrary[${index}] 必须是对象`);
      continue;
    }
    const id = text(item.id, `videoLibrary[${index}].id`, [2, 64], errors, { allowUrl: true });
    if (!/^[\w-]{2,64}$/.test(id) || seen.has(id)) {
      errors.push(`videoLibrary[${index}].id 非法或重复`);
      continue;
    }
    seen.add(id);
    out.push({
      id,
      title: text(String(item.title || ''), `videoLibrary[${index}].title`, [2, 120], errors, { allowUrl: true }),
      creator: text(String(item.creator || ''), `videoLibrary[${index}].creator`, [2, 60], errors, { allowUrl: true }),
      subjectId: text(String(item.subjectId || ''), `videoLibrary[${index}].subjectId`, [2, 40], errors, { allowUrl: true }),
      knowledgePoints: array(item.knowledgePoints, `videoLibrary[${index}].knowledgePoints`, [0, 8], errors)
        .filter((k) => typeof k === 'string' && k.length <= 40)
        .slice(0, 8),
    });
  }
  return out;
}

/**
 * 校验并规范化生成课程。
 * @param {unknown} raw 模型返回的对象
 * @param {{videoLibrary: Array<{id: string}>, subjectKey?: string}} options
 * @returns {object} 规范化后的课程（可直接被前端转换为应用内课程结构）
 */
export function validateGeneratedCourse(raw, { videoLibrary = [], subjectKey = 'generated' } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SchemaError(['返回内容不是 JSON 对象']);
  const allowedVideoIds = new Set(videoLibrary.map((v) => v.id));

  const course = {
    title: text(raw.title, 'title', LIMITS.title, errors),
    subject: text(raw.subject, 'subject', LIMITS.subject, errors),
    summary: text(raw.summary, 'summary', LIMITS.summary, errors),
    level: normalizeLevel(raw.level, errors),
    estimatedHours: int(raw.estimatedHours, 'estimatedHours', LIMITS.estimatedHours, errors, 10),
    outcomes: [],
    concepts: [],
  };

  course.outcomes = array(raw.outcomes, 'outcomes', LIMITS.outcomes, errors)
    .map((o, i) => text(o, `outcomes[${i}]`, [4, 120], errors))
    .filter(Boolean);

  const conceptList = array(raw.concepts, 'concepts', LIMITS.concepts, errors);
  const ids = new Set();
  const drafted = [];
  for (const [index, concept] of conceptList.entries()) {
    const path = `concepts[${index}]`;
    if (!concept || typeof concept !== 'object') {
      errors.push(`${path} 必须是对象`);
      continue;
    }
    const id = String(concept.id || '').trim().toLowerCase();
    if (!SLUG_PATTERN.test(id)) {
      errors.push(`${path}.id 必须是 2-40 位小写字母/数字/连字符`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`${path}.id 重复：${id}`);
      continue;
    }
    ids.add(id);
    const type = CONCEPT_TYPES.has(concept.type) ? concept.type : 'concept';
    if (!CONCEPT_TYPES.has(concept.type)) errors.push(`${path}.type 必须是 concept/practical/lab`);

    const item = {
      id,
      type,
      title: text(concept.title, `${path}.title`, LIMITS.conceptTitle, errors),
      summary: text(concept.summary, `${path}.summary`, LIMITS.conceptSummary, errors),
      difficulty: int(concept.difficulty, `${path}.difficulty`, [1, 3], errors, 2),
      estimatedMinutes: int(concept.estimatedMinutes, `${path}.estimatedMinutes`, LIMITS.estimatedMinutes, errors, 45),
      prerequisites: Array.isArray(concept.prerequisites) ? concept.prerequisites.filter((p) => typeof p === 'string').slice(0, 4) : [],
      objectives: array(concept.objectives, `${path}.objectives`, LIMITS.objectives, errors)
        .map((o, i) => text(o, `${path}.objectives[${i}]`, [4, 120], errors))
        .filter(Boolean),
      keyTerms: array(concept.keyTerms, `${path}.keyTerms`, LIMITS.keyTerms, errors).map((term, i) => ({
        term: text(term?.term, `${path}.keyTerms[${i}].term`, LIMITS.keyTerm, errors),
        definition: text(term?.definition, `${path}.keyTerms[${i}].definition`, [10, 200], errors),
      })),
      lesson: {
        sections: array(concept.lesson?.sections, `${path}.lesson.sections`, LIMITS.sections, errors).map((section, i) => ({
          heading: text(section?.heading, `${path}.lesson.sections[${i}].heading`, [2, 60], errors),
          body: array(section?.body, `${path}.lesson.sections[${i}].body`, LIMITS.sectionBody, errors)
            .map((p, j) => text(p, `${path}.lesson.sections[${i}].body[${j}]`, [30, 800], errors))
            .filter(Boolean),
          points: array(section?.points || [], `${path}.lesson.sections[${i}].points`, [0, 4], errors)
            .map((p, j) => text(p, `${path}.lesson.sections[${i}].points[${j}]`, [2, 120], errors))
            .filter(Boolean),
        })),
        takeaways: array(concept.lesson?.takeaways, `${path}.lesson.takeaways`, LIMITS.takeaways, errors)
          .map((t, i) => text(t, `${path}.lesson.takeaways[${i}]`, [10, 200], errors))
          .filter(Boolean),
        pitfalls: array(concept.lesson?.pitfalls || [], `${path}.lesson.pitfalls`, LIMITS.pitfalls, errors)
          .map((t, i) => text(t, `${path}.lesson.pitfalls[${i}]`, [10, 200], errors))
          .filter(Boolean),
      },
      exercises: array(concept.exercises, `${path}.exercises`, LIMITS.exercises, errors).map((exercise, i) => ({
        prompt: text(exercise?.prompt, `${path}.exercises[${i}].prompt`, [5, 300], errors),
        hint: text(exercise?.hint, `${path}.exercises[${i}].hint`, [2, 200], errors),
      })),
      tasks: [],
      project: null,
      videoIds: [],
      quiz: null,
    };

    if (type === 'practical' || type === 'lab') {
      item.tasks = array(concept.tasks, `${path}.tasks`, [3, 6], errors).map((task, i) => ({
        title: text(task?.title, `${path}.tasks[${i}].title`, [2, 60], errors),
        detail: text(task?.detail, `${path}.tasks[${i}].detail`, [10, 300], errors),
        acceptance: text(task?.acceptance, `${path}.tasks[${i}].acceptance`, [4, 200], errors),
      }));
      if (type === 'lab') {
        const project = concept.project || {};
        item.project = {
          goal: text(project.goal, `${path}.project.goal`, [10, 400], errors),
          deliverables: array(project.deliverables, `${path}.project.deliverables`, [2, 5], errors)
            .map((d, i) => text(d, `${path}.project.deliverables[${i}]`, [2, 120], errors))
            .filter(Boolean),
          rubric: array(project.rubric, `${path}.project.rubric`, [2, 5], errors).map((r, i) => ({
            criterion: text(r?.criterion, `${path}.project.rubric[${i}].criterion`, [2, 80], errors),
            weight: int(r?.weight, `${path}.project.rubric[${i}].weight`, [1, 100], errors, 20),
          })),
        };
      }
    }

    const videoIds = array(concept.videoIds || [], `${path}.videoIds`, [0, LIMITS.videoIdsPerConcept], errors)
      .map((v) => String(v || '').trim())
      .filter((v) => {
        if (!v) return false;
        if (!allowedVideoIds.has(v)) {
          errors.push(`${path}.videoIds 引用了不在已核实视频库中的 id：${v}`);
          return false;
        }
        return true;
      });
    item.videoIds = [...new Set(videoIds)];

    const quiz = concept.quiz || concept.checkpointQuiz;
    if (quiz) item.quiz = validateQuiz(quiz, `${path}.quiz`, errors);
    drafted.push(item);
  }

  // 前置引用必须存在、不能自引用、不能成环
  for (const concept of drafted) {
    concept.prerequisites = concept.prerequisites.filter((p) => {
      if (p === concept.id) {
        errors.push(`${concept.id}.prerequisites 不能引用自身`);
        return false;
      }
      if (!ids.has(p)) {
        errors.push(`${concept.id}.prerequisites 引用了不存在的概念：${p}`);
        return false;
      }
      return true;
    });
  }
  const cycle = findCycle(drafted);
  if (cycle) errors.push(`概念依赖存在环：${cycle.join(' → ')}`);

  // 交付质量要求：不能是空壳
  if (drafted.length > 0) {
    const withBody = drafted.filter((c) => c.lesson.sections.some((s) => s.body.length > 0));
    if (withBody.length !== drafted.length) errors.push('每个概念都必须有正文内容（不能是空占位）');
    const withQuiz = drafted.filter((c) => c.quiz && c.quiz.questions.length >= 2);
    if (withQuiz.length !== drafted.length) errors.push('每个概念都必须配有至少 2 道带解析的测验题');
    if (!drafted.some((c) => c.type === 'practical' || c.type === 'lab')) errors.push('课程必须至少包含一个实战或实验室单元');
    if (!drafted.every((c) => c.exercises.length >= 1)) errors.push('每个概念都必须包含练习');
  }

  course.concepts = drafted;
  course.subjectKey = subjectKey;
  if (errors.length > 0) throw new SchemaError(errors);
  return course;
}

/* ---------------------------------------------------------------------------
 * 分阶段生成（大纲 → 逐知识点正文）使用的校验器。
 *
 * 为什么要分阶段：一门完整课程的正文 + 术语 + 练习 + 带解析测验 + 动手任务，
 * 远超单个模型响应可容纳的输出上限。分阶段后每次响应都在预算内，
 * 并且失败可以只重试一个知识点，而不是整门课重新计费。
 *
 * 这两个校验器与 validateGeneratedCourse 共用同一套原语（text / array / int /
 * normalizeLevel / LIMITS / SLUG_PATTERN），因此字段长度、HTML 与链接拦截、
 * id 规则、数组上界、答案合法性、视频 id 白名单等约束完全一致。
 * ------------------------------------------------------------------------- */

/** 校验「课程大纲」阶段：只有元信息与知识点骨架，不含正文与测验。 */
export function validateCourseOutline(raw, { subjectKey = 'generated' } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SchemaError(['返回内容不是 JSON 对象']);

  const outline = {
    title: text(raw.title, 'title', LIMITS.title, errors),
    subject: text(raw.subject, 'subject', LIMITS.subject, errors),
    summary: text(raw.summary, 'summary', LIMITS.summary, errors),
    level: normalizeLevel(raw.level, errors),
    estimatedHours: int(raw.estimatedHours, 'estimatedHours', LIMITS.estimatedHours, errors, 10),
    outcomes: [],
    concepts: [],
    subjectKey,
  };

  outline.outcomes = array(raw.outcomes, 'outcomes', LIMITS.outcomes, errors)
    .map((o, i) => text(o, `outcomes[${i}]`, [4, 120], errors))
    .filter(Boolean);

  const conceptList = array(raw.concepts, 'concepts', LIMITS.concepts, errors);
  const ids = new Set();
  const drafted = [];
  for (const [index, concept] of conceptList.entries()) {
    const path = `concepts[${index}]`;
    if (!concept || typeof concept !== 'object') {
      errors.push(`${path} 必须是对象`);
      continue;
    }
    const id = String(concept.id || '').trim().toLowerCase();
    if (!SLUG_PATTERN.test(id)) {
      errors.push(`${path}.id 必须是 2-40 位小写字母/数字/连字符`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`${path}.id 重复：${id}`);
      continue;
    }
    ids.add(id);
    const type = CONCEPT_TYPES.has(concept.type) ? concept.type : 'concept';
    if (!CONCEPT_TYPES.has(concept.type)) errors.push(`${path}.type 必须是 concept/practical/lab`);
    drafted.push({
      id,
      type,
      title: text(concept.title, `${path}.title`, LIMITS.conceptTitle, errors),
      summary: text(concept.summary, `${path}.summary`, LIMITS.conceptSummary, errors),
      difficulty: int(concept.difficulty, `${path}.difficulty`, [1, 3], errors, 2),
      estimatedMinutes: int(concept.estimatedMinutes, `${path}.estimatedMinutes`, LIMITS.estimatedMinutes, errors, 45),
      prerequisites: Array.isArray(concept.prerequisites) ? concept.prerequisites.filter((p) => typeof p === 'string').slice(0, 4) : [],
      objectives: array(concept.objectives, `${path}.objectives`, LIMITS.objectives, errors)
        .map((o, i) => text(o, `${path}.objectives[${i}]`, [4, 120], errors))
        .filter(Boolean),
    });
  }

  const known = new Set(drafted.map((c) => c.id));
  for (const concept of drafted) {
    concept.prerequisites = concept.prerequisites.filter((p) => {
      if (p === concept.id) {
        errors.push(`${concept.id}.prerequisites 不能引用自身`);
        return false;
      }
      if (!known.has(p)) {
        errors.push(`${concept.id}.prerequisites 引用了不存在的概念：${p}`);
        return false;
      }
      return true;
    });
  }
  const cycle = findCycle(drafted);
  if (cycle) errors.push(`概念依赖存在环：${cycle.join(' → ')}`);
  if (drafted.length > 0 && !drafted.some((c) => c.type === 'practical' || c.type === 'lab')) {
    errors.push('课程必须至少包含一个实战或实验室单元');
  }

  outline.concepts = drafted;
  if (errors.length > 0) throw new SchemaError(errors);
  return outline;
}

/** 校验「单个知识点的正文」阶段。concept 来自大纲（type 以大纲为准）。 */
export function validateConceptContent(raw, { concept, videoLibrary = [] } = {}) {
  const errors = [];
  if (!concept || typeof concept.id !== 'string' || !SLUG_PATTERN.test(concept.id)) throw new SchemaError(['缺少合法的概念信息']);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SchemaError(['返回内容不是 JSON 对象']);
  const allowedVideoIds = new Set(videoLibrary.map((v) => v.id));
  const type = CONCEPT_TYPES.has(concept.type) ? concept.type : 'concept';
  const path = `concepts.${concept.id}`;
  const source = { ...raw, id: concept.id, type };

  const keyTerms = array(source.keyTerms, `${path}.keyTerms`, LIMITS.keyTerms, errors).map((term, i) => ({
    term: text(term?.term, `${path}.keyTerms[${i}].term`, LIMITS.keyTerm, errors),
    definition: text(term?.definition, `${path}.keyTerms[${i}].definition`, [10, 200], errors),
  }));

  const lesson = {
    sections: array(source.lesson?.sections, `${path}.lesson.sections`, LIMITS.sections, errors).map((section, i) => ({
      heading: text(section?.heading, `${path}.lesson.sections[${i}].heading`, [2, 60], errors),
      body: array(section?.body, `${path}.lesson.sections[${i}].body`, LIMITS.sectionBody, errors)
        .map((p, j) => text(p, `${path}.lesson.sections[${i}].body[${j}]`, [30, 800], errors))
        .filter(Boolean),
      points: array(section?.points || [], `${path}.lesson.sections[${i}].points`, [0, 4], errors)
        .map((p, j) => text(p, `${path}.lesson.sections[${i}].points[${j}]`, [2, 120], errors))
        .filter(Boolean),
    })),
    takeaways: array(source.lesson?.takeaways, `${path}.lesson.takeaways`, LIMITS.takeaways, errors)
      .map((t, i) => text(t, `${path}.lesson.takeaways[${i}]`, [10, 200], errors))
      .filter(Boolean),
    pitfalls: array(source.lesson?.pitfalls || [], `${path}.lesson.pitfalls`, LIMITS.pitfalls, errors)
      .map((t, i) => text(t, `${path}.lesson.pitfalls[${i}]`, [10, 200], errors))
      .filter(Boolean),
  };

  const exercises = array(source.exercises, `${path}.exercises`, LIMITS.exercises, errors).map((exercise, i) => ({
    prompt: text(exercise?.prompt, `${path}.exercises[${i}].prompt`, [5, 300], errors),
    hint: text(exercise?.hint, `${path}.exercises[${i}].hint`, [2, 200], errors),
  }));

  let tasks = [];
  let project = null;
  if (type === 'practical' || type === 'lab') {
    tasks = array(source.tasks, `${path}.tasks`, [3, 6], errors).map((task, i) => ({
      title: text(task?.title, `${path}.tasks[${i}].title`, [2, 60], errors),
      detail: text(task?.detail, `${path}.tasks[${i}].detail`, [10, 300], errors),
      acceptance: text(task?.acceptance, `${path}.tasks[${i}].acceptance`, [4, 200], errors),
    }));
    if (type === 'lab') {
      const p = source.project || {};
      project = {
        goal: text(p.goal, `${path}.project.goal`, [10, 400], errors),
        deliverables: array(p.deliverables, `${path}.project.deliverables`, [2, 5], errors)
          .map((d, i) => text(d, `${path}.project.deliverables[${i}]`, [2, 120], errors))
          .filter(Boolean),
        rubric: array(p.rubric, `${path}.project.rubric`, [2, 5], errors).map((r, i) => ({
          criterion: text(r?.criterion, `${path}.project.rubric[${i}].criterion`, [2, 80], errors),
          weight: int(r?.weight, `${path}.project.rubric[${i}].weight`, [1, 100], errors, 20),
        })),
      };
    }
  }

  const videoIds = array(source.videoIds || [], `${path}.videoIds`, [0, LIMITS.videoIdsPerConcept], errors)
    .map((v) => String(v || '').trim())
    .filter((v) => {
      if (!v) return false;
      if (!allowedVideoIds.has(v)) {
        errors.push(`${path}.videoIds 引用了不在已核实视频库中的 id：${v}`);
        return false;
      }
      return true;
    });

  const quizSource = source.quiz || source.checkpointQuiz;
  const quiz = quizSource ? validateQuiz(quizSource, `${path}.quiz`, errors) : null;

  if (!lesson.sections.some((s) => s.body.length > 0)) errors.push(`${path}: 必须写出真正的正文内容（不能是空占位）`);
  if (!quiz || quiz.questions.length < 2) errors.push(`${path}: 必须配有至少 2 道带解析的测验题`);
  if (exercises.length < 1) errors.push(`${path}: 必须包含练习`);

  if (errors.length > 0) throw new SchemaError(errors);
  return {
    id: concept.id,
    type,
    keyTerms,
    lesson,
    exercises,
    tasks,
    project,
    videoIds: [...new Set(videoIds)],
    quiz,
  };
}

function validateQuiz(quiz, path, errors) {
  const questions = array(quiz.questions, `${path}.questions`, LIMITS.questions, errors).map((q, i) => {
    const qPath = `${path}.questions[${i}]`;
    const type = QUESTION_TYPES.has(q?.type) ? q.type : null;
    if (!type) errors.push(`${qPath}.type 必须是 single/multiple/judge/fill`);
    const item = {
      id: text(q?.id, `${qPath}.id`, [1, 40], errors) || `q${i + 1}`,
      type: type || 'single',
      stem: text(q?.stem, `${qPath}.stem`, [5, 300], errors),
      explanation: text(q?.explanation, `${qPath}.explanation`, [10, 400], errors),
      knowledgePoint: text(q?.knowledgePoint || '综合', `${qPath}.knowledgePoint`, [2, 60], errors),
      options: [],
      answer: null,
    };
    if (!/^[\w-]{1,40}$/.test(item.id)) errors.push(`${qPath}.id 只允许字母数字下划线与连字符`);
    if (type === 'single' || type === 'multiple') {
      item.options = array(q.options, `${qPath}.options`, LIMITS.options, errors)
        .map((o, j) => text(o, `${qPath}.options[${j}]`, [1, 200], errors))
        .filter(Boolean);
      if (type === 'single') {
        const answer = Number(q.answer);
        if (!Number.isInteger(answer) || answer < 0 || answer >= item.options.length) {
          errors.push(`${qPath}.answer 必须是合法选项下标`);
        } else item.answer = answer;
      } else {
        const answer = (Array.isArray(q.answer) ? q.answer : []).map(Number).filter((n) => Number.isInteger(n));
        const unique = [...new Set(answer)].sort((a, b) => a - b);
        if (unique.length === 0 || unique.some((n) => n < 0 || n >= item.options.length)) {
          errors.push(`${qPath}.answer 必须是至少一个合法选项下标`);
        } else item.answer = unique;
      }
    } else if (type === 'judge') {
      if (typeof q.answer !== 'boolean') errors.push(`${qPath}.answer 必须是布尔值`);
      else item.answer = q.answer;
    } else if (type === 'fill') {
      const answers = (Array.isArray(q.answer) ? q.answer : [q.answer])
        .filter((a) => typeof a === 'string' && a.trim() !== '')
        .map((a, j) => text(a, `${qPath}.answer[${j}]`, [1, 60], errors))
        .slice(0, 4);
      if (answers.length === 0) errors.push(`${qPath}.answer 需要至少一个可接受答案`);
      else item.answer = answers;
    }
    return item;
  });
  const ids = new Set();
  for (const q of questions) {
    if (ids.has(q.id)) errors.push(`${path} 中的题目 id 重复：${q.id}`);
    ids.add(q.id);
  }
  return { questions };
}

/** 依赖环检测（DFS 三色标记）。 */
export function findCycle(concepts) {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const state = new Map();
  const stack = [];
  let found = null;
  const visit = (id) => {
    if (found) return;
    const status = state.get(id) || 0;
    if (status === 1) {
      const start = stack.indexOf(id);
      found = stack.slice(start).concat(id);
      return;
    }
    if (status === 2) return;
    state.set(id, 1);
    stack.push(id);
    for (const prereq of byId.get(id)?.prerequisites || []) if (byId.has(prereq)) visit(prereq);
    stack.pop();
    state.set(id, 2);
  };
  for (const concept of concepts) visit(concept.id);
  return found;
}

export { LIMITS };
