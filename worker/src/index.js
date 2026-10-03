/**
 * StudyMate AI 代理 Worker。
 *
 * 职责：
 *  - 保管供应商密钥（只存在于 Cloudflare 机密中，绝不下发浏览器、绝不写入日志/响应）；
 *  - 固定服务端配置的 HTTPS 供应商地址，客户端无法指定目标（避免任意代理与 SSRF）；
 *  - 用 Durable Object 做原子配额：**不可退款的模型尝试上限**（访客/天 + 全站/天）与并发上限；
 *  - 视频选择以服务端权威目录为准（客户端提交的「视频库」只作提示，伪造条目一律忽略）；
 *  - 对模型输出做严格结构校验（schema.js），拒绝 HTML / 链接 / 编造视频 id / 超长内容；
 *  - 显式检测输出截断（finish_reason=length），不把半截课程当成功返回。
 *
 * 安全边界：Origin 白名单只防浏览器跨站调用，不是鉴权也不算配额；真正的用量控制来自上面的尝试上限，
 * 私有部署请叠加 Cloudflare Access。访客身份只来自 Cloudflare 注入的 CF-Connecting-IP（缺省时归入
 * 一个共享的受限桶），绝不接受客户端自报身份。
 */

import { loadConfig, isAllowedOrigin } from './config.js';
import { buildCoursePrompt, buildExplainPrompt, buildOutlinePrompt, buildLessonPrompt, extractJson, sanitizeExplanation } from './prompt.js';
import { validateGeneratedCourse, validateCourseOutline, validateConceptContent, SchemaError } from './schema.js';
import { RateLimiter } from './ratelimit.js';
import { SERVER_VIDEOS, SERVER_CATALOG_VERSION, selectServerVideos, knownVideoIds } from './catalog.js';
import { normalizeTemplateId, getTemplate } from '../../src/data/course-templates.js';
import {
  buildAuthorizeUrl,
  verifyToken,
  verifySessionToken,
  signToken,
  exchangeCodeForToken,
  fetchGithubUser,
  pickReturnTo,
} from './auth.js';

export { RateLimiter };

const ROUTES = new Set([
  '/api/health',
  '/api/course/generate',
  '/api/course/outline',
  '/api/course/lesson',
  '/api/explain',
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/me',
]);
const TEXT_DECODER = new TextDecoder();

