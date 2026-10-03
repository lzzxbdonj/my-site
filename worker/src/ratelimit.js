/**
 * 原子配额与并发控制（Durable Object）。
 *
 * 为什么用 Durable Object：KV 计数器最终一致，两个并发请求可能同时读到「还有 1 次」而突破上限。
 * Durable Object 的单实例串行 + storage 读写在 blockConcurrencyWhile 内组合，是可靠的原子操作
 * （await storage 期间输入门会挡住其他事件，因此「读 → 判断 → 写」不会交错）。
 *
 * 语义（按安全审查修正）：
 *  - 只要真的发起了供应商请求，就占用一次「模型尝试」额度，**不可退款**：
 *    供应商可能对失败或结构非法的调用照样计费，所以不能承诺「失败不计费」。
 *  - 尝试额度有两层硬上限：每位访客/每天 + 全站/每天；用尽即拒绝，不发起任何供应商请求。
 *  - 并发上限由带过期时间的预占 ID 保证：reserve 创建预占，finally 中 release；
 *    release 幂等（重复释放或释放已过期/不存在的 ID 都不产生副作用），
 *    且只作用于自己那一天的计数，跨午夜不会误伤第二天的额度。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: 'bad-request' }, 400);
    }
    return this.state.blockConcurrencyWhile(async () => {
      const now = Number.isFinite(Number(payload.now)) ? Number(payload.now) : Date.now();
      const counters = normalize(await this.state.storage.get('counters'), now);
      const visitor = typeof payload.visitorHash === 'string' && payload.visitorHash.length <= 64 && payload.visitorHash !== ''
        ? payload.visitorHash
        : 'unknown';
      const respond = (body) => json({ ...body, counters: snapshot(counters, visitor) });

      if (payload.action === 'stats') {
        return respond({ ok: true, stats: { day: counters.day, siteAttempts: counters.siteAttempts, successes: counters.successes, failures: counters.failures, active: Object.keys(counters.reservations).length, visitors: Object.keys(counters.visitors).length } });
      }

      if (payload.action === 'reserve') {
        const result = reserve(counters, payload, visitor, now);
        if (result.allowed) await this.state.storage.put('counters', counters);
        return respond(result);
      }

      if (payload.action === 'release') {
        const result = release(counters, payload, now);
        if (result.changed) await this.state.storage.put('counters', counters);
        return respond(result);
      }

      return json({ ok: false, error: 'unknown-action' }, 400);
    });
  }
}

function reserve(counters, payload, visitor, now) {
  const visitorAttemptLimit = limit(payload.visitorAttemptLimit);
  const siteAttemptLimit = limit(payload.siteAttemptLimit);
  const maxConcurrent = limit(payload.maxConcurrent) || 1;
  const ttl = limit(payload.reservationTtlMs) || 180000;
  // 一次请求可能包含多次模型调用（按节生成），因此额度按**真实调用次数**计费：
  // 默认 1；调用方预先声明本次要发起的调用数，避免限额被低估。
  const cost = Math.max(1, Math.min(limit(payload.cost) || 1, 32));

  purgeExpired(counters, now);
  const active = Object.keys(counters.reservations).length;

  if (active >= maxConcurrent) return { ok: false, allowed: false, reason: 'concurrency-limit' };
  if (counters.siteAttempts + cost > siteAttemptLimit) return { ok: false, allowed: false, reason: 'site-attempt-limit' };
  if ((counters.visitors[visitor] || 0) + cost > visitorAttemptLimit) return { ok: false, allowed: false, reason: 'visitor-attempt-limit' };

  const reservationId = `${counters.day}:${visitor}:${now.toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  counters.reservations[reservationId] = { day: counters.day, at: now, expiresAt: now + ttl, cost };
  counters.siteAttempts += cost;
  counters.visitors[visitor] = (counters.visitors[visitor] || 0) + cost;
  counters.attemptDays[counters.day] = counters.attemptDays[counters.day] || {};
  counters.attemptDays[counters.day][visitor] = (counters.attemptDays[counters.day][visitor] || 0) + cost;
  return { ok: true, allowed: true, reservationId, day: counters.day, cost, changed: true };
}

function release(counters, payload, now) {
  const reservationId = typeof payload.reservationId === 'string' ? payload.reservationId : '';
  const outcome = ['success', 'invalid-output', 'provider-error', 'timeout', 'client-abort', 'unknown'].includes(payload.outcome)
    ? payload.outcome
    : 'unknown';
  const reservation = counters.reservations[reservationId];

  if (!reservation) {
    // 幂等：重复释放、释放过期条目、释放他人 ID 都不会改动任何计数
    return { ok: true, alreadyReleased: true, outcome, changed: false };
  }
  if (reservation.expiresAt <= now) {
    delete counters.reservations[reservationId];
    return { ok: true, alreadyReleased: true, expired: true, outcome, changed: true };
  }

  delete counters.reservations[reservationId];
  // 只记录结果，不退还当天已经消耗的尝试额度（尝试是不可退款的）
  const record = counters.outcomes[reservation.day] = counters.outcomes[reservation.day] || { success: 0, failure: 0 };
  if (outcome === 'success') {
    counters.successes += 1;
    record.success += 1;
  } else {
    counters.failures += 1;
    record.failure += 1;
  }
  return { ok: true, released: true, day: reservation.day, outcome, changed: true };
}

function purgeExpired(counters, now) {
  for (const [id, reservation] of Object.entries(counters.reservations)) {
    if (!reservation || !Number.isFinite(reservation.expiresAt) || reservation.expiresAt <= now) delete counters.reservations[id];
  }
}

function normalize(raw, now) {
  const day = dayKey(now);
  const counters = {
    day,
    siteAttempts: 0,
    visitors: {},
    attemptDays: {},
    outcomes: {},
    successes: 0,
    failures: 0,
    reservations: {},
    ...(raw && typeof raw === 'object' ? raw : {}),
  };
  counters.reservations = plain(counters.reservations);
  counters.visitors = plain(counters.visitors);
  counters.attemptDays = plain(counters.attemptDays);
  counters.outcomes = plain(counters.outcomes);
  if (counters.day !== day) {
    // 跨天：当天计数从零开始；历史日期桶保留（release 仍可归属到原来那一天）
    counters.day = day;
    counters.siteAttempts = 0;
    counters.visitors = {};
    counters.successes = 0;
    counters.failures = 0;
    counters.reservations = {};
  }
  counters.siteAttempts = Math.max(0, Math.floor(Number(counters.siteAttempts) || 0));
  counters.successes = Math.max(0, Math.floor(Number(counters.successes) || 0));
  counters.failures = Math.max(0, Math.floor(Number(counters.failures) || 0));
  purgeExpired(counters, now);
  return counters;
}

function plain(value) {
  const out = {};
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      out[key] = item;
    }
  }
  return out;
}

function snapshot(counters, visitor) {
  return {
    day: counters.day,
    visitorAttempts: counters.visitors[visitor] || 0,
    siteAttempts: counters.siteAttempts,
    activeReservations: Object.keys(counters.reservations).length,
    successes: counters.successes,
    failures: counters.failures,
  };
}

/**
 * 供测试与本地运行使用的状态适配器：
 * 提供 storage.get/put 与 blockConcurrencyWhile（用 promise 链串行化，模拟 Durable Object 的输入门）。
 */
export function createRateLimiterState(rawStorage) {
  const memory = new Map();
  const store = rawStorage || {
    get: async (key) => memory.get(key),
    put: async (key, value) => { memory.set(key, value); },
  };
  let tail = Promise.resolve();
  const latest = new Map();
  return {
    storage: {
      get: async (key) => {
        const value = await store.get(key);
        if (value !== undefined) latest.set(key, value);
        return value;
      },
      put: async (key, value) => {
        latest.set(key, value);
        await store.put(key, value);
      },
    },
    blockConcurrencyWhile(fn) {
      const run = tail.then(fn, fn);
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    /** 同步查看最近一次写入的计数（测试用）。 */
    peek: () => latest.get('counters'),
  };
}

function limit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1000000, Math.floor(n));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export { DAY_MS, dayKey };
