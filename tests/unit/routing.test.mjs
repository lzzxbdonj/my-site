import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, buildRoute, ROUTES, routeTitle } from '../../src/core/router.js';
import { detectBasePath, stripBasePath, assetPath, isRootAbsoluteRef, isSafeExternalLink } from '../../src/core/paths.js';

test('hash 路由解析：默认页、参数与查询串', () => {
  assert.equal(parseRoute('').view, 'dashboard');
  assert.equal(parseRoute('#/').view, 'dashboard');
  assert.equal(parseRoute('#/explore').view, 'explore');
  assert.equal(parseRoute('#/videos').view, 'videos');
  const lesson = parseRoute('#/lesson/python/py-loop?from=plan&x=%E4%B8%AD');
  assert.equal(lesson.view, 'lesson');
  assert.equal(lesson.params.courseId, 'python');
  assert.equal(lesson.params.conceptId, 'py-loop');
  assert.equal(lesson.query.from, 'plan');
  assert.equal(lesson.query.x, '中');
  const bad = parseRoute('#/nope/1/2');
  assert.equal(bad.notFound, true);
  assert.equal(bad.view, 'dashboard', '未知路由回退到首页而不是崩溃');
});

test('路由生成只产生相对 hash 链接（子路径部署安全）', () => {
  for (const route of ROUTES) {
    const params = {};
    for (const token of route.pattern) if (token.startsWith(':')) params[token.slice(1)] = '测试值';
    const href = buildRoute(route.view, params);
    assert.ok(href.startsWith('#/'), `${route.view} 的链接必须以 #/ 开头：${href}`);
    assert.ok(!href.includes('//'), '链接中不应出现协议或双斜杠');
    const parsed = parseRoute(href);
    assert.equal(parsed.view, route.view, `${href} 应能被解析回 ${route.view}`);
    assert.ok(routeTitle(route.view).length > 0);
  }
  assert.equal(buildRoute('lesson', { courseId: 'python', conceptId: 'a b' }), '#/lesson/python/a%20b', '参数需要 URL 编码');
  assert.equal(buildRoute('course', { courseId: 'x' }, { tab: 'plan' }), '#/course/x?tab=plan');
  assert.equal(buildRoute('nonexistent'), '#/', '未知视图回退到首页');
});

test('GitHub Pages 子路径推断与剥离', () => {
  assert.equal(detectBasePath('/'), '/');
  assert.equal(detectBasePath('/StudyMate-Web/'), '/StudyMate-Web/');
  assert.equal(detectBasePath('/StudyMate-Web/index.html'), '/StudyMate-Web/');
  assert.equal(detectBasePath('/user.github.io/repo/course'), '/user.github.io/');
  assert.equal(detectBasePath(''), '/');
  assert.equal(stripBasePath('/StudyMate-Web/index.html', '/StudyMate-Web/'), '/index.html');
  assert.equal(stripBasePath('/index.html', '/'), '/index.html');
  assert.equal(stripBasePath('/other/x', '/StudyMate-Web/'), '/other/x');
});

test('资源路径与安全检查', () => {
  assert.equal(assetPath('src/main.js'), './src/main.js');
  assert.equal(assetPath('/src/main.js'), './src/main.js');
  assert.equal(isRootAbsoluteRef('src="/src/main.js"'), true);
  assert.equal(isRootAbsoluteRef('src="./src/main.js"'), false);
  assert.equal(isRootAbsoluteRef('href="//cdn.example.com/x"'), false, '协议相对地址不属于根绝对路径');
  assert.equal(isSafeExternalLink('https://ocw.mit.edu/'), true);
  assert.equal(isSafeExternalLink('javascript:alert(1)'), false);
  assert.equal(isSafeExternalLink('not a url'), false);
});
