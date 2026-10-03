import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryBackend,
  createStore,
  createEmptyState,
  normalizeState,
  normalizePlan,
  normalizeCustomVideo,
  stripSecrets,
  exportState,
  importState,
  createSecretStore,
  STORAGE_KEY,
} from '../../src/core/storage.js';

test('损坏的输入会被收敛成合法状态，而不是让应用崩溃', () => {
  for (const garbage of [null, undefined, 42, 'nope', [], { profile: 'x', courses: 5, stats: [] }]) {
    const state = normalizeState(garbage);
    assert.equal(state.schemaVersion, 1);
    assert.equal(typeof state.profile.weeklyHours, 'number');
    assert.equal(typeof state.courses, 'object');
    assert.ok(Array.isArray(state.stats.studyDays));
  }
});

test('导入恶意备份：危险链接被丢弃、伪造的验证标记被重置、危险键名被忽略', () => {
  const evil = JSON.stringify({
    app: 'StudyMate-Web',
    schemaVersion: 1,
    data: {
      courses: {
        python: {
          customVideos: [
            { id: 'evil1', title: '恶意', watchUrl: 'javascript:alert(document.cookie)', creatorVerified: true, verification: { status: 'ok' } },
            { id: 'evil2', title: '数据链接', watchUrl: 'data:text/html,<script>1</script>' },
            { id: 'ok1', title: '正常', watchUrl: 'https://example.com/lesson', knowledgePoints: 'not-an-array', creatorVerified: true, playbackVerified: true, verification: { status: 'ok', creatorVerified: true } },
          ],
          customPlan: { weeks: 'not-an-array' },
          lessons: { '__proto__': { status: 'completed' }, constructor: { status: 'completed' }, real: { status: 'completed' } },
        },
        '__proto__': { customVideos: [] },
      },
      stats: { studyDays: ['2026-10-01', 'not-a-date'], totalMinutes: -999 },
    },
  });
  const result = importState(evil);
  assert.equal(result.ok, true);
  const course = result.state.courses.python;
  assert.equal(course.customVideos.length, 1, '只应保留 https 链接的自定义视频');
  const kept = course.customVideos[0];
  assert.equal(kept.id, 'ok1');
  assert.deepEqual(kept.knowledgePoints, [], '非数组的知识点应被清空');
  assert.equal(kept.creatorVerified, false, '不应信任备份里自填的「已认证」');
  assert.equal(kept.playbackVerified, false, '不应信任备份里自填的「播放已验证」');
  assert.equal(kept.verification.status, 'unverified');
  assert.equal(course.customPlan, null, '结构非法的计划应整份丢弃');
  assert.deepEqual(Object.keys(course.lessons), ['real'], '危险键名应被忽略');
  assert.equal(Object.prototype.course, undefined, '不应发生原型污染');
  assert.equal({}.customVideos, undefined, '不应发生原型污染');
  assert.deepEqual(result.state.stats.studyDays, ['2026-10-01']);
  assert.equal(result.state.stats.totalMinutes, 0, '负数时长应被纠正');
  assert.ok(result.warnings.length >= 2, '应给出丢弃内容的警告');
});

test('正常备份可以完整往返（进度、笔记、收藏、计划、自定义视频）', () => {
  const state = createEmptyState('2026-10-01T00:00:00.000Z');
  state.profile = { ...state.profile, name: '小明', goal: 'exam', level: 'some', weeklyHours: 6, lessonMinutes: 45 };
  state.courses.python = {
    customPlan: {
      courseId: 'python',
      courseTitle: 'Python 编程',
      prefs: { goal: 'exam', level: 'some', weeklyHours: 6, lessonMinutes: 45 },
      weeks: [{ index: 1, theme: '打基础', focus: '环境 / 变量', minutes: 90, items: [{ conceptId: 'py-setup', title: '环境搭建', type: 'concept', difficulty: 1, minutes: 40, videoIds: ['bili-py-01'], quizId: 'quiz-py-setup', tags: [] }] }],
    },
    customVideos: [{ id: 'user-1', title: '我的补充视频', watchUrl: 'https://www.bilibili.com/video/BV1tDsgzxECr', provider: 'bilibili', knowledgePoints: ['py-loop'], reason: '老师讲得细' }],
    lessons: { 'py-setup': { status: 'completed', minutes: 40, tasks: { 0: true }, openedAt: '2026-10-01T01:00:00.000Z', completedAt: '2026-10-01T02:00:00.000Z' } },
    quizAttempts: [{ quizId: 'quiz-py-setup', score: 3, total: 3, passed: true, at: '2026-10-01T02:10:00.000Z' }],
    notes: { 'py-setup': [{ id: 'n1', text: '记得勾选 PATH', at: '2026-10-01T02:20:00.000Z' }] },
    videos: { 'bili-py-01': { opened: true, lastAt: '2026-10-01T02:30:00.000Z' } },
    bookmarks: ['py-setup'],
  };
  state.stats = { studyDays: ['2026-10-01'], totalMinutes: 40 };

  const json = exportState(state, { now: '2026-10-02T00:00:00.000Z' });
  const back = importState(json, { now: '2026-10-02T00:00:00.000Z' });
  assert.equal(back.ok, true);
  assert.deepEqual(back.warnings, []);
  const course = back.state.courses.python;
  assert.equal(course.lessons['py-setup'].status, 'completed');
  assert.deepEqual(course.lessons['py-setup'].tasks, { 0: true });
  assert.equal(course.quizAttempts[0].passed, true);
  assert.equal(course.notes['py-setup'][0].text, '记得勾选 PATH');
  assert.deepEqual(course.bookmarks, ['py-setup']);
  assert.equal(course.customPlan.weeks.length, 1);
  assert.equal(course.customPlan.stats.concepts, 1, '导入时应重算计划统计');
  assert.equal(course.customVideos[0].title, '我的补充视频');
  assert.equal(back.state.profile.name, '小明');
  assert.equal(back.state.profile.weeklyHours, 6);
});

