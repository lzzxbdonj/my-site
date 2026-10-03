import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { hashVisitor, readJsonBody, safeMessage } from '../../worker/src/index.js';
import { RateLimiter, createRateLimiterState } from '../../worker/src/ratelimit.js';
import { SERVER_VIDEO_IDS, SERVER_VIDEOS } from '../../worker/src/catalog.js';
import { makeValidCourse } from './support/fixture.mjs';

const ORIGIN = 'https://example.github.io';
const API_KEY = 'sk-test-provider-key-must-never-leak-123456';
const PYTHON_VIDEOS = SERVER_VIDEOS.filter((video) => video.subjectId === 'python').slice(0, 2);
const [SAMPLE_A, SAMPLE_B] = PYTHON_VIDEOS.map((video) => video.id);

function createEnv(overrides = {}) {
  const state = createRateLimiterState();
  const limiter = new RateLimiter(state, {});
  const namespace = {
    idFromName: (name) => name,
    get: () => ({ fetch: (url, init) => limiter.fetch(new Request(typeof url === 'string' ? url : url.url, init)) }),
    state,
  };
  return {
    namespace,
    env: {
      PROVIDER_BASE_URL: 'https://api.provider.example',
      PROVIDER_MODEL: 'mock-model',
      PROVIDER_API_KEY: API_KEY,
      ALLOWED_ORIGINS: ORIGIN,
      IP_SALT: 'test-salt-0123456789',
      VISITOR_DAILY_LIMIT: '10',
      SITE_DAILY_LIMIT: '100',
      MAX_CONCURRENT_PROVIDER_REQUESTS: '4',
      RATE_LIMITER: namespace,
      ...overrides,
    },
  };
}

