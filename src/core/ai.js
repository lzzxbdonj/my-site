/**
 * 可选 AI 能力：由用户自己配置 OpenAI 兼容接口。
 * 原则：不内置任何密钥；不假装有 AI；未配置时明确说明并保持核心功能离线可用。
 */

export const AI_DISCLAIMER =
  'AI 生成内容仅供参考，可能包含错误，请自行核对。只有在你点击「生成」时才会把下面选中的内容发送到你自己填写的接口。';

/** 允许的接口地址：https，或本机 http（本地推理服务）。 */
export function validateEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.trim() === '') return { ok: false, reason: '接口地址为空' };
  let url;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return { ok: false, reason: '接口地址不是合法 URL' };
  }
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol === 'https:') return { ok: true, url: url.toString().replace(/\/$/, '') };
  if (url.protocol === 'http:' && isLocal) return { ok: true, url: url.toString().replace(/\/$/, ''), local: true };
  return { ok: false, reason: '出于安全考虑，只支持 https 接口；本机 http 服务可用 localhost/127.0.0.1' };
}

function joinEndpoint(base, suffix) {
  const normalized = base.replace(/\/$/, '');
  if (/\/v1$/.test(normalized)) return `${normalized}${suffix}`;
  return `${normalized}/v1${suffix}`;
}

/** 构造讲解请求（不发送，返回 url 与 init，便于测试与展示）。 */
export function buildExplanationRequest({ endpoint, model = 'gpt-4o-mini', apiKey = '', concept, level = 'new', goal = 'starter', courseTitle = '' }) {
  const check = validateEndpoint(endpoint);
  if (!check.ok) return { ok: false, reason: check.reason };
  const system = '你是一位耐心的中文学习助教。请用具体例子解释概念，避免堆砌术语，最后给出一个自测问题。';
  const user = [
    `课程：${courseTitle || '（未指定）'}`,
    `知识点：${concept?.title || '（未指定）'}`,
    `学习者水平：${level}；学习目标：${goal}`,
    `知识点摘要：${concept?.summary || ''}`,
    '请用 200-350 字解释这个概念，并指出一个常见误解。',
  ].join('\n');
  const payload = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
  };
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return {
    ok: true,
    url: joinEndpoint(check.url, '/chat/completions'),
    init: { method: 'POST', headers, body: JSON.stringify(payload) },
    preview: { system, user },
  };
}

/** 执行请求，返回可展示的结果（永不抛出）。 */
export async function requestExplanation({ fetchImpl = globalThis.fetch, ...args } = {}) {
  const built = buildExplanationRequest(args);
  if (!built.ok) return { ok: false, error: built.reason };
  if (typeof fetchImpl !== 'function') return { ok: false, error: '当前环境不支持网络请求' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs || 30000);
  try {
    const res = await fetchImpl(built.url, { ...built.init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `接口返回 ${res.status}：${text.slice(0, 200)}` };
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: '接口返回的不是 JSON，请确认地址是否为 OpenAI 兼容接口' };
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') return { ok: false, error: '接口没有返回可用的文本内容' };
    return { ok: true, text: content.trim(), model: data.model || args.model || '' };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? '请求超时' : `请求失败：${error?.message || error}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 生成「定制课程」的提示词（供用户复制到任意 AI 工具，也可直接调用接口）。 */
export function buildPlanPrompt(course, prefs) {
  return [
    `我想学习《${course.title}》。`,
    `学习目标：${prefs.goal}；当前水平：${prefs.level}；每周可投入：${prefs.weeklyHours} 小时；单次专注时长：${prefs.lessonMinutes} 分钟。`,
    `课程知识点顺序：${(course.concepts || []).map((c) => c.title).join(' → ')}。`,
    '请基于以上信息给出 4 周的学习建议，每周列出具体任务与自测方式。',
  ].join('\n');
}
