/**
 * AI 服务客户端（代理优先，直连为次级选项）。
 *
 * 代理模式（推荐）：只发送学习需求与已核实视频库元数据到你自己部署的 Worker，
 * 供应商密钥保存在 Cloudflare 机密里，浏览器永远拿不到。
 *
 * 直连模式（BYOK）：明确标注风险，密钥只放 sessionStorage / 内存，导出备份时会剔除。
 */

import { toTemplatePayload } from '../data/course-templates.js';

export const PROXY_DISCLAIMER = 'AI 生成内容仅供参考，可能包含错误，请自行核对。只有你点击「生成」时才会把学习需求发送到你自己配置的服务。';

/**
 * 同源部署时的默认代理地址（例如 Cloudflare Pages：静态前端与 `/api/*` 反向代理在同一个域名下）。
 *
 * 为什么需要它：这种部署里用户不需要知道任何地址，打开就能用；否则每换一台设备都要手填一次，
 * 对「拿来就能学」的产品是硬伤。
 *
 * 这里**不做任何网络探测**，只按主机名判断，因此不会引入后台请求；
 * 判断不成立时返回空串，界面照旧提示去配置。
 */
export function defaultWorkerUrl(loc = (typeof location !== 'undefined' ? location : null)) {
  if (!loc) return '';
  const host = String(loc.hostname || '');
  if (!host) return '';
  return host === 'pages.dev' || host.endsWith('.pages.dev') ? String(loc.origin || '') : '';
}

/**
 * 前端等待 Worker 的截止时间（毫秒）。
 *
 * 为什么必须大于 Worker 侧的 PROVIDER_TIMEOUT_MS（worker/src/config.js 默认 90000ms）：
 * 模型调用一旦发出，供应商就可能已经计费；如果前端先超时中断，用户会拿不到那次**已经付费**的结果，
 * 还可能再点一次造成重复计费。因此前端给足「供应商超时 + 传输/校验」的余量。
 *
 * 运维提示：如果你把 Worker 变量 PROVIDER_TIMEOUT_MS 调大（例如 180000），
 * 请同步把这里调成「新的超时 + 至少 30 秒」（见 README「AI 通道」小节），否则前端会先放弃。
 *
 * 所有端点（含大纲）统一为 120 秒：大纲曾经是 90 秒，与供应商默认超时完全相等，
 * 一旦供应商真的跑满 90 秒，前端会先放弃那次**已经发出、可能已计费**的调用。
 */
export const WORKER_DEADLINES = Object.freeze({ generate: 120000, outline: 120000, lesson: 120000, explain: 120000 });

/** 规范化 Worker 地址：只允许 https（localhost 开发可用 http）。 */
export function normalizeWorkerUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, reason: '未填写 Worker 地址' };
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, reason: 'Worker 地址不是合法 URL' };
  }
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    return { ok: false, reason: 'Worker 地址必须使用 https（本机调试可用 http://localhost）' };
  }
  if (url.username || url.password) return { ok: false, reason: 'Worker 地址不能包含凭据' };
  url.hash = '';
  const base = url.toString().replace(/\/+$/, '');
  return { ok: true, base };
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

async function postJson(url, body, { fetchImpl, timeoutMs = WORKER_DEADLINES.generate, headers = {} } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, error: '当前环境不支持网络请求' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, error: `服务返回的不是 JSON（HTTP ${response.status}）`, status: response.status };
    }
    if (!response.ok || data?.ok === false) {
      return {
        ok: false,
        status: response.status,
        error: data?.message || `请求失败（HTTP ${response.status}）`,
        code: data?.error || 'http-error',
        problems: Array.isArray(data?.problems) ? data.problems : [],
      };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, error: `请求超时（>${timeoutMs} ms）`, code: 'timeout' };
    return { ok: false, error: `网络请求失败：${error?.message || error}`, code: 'network-error' };
  } finally {
    clearTimeout(timer);
  }
}

/** 通过 Worker 生成课程。 */
export async function generateCourseViaWorker({ workerUrl, payload, fetchImpl = globalThis.fetch, timeoutMs = WORKER_DEADLINES.generate } = {}) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized.ok) return { ok: false, error: normalized.reason, code: 'bad-worker-url' };
  const result = await postJson(joinUrl(normalized.base, '/api/course/generate'), payload, { fetchImpl, timeoutMs });
  if (!result.ok) return result;
  if (!result.data?.course) return { ok: false, error: '服务没有返回课程内容', code: 'empty-response' };
  return { ok: true, course: result.data.course, meta: result.data.meta || {} };
}

