/**
 * GitHub 登录（OAuth + 无状态会话令牌）的测试。
 *
 * 全部使用**本地模拟的 GitHub**（不访问 github.com、不产生任何费用），覆盖：
 *  - 未配置登录时整体关闭，且不影响既有能力；
 *  - 登录地址不含 client secret；
 *  - 回调必须验证签名过的 state（防登录 CSRF），被篡改/过期的 state 一律拒绝且不发任何请求；
 *  - 不回显 client secret / access token；
 *  - returnTo 不能跳到白名单之外的站点（防开放重定向）；
 *  - /api/auth/me 拒绝伪造、过期、缺失的令牌；
 *  - 回调是顶层导航、不带 Origin，也必须能工作。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { signToken, verifyToken, STATE_TTL_MS, SESSION_TTL_MS } from '../../worker/src/auth.js';
import { RateLimiter, createRateLimiterState } from '../../worker/src/ratelimit.js';

const ORIGIN = 'https://example.github.io';
const CLIENT_ID = 'Iv1.test-client-id';
const CLIENT_SECRET = 'client-secret-must-never-leak-abcdef';
const TOKEN_SECRET = 'test-token-secret-0123456789abcdefghijklmnop';
const ACCESS_TOKEN = 'gho_accesstoken-must-never-leak-123456';

function createEnv(overrides = {}) {
  const state = createRateLimiterState();
  const limiter = new RateLimiter(state, {});
  const namespace = {
    idFromName: (name) => name,
    get: () => ({ fetch: (url, init) => limiter.fetch(new Request(typeof url === 'string' ? url : url.url, init)) }),
    state,
  };
  return {
    env: {
      PROVIDER_BASE_URL: 'https://api.provider.example',
      PROVIDER_MODEL: 'mock-model',
      PROVIDER_API_KEY: 'sk-test-provider-key',
      ALLOWED_ORIGINS: ORIGIN,
      IP_SALT: 'test-salt-0123456789',
      RATE_LIMITER: namespace,
      ...overrides,
    },
  };
}

const AUTH_ENV = {
  GITHUB_CLIENT_ID: CLIENT_ID,
  GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  AUTH_TOKEN_SECRET: TOKEN_SECRET,
};

function request(path, { origin = ORIGIN, method = 'GET', headers = {} } = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: { ...(origin ? { origin } : {}), ...headers },
  });
}

/** 模拟 GitHub：只回应令牌接口与用户接口，并记录收到的请求。 */
function mockGithub({ tokenStatus = 200, tokenBody = { access_token: ACCESS_TOKEN, scope: 'read:user' }, userStatus = 200, userBody = { id: 4242, login: 'octocat', name: '测试用户' } } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const target = String(url);
    calls.push({ target, init });
    if (target.includes('/login/oauth/access_token')) {
      return new Response(JSON.stringify(tokenBody), { status: tokenStatus, headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('api.github.com/user')) {
      return new Response(JSON.stringify(userBody), { status: userStatus, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  };
  return { impl, calls };
}

async function withGithub(mock, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mock.impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

/** 通过 /api/auth/login 拿到一份真实签名过的 state。 */
async function obtainState(env, returnTo = `${ORIGIN}/index.html#/generate`) {
  const response = await worker.fetch(request(`/api/auth/login?return=${encodeURIComponent(returnTo)}`), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  return { body, state: new URL(body.url).searchParams.get('state'), url: body.url };
}

test('未配置登录时：登录端点 503，既有能力不受影响', async () => {
  const { env } = createEnv();
  const login = await worker.fetch(request('/api/auth/login'), env);
  const body = await login.json();
  assert.equal(login.status, 503);
  assert.equal(body.error, 'auth-not-configured');

  const me = await worker.fetch(request('/api/auth/me'), env);
  assert.equal(me.status, 503);

  const health = await worker.fetch(request('/api/health'), env);
  const healthBody = await health.json();
  assert.equal(health.status, 200, '登录没配置不能拖垮整个 Worker');
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.auth.enabled, false);
});

test('只配置了一部分登录变量：明确报错，但 AI 端点仍然可用', async () => {
  const { env } = createEnv({ GITHUB_CLIENT_ID: CLIENT_ID });
  const health = await worker.fetch(request('/api/health'), env);
  const body = await health.json();
  assert.equal(health.status, 200);
  assert.equal(body.auth.enabled, false);
  assert.match(body.auth.error, /必须同时设置/, '应明确指出三者必须同时设置');

  const login = await worker.fetch(request('/api/auth/login'), env);
  assert.equal(login.status, 503);
});

test('登录地址包含必要参数，但绝不包含 client secret', async () => {
  const { env } = createEnv(AUTH_ENV);
  const { body, url } = await obtainState(env);
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://github.com');
  assert.equal(parsed.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(parsed.searchParams.get('scope'), 'read:user');
  assert.ok(parsed.searchParams.get('state'), 'state 必须存在');
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(CLIENT_SECRET), '响应里绝不能出现 client secret');
  assert.ok(!serialized.includes(TOKEN_SECRET), '响应里绝不能出现令牌签名密钥');
});

test('回调成功：换 token → 取用户 → 302 回到本站并带上会话令牌', async () => {
  const { env } = createEnv(AUTH_ENV);
  const mock = mockGithub();
  const { state } = await obtainState(env);

  await withGithub(mock, async () => {
    const response = await worker.fetch(request(`/api/auth/callback?code=test-code&state=${encodeURIComponent(state)}`, { origin: '' }), env);
    assert.equal(response.status, 302, '回调应重定向回前端');
    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin, ORIGIN, '必须跳回白名单内的源');
    assert.match(location.hash, /^#\/auth\/complete\?token=/, '令牌应放在 fragment 里（不会发给服务端）');
    assert.equal(mock.calls.length, 2, '应恰好调用一次令牌接口与一次用户接口');

    const token = decodeURIComponent(location.hash.replace('#/auth/complete?token=', ''));
    assert.ok(!location.toString().includes(CLIENT_SECRET), '重定向地址不得携带 client secret');

    const me = await worker.fetch(request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } }), env);
    const body = await me.json();
    assert.equal(me.status, 200);
    assert.equal(body.user.sub, '4242');
    assert.equal(body.user.login, 'octocat');
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes(ACCESS_TOKEN), '不能回显 GitHub access token');
    assert.ok(!serialized.includes(CLIENT_SECRET), '不能回显 client secret');
  });
});

test('回调的 state 被篡改：拒绝，且不向 GitHub 发任何请求', async () => {
  const { env } = createEnv(AUTH_ENV);
  const mock = mockGithub();
  const { state } = await obtainState(env);

  await withGithub(mock, async () => {
    for (const tampered of [`${state}x`, state.slice(0, -3), 'forged.state']) {
      const response = await worker.fetch(request(`/api/auth/callback?code=test-code&state=${encodeURIComponent(tampered)}`, { origin: '' }), env);
      assert.equal(response.status, 400, `被篡改的 state 必须拒绝：${tampered.slice(0, 12)}…`);
    }
    assert.equal(mock.calls.length, 0, '拒绝时绝不能调用 GitHub（否则等于替攻击者换 token）');
  });
});

test('用别的密钥签出来的 state 一律无效', async () => {
  const { env } = createEnv(AUTH_ENV);
  const forged = await signToken('another-secret-0123456789abcdefghijklmnop', { purpose: 'oauth-state', nonce: 'x', returnTo: ORIGIN });
  const mock = mockGithub();
  await withGithub(mock, async () => {
    const response = await worker.fetch(request(`/api/auth/callback?code=c&state=${encodeURIComponent(forged)}`, { origin: '' }), env);
    assert.equal(response.status, 400);
    assert.equal(mock.calls.length, 0);
  });
});

test('过期的 state 被拒绝', async () => {
  const { env } = createEnv(AUTH_ENV);
  const expired = await signToken(TOKEN_SECRET, { purpose: 'oauth-state', nonce: 'x', returnTo: ORIGIN }, {
    now: Date.now() - STATE_TTL_MS - 60_000,
    ttlMs: STATE_TTL_MS,
  });
  const mock = mockGithub();
  await withGithub(mock, async () => {
    const response = await worker.fetch(request(`/api/auth/callback?code=c&state=${encodeURIComponent(expired)}`, { origin: '' }), env);
    assert.equal(response.status, 400);
    assert.equal(mock.calls.length, 0);
  });
});

test('returnTo 不能把用户重定向到白名单之外的站点', async () => {
  const { env } = createEnv(AUTH_ENV);
  const { body, state } = await obtainState(env, 'https://evil.example/steal');
  assert.equal(body.returnTo, ORIGIN, '非白名单地址必须回退到主源');

  const mock = mockGithub();
  await withGithub(mock, async () => {
    const response = await worker.fetch(request(`/api/auth/callback?code=c&state=${encodeURIComponent(state)}`, { origin: '' }), env);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin, ORIGIN, '不得跳到 evil.example');
  });
});