function makeRequest({ path = '/api/course/generate', body = {}, origin = ORIGIN, method = 'POST', ip = '203.0.113.7', headers = {} } = {}) {
  return new Request(`https://worker.example${path}`, {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
      ...headers,
    },
    body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const generateBody = {
  topic: 'Python 编程',
  goal: 'starter',
  level: 'new',
  weeklyHours: 4,
  lessonMinutes: 40,
  videoLibrary: [{ id: 'spoofed-video-id', title: '伪造条目', creator: '攻击者', subjectId: 'python', knowledgePoints: ['fake'] }],
};

function providerResponse(course, { status = 200, finishReason = 'stop' } = {}) {
  return new Response(JSON.stringify({
    model: 'mock-model',
    choices: [{ message: { content: JSON.stringify(course) }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  }), { status, headers: { 'content-type': 'application/json' } });
}

async function withProvider(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const attempts = (namespace) => namespace.state.peek()?.siteAttempts ?? 0;

test('健康检查返回目录与额度摘要，但不泄露密钥', async () => {
  const { env } = createEnv();
  const response = await worker.fetch(makeRequest({ path: '/api/health', method: 'GET' }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.model, 'mock-model');
  assert.equal(body.catalog, `videos:${SERVER_VIDEOS.length}`);
  assert.equal(body.limits.visitorDailyLimit, 10);
  assert.equal(body.limits.siteDailyLimit, 100);
  assert.ok(body.limits.maxConcurrentProviderRequests >= 1);
  assert.ok(body.limits.maxOutputTokens >= 4000, '完整课程需要足够的输出预算');
  assert.ok(!JSON.stringify(body).includes(API_KEY), '健康检查不得包含密钥');
  assert.match(body.note, /不会返回给浏览器/);
});

test('缺少关键配置时拒绝服务，且绝不调用模型', async () => {
  await withProvider(() => { throw new Error('不应该调用模型'); }, async (calls) => {
    for (const overrides of [{ PROVIDER_API_KEY: '' }, { ALLOWED_ORIGINS: '' }, { IP_SALT: 'short' }, { PROVIDER_BASE_URL: '' }, { PROVIDER_MODEL: '' }]) {
      const { env } = createEnv(overrides);
      const response = await worker.fetch(makeRequest({ body: generateBody }), env);
      assert.equal(response.status, 503, `缺少 ${Object.keys(overrides)[0]} 时应 503`);
      assert.equal((await response.json()).error, 'worker-configuration-error');
    }
    assert.equal(calls.length, 0, '配置缺失时不得发起任何供应商请求');
  });
});

test('成功生成：只使用服务端已核实目录，客户端伪造条目被忽略', async () => {
  const { env, namespace } = createEnv();
  const course = makeValidCourse({ videoIds: [SAMPLE_A, SAMPLE_B] });
  await withProvider(() => providerResponse(course), async (calls) => {
    const response = await worker.fetch(makeRequest({ body: generateBody }), env);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body).slice(0, 200));
    assert.equal(body.ok, true);
    assert.equal(body.course.concepts.length, 4);
    assert.ok(body.meta.matchedVideoIds.every((id) => SERVER_VIDEO_IDS.has(id)), '返回的视频 id 必须来自服务端目录');
    assert.equal(body.meta.ignoredClientVideoEntries, 1, '应记录被忽略的客户端伪造条目');
    assert.match(body.meta.note, /未被采信/);
    assert.ok(!JSON.stringify(body).includes(API_KEY));
    const outbound = calls[0].init.body;
    assert.ok(SAMPLE_A && SAMPLE_B, '服务端目录里应有 Python 视频样本');
    assert.ok(PYTHON_VIDEOS.some((video) => outbound.includes(video.id)), '提示词应包含与服务端目录相关的视频 id');
    assert.ok(!outbound.includes('spoofed-video-id'), '提示词绝不能包含客户端伪造的视频 id');
    assert.equal(attempts(namespace), 1, '成功请求占用一次尝试额度');
  });
});

test('模型输出非法：返回 422，且尝试额度不可退款（供应商可能照样计费）', async () => {
  const { env, namespace } = createEnv();
  const broken = makeValidCourse({ videoIds: [] });
  broken.concepts[0].lesson.sections[0].body[0] = '带链接的段落 https://evil.example.com 长度足够但不应通过校验。';
  await withProvider(() => providerResponse(broken), async () => {
    const response = await worker.fetch(makeRequest({ body: generateBody }), env);
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.error, 'invalid-model-output');
    assert.match(body.note, /已计入每日尝试额度/);
    assert.equal(attempts(namespace), 1, '无效输出同样消耗尝试额度（不再退款）');
    assert.equal(namespace.state.peek().failures, 1);
    assert.equal(namespace.state.peek().activeReservations ?? 0, 0, 'finally 中必须释放并发预占');
  });
});

test('供应商 5xx 与超时：返回确定错误、释放并发预占、尝试额度仍被计入', async () => {
  const cases = [
    { name: '供应商 500', handler: () => new Response('boom', { status: 500 }), status: 502, error: 'provider-error' },
    { name: '超时', handler: () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; }, status: 504, error: 'provider-timeout' },
  ];
  for (const item of cases) {
    const { env, namespace } = createEnv();
    await withProvider(item.handler, async () => {
      const response = await worker.fetch(makeRequest({ body: generateBody }), env);
      const body = await response.json();
      assert.equal(response.status, item.status, item.name);
      assert.equal(body.error, item.error, item.name);
      assert.equal(attempts(namespace), 1, `${item.name}：尝试已发生，额度不退还`);
      assert.equal((namespace.state.peek().reservations && Object.keys(namespace.state.peek().reservations).length) || 0, 0, `${item.name}：并发预占必须释放`);
      assert.ok(!JSON.stringify(body).includes(API_KEY), `${item.name}：响应不得包含密钥`);
    });
  }
});

test('供应商响应被长度上限截断时明确报错，而不是返回半截课程', async () => {
  const { env } = createEnv();
  await withProvider(() => providerResponse(makeValidCourse(), { finishReason: 'length' }), async () => {
    const response = await worker.fetch(makeRequest({ body: generateBody }), env);
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.error, 'output-truncated');
    assert.match(body.message, /截断|长度上限/);
  });
});

test('CORS：预检与跨域请求都按白名单严格处理', async () => {
  const { env } = createEnv();
  const preflight = await worker.fetch(makeRequest({ method: 'OPTIONS', body: undefined }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);

  const blockedPreflight = await worker.fetch(makeRequest({ method: 'OPTIONS', origin: 'https://evil.example', body: undefined }), env);
  assert.equal(blockedPreflight.status, 403);
  assert.equal(blockedPreflight.headers.get('access-control-allow-origin'), null);

  await withProvider(() => { throw new Error('不应被调用'); }, async (calls) => {
    const post = await worker.fetch(makeRequest({ body: generateBody, origin: 'https://evil.example' }), env);
    assert.equal(post.status, 403);
    assert.equal(calls.length, 0, '非白名单来源不得触发供应商调用');
  });
});

test('尝试额度：访客上限与全站上限都返回 429，且不再发起供应商请求', async () => {
  const visitorEnv = createEnv({ VISITOR_DAILY_LIMIT: '2' });
  await withProvider(() => providerResponse(makeValidCourse()), async (calls) => {
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await worker.fetch(makeRequest({ body: generateBody }), visitorEnv.env)).status, 200, `第 ${i + 1} 次应成功`);
    }
    const third = await worker.fetch(makeRequest({ body: generateBody }), visitorEnv.env);
    const body = await third.json();
    assert.equal(third.status, 429);
    assert.equal(body.error, 'visitor-quota-exceeded');
    assert.match(body.message, /2 次\/天/);
    assert.equal((await worker.fetch(makeRequest({ body: generateBody, ip: '203.0.113.99' }), visitorEnv.env)).status, 200, '其他访客有自己的额度');
    assert.equal(calls.length, 3, '被拒绝的请求不得触发供应商调用');
  });

  const siteEnv = createEnv({ SITE_DAILY_LIMIT: '1' });
  await withProvider(() => providerResponse(makeValidCourse()), async () => {
    assert.equal((await worker.fetch(makeRequest({ body: generateBody, ip: '198.51.100.1' }), siteEnv.env)).status, 200);
    const blocked = await worker.fetch(makeRequest({ body: generateBody, ip: '198.51.100.2' }), siteEnv.env);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error, 'site-quota-exceeded');
  });
});

