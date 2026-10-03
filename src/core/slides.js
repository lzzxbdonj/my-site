/**
 * 课件模式（courseware / deck）生成器。
 *
 * 设计目标：把「课时」这本内容变成可放映的 16:9 课件，而不是换皮的大字报。
 *  - 只使用课时里已有的真实内容（目标、正文段落、术语、练习、任务、评分标准、测验、视频），不编造；
 *  - 每页都有职责：章节封面 / 学习目标 / 概念讲解 / 术语 / 示例练习 / 动手任务 / 配套视频 / 小结 / 测验；
 *  - 体积可控（默认最多 12 页），并且对 AI 生成课程与内置课程使用完全相同的模板；
 *  - 纯函数、确定性输出，便于单元测试。
 */

import { typeLabel } from '../ui/components.js';
import { videoById } from './catalog.js';
import { formatMinutes } from './format.js';
import { buildGraph } from './graph.js';

const MAX_SLIDES = 12;
const MAX_SECTION_SLIDES = 4;

/** 英文微标签：模仿参考作品的「中文标题 + spaced English micro-label」排版语言。 */
const KICKERS = {
  chapter: 'CHAPTER · 章节',
  objectives: 'OBJECTIVES · 学习目标',
  concept: 'CONCEPT · 概念',
  terms: 'GLOSSARY · 术语',
  example: 'EXAMPLE · 示例',
  exercise: 'PRACTICE · 练习',
  project: 'LABORATORY · 实验',
  video: 'ARCHIVE · 影像档案',
  summary: 'SUMMARY · 小结',
  quiz: 'ASSESSMENT · 测验',
};

export function buildDeck(course, concept, { state = null } = {}) {
  if (!course || !concept) return { courseId: '', conceptId: '', title: '', slides: [] };
  const slides = [];
  const { order } = buildGraph(course.concepts || []);
  const unitIndex = Math.max(1, course.concepts.findIndex((c) => c.id === concept.id) + 1);
  const nextId = order[order.indexOf(concept.id) + 1];
  const next = nextId ? course.concepts.find((c) => c.id === nextId) : null;
  const quiz = concept.quizId ? course.quizzes?.[concept.quizId] : null;
  const videos = (concept.videoIds || []).map((id) => videoById(id)).filter(Boolean);

  slides.push({
    kind: 'chapter',
    title: concept.title,
    subtitle: course.title,
    bigNumber: String(unitIndex).padStart(2, '0'),
    meta: [typeLabel(concept.type), `难度 ${'★'.repeat(Number(concept.difficulty) || 1)}`, formatMinutes(concept.estimatedMinutes), `${course.concepts.length} 个单元中的第 ${unitIndex} 个`],
    blocks: [{ type: 'paragraph', text: concept.summary }],
  });

  if ((concept.objectives || []).length > 0) {
    slides.push({
      kind: 'objectives',
      title: '学完这一课，你应该能',
      subtitle: concept.title,
      blocks: [{ type: 'points', items: concept.objectives }],
    });
  }

  for (const section of (concept.lesson?.sections || []).slice(0, MAX_SECTION_SLIDES)) {
    slides.push({
      kind: 'concept',
      title: section.heading,
      subtitle: concept.title,
      blocks: [
        { type: 'paragraphs', items: section.body || [] },
        (section.points || []).length ? { type: 'points', items: section.points } : null,
      ].filter(Boolean),
    });
  }

  if ((concept.keyTerms || []).length >= 2) {
    slides.push({
      kind: 'terms',
      title: '关键术语',
      subtitle: concept.title,
      blocks: [{ type: 'terms', items: concept.keyTerms.slice(0, 5) }],
    });
  }

  if ((concept.exercises || []).length > 0) {
    slides.push({
      kind: 'example',
      title: '示例练习（选自本课练习）',
      subtitle: concept.title,
      blocks: [{ type: 'example', prompt: concept.exercises[0].prompt, hint: concept.exercises[0].hint }],
    });
  }

  if ((concept.exercises || []).length > 1) {
    slides.push({
      kind: 'exercise',
      title: '动手练习',
      subtitle: concept.title,
      blocks: [{ type: 'points', items: concept.exercises.slice(1, 5).map((e) => e.prompt) }],
    });
  }

  const tasks = concept.tasks || concept.project?.steps || [];
  if (tasks.length > 0) {
    slides.push({
      kind: 'project',
      title: concept.type === 'lab' ? '实验步骤与验收' : '实战任务与验收',
      subtitle: concept.project?.goal || concept.summary,
      blocks: [{ type: 'tasks', items: tasks.slice(0, 5) }],
    });
  }

  if (videos.length > 0) {
    slides.push({
      kind: 'video',
      title: '配套影像档案',
      subtitle: '第三方外链，本站不转存',
      blocks: [{ type: 'videos', items: videos.map((v) => ({ title: v.title, creator: v.creator, duration: v.durationSeconds, reason: v.reason, url: v.watchUrl, verified: v.creatorVerified })) }],
    });
  }

  slides.push({
    kind: 'summary',
    title: '小结',
    subtitle: concept.title,
    blocks: [
      (concept.lesson?.takeaways || []).length ? { type: 'points', items: concept.lesson.takeaways, label: '关键结论' } : null,
      (concept.lesson?.pitfalls || []).length ? { type: 'points', items: concept.lesson.pitfalls, label: '常见误解' } : null,
    ].filter(Boolean),
  });

  if (quiz) {
    slides.push({
      kind: 'quiz',
      title: '随堂测验',
      subtitle: `共 ${quiz.questions.length} 题，答对 ${Math.ceil(quiz.passScore * quiz.questions.length)} 题即通过`,
      blocks: [
        { type: 'points', items: quiz.questions.map((q, i) => `${i + 1}. ${q.stem}`), label: '题目预览' },
        { type: 'paragraph', text: '返回课时页作答，提交后可以看到逐题解析。' },
      ],
      meta: next ? [`下一课：${next.title}`] : ['这是本课程最后一个单元'],
    });
  }

  const limited = slides.slice(0, MAX_SLIDES);
  return {
    courseId: course.id,
    conceptId: concept.id,
    title: `${course.title} · ${concept.title}`,
    source: course.source === 'ai' ? 'ai' : 'builtin',
    slides: limited.map((slide, index) => ({
      id: `${concept.id}-${index + 1}`,
      index: index + 1,
      total: limited.length,
      folio: `${String(index + 1).padStart(2, '0')} / ${String(limited.length).padStart(2, '0')}`,
      kicker: KICKERS[slide.kind] || KICKERS.concept,
      kind: slide.kind,
      title: slide.title,
      subtitle: slide.subtitle || '',
      bigNumber: slide.bigNumber || null,
      meta: slide.meta || null,
      blocks: slide.blocks || [],
    })),
    stateHint: state ? '进度记录会同步到课时页' : null,
  };
}

/** 课件在打印/导出 PDF 时使用的额外说明（首页脚注）。 */
export const DECK_PRINT_NOTE = '打印或另存为 PDF 时，每一页会独占一张纸；建议使用「背景图形」选项以保留纸色与线条。';
