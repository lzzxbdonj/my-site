/** 提示词构造：要求模型输出可被严格校验的 JSON，并把视频选择限制在已核实库内。 */

import { getTemplate, normalizeTemplateId } from '../../src/data/course-templates.js';

/**
 * 模板取向说明：只从共用目录里按受信任 id 取文本。
 * 未知 id / 缺失 id 一律返回空串——提示词与加入模板之前完全一致（向后兼容）。
 */
export function templateFocus(templateId, stage) {
  const template = getTemplate(normalizeTemplateId(templateId));
  if (!template || template.id === 'custom') return '';
  const emphasis = stage === 'lesson' ? template.lessonEmphasis : template.outlineEmphasis;
  return [
    `本次使用的课程模板是「${template.label}」：${template.focus}`,
    emphasis ? `模板取向（必须体现在结构里）：${emphasis}` : '',
  ].filter(Boolean).join('\n');
}

const SCHEMA_SPEC = `{
  "title": "课程标题(4-80字)",
  "subject": "学科名(2-40字)",
  "summary": "课程简介(40-600字，说明学什么、给谁学、学完能做什么)",
  "level": "入门|中级|进阶",
  "estimatedHours": 数字(1-200),
  "outcomes": ["学习成果", ...(2-6条，每条4-120字)],
  "concepts": [
    {
      "id": "小写字母数字连字符，2-40位，全局唯一，例如 la-vectors",
      "title": "知识点标题(2-80字)",
      "type": "concept|practical|lab",
      "summary": "一句话概述(20-300字)",
      "difficulty": 1|2|3,
      "estimatedMinutes": 数字(10-180),
      "prerequisites": ["只能引用本课程内已出现的 concept id"],
      "objectives": ["学完能做到什么", ...(2-5条)],
      "keyTerms": [{"term": "术语(1-40字，单字术语如「键」「值」也合法，不能为空)", "definition": "解释(10-200字)"}, ...(1-6条)],
      "lesson": {
        "sections": [
          {
            "heading": "小节标题(2-60字)",
            "body": ["正文段落，每段30-800字，必须包含具体讲解或例子", ...(1-4段)],
            "points": ["要点(2-120字)", ...(0-4条)]
          }
          ...(2-5节)
        ],
        "takeaways": ["关键结论(10-200字)", ...(1-4条)],
        "pitfalls": ["常见误解(10-200字)", ...(0-3条)]
      },
      "exercises": [{"prompt": "练习要求(5-300字)", "hint": "提示(2-200字)"}, ...(1-5条)],
      "videoIds": ["只能从下面提供的已核实视频库中选择，可为空数组"],
      "quiz": {
        "questions": [
          {
            "id": "q1",
            "type": "single|multiple|judge|fill",
            "stem": "题干(5-300字)",
            "options": ["选项", ...(2-5个，判断题与填空题可省略)],
            "answer": "single: 下标数字；multiple: 下标数组；judge: true/false；fill: 字符串或字符串数组",
            "explanation": "为什么是这个答案(10-400字，必须解释而不是重复答案)",
            "knowledgePoint": "该题考察的点(2-60字)"
          }
          ...(2-6题)
        ]
      }
    }
    ...(4-12个知识点)
  ]
}`;

const HARD_RULES = `硬性要求：
1. 只输出一个 JSON 对象，不要输出 Markdown 代码块、注释或额外说明。
2. 所有文本使用中文，禁止出现任何 HTML 标签、Markdown 链接、网址或脚本片段。
3. 必须包含 4-12 个知识点，且至少包含一个 type 为 practical 或 lab 的动手单元。
4. 每个知识点的 lesson.sections 至少 2 节，每节 body 至少 1 段，且要写出真正的讲解与例子（不要写「见教材」这类占位内容）。
5. 每个知识点都要有 quiz，至少 2 道题，并且每题都要有能解释原因的 explanation。
6. 每个知识点都要有 exercises；practical 单元要给出 3-6 个带验收标准的任务(tasks)，lab 单元还要给出 project(goal/deliverables/rubric)。
7. prerequisites 只能引用本课程中已定义的 concept id，必须形成无环的先后顺序。
8. videoIds 只能使用下面目录里给出的 id；如果没有合适视频，就给空数组，绝不能编造 id、标题或链接。
9. 这是「完整课程」：每个知识点的正文都要写成能真正读懂的讲解与例子（不要写「略」「见教材」这类占位），测验每题的 explanation 都要解释原因。`;

