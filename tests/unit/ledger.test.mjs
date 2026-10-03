/**
 * 信用点账本的测试。
 *
 * 计费的正确性直接关系到钱，所以这里覆盖的都是「出错就会真的算错钱」的场景：
 *  - 重复预留 / 重复结算 / 重复加点必须幂等（支付回调与网络重试都会重复到达）；
 *  - 并发预留不能超卖（Durable Object 事务串行）；
 *  - 失败要能释放预留且**不扣用户信用点**；
 *  - 找不到预留时拒绝结算，绝不凭空扣费；
 *  - 结算额超过预留额时按预留额封顶并如实报告。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountLedger } from '../../worker/src/ledger.js';

/** 模拟 Durable Object：storage.transaction 串行执行，和真实 DO 的语义一致。 */
function createFakeState() {
  const map = new Map();
  let chain = Promise.resolve();
  const kv = {
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
  };
  const storage = {
    ...kv,
    transaction(fn) {
      const run = chain.then(() => fn(kv));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { storage };
}

function call(ledger, body) {
  return ledger.fetch(new Request('https://ledger.worker/', { method: 'POST', body: JSON.stringify(body) }));
}

async function callJson(ledger, body) {
  const response = await call(ledger, body);
  return { status: response.status, data: await response.json() };
}

const newLedger = () => new AccountLedger(createFakeState(), {});
const state = (ledger) => callJson(ledger, { action: 'state' });

test('新账号余额为 0，可用 = 总额 - 预留', async () => {
  const ledger = newLedger();
  const { status, data } = await state(ledger);
  assert.equal(status, 200);
  assert.deepEqual({ credits: data.balance.credits, reserved: data.balance.reserved, available: data.balance.available }, { credits: 0, reserved: 0, available: 0 });
});

test('加点（支付成功）→ 余额增加；同一订单号重复回调只加一次', async () => {
  const ledger = newLedger();
  const first = await callJson(ledger, { action: 'grant', key: 'order-1', amount: 100, accountId: 'u1' });
  assert.equal(first.status, 200);
  assert.equal(first.data.balance.credits, 100);
  assert.equal(first.data.idempotent, undefined);

  const again = await callJson(ledger, { action: 'grant', key: 'order-1', amount: 100, accountId: 'u1' });
  assert.equal(again.status, 200);
  assert.equal(again.data.idempotent, true, '同一订单号必须幂等');
  assert.equal(again.data.balance.credits, 100, '绝不能重复加点');
});

test('预留 → 可用减少但总额不变；重复预留同一业务键幂等', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'o1', amount: 10, accountId: 'u1' });
  const r1 = await callJson(ledger, { action: 'reserve', key: 'job-a-os', amount: 1 });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.balance.credits, 10, '预留不动总额');
  assert.equal(r1.data.balance.reserved, 1);
  assert.equal(r1.data.balance.available, 9);

  const r2 = await callJson(ledger, { action: 'reserve', key: 'job-a-os', amount: 1 });
  assert.equal(r2.data.idempotent, true);
  assert.equal(r2.data.balance.reserved, 1, '重复预留不得重复占用');
});

test('余额不足时拒绝预留，并说明需要多少、可用多少', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'o1', amount: 2, accountId: 'u1' });
  const { status, data } = await callJson(ledger, { action: 'reserve', key: 'job-x', amount: 5 });
  assert.equal(status, 402);
  assert.equal(data.error, 'insufficient-credits');
  assert.equal(data.available, 2);
  assert.equal(data.required, 5);
});

test('结算：扣实际用量并释放剩余预留；重复结算幂等', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'o1', amount: 10, accountId: 'u1' });
  await callJson(ledger, { action: 'reserve', key: 'job-1', amount: 3 });
  const settled = await callJson(ledger, { action: 'settle', key: 'job-1', amount: 1 });
  assert.equal(settled.status, 200);
  assert.equal(settled.data.charged, 1);
  assert.equal(settled.data.balance.credits, 9, '只扣实际用量');
  assert.equal(settled.data.balance.reserved, 0, '剩余预留必须释放');
  assert.equal(settled.data.balance.available, 9);

  const again = await callJson(ledger, { action: 'settle', key: 'job-1', amount: 1 });
  assert.equal(again.data.idempotent, true);
  assert.equal(again.data.balance.credits, 9, '重复结算不得重复扣费');
});