test('导出内容不含任何密钥字段', () => {
  const state = createEmptyState();
  state.ai = { endpoint: 'https://api.example.com', model: 'm', enabled: true, keyStorage: 'session' };
  state.apiKey = 'sk-should-not-be-exported';
  state.courses.python = { ...{ lessons: {}, notes: {}, videos: {}, quizAttempts: [], bookmarks: [], customVideos: [], customPlan: null }, token: 'sk-another' };
  const json = exportState(state);
  assert.ok(!/sk-should-not-be-exported/.test(json), '导出不得包含 apiKey');
  assert.ok(!/sk-another/.test(json), '导出不得包含 token 字段');
  assert.deepEqual(stripSecrets({ authorization: 'x', bearer: 'y', ok: 1 }), { ok: 1 });
});

test('非法输入被拒绝并给出可读错误', () => {
  assert.match(importState('{oops').error, /不是合法的 JSON/);
  assert.match(importState('').error, /为空/);
  assert.match(importState('[]').error, /JSON 对象/);
  assert.match(importState(JSON.stringify({ app: 'OtherApp', data: {} })).error, /其他应用/);
});

test('写入失败（配额/隐私模式）不会抛出异常，而是返回可读错误', () => {
  const failing = {
    kind: 'failing',
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  };
  const store = createStore(failing);
  const result = store.save(createEmptyState());
  assert.equal(result.ok, false);
  assert.match(store.getLastError(), /保存失败/);
  assert.equal(store.load().schemaVersion, 1);
});

test('保存再读取会保留数据，并且版本更新会产生提示', () => {
  const backend = createMemoryBackend();
  const store = createStore(backend);
  const state = createEmptyState();
  state.courses.python = { lessons: { 'py-loop': { status: 'completed', minutes: 30 } } };
  assert.equal(store.save(state).ok, true);
  const loaded = store.load();
  assert.equal(loaded.courses.python.lessons['py-loop'].status, 'completed');

  backend.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 99, courses: {} }));
  assert.equal(store.load().schemaVersion, 1, '未来版本的数据应被兼容读取而不是崩溃');
  assert.match(store.getLastError(), /高于当前应用支持的版本/);
});

test('normalizePlan / normalizeCustomVideo 的边界', () => {
  assert.equal(normalizePlan(null), null);
  assert.equal(normalizePlan({ weeks: [] }), null);
  assert.equal(normalizePlan({ weeks: [{ items: [] }] }), null);
  assert.equal(normalizeCustomVideo({ title: 't', watchUrl: 'ftp://x' }, '2026-10-03'), null);
  assert.equal(normalizeCustomVideo({ title: '', watchUrl: 'https://x.com' }, '2026-10-03'), null);
  const ok = normalizeCustomVideo({ title: 't', watchUrl: 'https://www.bilibili.com/video/BV1tDsgzxECr?p=5', provider: 'bilibili' }, '2026-10-03');
  assert.equal(ok.provider, 'bilibili');
  assert.equal(ok.creatorVerified, false);
});

test('会话密钥存储：默认不落 localStorage，可清除', () => {
  const memory = new Map();
  const fake = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
  const secrets = createSecretStore({ session: fake });
  assert.equal(secrets.read(), '');
  secrets.write('sk-session-only');
  assert.equal(secrets.read(), 'sk-session-only');
  assert.equal(memory.size, 1);
  secrets.clear();
  assert.equal(secrets.read(), '');
  assert.equal(memory.size, 0);
});

test('缺少 sessionStorage 时退化为内存存储', () => {
  const secrets = createSecretStore({ session: null });
  secrets.write('sk-memory');
  assert.equal(secrets.read(), 'sk-memory');
  assert.equal(secrets.write('x').mode, 'memory');
});
