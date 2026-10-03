import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, DECK_PRINT_NOTE } from '../../src/core/slides.js';
import { COURSES, COURSE_BY_ID } from '../../src/data/courses.js';
import { toAppCourse } from '../../src/core/ai-course.js';
import { VIDEO_LIBRARY } from '../../src/data/videos.js';
import { makeValidCourse } from './support/fixture.mjs';

test('内置课程：每个单元的课件都包含章节页、概念页、小结与测验页', () => {
  for (const course of COURSES) {
    for (const concept of course.concepts) {
      const deck = buildDeck(course, concept);
      assert.ok(deck.slides.length >= 4, `${course.id}/${concept.id} 课件页数过少`);
      assert.ok(deck.slides.length <= 12, `${course.id}/${concept.id} 课件超过页数上限`);
      assert.equal(deck.slides[0].kind, 'chapter');
      assert.match(deck.slides[0].kicker, /CHAPTER/);
      assert.ok(deck.slides[0].bigNumber, '章节页应有单元编号');
      assert.ok(deck.slides.some((s) => s.kind === 'summary'), '应有小结页');
      assert.ok(deck.slides.some((s) => s.kind === 'quiz'), '应有测验页');
      assert.equal(deck.slides.at(-1).kind, 'quiz');
      for (const [index, slide] of deck.slides.entries()) {
        assert.equal(slide.index, index + 1);
        assert.equal(slide.total, deck.slides.length);
        assert.equal(slide.folio, `${String(index + 1).padStart(2, '0')} / ${String(deck.slides.length).padStart(2, '0')}`);
        assert.ok(slide.title && slide.title.length > 1, '每页都要有标题');
        assert.ok(slide.kicker && /[A-Z]/.test(slide.kicker), '每页都要有英文微标签');
        assert.ok(slide.blocks.length >= 1, '每页都要有内容块（不允许空页）');
      }
    }
  }
});

test('课件正文来自课时本身，不编造内容', () => {
  const course = COURSE_BY_ID.get('linear-algebra');
  const concept = course.concepts.find((c) => c.id === 'la-vectors');
  const deck = buildDeck(course, concept);
  const text = JSON.stringify(deck);
  for (const objective of concept.objectives) assert.ok(text.includes(objective), `应包含学习目标：${objective}`);
  for (const section of concept.lesson.sections) assert.ok(text.includes(section.heading), `应包含小节：${section.heading}`);
  assert.ok(text.includes(concept.exercises[0].prompt), '示例页应来自本课练习');
  for (const takeaway of concept.lesson.takeaways) assert.ok(text.includes(takeaway), '小结页应包含关键结论');
  for (const term of concept.keyTerms) assert.ok(text.includes(term.term), '术语页应来自本课术语');
});

test('实战与实验室单元会生成任务/实验页，并带验收标准', () => {
  const course = COURSE_BY_ID.get('python');
  for (const id of ['py-practical', 'py-lab']) {
    const concept = course.concepts.find((c) => c.id === id);
    const deck = buildDeck(course, concept);
    const projectSlide = deck.slides.find((s) => s.kind === 'project');
    assert.ok(projectSlide, `${id} 应有任务/实验页`);
    const tasks = projectSlide.blocks.find((b) => b.type === 'tasks');
    assert.ok(tasks && tasks.items.length >= 3, '任务页应包含具体任务');
    assert.ok(tasks.items.every((t) => t.acceptance && t.acceptance.length > 2), '每个任务都要有验收标准');
  }
});

test('配套视频页只列出已核实目录中的视频，并附来源链接', () => {
  const course = COURSE_BY_ID.get('python');
  const concept = course.concepts.find((c) => c.id === 'py-setup');
  const deck = buildDeck(course, concept);
  const videoSlide = deck.slides.find((s) => s.kind === 'video');
  assert.ok(videoSlide, '有视频的单元应生成影像档案页');
  const items = videoSlide.blocks.find((b) => b.type === 'videos').items;
  assert.ok(items.length >= 1);
  for (const item of items) {
    assert.ok(VIDEO_LIBRARY.some((v) => v.title === item.title), '视频必须来自已核实视频库');
    assert.match(item.url, /^https:\/\//, '必须提供 https 来源链接');
    assert.ok(item.creator, '必须标注作者');
  }
});

test('AI 生成课程走同一模板，并标注来源为 ai', () => {
  const converted = toAppCourse(makeValidCourse({ videoIds: [VIDEO_LIBRARY[0].id] }), { videoLibrary: VIDEO_LIBRARY });
  assert.equal(converted.ok, true);
  const course = converted.course;
  const deck = buildDeck(course, course.concepts[0]);
  assert.equal(deck.source, 'ai');
  assert.ok(deck.slides.length >= 4);
  assert.ok(deck.slides.some((s) => s.kind === 'quiz'), '生成课程也要有测验页');
  const body = JSON.stringify(deck);
  assert.ok(body.includes(course.concepts[0].objectives[0]), '生成课程的课件应包含其真实目标');
});

test('缺少课程或单元时返回空课件而不是抛错', () => {
  assert.deepEqual(buildDeck(null, null).slides, []);
  const course = COURSE_BY_ID.get('python');
  assert.deepEqual(buildDeck(course, { id: 'nope', title: '不存在' }).slides.length >= 1, true, '即使单元数据不完整也不应崩溃');
  assert.match(DECK_PRINT_NOTE, /PDF|打印/);
});
