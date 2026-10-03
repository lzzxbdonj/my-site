/** 课程数据总入口：把课程内容与测验合并导出。 */

import { linearAlgebraCourse } from './courses/linear-algebra.js';
import { linearAlgebraQuizzes } from './courses/linear-algebra-quizzes.js';
import { pythonCourse } from './courses/python.js';
import { pythonQuizzes } from './courses/python-quizzes.js';
import { machineLearningCourse } from './courses/machine-learning.js';
import { machineLearningQuizzes } from './courses/machine-learning-quizzes.js';

function withQuizzes(course, quizzes) {
  const bound = {};
  for (const [key, quiz] of Object.entries(quizzes)) {
    bound[key] = { ...quiz, courseId: course.id };
  }
  return { ...course, quizzes: bound };
}

export const COURSES = [
  withQuizzes(linearAlgebraCourse, linearAlgebraQuizzes),
  withQuizzes(pythonCourse, pythonQuizzes),
  withQuizzes(machineLearningCourse, machineLearningQuizzes),
];

export const COURSE_BY_ID = new Map(COURSES.map((c) => [c.id, c]));

/** 全站统计数据（首页与关于页使用，数字都来自真实数据）。 */
export function catalogStats() {
  const concepts = COURSES.reduce((n, c) => n + c.concepts.length, 0);
  const quizzes = COURSES.reduce((n, c) => n + Object.keys(c.quizzes).length, 0);
  const questions = COURSES.reduce((n, c) => n + Object.values(c.quizzes).reduce((m, q) => m + q.questions.length, 0), 0);
  const minutes = COURSES.reduce((n, c) => n + c.concepts.reduce((m, x) => m + (x.estimatedMinutes || 0), 0), 0);
  return { courses: COURSES.length, concepts, quizzes, questions, hours: Math.round(minutes / 60) };
}
