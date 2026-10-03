/** 生成合法的「AI 课程」样例，供 schema 与 worker 测试复用。 */

export function makeValidCourse(overrides = {}) {
  const videoIds = overrides.videoIds || [];
  const concept = (id, index, extra = {}) => ({
    id,
    title: `知识点 ${index}`,
    type: 'concept',
    summary: `这是第 ${index} 个知识点的概述，说明它解决什么问题以及需要的前置内容。`,
    difficulty: 1 + (index % 3),
    estimatedMinutes: 40,
    prerequisites: index === 1 ? [] : [`c${index - 1}`],
    objectives: ['能用自己的话解释核心概念', '能完成一道基础练习'],
    keyTerms: [{ term: `术语${index}`, definition: `术语${index} 的含义解释，长度足够通过校验。` }],
    lesson: {
      sections: [
        {
          heading: '为什么需要它',
          body: ['先说明这个知识点在实际问题里出现的位置，以及不用它会遇到什么麻烦，这样学习者才愿意投入时间。'],
          points: ['先有动机再讲方法'],
        },
        {
          heading: '具体怎么做',
          body: ['给出一个可以跟着算的小例子，并逐步解释每一步为什么这样做，最后总结成一句可复述的结论。'],
          points: ['每一步都要解释原因'],
        },
      ],
      takeaways: ['把概念翻译成可复述的一句话'],
      pitfalls: ['把公式当成全部，忽略适用条件'],
    },
    exercises: [{ prompt: '用给定数据手算一次，并写出中间步骤。', hint: '先写出已知条件。' }],
    videoIds: index <= videoIds.length ? [videoIds[index - 1]] : [],
    quiz: {
      questions: [
        {
          id: 'q1',
          type: 'single',
          stem: `关于知识点 ${index}，下列说法正确的是？`,
          options: ['说法 A', '说法 B'],
          answer: 1,
          explanation: '说法 B 与定义一致，说法 A 忽略了适用条件，因此不成立。',
          knowledgePoint: `知识点 ${index}`,
        },
        {
          id: 'q2',
          type: 'judge',
          stem: `知识点 ${index} 只有在满足其前提条件时才成立。`,
          answer: true,
          explanation: '这类结论都带有前提条件，脱离条件使用会得到错误结果。',
          knowledgePoint: `知识点 ${index}`,
        },
      ],
    },
    ...extra,
  });

  return {
    title: '测试课程：从零到可交付',
    subject: '测试学科',
    summary: '这是一门用于测试的课程简介，说明学习对象、需要的前置知识以及学完之后可以独立完成什么工作。',
    level: '入门',
    estimatedHours: 12,
    outcomes: ['能独立完成一个端到端的小项目', '能解释每一步背后的原因'],
    concepts: [
      concept('c1', 1),
      concept('c2', 2),
      concept('c3', 3),
      {
        id: 'c4',
        title: '实战单元',
        type: 'practical',
        summary: '把前面三个知识点串起来，完成一个可以运行的小工具。',
        difficulty: 2,
        estimatedMinutes: 60,
        prerequisites: ['c3'],
        objectives: ['能独立设计数据结构', '能处理边界情况'],
        keyTerms: [{ term: '边界情况', definition: '输入处于极端值时程序的表现，必须显式处理。' }],
        lesson: {
          sections: [
            { heading: '任务背景', body: ['你需要在真实场景里落地前面学到的方法，并交付一个可以被他人复核的成果。'], points: ['先写清验收标准'] },
            { heading: '实施步骤', body: ['按步骤实现并逐步验证，每一步都留下可以复现的证据，最后整理成简短的说明文档。'], points: ['每步都要能复现'] },
          ],
          takeaways: ['把知识变成可交付成果'],
          pitfalls: ['跳过验证直接交付结果，导致问题被掩盖'],
        },
        exercises: [{ prompt: '为你的实现写两条断言。', hint: '挑最容易出错的地方。' }],
        videoIds: [],
        tasks: [
          { title: '设计结构', detail: '确定数据如何保存，并写出字段含义的说明。', acceptance: '他人可以据此复现你的结构。' },
          { title: '实现功能', detail: '实现核心逻辑并处理至少两种异常输入。', acceptance: '异常输入不会导致崩溃。' },
          { title: '整理交付', detail: '写出运行方式与结果记录。', acceptance: '包含可复现的命令或步骤。' },
        ],
        quiz: {
          questions: [
            {
              id: 'q1',
              type: 'fill',
              stem: '为了让结果可复核，交付物中必须包含 ______。',
              answer: ['运行步骤', '可复现步骤'],
              explanation: '缺少复现步骤时，别人无法验证你的结论是否成立。',
              knowledgePoint: '交付规范',
            },
            {
              id: 'q2',
              type: 'multiple',
              stem: '下列哪些做法有助于提升交付质量？',
              options: ['记录运行环境', '处理异常输入', '只贴最终结果'],
              answer: [0, 1],
              explanation: '记录环境与处理异常都能提升可复核性；只贴结果无法验证。',
              knowledgePoint: '交付规范',
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

/** 深度修改某条路径，便于构造非法样例。 */
export function mutate(course, path, value) {
  const clone = JSON.parse(JSON.stringify(course));
  const parts = path.split('.');
  let cursor = clone;
  for (const part of parts.slice(0, -1)) cursor = cursor[Array.isArray(cursor) ? Number(part) : part];
  const last = parts[parts.length - 1];
  cursor[Array.isArray(cursor) ? Number(last) : last] = value;
  return clone;
}

