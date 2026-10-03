/** 极简 hash 路由：GitHub Pages 任意子路径下都能工作（不需要服务端重写）。 */

export const ROUTES = [
  { view: 'dashboard', pattern: [''] },
  { view: 'explore', pattern: ['explore'] },
  { view: 'plan', pattern: ['plan'] },
  { view: 'generate', pattern: ['generate'] },
  { view: 'course', pattern: ['course', ':courseId'] },
  { view: 'lesson', pattern: ['lesson', ':courseId', ':conceptId'] },
  { view: 'slides', pattern: ['slides', ':courseId', ':conceptId'] },
  { view: 'videos', pattern: ['videos'] },
  { view: 'profile', pattern: ['profile'] },
  { view: 'settings', pattern: ['settings'] },
  { view: 'authComplete', pattern: ['auth', 'complete'] },
  { view: 'about', pattern: ['about'] },
];

const DEFAULT_ROUTE = { view: 'dashboard', params: {}, query: {}, raw: '#/' };

/**
 * 解析 location.hash。
 * @param {string} hash 例如 "#/lesson/python/py-loop?from=plan"
 */
export function parseRoute(hash) {
  const raw = typeof hash === 'string' && hash !== '' ? hash : '#/';
  const withoutHash = raw.replace(/^#/, '');
  const [pathPart, queryPart = ''] = withoutHash.split('?');
  const segments = pathPart.split('/').filter((s) => s !== '');
  const query = {};
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    if (k) query[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    const params = {};
    let matched = true;
    route.pattern.forEach((token, index) => {
      if (token.startsWith(':')) params[token.slice(1)] = decodeURIComponent(segments[index]);
      else if (token !== segments[index]) matched = false;
    });
    if (matched) return { view: route.view, params, query, raw };
  }
  return { ...DEFAULT_ROUTE, raw, notFound: true };
}

/** 生成 hash 链接（永远是相对当前页面的引用，天然支持子路径部署）。 */
export function buildRoute(view, params = {}, query = {}) {
  const route = ROUTES.find((r) => r.view === view);
  if (!route) return '#/';
  const path = route.pattern
    .map((token) => {
      if (!token.startsWith(':')) return token;
      const key = token.slice(1);
      return params[key] === undefined || params[key] === null ? '' : encodeURIComponent(String(params[key]));
    })
    .filter((s) => s !== '')
    .join('/');
  const search = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `#/${path}${search ? `?${search}` : ''}`;
}

/** 顶部导航使用的固定链接。 */
export const NAV_ITEMS = [
  { view: 'dashboard', label: '学习台' },
  { view: 'explore', label: '课程库' },
  { view: 'plan', label: '定制课程' },
  { view: 'generate', label: '智能建课' },
  { view: 'videos', label: '视频课' },
  { view: 'profile', label: '我的进度' },
  { view: 'about', label: '关于' },
];

export function routeTitle(route) {
  switch (route.view) {
    case 'dashboard': return '学习台';
    case 'explore': return '课程库';
    case 'plan': return '定制课程';
    case 'generate': return '智能建课';
    case 'course': return '课程详情';
    case 'lesson': return '课时';
    case 'slides': return '课件模式';
    case 'videos': return '视频课';
    case 'profile': return '我的进度';
    case 'settings': return '设置';
    case 'authComplete': return '正在完成登录';
    case 'about': return '关于本项目';
    default: return '页面不存在';
  }
}
