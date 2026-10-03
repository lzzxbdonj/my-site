/**
 * Cloudflare Pages Function：把 /api/* 反向代理到已部署的 AI Worker。
 *
 * 为什么需要它：`workers.dev` 这个域名在部分网络（实测：用户的家庭宽带与手机流量）
 * 被 DNS 污染 + 连接重置，浏览器直连不通；但 **Cloudflare 的边缘自己访问 workers.dev 是通的**。
 * 于是让浏览器只连 `pages.dev`，由边缘内部去调 Worker —— 被封的路径就绕开了，
 * 而且上游 Worker 不需要做任何改动。
 *
 * 设计要点：
 *  - 对上游固定使用 ALLOWED_ORIGINS 里已登记的那个源（Worker 会校验 Origin）；
 *    回程再把 CORS 头改写成**真实请求方**的源，因此前端放在 github.io 或 pages.dev 都能用。
 *  - 原样转发 method / body / 相关请求头，保留上游状态码与响应体。
 *  - 明确把原始访客 IP 透传给上游（见下方注释里的限制说明）。
 *
 * ⚠️ 已知限制（如实记录，不要当成已解决）：
 *  经过本代理后，Worker 侧「按访客」的限额**可能退化为共享计数**——因为
 *  Worker→Worker 的子请求里 `CF-Connecting-IP` 是否仍为终端用户 IP 取决于 Cloudflare 行为，
 *  本仓库无法在受限网络下实测确认。**全站每日限额始终有效**。
 *  要彻底修好，需要在 Worker 侧增加一个「可信代理签名」校验（需要重新部署 Worker）。
 */

/** 上游 AI Worker（已部署）。 */
const UPSTREAM = 'https://studymate-ai-proxy.lzzxbdonj.workers.dev';

/** Worker 的 ALLOWED_ORIGINS 里已登记的源：对上游统一用它，避免上游 403。 */
const UPSTREAM_ORIGIN = 'https://lzzxbdonj.github.io';

/** 允许经过本代理的前端源（回程 CORS 只对这些源开放）。 */
const ALLOWED_CLIENT_ORIGINS = new Set([
  'https://lzzxbdonj.github.io',
  'https://ai-zixuetong.pages.dev',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

function corsFor(request) {
  const origin = request.headers.get('origin') || '';
  return ALLOWED_CLIENT_ORIGINS.has(origin) ? origin : UPSTREAM_ORIGIN;
}

function jsonError(status, error, message, origin) {
  return new Response(JSON.stringify({ ok: false, error, message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'cache-control': 'no-store',
    },
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const origin = corsFor(request);

  // 预检：直接回，不必打扰上游（上游也会处理，但这里更快且不消耗任何配额）
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-max-age': '600',
      },
    });
  }

  const target = new URL(`${url.pathname}${url.search}`, UPSTREAM);
  const headers = new Headers(request.headers);
  headers.set('origin', UPSTREAM_ORIGIN);
  headers.delete('host');
  headers.delete('referer');
  // 把终端访客 IP 透传给上游：若 Cloudflare 覆盖该头，访客级配额会退化为共享计数（见文件头说明）
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('cf-connecting-ip', clientIp);

  const init = { method: request.method, headers };
  // 关键：必须手动处理重定向。GitHub 登录回跳靠的就是 Worker 返回的 302，
  // 若让 fetch 默认 follow，代理会自己把 302 跟掉、把回跳地址当页面抓回来，
  // 浏览器就永远拿不到那个带令牌的重定向，登录直接断掉。
  init.redirect = 'manual';
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

  let upstream;
  try {
    upstream = await fetch(target.toString(), init);
  } catch (error) {
    return jsonError(502, 'upstream-unreachable', `代理无法连接上游 AI 服务：${String(error?.message || error)}`, origin);
  }

  const outHeaders = new Headers(upstream.headers);
  outHeaders.set('access-control-allow-origin', origin);
  outHeaders.set('access-control-allow-headers', 'content-type, authorization');
  outHeaders.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  outHeaders.delete('content-encoding'); // 交给运行时处理，避免双重压缩
  outHeaders.set('cache-control', 'no-store');

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
}