export default {
  async fetch(request, env, ctx) {
    const configResult = loadConfig(env);
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin, configResult.ok ? configResult.config.allowedOrigins : []);

    if (request.method === 'OPTIONS') {
      if (!configResult.ok) return json({ ok: false, error: 'worker-configuration-error', message: configResult.message }, 503, cors);
      if (!isAllowedOrigin(origin, configResult.config.allowedOrigins)) return json({ ok: false, error: 'origin-not-allowed' }, 403, {});
      return new Response(null, { status: 204, headers: { ...cors, 'access-control-max-age': '600' } });
    }

    if (!ROUTES.has(url.pathname)) return json({ ok: false, error: 'not-found' }, 404, cors);

    if (!configResult.ok) {
      // 未配置完成时拒绝服务：不调用模型，也不降级放行
      return json({ ok: false, error: 'worker-configuration-error', message: configResult.message }, 503, cors);
    }
    const config = configResult.config;

    // GitHub 回调是浏览器的**顶层导航**（从 github.com 跳回来），浏览器不会带 Origin，
    // 因此它必须在 Origin 白名单校验之前处理；这次的 CSRF 防护来自签名过的 state 票据，
    // 而不是 Origin 头。回调不消耗模型额度，也不接触供应商密钥。
    if (url.pathname === '/api/auth/callback') {
      return handleAuthCallback({ url, config });
    }

    if (!isAllowedOrigin(origin, config.allowedOrigins)) {
      return json({ ok: false, error: 'origin-not-allowed', message: '请在 Worker 变量 ALLOWED_ORIGINS 中加入本站源。' }, 403, {});
    }

    if (url.pathname.startsWith('/api/auth/')) {
      return handleAuthRoute({ request, url, config, cors });
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'studymate-ai-proxy',
        environment: config.environment,
        model: config.providerModel,
        catalog: SERVER_CATALOG_VERSION,
        limits: {
          visitorDailyLimit: config.visitorDailyLimit,
          siteDailyLimit: config.siteDailyLimit,
          maxConcurrentProviderRequests: config.maxConcurrentProviderRequests,
          maxOutputTokens: config.maxOutputTokens,
          timeoutMs: config.timeoutMs,
        },
        note: '密钥保存在 Worker 机密中，不会返回给浏览器；模型尝试额度不可退款（供应商可能对失败调用计费）。',
        auth: {
          enabled: config.authConfigured,
          provider: 'github',
          // 只列出「还缺哪个变量名」，绝不回显任何值——方便部署者自己定位问题
          missing: [
            !config.githubClientId ? 'GITHUB_CLIENT_ID' : null,
            !config.githubClientSecret ? 'GITHUB_CLIENT_SECRET' : null,
            !config.authTokenSecret ? 'AUTH_TOKEN_SECRET' : null,
          ].filter(Boolean),
          error: config.authError,
        },
      }, 200, cors);
    }

    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405, cors);

    const raw = await readJsonBody(request, config.maxRequestBytes);
    if (!raw.ok) return json({ ok: false, error: raw.error, message: raw.message }, raw.status, cors);

    const visitor = await hashVisitor(request, config.ipSalt);
    const reservation = await reserveQuota(env, config, visitor.hash);
    if (!reservation.ok) return json(reservation.body, reservation.status, cors);

    // 无论成功、失败、异常还是超时，都在 finally 中释放并发预占（释放是幂等的）。
    // 但模型尝试额度本身不可退款：只要发起了供应商请求，这一次就已经计入硬上限。
    let outcome = 'unknown';
    try {
      if (url.pathname === '/api/course/generate') {
        const result = await handleGenerate({ raw: raw.value, config, cors, reservation });
        outcome = result.outcome;
        return result.response;
      }
      if (url.pathname === '/api/course/outline') {
        const result = await handleOutline({ raw: raw.value, config, cors, reservation });
        outcome = result.outcome;
        return result.response;
      }
      if (url.pathname === '/api/course/lesson') {
        const result = await handleLesson({ raw: raw.value, config, cors, reservation });
        outcome = result.outcome;
        return result.response;
      }
      const result = await handleExplain({ raw: raw.value, config, cors });
      outcome = result.outcome;
      return result.response;
    } catch (error) {
      outcome = error?.name === 'AbortError' ? 'timeout' : 'provider-error';
      if (error instanceof SchemaError) {
        outcome = 'invalid-output';
        return json({ ok: false, error: 'invalid-model-output', message: error.message, problems: error.errors.slice(0, 8), note: quotaNote('invalid-output') }, 422, cors);
      }
      if (error?.name === 'AbortError') {
        return json({ ok: false, error: 'provider-timeout', message: `调用模型超时（>${config.timeoutMs} ms）。${quotaNote('timeout')}` }, 504, cors);
      }
      if (error?.code === 'output-truncated') {
        outcome = 'invalid-output';
        return json({ ok: false, error: 'output-truncated', message: error.message, note: quotaNote('truncated') }, 422, cors);
      }
      if (error?.userError) {
        outcome = 'invalid-output';
        return json({ ok: false, error: 'bad-request', message: error.message }, 400, cors);
      }
      return json({ ok: false, error: 'provider-error', message: `${safeMessage(error)}${quotaNote('provider-error')}` }, 502, cors);
    } finally {
      await releaseQuota(env, config, reservation, outcome);
    }
  },
};

/* ---------------------------------------------------------------------------
 * GitHub 登录（可选功能）
 *
 * 端点：
 *   GET /api/auth/login    返回 GitHub 授权地址（前端跳转过去）
 *   GET /api/auth/callback GitHub 跳回这里：换 token、取用户、签发会话令牌
 *   GET /api/auth/me       校验 Authorization: Bearer 并返回当前用户
 *
 * 未配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / AUTH_TOKEN_SECRET 时，
 * 这三个端点一律返回 503 auth-not-configured —— 登录整体关闭，但 AI 建课等既有能力不受影响。
 * 任何响应都不包含 client secret、access token 或令牌签名密钥。
 * ------------------------------------------------------------------------- */

