import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGeneratedCourse, validateConceptContent, validateVideoLibrary, SchemaError, findCycle, takeValidationWarnings } from '../../worker/src/schema.js';
import { makeValidCourse, mutate } from './support/fixture.mjs';

const library = [
  { id: 'bili-py-01', title: '安装 Python 解释器', creator: '尚硅谷', subjectId: 'python', knowledgePoints: ['py-setup'] },
  { id: 'bili-py-02', title: '变量', creator: '尚硅谷', subjectId: 'python', knowledgePoints: ['py-variables'] },
  { id: 'bili-py-03', title: '数据类型', creator: '尚硅谷', subjectId: 'python', knowledgePoints: ['py-variables'] },
];

test('合法课程通过校验并被规范化', () => {
  const course = validateGeneratedCourse(makeValidCourse({ videoIds: ['bili-py-01', 'bili-py-02'] }), { videoLibrary: library });
  assert.equal(course.concepts.length, 4);
  assert.equal(course.level, '入门');
  assert.deepEqual(course.concepts[0].videoIds, ['bili-py-01']);
  assert.ok(course.concepts[3].tasks.length >= 3, '实战单元必须保留任务清单');
  assert.ok(course.concepts.every((c) => c.quiz.questions.length >= 2), '每个概念都必须有测验');
  assert.equal(course.subjectKey, 'generated');
});

test('拒绝空壳课程（没有正文/测验/练习/动手单元）', () => {
  const shell = {
    title: '空壳课程',
    subject: '测试',
    summary: '这是一个看起来完整、但所有知识点都是空占位的课程简介，用来验证校验器能否拦住它并给出具体问题。',
    level: '入门',
    estimatedHours: 5,
    outcomes: ['说不出任何具体内容', '也不能完成任何练习'],
    concepts: [
      { id: 'aa', title: '甲', summary: '很短但合法的概述文本，用来占位通过长度校验。', difficulty: 1, estimatedMinutes: 30, prerequisites: [], objectives: ['一', '二'], keyTerms: [{ term: '词', definition: '这里是足够长的定义文本内容。' }], lesson: { sections: [], takeaways: [], pitfalls: [] }, exercises: [] },
      { id: 'bb', title: '乙', summary: '很短但合法的概述文本，用来占位通过长度校验。', difficulty: 1, estimatedMinutes: 30, prerequisites: [], objectives: ['一', '二'], keyTerms: [{ term: '词', definition: '这里是足够长的定义文本内容。' }], lesson: { sections: [], takeaways: [], pitfalls: [] }, exercises: [] },
      { id: 'cc', title: '丙', summary: '很短但合法的概述文本，用来占位通过长度校验。', difficulty: 1, estimatedMinutes: 30, prerequisites: [], objectives: ['一', '二'], keyTerms: [{ term: '词', definition: '这里是足够长的定义文本内容。' }], lesson: { sections: [], takeaways: [], pitfalls: [] }, exercises: [] },
      { id: 'dd', title: '丁', summary: '很短但合法的概述文本，用来占位通过长度校验。', difficulty: 1, estimatedMinutes: 30, prerequisites: [], objectives: ['一', '二'], keyTerms: [{ term: '词', definition: '这里是足够长的定义文本内容。' }], lesson: { sections: [], takeaways: [], pitfalls: [] }, exercises: [] },
    ],
  };
  assert.throws(() => validateGeneratedCourse(shell, { videoLibrary: library }), (error) => {
    assert.ok(error instanceof SchemaError);
    assert.ok(error.errors.some((e) => e.includes('正文')), '应指出缺少正文');
    assert.ok(error.errors.some((e) => e.includes('测验')), '应指出缺少测验');
    assert.ok(error.errors.some((e) => e.includes('实战')), '应指出缺少动手单元');
    return true;
  });
});

test('拒绝 HTML、链接与脚本协议', () => {
  for (const [path, value] of [
    ['concepts.0.lesson.sections.0.body.0', '<script>alert(1)</script> 这是一段足够长的恶意正文内容用于测试。'],
    ['concepts.0.summary', '概述里带有链接 https://evil.example.com/payload，长度足够但不应通过校验。'],
    ['concepts.1.title', '标题里带 javascript:alert(1) 这种危险协议'],
  ]) {
    assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), path, value), { videoLibrary: library }), SchemaError, path + ' 未通过校验');
  }
});

test('超长/超量只警告并按句截断，太短仍然是错误', () => {
  // 超量：超出上限的条目被截掉，并留下一条警告（换以前会让整门课失败）
  const manySections = mutate(makeValidCourse(), 'concepts.0.lesson.sections', new Array(9).fill({ heading: '标题', body: ['内容'.repeat(20)], points: [] }));
  const course = validateGeneratedCourse(manySections, { videoLibrary: library });
  assert.ok(course.concepts[0].lesson.sections.length <= 5, '超出上限的小节应被截掉');
  const sectionWarnings = takeValidationWarnings();
  assert.ok(sectionWarnings.some((w) => w.includes('sections')), `应记录小节超量警告，实际：${JSON.stringify(sectionWarnings)}`);

  // 太短仍然是错误：防的是空占位，属于质量问题
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'outcomes', ['太短']), { videoLibrary: library }), SchemaError);
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.summary', '短'), { videoLibrary: library }), SchemaError);
});

