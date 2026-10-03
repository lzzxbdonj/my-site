/**
 * Pages 反向代理（functions/api/[[path]].js）的测试。
 *
 * 这个代理是绕开 `workers.dev` 被封的关键一跳，因此必须证明：
 *  - 预检不发上游请求；
 *  - method / body / Authorization 被原样转发；
 *  - **对上游统一使用已登记的源**（否则上游会 403），
 *  - 但**回程 CORS 改写成真实请求方**，且白名单外的源拿不到放行头。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../../functions/api/[[path]].js';
import { defaultWorkerUrl } from '../../src/core/ai-client.js';

const UPSTREAM = 'https://studymate-ai-proxy.lzzxbdonj.workers.dev';
const GITHUB_ORIGIN = 'https://lzzxbdonj.github.io';
const PAGES_ORIGIN = 'https://ai-zixuetong.pages.dev';

function captureFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { impl, calls };
}

async function withFetch(mock, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mock.impl;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

const makeRequest = (path, { method = 'GET', origin = GITHUB_ORIGIN, headers = {}, body } = {}) =>
  new Request(`https://ai-zixuetong.pages.dev${path}`, {
    method,
    headers: { ...(origin ? { origin } : {}), ...headers },
    body,
  });

test('预检请求直接返回 204，且不打扰上游', async () => {
  const mock = captureFetch(() => new Response('{}', { status: 200 }));
  await withFetch(mock, async () => {
    const response = await onRequest({ request: makeRequest('/api/course/outline', { method: 'OPTIONS' }) });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), GITHUB_ORIGIN);
    assert.equal(mock.calls.length, 0, '预检不得触发上游请求（不消耗额度）');
  });
});

test('POST 被原样转发到上游，并使用已登记的源', async () => {
  const mock = captureFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
  await withFetch(mock, async () => {
    const payload = JSON.stringify({ topic: 'Python 入门' });
    const request = new Request('https://ai-zixuetong.pages.dev/api/course/outline', {
      method: 'POST',
      headers: { origin: GITHUB_ORIGIN, 'content-type': 'application/json' },
      body: payload,
    });
    const response = await onRequest({ request });
    assert.equal(response.status, 200);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${UPSTREAM}/api/course/outline`);
    assert.equal(mock.calls[0].init.method, 'POST');
    assert.equal(mock.calls[0].init.headers.get('origin'), GITHUB_ORIGIN, '必须带上上游白名单里的源');
    assert.equal(mock.calls[0].init.headers.get('content-type'), 'application/json');
  });
});

test('查询串、路径与 Authorization 头都保留', async () => {
  const mock = captureFetch(() => new Response(JSON.stringify({ ok: true, user: {} }), { status: 200 }));
  await withFetch(mock, async () => {
    await onRequest({
      request: makeRequest('/api/auth/me?x=1', { headers: { authorization: 'Bearer abc.def' } }),
    });
    assert.equal(mock.calls[0].url, `${UPSTREAM}/api/auth/me?x=1`);
    assert.equal(mock.calls[0].init.headers.get('authorization'), 'Bearer abc.def');
  });
});

test('回程 CORS 按真实请求方改写（github.io 与 pages.dev 都能用）', async () => {
  const mock = captureFetch(() => new Response('{}', { status: 200, headers: { 'access-control-allow-origin': 'https://stale.example' } }));
  await withFetch(mock, async () => {
    for (const origin of [GITHUB_ORIGIN, PAGES_ORIGIN]) {
      const response = await onRequest({ request: makeRequest('/api/health', { origin }) });
      assert.equal(response.headers.get('access-control-allow-origin'), origin, `应改写为 ${origin}`);
    }
  });
});

test('白名单外的来源拿不到放行头（不会把 API 变成公开代理）', async () => {
  const mock = captureFetch(() => new Response('{}', { status: 200 }));
  await withFetch(mock, async () => {
    const response = await onRequest({ request: makeRequest('/api/health', { origin: 'https://evil.example' }) });
    assert.notEqual(response.headers.get('access-control-allow-origin'), 'https://evil.example');
    assert.equal(response.headers.get('access-control-allow-origin'), GITHUB_ORIGIN);
  });
});

test('上游状态码与响应体被保留（含 422/429 这些业务错误）', async () => {
  const mock = captureFetch(() => new Response(JSON.stringify({ ok: false, error: 'output-truncated' }), { status: 422 }));
  await withFetch(mock, async () => {
    const response = await onRequest({ request: makeRequest('/api/course/lesson', { method: 'POST', body: '{}' }) });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error, 'output-truncated');
  });
});

test('上游不可达时返回 502 与可读原因，而不是空响应', async () => {
  const failing = { impl: async () => { throw new Error('connection reset'); }, calls: [] };
  await withFetch(failing, async () => {
    const response = await onRequest({ request: makeRequest('/api/health') });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error, 'upstream-unreachable');
    assert.match(body.message, /connection reset/);
  });
});

test('同源部署时默认代理地址取当前源；其它主机不乱猜', () => {
  assert.equal(
    defaultWorkerUrl({ hostname: 'ai-zixuetong.pages.dev', origin: 'https://ai-zixuetong.pages.dev' }),
    'https://ai-zixuetong.pages.dev',
  );
  assert.equal(defaultWorkerUrl({ hostname: 'pages.dev', origin: 'https://pages.dev' }), 'https://pages.dev');
  assert.equal(
    defaultWorkerUrl({ hostname: 'lzzxbdonj.github.io', origin: 'https://lzzxbdonj.github.io' }),
    '',
    'GitHub Pages 上没有同源 API，不能猜一个地址出来',
  );
  assert.equal(defaultWorkerUrl(null), '');
  assert.equal(defaultWorkerUrl({}), '');
});

test('访客 IP 会被透传给上游（若被 Cloudflare 覆盖则退化为共享计数，已在文件头说明）', async () => {
  const mock = captureFetch(() => new Response('{}', { status: 200 }));
  await withFetch(mock, async () => {
    await onRequest({ request: makeRequest('/api/health', { headers: { 'cf-connecting-ip': '203.0.113.9' } }) });
    assert.equal(mock.calls[0].init.headers.get('cf-connecting-ip'), '203.0.113.9');
  });
});
