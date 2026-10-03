/**
 * 静态部署路径工具。
 * 站点全部使用相对资源路径 + hash 路由，因此在
 * https://user.github.io/<任意仓库名>/ 下都能直接运行，无需知道仓库名。
 */

/** 从 pathname 推断 GitHub Pages 项目站点的基路径（首段），失败时返回 '/'。 */
export function detectBasePath(pathname = '/') {
  if (typeof pathname !== 'string' || pathname === '') return '/';
  if (pathname === '/') return '/';
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  // 形如 /repo/index.html 或 /repo/ 时返回 /repo/；形如 /repo/course/x 时同样返回 /repo/
  return `/${segments[0]}/`;
}

/** 去掉基路径，得到站点内部路径。 */
export function stripBasePath(pathname, base) {
  if (!base || base === '/') return pathname;
  if (pathname.startsWith(base)) {
    const rest = pathname.slice(base.length);
    return `/${rest}`.replace(/\/{2,}/g, '/');
  }
  return pathname;
}

/** 拼接站点内资源路径（永远返回相对路径，避免绝对路径在子目录部署时失效）。 */
export function assetPath(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  return `./${clean}`;
}

/**
 * 判断字符串是否为「根绝对」资源引用（例如 "/src/app.js"），
 * 这类引用在子路径部署时会失效，构建脚本据此做检查。
 */
export function isRootAbsoluteRef(value) {
  return typeof value === 'string' && /^(?:href|src)\s*=\s*["']\/(?!\/)/i.test(value);
}

/** 校验一个外部链接是否是允许的协议（用于兜底跳转）。 */
export function isSafeExternalLink(url) {
  if (typeof url !== 'string' || url.trim() === '') return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