test('回归：解析写到 1614 字不再让整门课作废，而是按句截断并警告', () => {
  // 这是真实发生过的失败：quiz.questions[0].explanation 实际 1614 字，
  // 旧实现直接 422，整门课（含已生成的知识点、已花的调用）全部作废。
  const verbose = mutate(makeValidCourse(), 'concepts.0.quiz.questions.0.explanation', '这是一段很长的解析。'.repeat(160));
  const course = validateGeneratedCourse(verbose, { videoLibrary: library });
  const explanation = course.concepts[0].quiz.questions[0].explanation;
  assert.ok(explanation.length <= 400, `超长解析应被截断到上限内，实际 ${explanation.length}`);
  assert.ok(explanation.endsWith('。'), '应在句子边界截断，而不是拦腰剪断');
  const warnings = takeValidationWarnings();
  assert.ok(warnings.some((w) => w.includes('explanation')), `应记录截断警告，实际：${JSON.stringify(warnings)}`);
  assert.equal(course.concepts.length, 4, '整门课仍然可用');
});

test('拒绝重复 id、自引用、缺失前置与依赖环', () => {
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.1.id', 'c1'), { videoLibrary: library }), SchemaError, '重复 id 应被拒绝');
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.1.prerequisites', ['c2']), { videoLibrary: library }), SchemaError, '自引用应被拒绝');
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.1.prerequisites', ['nope']), { videoLibrary: library }), SchemaError, '缺失前置应被拒绝');
  const cyclic = mutate(makeValidCourse(), 'concepts.0.prerequisites', ['c2']);
  assert.throws(() => validateGeneratedCourse(cyclic, { videoLibrary: library }), SchemaError, '依赖环应被拒绝');
  assert.deepEqual(findCycle(makeValidCourse().concepts), null);
});

test('拒绝非法的测验答案与选项', () => {
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.quiz.questions.0.answer', 5), { videoLibrary: library }), SchemaError, '越界下标');
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.quiz.questions.1.answer', 'yes'), { videoLibrary: library }), SchemaError, '判断题必须是布尔值');
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.3.quiz.questions.0.answer', ['']), { videoLibrary: library }), SchemaError, '填空题必须有可接受答案');
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.quiz.questions.0.explanation', '对'), { videoLibrary: library }), SchemaError, '解析必须解释原因');
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.quiz.questions', [{ id: 'q1', type: 'single', stem: '唯一一道题', options: ['a', 'b'], answer: 0, explanation: '这里给出解释但题目数量不足。', knowledgePoint: 'x' }]), { videoLibrary: library }), SchemaError, '题目数量下限');
});

test('单字术语（「键」「值」）在完整课程与单个知识点两条路径上都合法', () => {
  const oneCharCourse = mutate(makeValidCourse(), 'concepts.0.keyTerms', [
    { term: '键', definition: '字典里用来索引值的那个名字。' },
    { term: '值', definition: '键所对应的内容，可以是任意类型。' },
  ]);
  const course = validateGeneratedCourse(oneCharCourse, { videoLibrary: library });
  assert.deepEqual(course.concepts[0].keyTerms.map((t) => t.term), ['键', '值']);

  const concept = { id: 'c1', type: 'concept', title: '知识点 1' };
  const content = validateConceptContent({
    keyTerms: [{ term: '键', definition: '字典里用来索引值的那个名字。' }],
    lesson: oneCharCourse.concepts[0].lesson,
    exercises: oneCharCourse.concepts[0].exercises,
    quiz: oneCharCourse.concepts[0].quiz,
    videoIds: [],
  }, { concept, videoLibrary: library });
  assert.deepEqual(content.keyTerms.map((t) => t.term), ['键']);

  // 空白与空串仍然被拒绝（不能因为放开下限就把空术语当合法）
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.keyTerms', [{ term: '', definition: '这里是足够长的定义文本内容。' }]), { videoLibrary: library }), SchemaError);
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.keyTerms', [{ term: '   ', definition: '这里是足够长的定义文本内容。' }]), { videoLibrary: library }), SchemaError);
  // 超长（>40）不再报错，而是截断 + 警告（术语太长属于啰嗦，不该让整门课失败）
  const longTerm = validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.keyTerms', [{ term: '术'.repeat(41), definition: '这里是足够长的定义文本内容。' }]), { videoLibrary: library });
  assert.equal(longTerm.concepts[0].keyTerms[0].term.length, 40, '超长术语应被截断到上限');
  assert.ok(takeValidationWarnings().some((w) => w.includes('keyTerms')), '应记录术语超长警告');
});

test('视频 id 必须来自提供的已核实库，编造即拒绝', () => {
  assert.throws(() => validateGeneratedCourse(mutate(makeValidCourse(), 'concepts.0.videoIds', ['invented-video-id']), { videoLibrary: library }), (error) => {
    assert.ok(error.errors.some((e) => e.includes('不在已核实视频库')), '应指出编造的 id');
    return true;
  });
  const ok = validateGeneratedCourse(mutate(makeValidCourse({ videoIds: ['bili-py-01'] }), 'concepts.1.videoIds', ['bili-py-01']), { videoLibrary: library });
  assert.deepEqual(ok.concepts[1].videoIds, ['bili-py-01']);
});

test('视频库白名单本身也要校验（去重、上界、字段）', () => {
  const errors = [];
  const cleaned = validateVideoLibrary([...library, { id: 'bili-py-01', title: '重复', creator: 'x', subjectId: 'y', knowledgePoints: [] }, 42, { id: 'ok-1', title: '正常条目', creator: '作者', subjectId: 'python', knowledgePoints: ['k'] }], errors);
  assert.equal(cleaned.length, 4, '重复与非法条目应被剔除');
  assert.ok(errors.length >= 2);
  assert.deepEqual(cleaned[3].knowledgePoints, ['k']);
});