/** 回调地址：优先用显式配置，否则按当前请求的源推导（本地开发 http://127.0.0.1 也被 GitHub 接受）。 */
function authRedirectUri(config, url) {
  return config.authRedirectUri || `${url.origin}/api/auth/callback`;
}

function handleAuthRoute({ request, url, config, cors }) {
  if (!config.authConfigured) {
    return json({
      ok: false,
      error: 'auth-not-configured',
      message: config.authError || '此 Worker 未配置 GitHub 登录（缺少 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / AUTH_TOKEN_SECRET）。',
    }, 503, cors);
  }
  if (url.pathname === '/api/auth/login') return handleAuthLogin({ url, config, cors });
  if (url.pathname === '/api/auth/me') return handleAuthMe({ request, config, cors });
  return json({ ok: false, error: 'not-found' }, 404, cors);
}

async function handleAuthLogin({ url, config, cors }) {
  const redirectUri = authRedirectUri(config, url);
  const built = await buildAuthorizeUrl({
    clientId: config.githubClientId,
    redirectUri,
    returnTo: url.searchParams.get('return') || '',
    allowedOrigins: config.allowedOrigins,
    secret: config.authTokenSecret,
  });
  return json({
    ok: true,
    url: built.url,
    redirectUri,
    returnTo: built.returnTo,
    scope: 'read:user',
    note: 'state 是服务端签名的短期票据，用于防止登录 CSRF 与开放重定向。',
  }, 200, { ...cors, 'cache-control': 'no-store' });
}

async function handleAuthMe({ request, config, cors }) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const verified = await verifySessionToken(config.authTokenSecret, match ? match[1] : '');
  if (!verified.ok) {
    return json({ ok: false, error: 'unauthorized', reason: verified.reason, message: '请重新登录。' }, 401, { ...cors, 'cache-control': 'no-store' });
  }
  const { sub, login, name, iat, exp } = verified.payload;
  return json({ ok: true, user: { sub, login, name, issuedAt: iat, expiresAt: exp } }, 200, { ...cors, 'cache-control': 'no-store' });
}

