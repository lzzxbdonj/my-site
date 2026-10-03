import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCatalog, filterCourses, searchConcepts, listSubjects, getCourse, getConcept, resolveCourseVideos, videosForCourse, videoById, allCourses } from '../../src/core/catalog.js';
import { COURSES, COURSE_BY_ID, catalogStats } from '../../src/data/courses.js';
import { VIDEO_LIBRARY } from '../../src/data/videos.js';
import { buildCustomCourse } from '../../src/core/personalize.js';
import { validateQuestion } from '../../src/core/quiz.js';

test('课程数据自检无问题（依赖、测验引用、课时测验齐备）', () => {
  assert.deepEqual(auditCatalog(), []);
});

test('课程与知识点标识全局唯一，且包含必要的教学内容', () => {
  const courseIds = new Set();
  const conceptIds = new Set();
  for (const course of COURSES) {
    assert.ok(!courseIds.has(course.id), `课程 id 重复：${course.id}`);
    courseIds.add(course.id);
    assert.ok(course.title && course.summary && course.outcomes.length >= 3, `${course.id} 缺少基础介绍信息`);
    assert.ok(course.subjects.length >= 1 && course.tags.length >= 3, `${course.id} 缺少学科或标签`);
    for (const concept of course.concepts) {
      assert.ok(!conceptIds.has(concept.id), `知识点 id 重复：${concept.id}`);
      conceptIds.add(concept.id);
      assert.ok(concept.objectives.length >= 3, `${concept.id} 缺少学习目标`);
      assert.ok(concept.keyTerms.length >= 2, `${concept.id} 缺少术语表`);
      assert.ok(concept.lesson.sections.length >= 1, `${concept.id} 缺少正文`);
      assert.ok(concept.lesson.sections.every((s) => s.body.length > 0), `${concept.id} 存在空章节`);
      assert.ok(concept.estimatedMinutes >= 5 && concept.estimatedMinutes <= 200, `${concept.id} 的时长不合理`);
      assert.ok([1, 2, 3].includes(concept.difficulty), `${concept.id} 的难度取值应为 1-3`);
      if (concept.type === 'practical') assert.ok((concept.tasks || []).length >= 3, `${concept.id} 实战课应包含任务清单`);
      if (concept.type === 'lab') {
        assert.ok(concept.project, `${concept.id} 实验室应有项目说明`);
        assert.ok(concept.project.steps.length >= 3 && concept.project.rubric.length >= 3, `${concept.id} 实验室缺少步骤或评分标准`);
      }
      const quiz = course.quizzes[concept.quizId];
      assert.ok(quiz, `${concept.id} 缺少随堂测验`);
      for (const question of quiz.questions) assert.deepEqual(validateQuestion(question), []);
    }
  }
  assert.equal(courseIds.size, 3);
  assert.equal(conceptIds.size, 28);
});

test('课程库检索：学科过滤、关键词搜索与跨课程概念命中', () => {
  assert.equal(filterCourses({ subjectId: 'all', query: '' }).length, 3);
  assert.equal(filterCourses({ subjectId: 'code' }).length, 1);
  assert.equal(filterCourses({ subjectId: 'math' })[0].id, 'linear-algebra');
  assert.equal(filterCourses({ query: '特征值' }).length, 1, '关键词应命中线性代数课程');
  assert.equal(filterCourses({ query: 'scikit-learn' }).length, 1);
  assert.deepEqual(filterCourses({ query: 'zzz-不存在' }), []);
  const hits = searchConcepts('特征值');
  assert.ok(hits.some((h) => h.conceptId === 'la-eigen'));
  assert.ok(hits.every((h) => typeof h.courseTitle === 'string'));
  assert.deepEqual(searchConcepts(''), []);
  const subjects = listSubjects();
  assert.deepEqual(subjects.map((s) => s.id).sort(), ['ai', 'code', 'math']);
});

test('课程与概念查询、视频解析保持一致', () => {
  assert.equal(getCourse('python').id, 'python');
  assert.equal(getCourse('nope'), null);
  assert.equal(getConcept('python', 'py-loop').concept.title, '循环与遍历');
  assert.equal(getConcept('python', 'nope').concept, null);
  assert.equal(allCourses().length, 3);

  const python = COURSE_BY_ID.get('python');
  const curated = videosForCourse('python');
  assert.ok(curated.length >= 8, 'Python 课程应有足量精选视频');
  const withCustom = resolveCourseVideos(python, { courses: { python: { customVideos: [{ id: 'u1', title: '自定义', watchUrl: 'https://example.com/x', knowledgePoints: ['py-loop'] }] } } });
  assert.equal(withCustom.length, curated.length + 1);
  const filtered = resolveCourseVideos(python, { courses: {} }, { conceptId: 'py-loop' });
  assert.ok(filtered.length >= 1 && filtered.every((v) => v.knowledgePoints.includes('py-loop')));
  assert.equal(videoById('bili-py-01').title.includes('安装Python解释器'), true);
  assert.equal(videoById('nope'), null);
});

test('目录统计数字与真实数据一致', () => {
  const stats = catalogStats();
  const concepts = COURSES.reduce((n, c) => n + c.concepts.length, 0);
  const questionCount = COURSES.reduce((n, c) => n + Object.values(c.quizzes).reduce((m, q) => m + q.questions.length, 0), 0);
  assert.equal(stats.courses, COURSES.length);
  assert.equal(stats.concepts, concepts);
  assert.equal(stats.questions, questionCount);
  assert.equal(stats.curatedVideos ?? VIDEO_LIBRARY.length, VIDEO_LIBRARY.length);
  assert.ok(stats.hours > 20 && stats.hours < 60, `课程总时长估计异常：${stats.hours}`);
});

test('定制计划引用的视频与测验都真实存在', () => {
  for (const course of COURSES) {
    for (const goal of ['starter', 'exam', 'project']) {
      const plan = buildCustomCourse(course, { goal, level: 'new', weeklyHours: 4, lessonMinutes: 40 });
      for (const item of plan.weeks.flatMap((w) => w.items)) {
        assert.ok(course.concepts.some((c) => c.id === item.conceptId), `计划引用了不存在的知识点 ${item.conceptId}`);
        for (const videoId of item.videoIds) assert.ok(videoById(videoId), `计划引用了不存在的视频 ${videoId}`);
        if (item.quizId) assert.ok(course.quizzes[item.quizId], `计划引用了不存在的测验 ${item.quizId}`);
      }
    }
  }
});
