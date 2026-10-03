/**
 * GitHub 登录的前端客户端。
 *
 * 关键取舍：会话令牌存放在**独立的 localStorage 键**里，而不是主状态对象中。
 *  - 备份导出（exportState）天然不会包含它，无需改动既有状态 schema 与清洗逻辑；
 *  - 「清空本地数据」会显式一并清除（见 clearAuthToken 的调用点）。
 * 代价：令牌落在 localStorage，同源脚本可读。这是「静态站点 + 跨站 API」下的
 * 常见取舍；若将来前端与接口同源，应改为 HttpOnly + Secure 的同站 Cookie。
 */

import { normalizeWorkerUrl } from './ai-client.js';

export const AUTH_TOKEN_KEY = 'studymate.auth.v1';
const AUTH_DEADLINE_MS = 15000;

function backendOrDefault(backend) {
  if (backend) return backend;
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function createAuthTokenStore(backend) {
  const store = backendOrDefault(backend);
  return {
    read() {
      if (!store) return '';
      try { return String(store.getItem(AUTH_TOKEN_KEY) || ''); } catch { return ''; }
    },
    write(token) {
      if (!store) return false;
      try { store.setItem(AUTH_TOKEN_KEY, String(token)); return true; } catch { return false; }
    },
    clear() {
      if (!store) return false;
      try { store.removeItem(AUTH_TOKEN_KEY); return true; } catch { return false; }
    },
  };
}

export function clearAuthToken(backend) {
  return createAuthTokenStore(backend).clear();
}

async function getJson(url, { token = '', fetchImpl = globalThis.fetch, timeoutMs = AUTH_DEADLINE_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON 响应保持 null */ }
    if (!data) return { ok: false, code: 'bad-response', error: `服务返回了无法解析的内容（HTTP ${response.status}）。` };
    if (!response.ok) {
      return { ok: false, code: data.error || `http-${response.status}`, error: data.message || `请求失败（HTTP ${response.status}）。`, reason: data.reason || null };
    }
    return { ok: true, data };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, code: 'timeout', error: '请求超时。' };
    return { ok: false, code: 'network-error', error: `网络请求失败：${error?.message || error}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 取回 GitHub 授权地址（服务端会签名一个防 CSRF 的 state）。 */
export async function startGithubLogin({ workerUrl, returnTo, fetchImpl = globalThis.fetch } = {}) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized.ok) return { ok: false, code: 'bad-worker-url', error: normalized.reason };
  const url = new URL(`${normalized.base}/api/auth/login`);
  if (returnTo) url.searchParams.set('return', returnTo);
  const result = await getJson(url.toString(), { fetchImpl });
  if (!result.ok) return result;
  if (!result.data?.url) return { ok: false, code: 'bad-response', error: '服务没有返回登录地址。' };
  return { ok: true, url: result.data.url, returnTo: result.data.returnTo || '' };
}

/** 校验当前令牌并取回登录用户。 */
export async function fetchSession({ workerUrl, token, fetchImpl = globalThis.fetch } = {}) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized.ok) return { ok: false, code: 'bad-worker-url', error: normalized.reason };
  if (!token) return { ok: false, code: 'no-token', error: '尚未登录。' };
  const result = await getJson(`${normalized.base}/api/auth/me`, { token, fetchImpl });
  if (!result.ok) return result;
  if (!result.data?.user) return { ok: false, code: 'bad-response', error: '服务没有返回用户信息。' };
  return { ok: true, user: result.data.user };
}

/** 从 /api/health 读取该 Worker 是否配置了登录（用于在界面上区分「未配置」与「未登录」）。 */
export async function fetchAuthSupport({ workerUrl, fetchImpl = globalThis.fetch } = {}) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized.ok) return { ok: false, code: 'bad-worker-url', error: normalized.reason };
  const result = await getJson(`${normalized.base}/api/health`, { fetchImpl });
  if (!result.ok) return result;
  return { ok: true, enabled: Boolean(result.data?.auth?.enabled), error: result.data?.auth?.error || null };
}

/**
 * 从回跳路由的 query 里取出令牌。
 * 只接受「看起来像令牌」的值（两段 base64url 用点连接），避免把任意字符串写进存储。
 */
export function readCallbackToken(query = {}) {
  const token = typeof query?.token === 'string' ? query.token.trim() : '';
  if (!token) return '';
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : '';
}
