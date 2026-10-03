/** 测验评分：纯函数，便于单元测试与在 UI 中复用。 */

const TYPE_LABELS = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  fill: '填空题',
};

export function questionTypeLabel(type) {
  return TYPE_LABELS[type] || '题目';
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 判断题目的答案是否完整、可自动评分（数据自检用）。
 * @returns {string[]} 问题列表，空数组代表合法
 */
export function validateQuestion(question) {
  const problems = [];
  if (!question || typeof question !== 'object') return ['题目不是对象'];
  if (!question.id) problems.push('缺少 id');
  if (!question.stem) problems.push('缺少题干');
  if (!TYPE_LABELS[question.type]) problems.push(`未知题型：${question.type}`);
  if (!question.explanation) problems.push('缺少解析');
  const options = Array.isArray(question.options) ? question.options : null;
  if (question.type === 'single' || question.type === 'multiple') {
    if (!options || options.length < 2) problems.push('选择题至少需要 2 个选项');
    if (question.type === 'single') {
      if (!Number.isInteger(question.answer) || !options || question.answer < 0 || question.answer >= options.length) {
        problems.push('单选题答案需要是合法下标');
      }
    } else {
      const answer = Array.isArray(question.answer) ? question.answer : [];
      if (answer.length === 0) problems.push('多选题至少需要一个正确选项');
      if (options && answer.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length)) {
        problems.push('多选题答案下标越界');
      }
      if (new Set(answer).size !== answer.length) problems.push('多选题答案存在重复下标');
    }
  }
  if (question.type === 'judge' && typeof question.answer !== 'boolean') problems.push('判断题答案必须是 true/false');
  if (question.type === 'fill') {
    const accepted = Array.isArray(question.answer) ? question.answer : [question.answer];
    if (accepted.filter((a) => String(a ?? '').trim() !== '').length === 0) problems.push('填空题需要至少一个可接受答案');
  }
  return problems;
}

/**
 * 判一题。
 * @returns {{correct: boolean, expected: unknown, expectedText: string, given: unknown}}
 */
export function gradeAnswer(question, given) {
  const empty = { correct: false, expected: question ? question.answer : null, expectedText: '', given };
  if (!question) return empty;
  switch (question.type) {
    case 'single': {
      const correct = Number.isInteger(given) && given === question.answer;
      return { correct, expected: question.answer, expectedText: answerText(question, question.answer), given };
    }
    case 'multiple': {
      const a = Array.isArray(given) ? [...new Set(given)].sort((x, y) => x - y) : [];
      const b = Array.isArray(question.answer) ? [...new Set(question.answer)].sort((x, y) => x - y) : [];
      const correct = a.length === b.length && a.every((v, i) => v === b[i]);
      return { correct, expected: question.answer, expectedText: answerText(question, question.answer), given };
    }
    case 'judge': {
      const correct = typeof given === 'boolean' && given === question.answer;
      return { correct, expected: question.answer, expectedText: question.answer ? '正确' : '错误', given };
    }
    case 'fill': {
      const accepted = Array.isArray(question.answer) ? question.answer : [question.answer];
      const givenText = normalizeText(given);
      const correct = givenText !== '' && accepted.some((a) => normalizeText(a) === givenText);
      return { correct, expected: accepted, expectedText: accepted.join(' / '), given };
    }
    default:
      return empty;
  }
}

function answerText(question, answer) {
  const options = Array.isArray(question.options) ? question.options : [];
  if (Array.isArray(answer)) return answer.map((i) => options[i]).filter(Boolean).join('、') || String(answer);
  if (typeof answer === 'number') return options[answer] ?? String(answer);
  return String(answer);
}

/**
 * 批改整份测验。
 * @param {{id: string, passScore?: number, questions: object[]}} quiz
 * @param {Record<string, unknown>} answers
 */
export function gradeQuiz(quiz, answers = {}) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  const perQuestion = questions.map((q) => {
    const given = Object.prototype.hasOwnProperty.call(answers, q.id) ? answers[q.id] : undefined;
    const result = gradeAnswer(q, given);
    return {
      id: q.id,
      knowledgePoint: q.knowledgePoint || '',
      explanation: q.explanation || '',
      stem: q.stem,
      type: q.type,
      answered: given !== undefined && given !== '' ,
      ...result,
    };
  });
  const score = perQuestion.filter((q) => q.correct).length;
  const total = questions.length;
  const ratio = total === 0 ? 0 : score / total;
  const passScore = typeof quiz?.passScore === 'number' ? quiz.passScore : 0.8;
  return {
    quizId: quiz?.id || '',
    score,
    total,
    ratio,
    passRatio: passScore,
    passed: total > 0 && ratio >= passScore,
    answeredCount: perQuestion.filter((q) => q.answered).length,
    perQuestion,
    weakPoints: [...new Set(perQuestion.filter((q) => !q.correct).map((q) => q.knowledgePoint).filter(Boolean))],
  };
}