test('并发上限：同时进行的模型请求受限，超出者被拒绝且不发起调用', async () => {
  const { env, namespace } = createEnv({ MAX_CONCURRENT_PROVIDER_REQUESTS: '1' });
  await withProvider(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return providerResponse(makeValidCourse());
  }, async (calls) => {
    const [a, b] = await Promise.all([
      worker.fetch(makeRequest({ body: generateBody }), env),
      worker.fetch(makeRequest({ body: generateBody }), env),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 429], `并发结果应为 1 成功 1 拒绝，实际 ${statuses}`);
    const rejected = a.status === 429 ? a : b;
    assert.equal((await rejected.json()).error, 'concurrency-limit');
    assert.equal(calls.length, 1, '被并发限制拒绝的请求不得调用供应商');
    assert.equal(attempts(namespace), 1, '只有真正发起的请求才计入尝试额度');
  });
});

test('并发预占的释放是幂等的，并且跨午夜不会误伤第二天的额度', async () => {
  const state = createRateLimiterState();
  const limiter = new RateLimiter(state, {});
  const call = async (payload) => (await limiter.fetch(new Request('https://ratelimiter/', { method: 'POST', body: JSON.stringify(payload) }))).json();
  const day1 = Date.UTC(2026, 9, 3, 23, 59, 0);
  const day2 = Date.UTC(2026, 9, 4, 0, 1, 0);

  const reserved = await call({ action: 'reserve', visitorHash: 'v1', visitorAttemptLimit: 5, siteAttemptLimit: 5, maxConcurrent: 2, reservationTtlMs: 60000, now: day1 });
  assert.equal(reserved.allowed, true);
  assert.equal(reserved.counters.day, '2026-10-03');
  assert.equal(reserved.counters.siteAttempts, 1);

  // 第一次释放：正常释放
  const released = await call({ action: 'release', reservationId: reserved.reservationId, outcome: 'provider-error', now: day1 + 1000 });
  assert.equal(released.released, true);
  // 第二次释放同一个 id：幂等，不改动任何计数
  const again = await call({ action: 'release', reservationId: reserved.reservationId, outcome: 'provider-error', now: day1 + 2000 });
  assert.equal(again.alreadyReleased, true);
  assert.equal(again.counters.siteAttempts, 1, '重复释放不得递减尝试额度');

  // 跨天：新的一天从零开始，旧预占即使过期也只能影响自己那天
  const next = await call({ action: 'reserve', visitorHash: 'v1', visitorAttemptLimit: 5, siteAttemptLimit: 5, maxConcurrent: 2, now: day2 });
  assert.equal(next.counters.day, '2026-10-04');
  assert.equal(next.counters.siteAttempts, 1, '第二天只应记录自己的一次尝试');
  const staleRelease = await call({ action: 'release', reservationId: '2026-10-03:v1:zzz:abc', outcome: 'success', now: day2 });
  assert.equal(staleRelease.alreadyReleased, true, '未知/过期 id 视为已释放');
  assert.equal(staleRelease.counters.siteAttempts, 1, '跨天释放不得递减第二天计数');

  // 并发上限用过期时间兜底：预占过期后不再占用并发名额
  const expiredState = createRateLimiterState();
  const expiredLimiter = new RateLimiter(expiredState, {});
  const callExpired = async (payload) => (await expiredLimiter.fetch(new Request('https://ratelimiter/', { method: 'POST', body: JSON.stringify(payload) }))).json();
  await callExpired({ action: 'reserve', visitorHash: 'v2', visitorAttemptLimit: 5, siteAttemptLimit: 5, maxConcurrent: 1, reservationTtlMs: 1000, now: day1 });
  const blocked = await callExpired({ action: 'reserve', visitorHash: 'v2', visitorAttemptLimit: 5, siteAttemptLimit: 5, maxConcurrent: 1, reservationTtlMs: 1000, now: day1 + 500 });
  assert.equal(blocked.allowed, false);
  const afterTtl = await callExpired({ action: 'reserve', visitorHash: 'v2', visitorAttemptLimit: 5, siteAttemptLimit: 5, maxConcurrent: 1, reservationTtlMs: 1000, now: day1 + 2000 });
  assert.equal(afterTtl.allowed, true, '预占过期后应释放并发名额');
});

