/**
 * GitHub 登录（OAuth）与无状态会话令牌。
 *
 * 为什么不用 Cookie 会话：前端在 *.github.io、后端在 *.workers.dev，二者属于**不同站点**，
 * 跨站 Cookie 会被 SameSite 与浏览器第三方 Cookie 策略拦住，因此这里签发
 * **Authorization: Bearer <token>** 形式的令牌，由前端保存并在请求里带上。
 *
 * 为什么令牌是「无状态」的（HMAC 签名，不落库）：
 *  - 不需要新增 D1/KV/Durable Object 绑定与迁移，部署面最小；
 *  - 代价是**无法在到期前单独吊销**某个令牌。因此令牌有明确有效期（默认 30 天），
 *    且一旦服务端更换 AUTH_TOKEN_SECRET，所有旧令牌立即失效。
 *    需要「立即下线某个账号」时，请改成服务端存储（D1/KV）并在校验时查表——这是已知的取舍。
 *
 * 安全要点：
 *  - `state` 是**签名过**的短期票据（含随机数、时间戳、returnTo），用于防登录 CSRF 与开放重定向；
 *  - `returnTo` 只允许落在已配置的站点源上，其他一律回退到主源（不信任客户端传来的任意地址）；
 *  - 令牌摘要用常量时间比较；载荷里只放最小身份信息（不含邮箱、不含任何密钥）；
 *  - 任何错误路径都不回显 client secret 或 access token。
 */

const encoder = new TextEncoder();

/** 会话令牌默认有效期 30 天；state 票据 10 分钟。 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STATE_TTL_MS = 10 * 60 * 1000;

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_USER = 'https://api.github.com/user';

/** 只申请读取公开资料所需的 scope，不申请 email（尽量小权限）。 */
export const GITHUB_SCOPE = 'read:user';

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** 常量时间比较，避免用摘要比较结果泄露信息。 */
export function timingSafeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

/** 签发「载荷.签名」形式的令牌；payload 是普通对象，额外写入 exp。 */
export async function signToken(secret, payload, { now = Date.now(), ttlMs = SESSION_TTL_MS } = {}) {
  const body = { ...payload, iat: now, exp: now + ttlMs };
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(body)));
  const signature = await hmac(secret, encoded);
  return `${encoded}.${signature}`;
}

/**
 * 校验令牌。任何问题（格式、签名不符、过期、载荷损坏）都返回 ok:false，
 * 并给出**不含敏感信息**的原因，便于前端区分「过期」与「无效」。
 */
export async function verifyToken(secret, token, { now = Date.now() } = {}) {
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, reason: 'missing' };
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const encoded = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = await hmac(secret, encoded);
  if (!timingSafeEqual(expected, signature)) return { ok: false, reason: 'bad-signature' };
  const payload = parseJson(new TextDecoder().decode(base64UrlDecode(encoded)));
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return { ok: false, reason: 'expired' };
  // 注意：这里**只**校验「签名 + 有效期 + 形状」。
  // 具体用途（session / oauth-state）由调用方按 payload.purpose 判断：
  // state 票据本来就没有 sub，若在这里强制要求 sub，合法的 state 会被误判为非法。
  return { ok: true, payload };
}

/** 会话令牌专用的校验：必须是 session 用途，且带有用户标识。 */
export async function verifySessionToken(secret, token, { now = Date.now() } = {}) {
  const verified = await verifyToken(secret, token, { now });
  if (!verified.ok) return verified;
  if (verified.payload.purpose !== 'session') return { ok: false, reason: 'wrong-purpose' };
  const sub = verified.payload.sub;
  if (sub === undefined || sub === null || String(sub) === '') return { ok: false, reason: 'malformed' };
  return verified;
}

/**
 * 生成授权跳转 URL。
 * `returnTo` 只接受落在 allowedOrigins 内的地址；否则回退到主源，
 * 因此客户端无法把用户重定向到任意站点（防开放重定向）。
 */
export async function buildAuthorizeUrl({ clientId, redirectUri, returnTo, allowedOrigins, secret, now = Date.now() }) {
  const fallback = allowedOrigins[0];
  const target = pickReturnTo(returnTo, allowedOrigins) || fallback;
  const state = await signToken(secret, {
    purpose: 'oauth-state',
    nonce: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
    returnTo: target,
  }, { now, ttlMs: STATE_TTL_MS });

  const url = new URL(GITHUB_AUTHORIZE);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', GITHUB_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'true');
  return { url: url.toString(), state, returnTo: target };
}

/** returnTo 必须与某个已允许的源同源，并且只能是源本身或其下的 hash 路由。 */
export function pickReturnTo(returnTo, allowedOrigins) {
  const value = String(returnTo || '').trim();
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  const normalized = `${parsed.protocol}//${parsed.host}`;
  if (!allowedOrigins.includes(normalized)) return null;
  // 只保留 origin + path + hash，丢弃 query，避免把参数带进重定向
  return `${normalized}${parsed.pathname}${parsed.hash}`;
}

/** 用 code 换 access token（凭证只出现在服务端请求头/请求体，绝不回传前端）。 */
export async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(GITHUB_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const text = await response.text();
  const data = parseJson(text);
  if (!response.ok || !data) return { ok: false, error: `GitHub 令牌接口返回 ${response.status}` };
  if (data.error) return { ok: false, error: `GitHub 拒绝了这次登录（${data.error}）` };
  if (typeof data.access_token !== 'string' || !data.access_token) return { ok: false, error: 'GitHub 未返回 access token' };
  return { ok: true, accessToken: data.access_token, scope: data.scope || '' };
}

/** 读取 GitHub 用户公开资料；只取最小字段，不取邮箱。 */
export async function fetchGithubUser({ accessToken, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(GITHUB_USER, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'studymate-ai-proxy' },
  });
  const text = await response.text();
  const data = parseJson(text);
  if (!response.ok || !data) return { ok: false, error: `GitHub 用户接口返回 ${response.status}` };
  if (data.id === undefined || data.id === null) return { ok: false, error: 'GitHub 用户资料缺少 id' };
  return {
    ok: true,
    user: {
      sub: String(data.id),
      login: String(data.login || '').slice(0, 40),
      name: String(data.name || data.login || '').slice(0, 60),
    },
  };
}