export function buildCoursePrompt({ input, videoLibrary, catalogVersion = '', templateId = '' }) {
  const libraryText = videoLibrary.length === 0
    ? '（本次没有提供已核实视频库，所有 videoIds 必须为空数组）'
    : videoLibrary.map((v) => `- id=${v.id} | 标题：${v.title} | 作者：${v.creator} | 知识点标签：${(v.knowledgePoints || []).join(',') || '无'}`).join('\n');
  const focus = templateFocus(templateId ?? input?.templateId, 'outline');

  const system = '你是一位严谨的中文课程设计师，负责把学习需求转化成结构化的完整课程。你只输出符合给定结构的 JSON。';
  const user = `请设计一门完整可用的中文课程。

学习需求：
- 学科/主题：${input.topic}
- 学习目标：${input.goalLabel}
- 学习者水平：${input.levelLabel}
- 每周可投入：${input.weeklyHours} 小时
- 单次专注时长：${input.lessonMinutes} 分钟

${focus ? `课程模板取向：\n${focus}\n` : ''}
服务端已核实视频目录（${catalogVersion || 'videos'}，只能从中选择 id）：
${libraryText}

请严格按下面结构输出 JSON：
${SCHEMA_SPEC}

${HARD_RULES}`;
  return { system, user };
}

export function buildExplainPrompt({ concept, level, goal, courseTitle }) {
  const system = '你是一位耐心的中文学习助教，善于用具体例子解释概念，并指出常见误解。';
  const user = [
    `课程：${courseTitle || '（未指定）'}`,
    `知识点：${concept?.title || '（未指定）'}`,
    `学习者水平：${level}；学习目标：${goal}`,
    `知识点摘要：${concept?.summary || ''}`,
    '请用 200-350 字解释这个概念，给出一个具体例子，并指出一个常见误解。不要使用 Markdown 标题或链接，直接输出正文。',
  ].join('\n');
  return { system, user };
}

/* ---------------------------------------------------------------------------
 * 分阶段建课提示词。
 *
 * 单次响应写不下一门完整课程（正文 + 术语 + 练习 + 带解析测验 + 动手任务
 * 会远超模型输出上限），所以拆成「先大纲、再逐知识点正文」两段。
 * 每段的输出都远小于上限，既不截断，也便于只重试失败的那一个知识点。
 * ------------------------------------------------------------------------- */

const OUTLINE_SPEC = `{
  "title": "课程标题(4-80字)",
  "subject": "学科名(2-40字)",
  "summary": "课程简介(40-600字，说明学什么、给谁学、学完能做什么)",
  "level": "入门|中级|进阶",
  "estimatedHours": 数字(1-200),
  "outcomes": ["学习成果", ...(2-6条，每条4-120字)],
  "concepts": [
    {
      "id": "小写字母数字连字符，2-40位，全局唯一，例如 py-lists",
      "title": "知识点标题(2-80字)",
      "type": "concept|practical|lab",
      "summary": "一句话概述(20-300字)",
      "difficulty": 1|2|3,
      "estimatedMinutes": 数字(10-180),
      "prerequisites": ["只能引用本大纲中已出现的 concept id"],
      "objectives": ["学完能做到什么", ...(2-5条，每条4-120字)]
    }
    ...(5-8个知识点)
  ]
}`;

const OUTLINE_RULES = `硬性要求：
1. 只输出一个 JSON 对象，不要输出 Markdown 代码块、注释或额外说明。
2. 所有文本使用中文，禁止出现任何 HTML 标签、Markdown 链接、网址或脚本片段。
3. 必须给出 5-8 个知识点，按学习先后顺序排列，且至少包含一个 type 为 practical 或 lab 的动手单元。
4. prerequisites 只能引用本大纲中已定义的 concept id，必须形成无环的先后顺序；第一个知识点的 prerequisites 为空数组。
5. 这一阶段只输出大纲（元信息与知识点骨架），不要输出正文、术语、练习或测验——那些会在下一步单独生成。`;

const LESSON_SPEC = `{
  "keyTerms": [{"term": "术语(1-40字，单字术语如「键」「值」也合法，不能为空)", "definition": "解释(10-200字)"}, ...(1-5条)],
  "lesson": {
    "sections": [
      {
        "heading": "小节标题(2-60字)",
        "body": ["正文段落(30-800字)，必须写出真正的讲解与具体例子", ...(1-3段)],
        "points": ["要点(2-120字)", ...(0-4条)]
      }
      ...(2-3节)
    ],
    "takeaways": ["关键结论(10-200字)", ...(1-3条)],
    "pitfalls": ["常见误解(10-200字)", ...(0-3条)]
  },
  "exercises": [{"prompt": "练习要求(5-300字)", "hint": "提示(2-200字)"}, ...(1-3条)],
  "tasks": [{"title": "任务(2-60字)", "detail": "怎么做(10-300字)", "acceptance": "验收标准(4-200字)"}, ...(仅 practical/lab 需要，3-5条)],
  "project": {"goal": "项目目标(10-400字)", "deliverables": ["交付物", ...(2-5条)], "rubric": [{"criterion": "评分项(2-80字)", "weight": 数字(1-100)}, ...(2-5条)]},
  "videoSearchKeywords": ["用于检索配套视频的关键词", ...(2-5条：写具体的技术名、知识点名或典型术语，不要写整句)],
  "quiz": {
    "questions": [
      {
        "id": "q1",
        "type": "single|multiple|judge|fill",
        "stem": "题干(5-300字)",
        "options": ["选项", ...(2-5个，判断题与填空题可省略)],
        "answer": "single: 选项下标数字；multiple: 下标数组；judge: true/false；fill: 字符串或字符串数组",
        "explanation": "为什么是这个答案(10-400字，必须解释原因而不是重复答案)",
        "knowledgePoint": "该题考察的点(2-60字)"
      }
      ...(2-4题)
    ]
  }
}`;

