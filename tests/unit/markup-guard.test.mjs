/**
 * HTML 检测规则的回归测试。
 *
 * 背景：原实现用宽松的 `/<\/?[a-z][\s\S]*?>/i`，把 Python 正文里的
 * `<class 'int'>` 误判成 HTML 标签，导致**合法课程被整体拒绝**（真实调用中复现过）。
 * 现在的规则只拦真正的标签形状，同时保留对脚本注入的拦截。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { containsHtmlMarkup } from '../../src/core/markup-guard.js';
import { validateGeneratedCourse } from '../../worker/src/schema.js';
import { makeValidCourse, mutate } from './support/fixture.mjs';

test('真正的 HTML 标签与注入仍然被拦截', () => {
  const dangerous = [
    '<script>alert(1)</script>',
    '<div>内容</div>',
    '闭合标签 </div> 出现在文本里',
    '<img src=x onerror=alert(1)>',
    '<iframe src="https://evil.example"></iframe>',
    '把 <a href="#">链接</a> 写进正文',
    '<body onload=alert(1)>',
    '普通文本 onclick=alert(1) 也应当被拦',
    '<style>body{display:none}</style>',
    '<table><tr><td>1</td></tr></table>',
    '<svg/onload=alert(1)>',
  ];
  for (const value of dangerous) {
    assert.equal(containsHtmlMarkup(value), true, `应判定为 HTML：${value}`);
  }
});

test('编程与数学里常见的尖括号文本不再被误判', () => {
  const legitimate = [
    "输出结果是 <class 'int'>，表示整数类型",
    'Python 的 <class \'list\'> 表示列表对象',
    '在 C++ 里写作 vector<int>、map<string,int>',
    '泛型 List<T> 与 Map<K, V>',
    '条件判断写成 a<b and c>d 这种形式',
    '数学上 1 < 2 且 3 > 2',
    '区间写法 <a,b> 表示开区间',
    '3 < 5 与 7 > 2 都成立',
  ];
  for (const value of legitimate) {
    assert.equal(containsHtmlMarkup(value), false, `不应判定为 HTML：${value}`);
  }
});

test('含 <class \'int\'> 的正文能通过课程校验（真实失败场景的回归）', () => {
  const body = "运行 type(x) 会得到 <class 'int'>，说明这个值是整数；换成列表则得到 <class 'list'>。";
  const course = mutate(makeValidCourse(), 'concepts.0.lesson.sections.0.body.0', body);
  const validated = validateGeneratedCourse(course, { videoLibrary: [] });
  assert.equal(validated.concepts[0].lesson.sections[0].body[0], body, '合法的编程文本应原样保留');
});

test('含真实标签的正文依旧会被拒绝', () => {
  const evil = mutate(makeValidCourse(), 'concepts.0.lesson.sections.0.body.0', '<script>alert(1)</script> 这是一段足够长的恶意正文内容用于测试。');
  assert.throws(() => validateGeneratedCourse(evil, { videoLibrary: [] }), /HTML/);
});