test('访客身份只看 Cloudflare 注入头；客户端自报的 IP 头一律忽略', async () => {
  const salt = 'salt-abcdefghijklmnop';
  const a = await hashVisitor(makeRequest({ ip: '203.0.113.7' }), salt);
  const b = await hashVisitor(makeRequest({ ip: '203.0.113.8' }), salt);
  assert.equal(a.hash, (await hashVisitor(makeRequest({ ip: '203.0.113.7' }), salt)).hash, '同一 IP 结果稳定');
  assert.notEqual(a.hash, b.hash, '不同 IP 得到不同哈希');
  assert.equal(a.trusted, true);

  const spoofed1 = await hashVisitor(makeRequest({ ip: '', headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4' } }), salt);
  const spoofed2 = await hashVisitor(makeRequest({ ip: '', headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '9.9.9.9' } }), salt);
  assert.equal(spoofed1.trusted, false);
  assert.equal(spoofed1.hash, spoofed2.hash, '自报 IP 头不得产生不同的访客身份');
  assert.notEqual(spoofed1.hash, a.hash, '缺失 CF 头时归入独立的共享桶');
});

test('请求体按 UTF-8 字节数限制，并在读取过程中即中止', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ topic: '中文'.repeat(50) })).byteLength;
  const request = new Request('https://worker.example/api/course/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: '中文'.repeat(50) }),
  });
  const tooSmall = await readJsonBody(request, bytes - 10);
  assert.equal(tooSmall.ok, false);
  assert.equal(tooSmall.status, 413);

  const big = new Request('https://worker.example/api/course/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: '中文'.repeat(50) }),
  });
  const okRead = await readJsonBody(big, bytes + 100);
  assert.equal(okRead.ok, true);
  assert.equal(okRead.value.topic.length, 100);

  const empty = await readJsonBody(new Request('https://worker.example/x', { method: 'POST', body: '' }), 100);
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'empty-body');

  const badJson = await readJsonBody(new Request('https://worker.example/x', { method: 'POST', body: '{oops' }), 100);
  assert.equal(badJson.error, 'invalid-json');
});