/** 第一段：只生成课程大纲。 */
export function buildOutlinePrompt({ input, catalogVersion = '', templateId = '' }) {
  const system = '你是一位严谨的中文课程设计师，负责把学习需求转化成结构化的课程大纲。你只输出符合给定结构的 JSON。';
  const focus = templateFocus(templateId, 'outline');
  const user = `请为一门中文课程设计**大纲**（这一阶段不要写正文）。

学习需求：
- 学科/主题：${input.topic}
- 学习目标：${input.goalLabel}
- 学习者水平：${input.levelLabel}
- 每周可投入：${input.weeklyHours} 小时
- 单次专注时长：${input.lessonMinutes} 分钟

${focus ? `课程模板取向：\n${focus}\n` : ''}
请严格按下面结构输出 JSON：
${OUTLINE_SPEC}

${OUTLINE_RULES}`;
  return { system, user };
}

/** 第二段：为单个知识点生成完整正文、练习与测验，并给出视频检索关键词。 */
export function buildLessonPrompt({ input, outline, concept, templateId = '' }) {
  const siblings = (outline.concepts || []).map((c) => `- ${c.id}：${c.title}（${c.type}）`).join('\n');
  const isHands = concept.type === 'practical' || concept.type === 'lab';
  const focus = templateFocus(templateId, 'lesson');

  const system = '你是一位严谨的中文课程设计师，负责为单个知识点写出可直接学习的正文、练习与测验。你只输出符合给定结构的 JSON。';
  const user = `请为下面这门课中的**一个知识点**写出完整内容。

课程：《${outline.title}》（${outline.subject}，${outline.level}）
学习者：目标「${input.goalLabel}」，水平「${input.levelLabel}」，单次专注 ${input.lessonMinutes} 分钟
${focus ? `\n课程模板取向：\n${focus}\n` : ''}
本课程全部知识点（用于理解上下文，不要重复写别的知识点）：
${siblings}

本次要写的知识点：
- id：${concept.id}
- 标题：${concept.title}
- 类型：${concept.type}
- 概述：${concept.summary}
- 学习目标：${(concept.objectives || []).join('；') || '（未指定）'}

请严格按下面结构输出 JSON：
${LESSON_SPEC}

硬性要求：
1. 只输出一个 JSON 对象，不要输出 Markdown 代码块、注释或额外说明。
2. 所有文本使用中文，禁止出现任何 HTML 标签、Markdown 链接、网址或脚本片段。
3. lesson.sections 给出 2-3 节，每节 body 至少 1 段，必须是真正能读懂的讲解与具体例子，不要写「见教材」「略」这类占位。
4. quiz 必须有 2-4 道题，每题都要有解释原因的 explanation。
5. exercises 至少 1 条。${isHands ? '这是动手单元，必须额外给出 3-5 条带验收标准的 tasks。' : '这是概念课，不要输出 tasks 与 project。'}${concept.type === 'lab' ? ' 这是实验单元，还必须给出 project（目标、交付物、评分标准）。' : ''}
6. videoSearchKeywords 给 2-5 条**检索关键词**：写具体的技术名、知识点名或典型术语（例如「列表推导式」「特征值」），不要写整句，也不要编造任何视频标题、id 或链接 —— 配套视频由服务端用这些关键词去检索并加入课程。
7. 只写这一个知识点的内容，不要输出其他知识点。`;
  return { system, user };
}

/** 从模型返回文本中提取 JSON 对象（容忍 ```json 包裹与前后说明文字）。 */
export function extractJson(text) {
  if (typeof text !== 'string') return { ok: false, error: '模型返回内容为空' };
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return { ok: false, error: '模型没有返回 JSON 对象' };
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, error: `模型返回的 JSON 无法解析：${error.message}` };
  }
}

/** 清理讲解文本：去 HTML、去链接、限长。 */
export function sanitizeExplanation(text, maxLength = 4000) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/https?:\/\/\S+/gi, '[链接已移除]')
    .replace(/\s+\n/g, '\n')
    .trim()
    .slice(0, maxLength);
}
