/**
 * 前端登录客户端的测试（不访问网络：全部用注入的 fetch 假实现）。
 *
 * 重点覆盖容易出错的地方：
 *  - 令牌存在**独立键**里，读写清除都不碰主状态；
 *  - 回跳 query 的令牌必须做格式校验，垃圾字符串不能被写进存储；
 *  - 请求带上 Authorization: Bearer，且**永远不带任何 client secret**；
 *  - 401（令牌过期）与网络失败要能区分，便于界面给出可操作提示；
 *  - 错误信息里不得出现令牌本身。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_TOKEN_KEY,
  createAuthTokenStore,
  clearAuthToken,
  startGithubLogin,
  fetchSession,
  fetchAuthSupport,
  readCallbackToken,
} from '../../src/core/auth-client.js';

const WORKER = 'https://worker.example';
const TOKEN = 'cGF5bG9hZA.signature_part';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
    raw: map,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function captureFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { impl, calls };
}

test('令牌存储：独立键、可读写清除，且不触碰其它键', () => {
  const storage = fakeStorage({ 'studymate.state.v1': '{"profile":{}}' });
  const store = createAuthTokenStore(storage);
  assert.equal(store.read(), '');
  assert.equal(store.write(TOKEN), true);
  assert.equal(storage.getItem(AUTH_TOKEN_KEY), TOKEN);
  assert.equal(storage.getItem('studymate.state.v1'), '{"profile":{}}', '不能影响主状态');
  assert.equal(store.read(), TOKEN);
  assert.equal(clearAuthToken(storage), true);
  assert.equal(store.read(), '');
});

test('存储不可用时（隐私模式等）不会抛错，只是读写失败', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const store = createAuthTokenStore(broken);
  assert.equal(store.read(), '');
  assert.equal(store.write(TOKEN), false);
  assert.equal(store.clear(), false);
});

test('回跳令牌必须符合格式，垃圾字符串一律拒绝', () => {
  assert.equal(readCallbackToken({ token: TOKEN }), TOKEN);
  assert.equal(readCallbackToken({}), '');
  assert.equal(readCallbackToken({ token: '' }), '');
  assert.equal(readCallbackToken({ token: '   ' }), '');
  assert.equal(readCallbackToken({ token: 123 }), '', '非字符串不接受');
  assert.equal(readCallbackToken({ token: '<script>alert(1)</script>' }), '');
  assert.equal(readCallbackToken({ token: 'no-dot-here' }), '');
  assert.equal(readCallbackToken({ token: 'a.b.c' }), '', '只接受两段');
});

test('发起登录：请求带 return 参数，且响应里没有密钥', async () => {
  const { impl, calls } = captureFetch(() => jsonResponse({ ok: true, url: 'https://github.com/login/oauth/authorize?client_id=x', returnTo: 'https://site.example/' }));
  const result = await startGithubLogin({ workerUrl: WORKER, returnTo: 'https://site.example/', fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.match(result.url, /^https:\/\/github\.com\/login\/oauth\/authorize/);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, WORKER);
  assert.equal(url.pathname, '/api/auth/login');
  assert.equal(url.searchParams.get('return'), 'https://site.example/');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.authorization, undefined, '登录请求不需要令牌');
});

test('发起登录：Worker 地址非法时直接失败，不发任何请求', async () => {
  const { impl, calls } = captureFetch(() => jsonResponse({ ok: true, url: 'x' }));
  for (const bad of ['', 'ftp://x', 'javascript:alert(1)']) {
    const result = await startGithubLogin({ workerUrl: bad, fetchImpl: impl });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'bad-worker-url');
  }
  assert.equal(calls.length, 0);
});

test('发起登录：Worker 未配置登录时把原因透传出来', async () => {
  const { impl } = captureFetch(() => jsonResponse({ ok: false, error: 'auth-not-configured', message: '未配置 GitHub 登录' }, 503));
  const result = await startGithubLogin({ workerUrl: WORKER, fetchImpl: impl });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'auth-not-configured');
  assert.match(result.error, /未配置/);
});

test('校验会话：带上 Bearer 头并返回用户；令牌不出现在错误信息里', async () => {
  const { impl, calls } = captureFetch(() => jsonResponse({ ok: true, user: { sub: '1', login: 'octocat', name: '测试' } }));
  const result = await fetchSession({ workerUrl: WORKER, token: TOKEN, fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.equal(result.user.login, 'octocat');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(new URL(calls[0].url).pathname, '/api/auth/me');

  const failing = captureFetch(() => jsonResponse({ ok: false, error: 'unauthorized', reason: 'expired', message: '请重新登录。' }, 401));
  const failed = await fetchSession({ workerUrl: WORKER, token: TOKEN, fetchImpl: failing.impl });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'unauthorized');
  assert.equal(failed.reason, 'expired');
  assert.ok(!String(failed.error).includes(TOKEN), '错误信息里绝不能出现令牌');
});

test('没有令牌时不发请求（界面据此提示「未登录」）', async () => {
  const { impl, calls } = captureFetch(() => jsonResponse({ ok: true }));
  const result = await fetchSession({ workerUrl: WORKER, token: '', fetchImpl: impl });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'no-token');
  assert.equal(calls.length, 0);
});

test('网络异常与超时被区分出来，不会伪装成「未登录」', async () => {
  const network = captureFetch(() => { throw new Error('boom'); });
  const failed = await fetchSession({ workerUrl: WORKER, token: TOKEN, fetchImpl: network.impl });
  assert.equal(failed.code, 'network-error');

  const aborting = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  const timedOut = await fetchSession({ workerUrl: WORKER, token: TOKEN, fetchImpl: aborting });
  assert.equal(timedOut.code, 'timeout');
});

test('读取 Worker 是否支持登录（用于区分「未配置」与「未登录」）', async () => {
  const enabled = captureFetch(() => jsonResponse({ ok: true, auth: { enabled: true, error: null } }));
  const yes = await fetchAuthSupport({ workerUrl: WORKER, fetchImpl: enabled.impl });
  assert.equal(yes.ok, true);
  assert.equal(yes.enabled, true);

  const disabled = captureFetch(() => jsonResponse({ ok: true, auth: { enabled: false, error: '缺少配置' } }));
  const no = await fetchAuthSupport({ workerUrl: WORKER, fetchImpl: disabled.impl });
  assert.equal(no.enabled, false);
  assert.match(no.error, /缺少配置/);
});