test('供应商地址已含 /v1 时不会重复拼接；错误信息会脱敏', async () => {
  for (const [base, expected] of [['https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions'], ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/chat/completions'], ['https://api.openai.com/v1/', 'https://api.openai.com/v1/chat/completions']]) {
    const { env } = createEnv({ PROVIDER_BASE_URL: base });
    await withProvider(() => providerResponse(makeValidCourse({ videoIds: [SAMPLE_A] })), async (calls) => {
      await worker.fetch(makeRequest({ body: generateBody }), env);
      assert.equal(calls[0].url, expected, `PROVIDER_BASE_URL=${base} 的最终地址`);
      assert.equal(calls[0].init.headers.authorization, `Bearer ${API_KEY}`);
    });
  }

  const scrubbed = safeMessage({ message: 'upstream said api_key=sk-live-abcdef123456 and Bearer sk-live-abcdef123456' });
  assert.ok(!scrubbed.includes('sk-live-abcdef123456'), '错误信息必须脱敏');
  assert.match(scrubbed, /已隐藏/);

  const { env: errEnv } = createEnv();
  await withProvider(() => { throw new Error(`provider rejected key ${API_KEY}`); }, async () => {
    const response = await worker.fetch(makeRequest({ body: generateBody }), errEnv);
    const text = await response.text();
    assert.ok(!text.includes(API_KEY), '异常信息不得回显密钥');
  });
});

test('缺少 Durable Object 绑定时拒绝服务（不假装有配额或并发保护）', async () => {
  const { env } = createEnv({ RATE_LIMITER: undefined });
  await withProvider(async () => { throw new Error('不应被调用'); }, async (calls) => {
    const response = await worker.fetch(makeRequest({ body: generateBody }), env);
    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
  });
});

test('AI 讲解接口：清理文本、过滤链接，并同样占用一次尝试额度', async () => {
  const { env, namespace } = createEnv();
  await withProvider(() => new Response(JSON.stringify({
    model: 'mock-model',
    choices: [{ message: { content: '<b>讲解</b> 这是模型生成的讲解正文，包含链接 https://spam.example.com 以及足够长的说明文字，满足最小长度要求。' }, finish_reason: 'stop' }],
  }), { status: 200 }), async () => {
    const response = await worker.fetch(makeRequest({ path: '/api/explain', body: { concept: { title: '向量', summary: '概述' } } }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(!body.text.includes('<b>'));
    assert.ok(!body.text.includes('https://spam.example.com'));
    assert.match(body.text, /\[链接已移除\]/);
    assert.equal(attempts(namespace), 1, '讲解同样占用一次尝试额度');
    assert.equal(namespace.state.peek().successes, 1);
  });

  const short = createEnv();
  await withProvider(() => new Response(JSON.stringify({ choices: [{ message: { content: '太短' }, finish_reason: 'stop' }] }), { status: 200 }), async () => {
    const response = await worker.fetch(makeRequest({ path: '/api/explain', body: { concept: { title: '向量' } } }), short.env);
    assert.equal(response.status, 422);
    assert.equal(attempts(short.namespace), 1, '无效讲解同样消耗尝试额度');
  });
});