test('结算额超过预留额时按预留额封顶并如实报告', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'o1', amount: 10, accountId: 'u1' });
  await callJson(ledger, { action: 'reserve', key: 'job-2', amount: 2 });
  const { data } = await callJson(ledger, { action: 'settle', key: 'job-2', amount: 99 });
  assert.equal(data.charged, 2, '不能扣超过预留');
  assert.equal(data.balance.credits, 8);
});

test('失败释放：预留归还，且不扣用户信用点', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'o1', amount: 5, accountId: 'u1' });
  await callJson(ledger, { action: 'reserve', key: 'job-fail', amount: 2 });
  const released = await callJson(ledger, { action: 'release', key: 'job-fail' });
  assert.equal(released.status, 200);
  assert.equal(released.data.balance.credits, 5, '失败不扣用户钱（成本由商户承担）');
  assert.equal(released.data.balance.reserved, 0);
  assert.equal(released.data.balance.available, 5);

  const again = await callJson(ledger, { action: 'release', key: 'job-fail' });
  assert.equal(again.data.idempotent, true);
});

test('找不到预留时拒绝结算：绝不凭空扣费', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'o1', amount: 5, accountId: 'u1' });
  const { status, data } = await callJson(ledger, { action: 'settle', key: 'never-reserved', amount: 1 });
  assert.equal(status, 409);
  assert.equal(data.error, 'no-reservation');
  const after = await state(ledger);
  assert.equal(after.data.balance.credits, 5, '余额不得变化');
});

test('已释放的预留不能再结算', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'o1', amount: 5, accountId: 'u1' });
  await callJson(ledger, { action: 'reserve', key: 'job-3', amount: 1 });
  await callJson(ledger, { action: 'release', key: 'job-3' });
  const { status, data } = await callJson(ledger, { action: 'settle', key: 'job-3', amount: 1 });
  assert.equal(status, 409);
  assert.equal(data.error, 'already-released');
});

test('并发预留不会超卖（事务串行）', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'o1', amount: 3, accountId: 'u1' });
  // 同时发起 10 个各要 1 点的预留，只能成功 3 个
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => callJson(ledger, { action: 'reserve', key: `job-${i}`, amount: 1 })));
  const ok = results.filter((r) => r.status === 200).length;
  const rejected = results.filter((r) => r.status === 402).length;
  assert.equal(ok, 3, `只能成功 3 个，实际 ${ok}`);
  assert.equal(rejected, 7);
  const after = await state(ledger);
  assert.equal(after.data.balance.reserved, 3);
  assert.equal(after.data.balance.available, 0);
});

test('流水只记录真正扣费与加点，且带上业务键与时间', async () => {
  const ledger = newLedger();
  await callJson(ledger, { action: 'grant', key: 'order-9', amount: 5, accountId: 'u1', note: '充值' });
  await callJson(ledger, { action: 'reserve', key: 'job-9', amount: 2 });
  await callJson(ledger, { action: 'settle', key: 'job-9', amount: 1 });
  const { data } = await state(ledger);
  assert.equal(data.history.length, 2, '预留不进流水，只有扣费与加点进流水');
  assert.equal(data.history[0].kind, 'charge');
  assert.equal(data.history[0].amount, 1);
  assert.equal(data.history[0].key, 'job-9');
  assert.ok(data.history[0].at, '流水必须带时间');
  assert.equal(data.history[1].kind, 'grant');
});

test('非法输入被拒绝：缺业务键、非整数金额、未知操作', async () => {
  const ledger = newLedger();
  assert.equal((await callJson(ledger, { action: 'reserve', amount: 1 })).status, 400);
  assert.equal((await callJson(ledger, { action: 'reserve', key: 'k', amount: 0 })).status, 400);
  assert.equal((await callJson(ledger, { action: 'reserve', key: 'k', amount: 1.5 })).status, 400);
  assert.equal((await callJson(ledger, { action: 'grant', key: 'k', amount: -5 })).status, 400);
  assert.equal((await callJson(ledger, { action: 'nonsense' })).status, 400);
  const bad = await ledger.fetch(new Request('https://ledger.worker/', { method: 'POST', body: 'not json' }));
  assert.equal(bad.status, 400);
});
