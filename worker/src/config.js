/** Worker 运行时配置：缺失关键配置时拒绝服务，而不是静默降级。 */

export const DEFAULTS = {
  // 这些是本项目选定的默认值（不是用户指定的额度），可用 Cloudflare 变量覆盖。
  // 额度单位是「模型尝试次数」，分阶段建课下一门课约消耗 1（大纲）+ 知识点个数（正文）次，
  // 因此默认值按「一位访客每天能建几门课」来定：60 次 ≈ 每天 8-10 门 6-8 知识点的课。
  visitorDailyLimit: 60,
  siteDailyLimit: 200,
  maxConcurrentProviderRequests: 2,
  reservationTtlMs: 180000,
  // 一门「完整课程」（4-12 个知识点，含正文/练习/带解析测验）需要更多输出预算；
  // 默认 8000 tokens、90 秒超时。若模型在这里被截断，接口会明确返回 output-truncated，
  // 而不是悄悄给出半截课程（真实费用取决于你选择的供应商与模型，本项目未做任何付费测试）。
  timeoutMs: 90000,
  maxOutputTokens: 8000,
  maxRequestBytes: 20000,
  maxProviderResponseBytes: 262144,
};

/** 这些默认值是项目选定的折中值，不是用户指定的额度，可在 Cloudflare 变量中覆盖。 */
export function loadConfig(env = {}) {
  const missing = [];
  const invalid = [];

  const providerBaseUrl = String(env.PROVIDER_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!providerBaseUrl) missing.push('PROVIDER_BASE_URL');
  else {
    try {
      const url = new URL(providerBaseUrl);
      if (url.protocol !== 'https:') invalid.push('PROVIDER_BASE_URL 必须是 https');
      if (url.username || url.password) invalid.push('PROVIDER_BASE_URL 不能包含凭据');
      if (url.search) invalid.push('PROVIDER_BASE_URL 不能带查询参数');
      if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url.hostname)) invalid.push('PROVIDER_BASE_URL 不能指向本机地址');
    } catch {
      invalid.push('PROVIDER_BASE_URL 不是合法 URL');
    }
  }

  const providerModel = String(env.PROVIDER_MODEL || '').trim();
  if (!providerModel) missing.push('PROVIDER_MODEL');

  const providerApiKey = String(env.PROVIDER_API_KEY || '').trim();
  if (!providerApiKey) missing.push('PROVIDER_API_KEY');

  const allowedOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (allowedOrigins.length === 0) missing.push('ALLOWED_ORIGINS');
  else {
    for (const origin of allowedOrigins) {
      try {
        const url = new URL(origin);
        if (!['https:', 'http:'].includes(url.protocol)) invalid.push(`ALLOWED_ORIGINS 中的协议不支持：${origin}`);
        if (url.pathname !== '/' && url.pathname !== '') invalid.push(`ALLOWED_ORIGINS 只接受源（scheme://host[:port]）：${origin}`);
      } catch {
        invalid.push(`ALLOWED_ORIGINS 不是合法源：${origin}`);
      }
    }
  }

  const ipSalt = String(env.IP_SALT || '').trim();
  if (ipSalt.length < 16) missing.push('IP_SALT(至少 16 位随机串)');

  // GitHub 登录是**可选**功能：不配置就整体关闭（登录端点返回 503），
  // 但不会因为登录没配好就让 AI 建课等既有能力一起 503。
  const githubClientId = String(env.GITHUB_CLIENT_ID || '').trim();
  const githubClientSecret = String(env.GITHUB_CLIENT_SECRET || '').trim();
  const authTokenSecret = String(env.AUTH_TOKEN_SECRET || '').trim();
  const authRedirectUri = String(env.AUTH_REDIRECT_URI || '').trim();
  const provided = [githubClientId, githubClientSecret, authTokenSecret];
  let authError = null;
  if (provided.some(Boolean) && !provided.every(Boolean)) {
    authError = '登录功能配置不完整：GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET、AUTH_TOKEN_SECRET 必须同时设置。';
  } else if (authTokenSecret && authTokenSecret.length < 32) {
    authError = 'AUTH_TOKEN_SECRET 至少需要 32 位随机串（用于给会话令牌签名）。';
  } else if (authRedirectUri) {
    try {
      const url = new URL(authRedirectUri);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
        authError = 'AUTH_REDIRECT_URI 必须是 https 地址（本地开发可用 http://127.0.0.1）。';
      }
    } catch {
      authError = 'AUTH_REDIRECT_URI 不是合法 URL。';
    }
  }
  const authConfigured = provided.every(Boolean) && !authError;

  const environment = String(env.ENVIRONMENT || 'production').toLowerCase();
  const config = {
    environment,
    providerBaseUrl,
    providerModel,
    providerApiKey,
    allowedOrigins,
    ipSalt,
    visitorDailyLimit: positiveInt(env.VISITOR_DAILY_LIMIT, DEFAULTS.visitorDailyLimit),
    siteDailyLimit: positiveInt(env.SITE_DAILY_LIMIT, DEFAULTS.siteDailyLimit),
    timeoutMs: positiveInt(env.PROVIDER_TIMEOUT_MS, DEFAULTS.timeoutMs),
    maxOutputTokens: positiveInt(env.PROVIDER_MAX_OUTPUT_TOKENS, DEFAULTS.maxOutputTokens),
    maxRequestBytes: positiveInt(env.MAX_REQUEST_BYTES, DEFAULTS.maxRequestBytes),
    maxConcurrentProviderRequests: positiveInt(env.MAX_CONCURRENT_PROVIDER_REQUESTS, DEFAULTS.maxConcurrentProviderRequests),
    reservationTtlMs: positiveInt(env.RESERVATION_TTL_MS, DEFAULTS.reservationTtlMs),
    maxProviderResponseBytes: positiveInt(env.MAX_PROVIDER_RESPONSE_BYTES, DEFAULTS.maxProviderResponseBytes),
    githubClientId,
    githubClientSecret,
    authTokenSecret,
    authRedirectUri,
    authConfigured,
    authError,
  };

  if (missing.length > 0 || invalid.length > 0) {
    return {
      ok: false,
      status: 503,
      error: 'worker-configuration-error',
      message: [
        missing.length ? `缺少必需配置：${missing.join('、')}` : null,
        invalid.length ? `配置不合法：${invalid.join('；')}` : null,
        '请参考 worker/README.md 完成变量与机密设置；未配置完成前本服务不会调用任何模型。',
      ].filter(Boolean).join(' '),
    };
  }
  return { ok: true, config };
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(100000, Math.floor(n));
}

/** 判断请求来源是否在白名单内（Origin 校验只是第一道门，不是配额或鉴权）。 */
export function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  const normalized = String(origin).replace(/\/+$/, '');
  return allowedOrigins.includes(normalized);
}