/** 通过 Worker 生成讲解。 */
export async function explainViaWorker({ workerUrl, payload, fetchImpl = globalThis.fetch, timeoutMs = WORKER_DEADLINES.explain } = {}) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized.ok) return { ok: false, error: normalized.reason, code: 'bad-worker-url' };
  const result = await postJson(joinUrl(normalized.base, '/api/explain'), payload, { fetchImpl, timeoutMs });
  if (!result.ok) return result;
  if (!result.data?.text) return { ok: false, error: '服务没有返回讲解内容', code: 'empty-response' };
  return { ok: true, text: result.data.text, meta: result.data.meta || {} };
}

/** 分阶段建课第一步：只取课程大纲。 */
export async function generateOutlineViaWorker({ workerUrl, payload, fetchImpl = globalThis.fetch, timeoutMs = WORKER_DEADLINES.outline } = {}) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized.ok) return { ok: false, error: normalized.reason, code: 'bad-worker-url' };
  const result = await postJson(joinUrl(normalized.base, '/api/course/outline'), payload, { fetchImpl, timeoutMs });
  if (!result.ok) return result;
  if (!result.data?.outline) return { ok: false, error: '服务没有返回课程大纲', code: 'empty-response' };
  return { ok: true, outline: result.data.outline, meta: result.data.meta || {} };
}

/** 分阶段建课第二步：取单个知识点的正文、练习与测验。 */
export async function generateLessonViaWorker({ workerUrl, payload, fetchImpl = globalThis.fetch, timeoutMs = WORKER_DEADLINES.lesson } = {}) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized.ok) return { ok: false, error: normalized.reason, code: 'bad-worker-url' };
  const result = await postJson(joinUrl(normalized.base, '/api/course/lesson'), payload, { fetchImpl, timeoutMs });
  if (!result.ok) return result;
  if (!result.data?.concept) return { ok: false, error: '服务没有返回该知识点的内容', code: 'empty-response' };
  return { ok: true, concept: result.data.concept, meta: result.data.meta || {} };
}

/** 讲解请求的载荷（代理模式）。 */
export function buildExplainPayload({ concept, level, goal, courseTitle }) {
  return {
    concept: { title: concept?.title || '', summary: concept?.summary || '' },
    level: level || 'new',
    goal: goal || 'starter',
    courseTitle: courseTitle || '',
  };
}

/** 组装大纲请求体。 */
export function buildOutlinePayload({ topic, goal, level, weeklyHours, lessonMinutes, videoLibrary, templateId }) {
  return {
    topic,
    goal,
    level,
    weeklyHours,
    lessonMinutes,
    // 只发受信任的模板 id（未知 id 一律不发）；模板文本由服务端从共用目录里查，
    // 因此伪造的 id 不可能把任意提示词注入请求。
    ...toTemplatePayload(templateId),
    videoLibrary: toVideoLibraryPayload(videoLibrary),
  };
}

/** 组装单个知识点的请求体（带上完整大纲作为上下文）。 */
export function buildLessonPayload({ topic, goal, level, weeklyHours, lessonMinutes, outline, conceptId, templateId }) {
  return {
    topic,
    goal,
    level,
    weeklyHours,
    lessonMinutes,
    ...toTemplatePayload(templateId),
    outline,
    conceptId,
  };
}

/** 调用前把视频库裁剪成 worker 需要的最小元数据（不含任何密钥，也不含用户隐私）。 */
export function toVideoLibraryPayload(videos, { limit = 60 } = {}) {
  return videos.slice(0, limit).map((video) => ({
    id: video.id,
    title: video.title,
    creator: video.creator,
    subjectId: video.subjectId,
    knowledgePoints: (video.knowledgePoints || []).slice(0, 8),
  }));
}

/** 组装生成请求体（字段与 worker 约定一致）。 */
export function buildGeneratePayload({ topic, goal, level, weeklyHours, lessonMinutes, videoLibrary, templateId }) {
  return {
    topic,
    goal,
    level,
    weeklyHours,
    lessonMinutes,
    ...toTemplatePayload(templateId),
    videoLibrary: toVideoLibraryPayload(videoLibrary),
  };
}