test('会话令牌：伪造签名、过期、缺失都被 /api/auth/me 拒绝', async () => {
  const { env } = createEnv(AUTH_ENV);
  const valid = await signToken(TOKEN_SECRET, { purpose: 'session', sub: '1', login: 'a', name: 'a' });
  const forged = await signToken('wrong-secret-0123456789abcdefghijklmnop', { purpose: 'session', sub: '1', login: 'a', name: 'a' });
  const expired = await signToken(TOKEN_SECRET, { purpose: 'session', sub: '1', login: 'a', name: 'a' }, { now: Date.now() - SESSION_TTL_MS - 1000, ttlMs: SESSION_TTL_MS });

  const cases = [
    [null, 'missing'],
    [forged, 'bad-signature'],
    [expired, 'expired'],
    ['not-a-token', 'malformed'],
  ];
  for (const [token, reason] of cases) {
    const response = await worker.fetch(request('/api/auth/me', { headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
    const body = await response.json();
    assert.equal(response.status, 401, `${reason} 必须返回 401`);
    if (reason !== 'missing') assert.equal(body.reason, reason);
  }

  const ok = await worker.fetch(request('/api/auth/me', { headers: { authorization: `Bearer ${valid}` } }), env);
  assert.equal(ok.status, 200);
});

test('GitHub 报错时不泄露任何机密，也不会把用户当成已登录', async () => {
  const { env } = createEnv(AUTH_ENV);
  const mock = mockGithub({ tokenStatus: 200, tokenBody: { error: 'bad_verification_code', error_description: 'code expired' } });
  const { state } = await obtainState(env);
  await withGithub(mock, async () => {
    const response = await worker.fetch(request(`/api/auth/callback?code=bad&state=${encodeURIComponent(state)}`, { origin: '' }), env);
    const html = await response.text();
    assert.equal(response.status, 502, `错误页状态应为 502，实际 ${response.status}：${html.slice(0, 200)}`);
    assert.ok(!html.includes(CLIENT_SECRET), '错误页不得包含 client secret');
    assert.ok(!html.includes(ACCESS_TOKEN), '错误页不得包含 access token');
    assert.ok(!html.includes(TOKEN_SECRET), '错误页不得包含签名密钥');
    assert.equal(response.headers.get('location'), null, '失败时不得重定向（避免带出令牌）');
  });
});

test('用户在 GitHub 侧取消授权时给出可读提示', async () => {
  const { env } = createEnv(AUTH_ENV);
  const response = await worker.fetch(request('/api/auth/callback?error=access_denied', { origin: '' }), env);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /取消|拒绝/);
});

test('令牌签名往返：载荷最小化，且不含任何邮箱或密钥字段', async () => {
  const token = await signToken(TOKEN_SECRET, { purpose: 'session', sub: '42', login: 'x', name: 'y' });
  const verified = await verifyToken(TOKEN_SECRET, token);
  assert.equal(verified.ok, true);
  assert.equal(verified.payload.sub, '42');
  const payload = JSON.parse(Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'login', 'name', 'purpose', 'sub'], '载荷只放最小身份信息');
});

test('state 票据不能当作会话令牌使用（用途必须匹配）', async () => {
  const { env } = createEnv(AUTH_ENV);
  const { state } = await obtainState(env);
  const response = await worker.fetch(request('/api/auth/me', { headers: { authorization: `Bearer ${state}` } }), env);
  const body = await response.json();
  assert.equal(response.status, 401, '短期 state 票据不得换来登录态');
  assert.equal(body.reason, 'wrong-purpose');
});

test('登录端点不需要消耗模型额度，也不会触碰供应商密钥', async () => {
  const { env } = createEnv(AUTH_ENV);
  const { env: envWithoutProvider } = createEnv({ ...AUTH_ENV, PROVIDER_API_KEY: '' });
  // 供应商密钥缺失时整个 Worker 会 503——这验证了登录并没有绕开配置校验去调用什么
  const response = await worker.fetch(request('/api/auth/login'), envWithoutProvider);
  assert.equal(response.status, 503);
  const ok = await worker.fetch(request('/api/auth/login'), env);
  assert.equal(ok.status, 200);
});
