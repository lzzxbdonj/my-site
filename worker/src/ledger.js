/**
 * 按账号的信用点账本（Durable Object，一个账号一个实例）。
 *
 * 为什么用 Durable Object：账本必须**串行、原子、可幂等**。
 * 同一个账号的所有操作都落在同一个实例上，DO 的 storage.transaction 天然串行，
 * 因此不会出现「两个并发请求同时读到余额充足、各自扣一次」的超扣问题。
 *
 * 计费语义（与 docs/commercialization-plan.md 一致）：
 *  - **先预留、后结算**：发起一次模型调用前先 reserve，成功后 settle 成实际扣费，
 *    失败或不通过校验则 release（**不向用户收费**——这是商户自己承担的成本）。
 *  - **只对成功交付扣费**：失败调用不扣用户信用点（但供应商可能已经对我们计费，这笔由商户吸收）。
 *  - **幂等**：每次操作都带一个业务键（`jobId` / `orderId`）。同一个键重复到达只会生效一次，
 *    这是支付回调与网络重试下不重复扣费/不重复加点的关键。
 *
 * 金额一律用**整数信用点**，避免浮点误差。
 */

const MAX_HISTORY = 50;

/** 防止单个账号被写入无限多条幂等记录：老记录保留，但只保留最近 N 条用于对账查询。 */
function pushHistory(history, entry) {
  const next = [entry, ...(Array.isArray(history) ? history : [])];
  return next.slice(0, MAX_HISTORY);
}