function authErrorPage(status, title, detail) {
  // 极简错误页：不回显任何参数、不包含任何密钥，也不做自动跳转
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.7"><h1 style="font-size:1.2rem">${title}</h1><p>${detail}</p><p><a href="/">返回</a></p></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function handleAuthCallback({ url, config }) {
  if (!config.authConfigured) {
    return authErrorPage(503, '登录未启用', '此 Worker 尚未配置 GitHub 登录。');
  }
  const denied = url.searchParams.get('error');
  if (denied) {
    return authErrorPage(400, '登录被取消或拒绝', `GitHub 返回：${String(denied).slice(0, 40)}。你可以关闭此页面重新登录。`);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return authErrorPage(400, '登录参数不完整', '缺少 code 或 state，请重新发起登录。');

  const verifiedState = await verifyToken(config.authTokenSecret, state);
  if (!verifiedState.ok || verifiedState.payload.purpose !== 'oauth-state') {
    // 过期或签名的 state 都拒绝：这是登录 CSRF 的主要防线
    return authErrorPage(400, '登录校验失败', '本次登录的 state 无效或已过期，请重新发起登录。');
  }
  const returnTo = pickReturnTo(verifiedState.payload.returnTo, config.allowedOrigins) || config.allowedOrigins[0];

  let exchanged;
  try {
    exchanged = await exchangeCodeForToken({
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
      code,
      redirectUri: authRedirectUri(config, url),
    });
  } catch (error) {
    return authErrorPage(502, '登录失败', `无法连接 GitHub：${safeMessage(error)}`);
  }
  if (!exchanged.ok) return authErrorPage(502, '登录失败', exchanged.error);

  let profile;
  try {
    profile = await fetchGithubUser({ accessToken: exchanged.accessToken });
  } catch (error) {
    return authErrorPage(502, '登录失败', `无法读取 GitHub 账号资料：${safeMessage(error)}`);
  }
  if (!profile.ok) return authErrorPage(502, '登录失败', profile.error);

  const token = await signToken(config.authTokenSecret, {
    purpose: 'session',
    sub: profile.user.sub,
    login: profile.user.login,
    name: profile.user.name,
  });

  // 令牌放在 URL fragment：fragment 不会发送给服务器，也不会出现在服务端访问日志里
  const target = new URL(returnTo);
  target.hash = `#/auth/complete?token=${encodeURIComponent(token)}`;
  return new Response(null, {
    status: 302,
    headers: { location: target.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}

function quotaNote(kind) {
  return kind === 'invalid-output'
    ? '注意：模型已经被调用过，这次尝试已计入每日尝试额度（供应商可能对无效输出计费）。'
    : '注意：模型已经被调用过，这次尝试已计入每日尝试额度。';
}

async function handleGenerate({ raw, config, cors, reservation }) {
  const input = normalizeGenerateInput(raw);
  // 客户端可以提交「视频库提示」，但服务端只信任自己的目录
  const clientHints = Array.isArray(raw?.videoLibrary) ? raw.videoLibrary : [];
  const clientKnownHintIds = knownVideoIds(clientHints.map((item) => item?.id));
  const selection = selectServerVideos({ topic: input.topic, limit: 24 });
  const prompt = buildCoursePrompt({ input, videoLibrary: selection.videos, catalogVersion: SERVER_CATALOG_VERSION });
  const completion = await callProvider({ config, messages: prompt, maxTokens: config.maxOutputTokens });
  if (completion.truncated) {
    const error = new Error(`模型输出达到长度上限（max_tokens=${config.maxOutputTokens}）而被截断，未生成完整课程。可提高 PROVIDER_MAX_OUTPUT_TOKENS，或先缩小主题范围后重试。`);
    error.code = 'output-truncated';
    throw error;
  }
  const parsed = extractJson(completion.text);
  if (!parsed.ok) {
    const error = new SchemaError([parsed.error]);
    throw error;
  }
  const course = validateGeneratedCourse(parsed.value, { videoLibrary: SERVER_VIDEOS, subjectKey: input.subjectKey });
  const matched = new Set(course.concepts.flatMap((c) => c.videoIds));
  const ignoredClientEntries = clientHints.length - clientKnownHintIds.length;

  return {
    outcome: 'success',
    response: json({
      ok: true,
      course,
      meta: {
        model: completion.model || config.providerModel,
        generatedAt: new Date().toISOString(),
        catalogVersion: SERVER_CATALOG_VERSION,
        catalogSize: SERVER_VIDEOS.length,
        catalogMatchedByTopic: selection.matchedByTopic,
        matchedVideoIds: [...matched],
        noVerifiedVideoMatch: matched.size === 0,
        ignoredClientVideoEntries: ignoredClientEntries,
        note: '视频只从服务端已核实目录中匹配；客户端提交的条目仅作提示，未被采信为「已核实」。',
        disclaimer: 'AI 生成内容，请自行核对。',
        usage: completion.usage || null,
        finishReason: completion.finishReason || null,
      },
      counters: reservation?.counters || null,
    }, 200, cors),
  };
}

/**
 * 分阶段建课：第一段只生成大纲。
 *
 * 为什么不是一次调用生成整门课：完整课程（正文 + 术语 + 练习 + 带解析测验 +
 * 动手任务）远超模型单次输出上限，实测会稳定触发 output-truncated。
 * 拆成两段后每段都在预算内，且失败只需重试一个知识点。
 */
const OUTLINE_MAX_TOKENS = 3000;
const LESSON_MAX_TOKENS = 5000;

async function handleOutline({ raw, config, cors, reservation }) {
  const input = normalizeGenerateInput(raw);
  const clientHints = Array.isArray(raw?.videoLibrary) ? raw.videoLibrary : [];
  const clientKnownHintIds = knownVideoIds(clientHints.map((item) => item?.id));
  const prompt = buildOutlinePrompt({ input, catalogVersion: SERVER_CATALOG_VERSION, templateId: input.templateId });
  const completion = await callProvider({ config, messages: prompt, maxTokens: Math.min(config.maxOutputTokens, OUTLINE_MAX_TOKENS) });
  if (completion.truncated) {
    const error = new Error(`课程大纲输出达到长度上限（max_tokens=${Math.min(config.maxOutputTokens, OUTLINE_MAX_TOKENS)}）而被截断。`);
    error.code = 'output-truncated';
    throw error;
  }
  const parsed = extractJson(completion.text);
  if (!parsed.ok) throw new SchemaError([parsed.error]);
  const outline = validateCourseOutline(parsed.value, { subjectKey: input.subjectKey });

  return {
    outcome: 'success',
    response: json({
      ok: true,
      outline,
      meta: {
        stage: 'outline',
        model: completion.model || config.providerModel,
        generatedAt: new Date().toISOString(),
        catalogVersion: SERVER_CATALOG_VERSION,
        ignoredClientVideoEntries: clientHints.length - clientKnownHintIds.length,
        conceptCount: outline.concepts.length,
        templateId: input.templateId,
        templateLabel: getTemplate(input.templateId)?.label || '',
        note: '下一步会为每个知识点单独生成正文、练习与测验；视频在第二步按知识点匹配。',
        disclaimer: 'AI 生成内容，请自行核对。',
        usage: completion.usage || null,
      },
      counters: reservation?.counters || null,
    }, 200, cors),
  };
}

/** 分阶段建课：第二段为单个知识点生成正文、练习与测验。 */
async function handleLesson({ raw, config, cors, reservation }) {
  const input = normalizeGenerateInput(raw);
  const outlineInput = raw?.outline;
  if (!outlineInput || typeof outlineInput !== 'object' || Array.isArray(outlineInput)) {
    throw Object.assign(new Error('缺少课程大纲（outline）'), { userError: true });
  }
  // 大纲由客户端回传，因此这里是「不可信输入」：重新走一遍结构校验再用，
  // 既拦住注入了 HTML/链接的字段，也保证 prerequisites 与 id 规则成立。
  const outline = validateCourseOutline(
    { ...outlineInput, concepts: Array.isArray(outlineInput.concepts) ? outlineInput.concepts : [] },
    { subjectKey: input.subjectKey },
  );
  const wantedId = String(raw?.conceptId || '').trim().toLowerCase();
  const concept = outline.concepts.find((c) => c.id === wantedId);
  if (!concept) throw Object.assign(new Error('指定的知识点不在大纲中'), { userError: true });

  const selection = selectServerVideos({ topic: `${input.topic} ${concept.title}`, limit: 12 });
  const prompt = buildLessonPrompt({ input, outline, concept, videoLibrary: selection.videos, catalogVersion: SERVER_CATALOG_VERSION, templateId: input.templateId });
  const completion = await callProvider({ config, messages: prompt, maxTokens: Math.min(config.maxOutputTokens, LESSON_MAX_TOKENS) });
  if (completion.truncated) {
    const error = new Error(`知识点「${concept.title}」的输出达到长度上限（max_tokens=${Math.min(config.maxOutputTokens, LESSON_MAX_TOKENS)}）而被截断。`);
    error.code = 'output-truncated';
    throw error;
  }
  const parsed = extractJson(completion.text);
  if (!parsed.ok) throw new SchemaError([parsed.error]);
  const content = validateConceptContent(parsed.value, { concept, videoLibrary: SERVER_VIDEOS });

  return {
    outcome: 'success',
    response: json({
      ok: true,
      concept: content,
      meta: {
        stage: 'lesson',
        conceptId: concept.id,
        model: completion.model || config.providerModel,
        templateId: input.templateId,
        templateLabel: getTemplate(input.templateId)?.label || '',
        catalogMatchedByTopic: selection.matchedByTopic,
        matchedVideoIds: content.videoIds,
        noVerifiedVideoMatch: content.videoIds.length === 0,
        note: '视频只从服务端已核实目录中匹配；没有匹配到就是没有匹配到。',
        disclaimer: 'AI 生成内容，请自行核对。',
        usage: completion.usage || null,
      },
      counters: reservation?.counters || null,
    }, 200, cors),
  };
}

async function handleExplain({ raw, config, cors }) {
  const concept = raw?.concept && typeof raw.concept === 'object'
    ? { title: String(raw.concept.title || '').slice(0, 80), summary: String(raw.concept.summary || '').slice(0, 300) }
    : { title: '', summary: '' };
  if (!concept.title) {
    return { outcome: 'invalid-output', response: json({ ok: false, error: 'bad-request', message: '缺少 concept.title' }, 400, cors) };
  }
  const prompt = buildExplainPrompt({
    concept,
    level: String(raw.level || 'new').slice(0, 20),
    goal: String(raw.goal || 'starter').slice(0, 20),
    courseTitle: String(raw.courseTitle || '').slice(0, 120),
  });
  const completion = await callProvider({ config, messages: prompt, maxTokens: Math.min(config.maxOutputTokens, 1500) });
  if (completion.truncated) {
    const error = new Error('模型输出被长度上限截断，未生成完整讲解，请重试。');
    error.code = 'output-truncated';
    throw error;
  }
  const text = sanitizeExplanation(completion.text);
  if (text.length < 40) throw new SchemaError(['讲解内容过短，未通过质量校验']);
  return {
    outcome: 'success',
    response: json({ ok: true, text, meta: { model: completion.model || config.providerModel, disclaimer: 'AI 生成内容，请自行核对。' } }, 200, cors),
  };
}

function normalizeGenerateInput(raw) {
  const goalMap = { starter: '零基础入门', exam: '应对考试', project: '做项目/实战', advanced: '进阶补强' };
  const levelMap = { new: '完全零基础', some: '学过一点', advanced: '已经学过一遍' };
  const topic = String(raw?.topic || raw?.subject || '').trim().slice(0, 80);
  if (topic.length < 2) throw Object.assign(new Error('请提供至少 2 个字的学科或主题'), { userError: true });
  return {
    topic,
    subjectKey: String(raw?.subjectKey || slug(topic)).slice(0, 40),
    goal: String(raw?.goal || 'starter').slice(0, 20),
    goalLabel: goalMap[raw?.goal] || '零基础入门',
    level: String(raw?.level || 'new').slice(0, 20),
    levelLabel: levelMap[raw?.level] || '完全零基础',
    weeklyHours: clampNumber(raw?.weeklyHours, 1, 20, 4),
    lessonMinutes: clampNumber(raw?.lessonMinutes, 15, 120, 40),
    // 模板：只认共用目录里的受信任 id，未知值回退到自定义（绝不携带客户端文本）
    templateId: normalizeTemplateId(raw?.templateId),
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function slug(text) {
  const base = String(text).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return base.slice(0, 30) || 'custom';
}

/** 按字节上限读取请求体：边读边计数，超限立即取消，避免先缓冲再判断。 */
export async function readJsonBody(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return { ok: false, status: 413, error: 'payload-too-large', message: `请求体超过 ${maxBytes} 字节上限。` };
  if (!request.body) return { ok: false, status: 400, error: 'empty-body', message: '请求体为空。' };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, error: 'payload-too-large', message: `请求体超过 ${maxBytes} 字节上限。` };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false, status: 400, error: 'body-read-error', message: `读取请求体失败：${error?.message || 'unknown'}` };
  }

  const text = TEXT_DECODER.decode(concat(chunks, total));
  if (!text.trim()) return { ok: false, status: 400, error: 'empty-body', message: '请求体为空。' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'invalid-json', message: '请求体不是合法 JSON。' };
  }
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

/** 只信任 Cloudflare 注入的 CF-Connecting-IP；缺失（或非部署环境的自报 IP 头）都归入共享的 unknown 桶。 */
export async function hashVisitor(request, salt) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const data = new TextEncoder().encode(`${salt}|${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hash = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { hash, trusted: ip !== '' };
}

async function quotaStub(env) {
  if (!env.RATE_LIMITER) return null;
  const id = env.RATE_LIMITER.idFromName('global');
  return env.RATE_LIMITER.get(id);
}

async function reserveQuota(env, config, visitorHash) {
  const stub = await quotaStub(env);
  if (!stub) {
    return { ok: false, status: 503, body: { ok: false, error: 'worker-configuration-error', message: '缺少 RATE_LIMITER Durable Object 绑定，无法保证配额，已拒绝服务。' } };
  }
  const response = await stub.fetch('https://ratelimiter/reserve', {
    method: 'POST',
    body: JSON.stringify({
      action: 'reserve',
      visitorHash,
      visitorAttemptLimit: config.visitorDailyLimit,
      siteAttemptLimit: config.siteDailyLimit,
      maxConcurrent: config.maxConcurrentProviderRequests,
      reservationTtlMs: config.reservationTtlMs,
    }),
  });
  const data = await response.json();
  if (!data.allowed) {
    const messages = {
      'site-limit': `本站今日的模型尝试额度已用完（${config.siteDailyLimit} 次/天）。`,
      'site-attempt-limit': `本站今日的模型尝试额度已用完（${config.siteDailyLimit} 次/天）。`,
      'visitor-limit': `你今天的模型尝试额度已用完（${config.visitorDailyLimit} 次/天），明天会重置。`,
      'visitor-attempt-limit': `你今天的模型尝试额度已用完（${config.visitorDailyLimit} 次/天），明天会重置。`,
      'concurrency-limit': `当前同时进行的生成请求已达上限（${config.maxConcurrentProviderRequests}），请稍后重试。`,
    };
    const code = data.reason === 'concurrency-limit' ? 'concurrency-limit'
      : String(data.reason || '').startsWith('site') ? 'site-quota-exceeded' : 'visitor-quota-exceeded';
    return { ok: false, status: 429, body: { ok: false, error: code, message: messages[data.reason] || '额度已用尽。', counters: data.counters } };
  }
  return { ok: true, reservationId: data.reservationId, day: data.day, counters: data.counters };
}

async function releaseQuota(env, config, reservation, outcome) {
  const stub = await quotaStub(env);
  if (!stub || !reservation?.reservationId) return;
  await stub.fetch('https://ratelimiter/release', {
    method: 'POST',
    body: JSON.stringify({ action: 'release', reservationId: reservation.reservationId, outcome }),
  }).catch(() => {});
}

/**
 * 调用固定供应商端点（OpenAI 兼容）。密钥只出现在请求头；错误信息会做脱敏，绝不回显密钥。
 * 支持 PROVIDER_BASE_URL 已经以 /v1 结尾（DeepSeek/OpenAI 文档常见写法）而不产生 /v1/v1。
 */
async function callProvider({ config, messages, maxTokens }) {
  const endpoint = `${config.providerBaseUrl}${/\/v1$/.test(config.providerBaseUrl) ? '' : '/v1'}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.providerApiKey}`,
      },
      body: JSON.stringify({
        model: config.providerModel,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
        temperature: 0.4,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(`模型服务返回 ${response.status}`);
      error.providerStatus = response.status;
      throw error;
    }

    const { text, truncated } = await readBoundedText(response, config.maxProviderResponseBytes);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const error = new Error(truncated ? '模型服务的响应超过响应体上限而被截断' : '模型服务返回的不是 JSON');
      error.code = truncated ? 'output-truncated' : 'provider-error';
      throw error;
    }
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') throw new Error('模型没有返回内容');
    return {
      text: content,
      model: typeof data.model === 'string' ? data.model.slice(0, 80) : '',
      usage: data.usage || null,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
      truncated: choice.finish_reason === 'length' || truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 按字节上限读取供应商响应体。 */
async function readBoundedText(response, maxBytes) {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    return { text: text.slice(0, maxBytes), truncated: bytes > maxBytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return { text: TEXT_DECODER.decode(concat(chunks, Math.min(total, maxBytes))), truncated };
}

/** 错误脱敏：绝不回显供应商密钥或 Authorization 头内容。 */
export function safeMessage(error) {
  const raw = String(error?.message || error || 'unknown');
  const scrubbed = raw
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[已隐藏]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, 'Bearer [已隐藏]')
    .replace(/api[_-]?key["'\s:=]+[A-Za-z0-9._-]{6,}/gi, 'api_key=[已隐藏]');
  const status = error?.providerStatus ? `（供应商状态 ${error.providerStatus}）` : '';
  return `调用模型失败${status}：${scrubbed.slice(0, 200)}。`;
}

function corsHeaders(origin, allowedOrigins) {
  if (!origin || !isAllowedOrigin(origin, allowedOrigins)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
