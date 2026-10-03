/**
 * 账号 / 信用点账本 HTTP 接口的测试。
 *
 * 重点：
 *  - 余额接口必须**登录后才能读**（用 GitHub 的 sub 作为账号，用户名可改所以不用它）；
 *  - 支付回调（加点）必须校验 `x-payment-secret`，且以**订单号幂等**；
 *  - 不同账号的账本互相隔离；
 *  - 未配置支付密钥时拒绝加点（宁可不可用，也不接受无鉴权的加点）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/src/index.js';
import { AccountLedger } from '../../worker/src/ledger.js';
import { signToken } from '../../worker/src/auth.js';
import { RateLimiter, createRateLimiterState } from '../../worker/src/ratelimit.js';

const ORIGIN = 'https://ai-zixuetong.pages.dev';
const TOKEN_SECRET = 'test-token-secret-0123456789abcdefghijklmnop';
const WEBHOOK_SECRET = 'payment-webhook-secret-0123456789';

function fakeLedgerState() {
  const map = new Map();
  let chain = Promise.resolve();
  const kv = { async get(k) { return map.get(k); }, async put(k, v) { map.set(k, v); } };
  return {
    storage: {
      ...kv,
      transaction(fn) {
        const run = chain.then(() => fn(kv));
        chain = run.then(() => undefined, () => undefined);
        return run;
      },
    },
  };
}

function ledgerNamespace() {
  const instances = new Map();
  return {
    idFromName: (name) => name,
    get: (name) => {
      if (!instances.has(name)) instances.set(name, new AccountLedger(fakeLedgerState(), {}));
      const ledger = instances.get(name);
      return { fetch: (url, init) => ledger.fetch(new Request(typeof url === 'string' ? url : url.url, init)) };
    },
  };
}

function createEnv(overrides = {}) {
  const rateState = createRateLimiterState();
  const limiter = new RateLimiter(rateState, {});
  const rateNamespace = {
    idFromName: (name) => name,
    get: () => ({ fetch: (url, init) => limiter.fetch(new Request(typeof url === 'string' ? url : url.url, init)) }),
    state: rateState,
  };
  return {
    env: {
      PROVIDER_BASE_URL: 'https://api.provider.example',
      PROVIDER_MODEL: 'mock-model',
      PROVIDER_API_KEY: 'sk-test',
      ALLOWED_ORIGINS: ORIGIN,
      IP_SALT: 'test-salt-0123456789',
      RATE_LIMITER: rateNamespace,
      ACCOUNT_LEDGER: ledgerNamespace(),
      GITHUB_CLIENT_ID: 'Ov23li-test',
      GITHUB_CLIENT_SECRET: 'client-secret',
      AUTH_TOKEN_SECRET: TOKEN_SECRET,
      ...overrides,
    },
  };
}

function request(path, { method = 'GET', headers = {} } = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: { origin: ORIGIN, ...headers },
  });
}

async function sessionToken(sub = '1001', login = 'octocat') {
  return signToken(TOKEN_SECRET, { purpose: 'session', sub, login, name: login });
}

async function getBalance(env, token) {
  const response = await worker.fetch(request('/api/account', { headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
  return { status: response.status, data: await response.json() };
}

function grantRequest(body, { secret = WEBHOOK_SECRET } = {}) {
  return new Request('https://worker.example/api/account/grant', {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      ...(secret ? { 'x-payment-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('未登录读余额：401，且不泄露任何账号信息', async () => {
  const { env } = createEnv({ PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET });
  const { status, data } = await getBalance(env, null);
  assert.equal(status, 401);
  assert.equal(data.error, 'unauthorized');
  assert.equal(data.user, undefined);

  const forged = await getBalance(env, 'aaa.bbb');
  assert.equal(forged.status, 401);
});

test('已登录读余额：返回余额、活跃预留与用户身份', async () => {
  const { env } = createEnv({ PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET });
  const token = await sessionToken('1001', 'octocat');
  const { status, data } = await getBalance(env, token);
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.balance.credits, 0);
  assert.equal(data.balance.available, 0);
  assert.equal(data.user.sub, '1001');
  assert.equal(data.user.login, 'octocat');
  assert.deepEqual(data.history, []);
});

test('未配置支付密钥时拒绝加点（宁可不可用，也不接受无鉴权加点）', async () => {
  const { env } = createEnv();
  const response = await worker.fetch(grantRequest({ accountId: '1001', orderId: 'o1', amount: 10 }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'grant-not-configured');
});

test('支付回调密钥错误：403，且不加点', async () => {
  const { env } = createEnv({ PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET });
  const bad = await worker.fetch(grantRequest({ accountId: '1001', orderId: 'o1', amount: 10 }, { secret: 'wrong-secret-0123456789' }), env);
  assert.equal(bad.status, 403);
  const none = await worker.fetch(grantRequest({ accountId: '1001', orderId: 'o1', amount: 10 }, { secret: '' }), env);
  assert.equal(none.status, 403);

  const token = await sessionToken('1001');
  const { data } = await getBalance(env, token);
  assert.equal(data.balance.credits, 0, '鉴权失败绝不能加点');
});

test('支付成功回调加点：以订单号幂等，重复回调不重复加点', async () => {
  const { env } = createEnv({ PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET });
  const first = await worker.fetch(grantRequest({ accountId: '1001', orderId: 'order-abc', amount: 50, note: '充值 50 点' }), env);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.balance.credits, 50);

  const again = await worker.fetch(grantRequest({ accountId: '1001', orderId: 'order-abc', amount: 50 }), env);
  const againBody = await again.json();
  assert.equal(againBody.idempotent, true);
  assert.equal(againBody.balance.credits, 50, '同一订单号只能加一次');

  const token = await sessionToken('1001');
  const { data } = await getBalance(env, token);
  assert.equal(data.balance.credits, 50);
  assert.equal(data.history.length, 1);
});

test('不同账号的账本互相隔离', async () => {
  const { env } = createEnv({ PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET });
  await worker.fetch(grantRequest({ accountId: '1001', orderId: 'o-a', amount: 10 }), env);
  await worker.fetch(grantRequest({ accountId: '2002', orderId: 'o-b', amount: 7 }), env);
  const a = await getBalance(env, await sessionToken('1001'));
  const b = await getBalance(env, await sessionToken('2002'));
  assert.equal(a.data.balance.credits, 10);
  assert.equal(b.data.balance.credits, 7);
});

test('加点参数不合法时 400，且不改动余额', async () => {
  const { env } = createEnv({ PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET });
  for (const body of [{ orderId: 'o1', amount: 10 }, { accountId: '1001', amount: 10 }, { accountId: '1001', orderId: 'o1', amount: 0 }, { accountId: '1001', orderId: 'o1', amount: 1.5 }]) {
    const response = await worker.fetch(grantRequest(body), env);
    assert.equal(response.status, 400, `应拒绝：${JSON.stringify(body)}`);
  }
  const { data } = await getBalance(env, await sessionToken('1001'));
  assert.equal(data.balance.credits, 0);
});

test('默认不开启信用点拦截（REQUIRE_CREDITS 未设时 requireCredits=false）', async () => {
  const { env } = createEnv({ PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET });
  const { data } = await getBalance(env, await sessionToken('1001'));
  assert.equal(data.requireCredits, false, '没接支付前不能因为没点数就拦住所有人');
  assert.equal(data.pricing, null);
});

test('开启 REQUIRE_CREDITS 后：返回定价，且缺登录配置时明确报错', async () => {
  const { env } = createEnv({ PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET, REQUIRE_CREDITS: 'true', CREDITS_PER_OUTLINE: '2', CREDITS_PER_LESSON: '3' });
  const { data } = await getBalance(env, await sessionToken('1001'));
  assert.equal(data.requireCredits, true);
  assert.deepEqual(data.pricing, { outline: 2, lesson: 3 });

  const { env: noAuth } = createEnv({ REQUIRE_CREDITS: 'true', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', AUTH_TOKEN_SECRET: '' });
  const health = await worker.fetch(request('/api/health'), noAuth);
  const body = await health.json();
  assert.match(body.credits.error || '', /必须同时配置 GitHub 登录/, '开启收费必须先有登录');
});
