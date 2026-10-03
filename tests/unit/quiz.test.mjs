import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeAnswer, gradeQuiz, validateQuestion, questionTypeLabel } from '../../src/core/quiz.js';
import { COURSES } from '../../src/data/courses.js';

test('单选/多选/判断/填空的判定规则', () => {
  assert.equal(gradeAnswer({ type: 'single', options: ['a', 'b'], answer: 1 }, 1).correct, true);
  assert.equal(gradeAnswer({ type: 'single', options: ['a', 'b'], answer: 1 }, 0).correct, false);
  assert.equal(gradeAnswer({ type: 'multiple', options: ['a', 'b', 'c'], answer: [0, 2] }, [2, 0]).correct, true, '多选顺序无关');
  assert.equal(gradeAnswer({ type: 'multiple', options: ['a', 'b', 'c'], answer: [0, 2] }, [0]).correct, false, '少选不算对');
  assert.equal(gradeAnswer({ type: 'multiple', options: ['a', 'b', 'c'], answer: [0, 2] }, [0, 1, 2]).correct, false, '多选不算对');
  assert.equal(gradeAnswer({ type: 'judge', answer: true }, true).correct, true);
  assert.equal(gradeAnswer({ type: 'judge', answer: true }, false).correct, false);
  assert.equal(gradeAnswer({ type: 'fill', answer: ['try/except', 'try'] }, ' Try/Except ').correct, true, '填空应忽略大小写与首尾空格');
  assert.equal(gradeAnswer({ type: 'fill', answer: ['0'] }, '').correct, false, '空答案不算对');
});

test('填空支持多个可接受答案，并给出期望答案文本', () => {
  const result = gradeAnswer({ type: 'fill', answer: ['基', '基底', 'basis'] }, '基底');
  assert.equal(result.correct, true);
  assert.match(result.expectedText, /基/);
});

test('整卷评分、通过与薄弱知识点识别', () => {
  const quiz = {
    id: 'q',
    passScore: 0.6,
    questions: [
      { id: '1', type: 'single', stem: 's1', options: ['a', 'b'], answer: 1, explanation: 'e', knowledgePoint: 'kp1' },
      { id: '2', type: 'judge', stem: 's2', answer: true, explanation: 'e', knowledgePoint: 'kp2' },
      { id: '3', type: 'fill', stem: 's3', answer: ['x'], explanation: 'e', knowledgePoint: 'kp2' },
    ],
  };
  const passed = gradeQuiz(quiz, { 1: 1, 2: true, 3: 'x' });
  assert.equal(passed.score, 3);
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.weakPoints, []);

  const failed = gradeQuiz(quiz, { 1: 0, 2: false, 3: 'y' });
  assert.equal(failed.score, 0);
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.weakPoints.sort(), ['kp1', 'kp2']);

  const partial = gradeQuiz(quiz, { 1: 1, 2: true });
  assert.equal(partial.score, 2);
  assert.equal(partial.passed, true, '3 题答对 2 题（≥60%）应通过');
  assert.equal(partial.answeredCount, 2);
});

test('空测验不会误判为通过', () => {
  const result = gradeQuiz({ id: 'empty', questions: [] }, {});
  assert.equal(result.total, 0);
  assert.equal(result.passed, false);
  assert.equal(questionTypeLabel('fill'), '填空题');
});

test('题库自检：所有题目的答案、选项与解析都合法', () => {
  let total = 0;
  for (const course of COURSES) {
    for (const [quizId, quiz] of Object.entries(course.quizzes)) {
      assert.equal(quiz.id, quizId, '测验 id 与键名一致');
      assert.equal(quiz.courseId, course.id, '测验应绑定所属课程');
      assert.ok(quiz.passScore > 0 && quiz.passScore <= 1, `${quizId} 的通过线应在 (0,1] 之间`);
      assert.ok(quiz.questions.length >= 3, `${quizId} 至少应有 3 道题`);
      for (const question of quiz.questions) {
        const problems = validateQuestion(question);
        assert.deepEqual(problems, [], `${quizId}/${question.id} 题目数据问题：${problems.join('；')}`);
        assert.ok(question.knowledgePoint, `${quizId}/${question.id} 缺少知识点标注`);
        total += 1;
      }
    }
  }
  assert.equal(total, 84, `题库总题数应为 84，实际 ${total}`);
});
