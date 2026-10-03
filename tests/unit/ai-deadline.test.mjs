import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKER_DEADLINES, generateCourseViaWorker, explainViaWorker } from '../../src/core/ai-client.js';
import { DEFAULTS } from '../../worker/src/config.js';
import { makeValidCourse } from './support/fixture.mjs';

/** 一个在指定毫秒后才返回（或永不返回）的假 fetch，用于验证真实的中断时机。 */
function delayedFetch(delayMs, { payload = null, never = false } = {}) {
  const calls = [];
  const impl = (url, init) => {
    calls.push({ url, init });
    return new Promise((resolve, reject) => {
      const signal = init?.signal;
      const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      if (never) return;
      setTimeout(() => {
        resolve(new Response(JSON.stringify(payload ?? { ok: true, course: makeValidCourse(), meta: { model: 'mock' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }, delayMs);
    });
  };
  return { impl, calls };
}

test('前端截止时间必须高于 Worker 的供应商超时默认值（含余量）', () => {
  // 四个端点（含大纲）都要有明确余量：任何一个等于供应商超时，前端都会在
  // 「已经发出、可能已计费」的调用返回前先放弃，用户既拿不到结果又白花钱。
  for (const [name, value] of Object.entries(WORKER_DEADLINES)) {
    assert.ok(value > DEFAULTS.timeoutMs, `${name} 截止时间 ${value} 必须大于 Worker 默认超时 ${DEFAULTS.timeoutMs}`);
    assert.ok(value - DEFAULTS.timeoutMs >= 30000, `${name} 至少留 30 秒网络与校验余量（实际 ${value - DEFAULTS.timeoutMs}ms）`);
  }
  assert.equal(WORKER_DEADLINES.outline, WORKER_DEADLINES.lesson, '大纲与知识点段共用同一等待上限，便于运维统一调整');
  assert.equal(WORKER_DEADLINES.outline, WORKER_DEADLINES.generate);
});

test('所有端点的默认截止时间一致（避免某个端点被悄悄调回 90 秒）', () => {
  const values = new Set(Object.values(WORKER_DEADLINES));
  assert.equal(values.size, 1, `WORKER_DEADLINES 应保持同一数值，实际 ${JSON.stringify(WORKER_DEADLINES)}`);
});

test('真实超时仍会生效：截止时间到点即中断并返回 timeout', async () => {
  const { impl } = delayedFetch(0, { never: true });
  const started = Date.now();
  const result = await generateCourseViaWorker({ workerUrl: 'https://w.example', payload: {}, fetchImpl: impl, timeoutMs: 60 });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'timeout');
  assert.match(result.error, /超时/);
  assert.ok(elapsed >= 40 && elapsed < 2000, `应在配置的截止时间附近中断，实际 ${elapsed}ms`);
});

test('不会在预期的供应商窗口内提前中断：窗口内的慢响应依然成功', async () => {
  const { impl } = delayedFetch(120);
  const started = Date.now();
  const result = await generateCourseViaWorker({ workerUrl: 'https://w.example', payload: {}, fetchImpl: impl, timeoutMs: 1500 });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, true, '供应商在截止时间内返回时必须成功，不能被提前中断');
  assert.equal(result.meta.model, 'mock');
  assert.ok(elapsed >= 100, `成功路径应确实等待了供应商，实际 ${elapsed}ms`);
});

test('默认截止时间不会被短响应或稍慢响应触发（默认值下不提前放弃）', async () => {
  const { impl } = delayedFetch(150);
  const result = await generateCourseViaWorker({ workerUrl: 'https://w.example', payload: {}, fetchImpl: impl });
  assert.equal(result.ok, true, '默认截止时间（120 秒）下 150ms 的响应必须成功');
});

test('讲解接口使用同一套对齐后的截止时间', async () => {
  assert.equal(WORKER_DEADLINES.explain, WORKER_DEADLINES.generate, '两个端点的默认截止时间保持一致，便于运维统一调整');
  const { impl } = delayedFetch(80, { payload: { ok: true, text: '这是一段足够长的讲解内容，用于验证讲解接口在预期窗口内不会被提前中断。', meta: { model: 'mock' } } });
  const started = Date.now();
  const result = await explainViaWorker({ workerUrl: 'https://w.example', payload: { concept: { title: '向量' } }, fetchImpl: impl, timeoutMs: 1500 });
  assert.equal(result.ok, true);
  assert.ok(Date.now() - started >= 60);
});