/** 信用点一律是整数：**拒绝**小数（绝不静默取整，那会悄悄算错钱）。 */
function normalizeInt(value, { min = 0, max = 1_000_000 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function badRequest(error, message) {
  return Response.json({ ok: false, error, message }, { status: 400 });
}

export class AccountLedger {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest('invalid-json', '请求体必须是 JSON。');
    }
    const action = String(body?.action || '');
    const key = String(body?.key || '').slice(0, 120);
    const accountId = String(body?.accountId || '').slice(0, 80);

    try {
      switch (action) {
        case 'state': return await this.#run((txn) => this.#readState(txn));
        case 'reserve': return await this.#run((txn) => this.#reserve(txn, { key, amount: body.amount, note: body.note }));
        case 'settle': return await this.#run((txn) => this.#settle(txn, { key, amount: body.amount, note: body.note }));
        case 'release': return await this.#run((txn) => this.#release(txn, { key, note: body.note }));
        case 'grant': return await this.#run((txn) => this.#grant(txn, { key, amount: body.amount, note: body.note, accountId }));
        default: return badRequest('unknown-action', `不支持的操作：${action || '(空)'}`);
      }
    } catch (error) {
      return Response.json({ ok: false, error: 'ledger-error', message: String(error?.message || error) }, { status: 500 });
    }
  }

  /** 所有读写都在一个事务里完成；DO 会串行执行同一实例上的事务。 */
  async #run(fn) {
    return this.state.storage.transaction(async (txn) => {
      const result = await fn(txn);
      return Response.json(result.body, { status: result.status || 200 });
    });
  }

  async #readState(txn) {
    const balance = (await txn.get('balance')) || { credits: 0, reserved: 0, updatedAt: null };
    const history = (await txn.get('history')) || [];
    return {
      status: 200,
      body: {
        ok: true,
        balance: {
          credits: balance.credits || 0,
          reserved: balance.reserved || 0,
          available: (balance.credits || 0) - (balance.reserved || 0),
          updatedAt: balance.updatedAt || null,
        },
        history,
      },
    };
  }

  async #reserve(txn, { key, amount, note }) {
    if (!key) return { status: 400, body: { ok: false, error: 'missing-key', message: '预留必须带业务键（key）。' } };
    const value = normalizeInt(amount, { min: 1 });
    if (value === null) return { status: 400, body: { ok: false, error: 'bad-amount', message: '预留数量必须是正整数。' } };

    const existing = await txn.get(`txn:${key}`);
    if (existing) {
      // 幂等：同一个业务键重复预留，返回第一次的结果，绝不重复占用
      return { status: 200, body: { ok: true, idempotent: true, reservation: existing, ...(await this.#balanceOf(txn)) } };
    }

    const balance = (await txn.get('balance')) || { credits: 0, reserved: 0 };
    const available = (balance.credits || 0) - (balance.reserved || 0);
    if (available < value) {
      return { status: 402, body: { ok: false, error: 'insufficient-credits', message: `信用点不足：需要 ${value}，可用 ${available}。`, available, required: value } };
    }

    const reservation = { key, amount: value, status: 'reserved', note: String(note || '').slice(0, 120), createdAt: new Date().toISOString() };
    balance.reserved = (balance.reserved || 0) + value;
    balance.updatedAt = reservation.createdAt;
    await txn.put('balance', balance);
    await txn.put(`txn:${key}`, reservation);
    return { status: 200, body: { ok: true, reservation, ...(await this.#balanceOf(txn)) } };
  }

  async #settle(txn, { key, amount, note }) {
    if (!key) return { status: 400, body: { ok: false, error: 'missing-key', message: '结算必须带业务键（key）。' } };
    const reservation = await txn.get(`txn:${key}`);
    if (!reservation) return { status: 409, body: { ok: false, error: 'no-reservation', message: '找不到对应的预留，拒绝结算（避免凭空扣费）。' } };
    if (reservation.status === 'settled') return { status: 200, body: { ok: true, idempotent: true, reservation, ...(await this.#balanceOf(txn)) } };
    if (reservation.status === 'released') return { status: 409, body: { ok: false, error: 'already-released', message: '该预留已释放，不能再结算。' } };

    // 实际扣费不能超过预留额（超过说明调用方算错了，宁可按预留额结算并如实报告）
    const requested = amount === undefined || amount === null ? reservation.amount : normalizeInt(amount, { min: 0 });
    if (requested === null) return { status: 400, body: { ok: false, error: 'bad-amount', message: '结算数量必须是非负整数。' } };
    const actual = Math.min(requested, reservation.amount);

    const balance = (await txn.get('balance')) || { credits: 0, reserved: 0 };
    balance.reserved = Math.max(0, (balance.reserved || 0) - reservation.amount);
    balance.credits = Math.max(0, (balance.credits || 0) - actual);
    balance.updatedAt = new Date().toISOString();

    const settled = { ...reservation, status: 'settled', amount: actual, reservedAmount: reservation.amount, releasedAmount: reservation.amount - actual, note: String(note || reservation.note || '').slice(0, 120), settledAt: balance.updatedAt };
    await txn.put('balance', balance);
    await txn.put(`txn:${key}`, settled);
    const history = pushHistory(await txn.get('history'), { kind: 'charge', key, amount: actual, at: balance.updatedAt, note: settled.note });
    await txn.put('history', history);
    return { status: 200, body: { ok: true, reservation: settled, charged: actual, ...(await this.#balanceOf(txn)) } };
  }

  async #release(txn, { key, note }) {
    if (!key) return { status: 400, body: { ok: false, error: 'missing-key', message: '释放必须带业务键（key）。' } };
    const reservation = await txn.get(`txn:${key}`);
    if (!reservation) return { status: 200, body: { ok: true, idempotent: true, note: '没有预留需要释放', ...(await this.#balanceOf(txn)) } };
    if (reservation.status === 'released') return { status: 200, body: { ok: true, idempotent: true, reservation, ...(await this.#balanceOf(txn)) } };
    if (reservation.status === 'settled') return { status: 409, body: { ok: false, error: 'already-settled', message: '该预留已结算，不能再释放。' } };

    const balance = (await txn.get('balance')) || { credits: 0, reserved: 0 };
    balance.reserved = Math.max(0, (balance.reserved || 0) - reservation.amount);
    balance.updatedAt = new Date().toISOString();
    const released = { ...reservation, status: 'released', note: String(note || reservation.note || '').slice(0, 120), releasedAt: balance.updatedAt };
    await txn.put('balance', balance);
    await txn.put(`txn:${key}`, released);
    return { status: 200, body: { ok: true, reservation: released, ...(await this.#balanceOf(txn)) } };
  }

  /** 加点：只应由服务端（支付回调 / 管理员）调用，幂等键用订单号。 */
  async #grant(txn, { key, amount, note, accountId }) {
    if (!key) return { status: 400, body: { ok: false, error: 'missing-key', message: '加点必须带幂等键（通常用订单号）。' } };
    const value = normalizeInt(amount, { min: 1 });
    if (value === null) return { status: 400, body: { ok: false, error: 'bad-amount', message: '加点数量必须是正整数。' } };

    const existing = await txn.get(`grant:${key}`);
    if (existing) return { status: 200, body: { ok: true, idempotent: true, grant: existing, ...(await this.#balanceOf(txn)) } };

    const balance = (await txn.get('balance')) || { credits: 0, reserved: 0 };
    balance.credits = (balance.credits || 0) + value;
    balance.updatedAt = new Date().toISOString();
    const grant = { key, amount: value, accountId, note: String(note || '').slice(0, 120), at: balance.updatedAt };
    await txn.put('balance', balance);
    await txn.put(`grant:${key}`, grant);
    const history = pushHistory(await txn.get('history'), { kind: 'grant', key, amount: value, at: balance.updatedAt, note: grant.note });
    await txn.put('history', history);
    return { status: 200, body: { ok: true, grant, ...(await this.#balanceOf(txn)) } };
  }

  async #balanceOf(txn) {
    const balance = (await txn.get('balance')) || { credits: 0, reserved: 0 };
    return {
      balance: {
        credits: balance.credits || 0,
        reserved: balance.reserved || 0,
        available: (balance.credits || 0) - (balance.reserved || 0),
        updatedAt: balance.updatedAt || null,
      },
    };
  }
}
