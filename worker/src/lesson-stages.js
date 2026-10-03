/**
 * 按节生成：把一个知识点的内容拆成多次**小**调用。
 *
 * 为什么拆：一次写完「正文 + 术语 + 练习 + 带解析的测验」时，模型偶尔会把某个字段
 * （真实发生过：测验解析写到 1614 字）写得远超上限；虽然现在超长只会被截断+警告，
 * 但拆开之后每次输出都小，既不容易超限，失败也只需重跑一小段。
 *
 * 三段：
 *   1) 骨架：小节标题 + 术语 + 结论/误区 + 练习 +（动手单元的）任务/项目 + 视频检索关键词
 *   2) 逐节正文：每一次只写一个小节的正文段落
 *   3) 测验：只写题目与解析
 */

import { templateFocus } from './prompt.js';

const SKELETON_SPEC = `{  "keyTerms": [{"term": "术语(1-40字)", "definition": "解释(10-200字)"}, ...(1-5条)],
  "videoSearchKeywords": ["检索配套视频的关键词", ...(2-5条，具体的技术名或术语，不要整句)],
  "sections": [{"heading": "小节标题(2-60字)", "points": ["该节要点(2-120字)", ...(0-3条)]}, ...(2-3节)],
  "takeaways": ["关键结论(10-200字)", ...(1-3条)],
  "pitfalls": ["常见误解(10-200字)", ...(0-3条)],
  "exercises": [{"prompt": "练习要求(5-300字)", "hint": "提示(2-200字)"}, ...(1-3条)],
  "tasks": [{"title": "任务(2-60字)", "detail": "怎么做(10-300字)", "acceptance": "验收标准(4-200字)"}, ...(仅动手单元，3-5条)],
  "project": {"goal": "项目目标(10-400字)", "deliverables": ["交付物", ...(2-5条)], "rubric": [{"criterion": "评分项(2-80字)", "weight": 数字(1-100)}, ...(2-5条)]}
}`;

function subject({ input, outline, concept }) {
  return `课程：《${outline.title}》（${outline.subject}，${outline.level}）
学习者：目标「${input.goalLabel}」，水平「${input.levelLabel}」，单次专注 ${input.lessonMinutes} 分钟
知识点：${concept.title}（${concept.type}）
概述：${concept.summary}
学习目标：${(concept.objectives || []).join('；') || '（未指定）'}`;
}

const COMMON_RULES = `只输出一个 JSON 对象，不要 Markdown 代码块、注释或额外说明。
所有文本使用中文，禁止任何 HTML 标签、Markdown 链接、网址或脚本片段。
严格遵守每个字段后面标注的字数范围 —— 写超了会被截断。`;

/** 第 1 段：骨架。 */
export function buildSkeletonPrompt({ input, outline, concept, templateId = '' }) {
  const isHands = concept.type === 'practical' || concept.type === 'lab';
  const focus = templateFocus(templateId, 'lesson');
  const system = '你是一位严谨的中文课程设计师，负责把一个知识点的教学骨架设计出来。你只输出符合给定结构的 JSON。';
  const user = `请为下面这门课中的一个知识点设计**教学骨架**（这一阶段不要写正文）。

${subject({ input, outline, concept })}
${focus ? `\n课程模板取向：\n${focus}\n` : ''}
请严格按下面结构输出 JSON：
${SKELETON_SPEC}

硬性要求：
1. ${COMMON_RULES}
2. sections 给出 2-3 节，按讲解顺序排列，标题要具体（例如「列表推导式的写法」而不是「深入理解」）。
3. takeaways 至少 1 条，exercises 至少 1 条。
4. ${isHands ? '这是动手单元，必须给出 3-5 条带验收标准的 tasks。' : '这是概念课，不要输出 tasks 与 project。'}${concept.type === 'lab' ? ' 这是实验单元，还必须给出 project（目标、交付物、评分标准）。' : ''}
5. videoSearchKeywords 写具体的技术名/知识点名，不要写整句，也不要编造视频标题或链接。`;
  return { system, user };
}

/** 第 2 段：单个小节的正文（一次只写一节，输出很小）。 */
export function buildSectionPrompt({ input, outline, concept, skeleton, section, index, total }) {
  const system = '你是一位严谨的中文课程设计师，负责写出一个小节的正文。你只输出符合给定结构的 JSON。';
  const user = `请写出下面这个知识点的**第 ${index + 1} / ${total} 个小节**的正文。

${subject({ input, outline, concept })}

本知识点的全部小节标题（用于理解上下文，本次只写其中一节）：
${skeleton.sections.map((s, i) => `${i + 1}. ${s.heading}`).join('\n')}

本次要写的小节：
- 标题：${section.heading}
- 该节要点：${(section.points || []).join('；') || '（无）'}

请严格按下面结构输出 JSON：
{
  "body": ["正文段落(30-800字，真正能读懂的讲解与具体例子)", ...(2-3段)],
  "points": ["补充要点(2-120字)", ...(0-3条)]
}

硬性要求：
1. ${COMMON_RULES}
2. body 给 2-3 段，每段 30-800 字，必须写出真正的讲解与具体例子，不要写「见教材」「略」这类占位。
3. 只写这一个小节，不要写其他小节，也不要重复术语表或测验。`;
  return { system, user };
}

/** 第 3 段：测验（单独一次调用，专门控制题干与解析长度）。 */
export function buildQuizPrompt({ input, outline, concept, skeleton }) {
  const system = '你是一位严谨的中文命题老师，负责为一个小节写随堂测验。你只输出符合给定结构的 JSON。';
  const user = `请为下面这个知识点出**随堂测验**。

${subject({ input, outline, concept })}

本知识点覆盖的小节：
${skeleton.sections.map((s) => `- ${s.heading}`).join('\n')}
关键结论：${(skeleton.takeaways || []).join('；') || '（无）'}

请严格按下面结构输出 JSON：
{
  "questions": [
    {
      "id": "q1",
      "type": "single|multiple|judge|fill",
      "stem": "题干(5-300字，一句话说清楚，不要长篇背景)",
      "options": ["选项", ...(2-5个，判断题与填空题可省略)],
      "answer": "single: 选项下标数字；multiple: 下标数组；judge: true/false；fill: 字符串或字符串数组",
      "explanation": "为什么是这个答案(10-400字，写 2-4 句即可，不要长篇大论)",
      "knowledgePoint": "该题考察的点(2-60字)"
    }
    ...(2-4题)
  ]
}

硬性要求：
1. ${COMMON_RULES}
2. 出 2-4 道题，题型尽量混合；每题都必须有解释原因的 explanation。
3. explanation **必须控制在 400 字以内**：说清「为什么选它」和「其他选项错在哪」就够了，不要展开成讲解。
4. knowledgePoint 写具体考点（例如「列表切片」），不要写「本题」。`;
  return { system, user };
}

/** 把三段产物拼成 schema 期望的单个知识点内容。 */
export function assembleConceptContent({ skeleton, sections, quiz, videoSearchKeywords }) {
  return {
    keyTerms: skeleton.keyTerms,
    lesson: {
      sections: sections.map((section) => ({
        heading: section.heading,
        body: section.body,
        points: [...new Set([...(section.points || []), ...(section.extraPoints || [])])].slice(0, 4),
      })),
      takeaways: skeleton.takeaways,
      pitfalls: skeleton.pitfalls,
    },
    exercises: skeleton.exercises,
    ...(skeleton.tasks ? { tasks: skeleton.tasks } : {}),
    ...(skeleton.project ? { project: skeleton.project } : {}),
    quiz,
    videoSearchKeywords,
  };
}
