/**
 * 视频来源校验与嵌入地址构造。
 * 设计原则：只接受 https；只有来源可验证的提供方才会生成嵌入播放器；
 * 无法验证的来源（例如本机网络无法访问的站点）一律标记为「未验证」并降级为外链。
 */

const BV_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const BILIBILI_HOSTS = new Set(['www.bilibili.com', 'bilibili.com', 'm.bilibili.com', 'player.bilibili.com']);
const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']);

/** 判断是否为可安全跳转的 http(s) 地址。 */
export function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  return url.protocol === 'https:' || url.protocol === 'http:';
}

/** 判断是否为 https 地址（嵌入播放的硬性要求）。 */
export function isHttpsUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 从 B 站链接中解析 BV 号与分 P。
 * 支持 https://www.bilibili.com/video/BVxxxxxxxxxx?p=3 与播放器外链地址。
 * @returns {{ok: true, bvid: string, page: number} | {ok: false, reason: string}}
 */
export function parseBilibiliRef(input) {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, reason: '链接为空' };
  let url;
  try {
    url = new URL(input.trim(), 'https://www.bilibili.com');
  } catch {
    return { ok: false, reason: '链接格式无法解析' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: '仅支持 http(s) 链接' };
  if (!BILIBILI_HOSTS.has(url.hostname.toLowerCase())) return { ok: false, reason: '不是哔哩哔哩域名' };
  const match = url.pathname.match(/\/(?:video|player\.html)?\/?(BV[0-9A-Za-z]{10})/) || url.pathname.match(/(BV[0-9A-Za-z]{10})/);
  const bvid = match ? match[1] : (url.searchParams.get('bvid') || '');
  if (!BV_PATTERN.test(bvid)) return { ok: false, reason: '未找到合法的 BV 号' };
  const rawPage = Number(url.searchParams.get('p') || url.searchParams.get('page') || '1');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  return { ok: true, bvid, page };
}

/**
 * 识别任意用户输入的视频链接。
 * @returns {{ok: true, url: string, provider: string, embeddable: boolean, playbackVerified: boolean, bvid?: string, page?: number, note: string} | {ok: false, reason: string}}
 */
export function classifyVideoUrl(input) {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, reason: '链接为空' };
  const value = input.trim();
  if (/^(javascript|data|file|about|blob):/i.test(value)) return { ok: false, reason: '不支持的链接协议' };
  if (value.startsWith('//')) return classifyVideoUrl(`https:${value}`);
  if (!isSafeHttpUrl(value)) return { ok: false, reason: '请输入完整的 http(s) 链接' };
  const host = hostOf(value);
  if (host.endsWith('bilibili.com')) {
    const ref = parseBilibiliRef(value);
    if (!ref.ok) return { ok: false, reason: ref.reason };
    return {
      ok: true,
      url: `https://www.bilibili.com/video/${ref.bvid}${ref.page > 1 ? `?p=${ref.page}` : ''}`,
      provider: 'bilibili',
      embeddable: true,
      playbackVerified: false,
      bvid: ref.bvid,
      page: ref.page,
      note: '哔哩哔哩外链播放器可用，但能否播放取决于账号/地区与浏览器策略，本站不做播放成功保证。',
    };
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const id = extractYouTubeId(value);
    if (!id) return { ok: false, reason: '未找到合法的 YouTube 视频 ID' };
    return {
      ok: true,
      url: `https://www.youtube.com/watch?v=${id}`,
      provider: 'youtube',
      embeddable: true,
      playbackVerified: false,
      note: '本项目的构建环境无法访问 YouTube，因此该来源只做了链接格式校验，未做可达性验证。',
    };
  }
  if (new URL(value).protocol !== 'https:') return { ok: false, reason: '仅支持 https 链接' };
  return {
    ok: true,
    url: value,
    provider: 'external',
    embeddable: false,
    playbackVerified: false,
    note: '外部来源只能以新标签页打开，不在站内嵌入播放。',
  };
}

/** 提取 YouTube 视频 ID（仅做格式校验，不做网络验证）。 */
export function extractYouTubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
    }
    const v = url.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{6,20}$/.test(v)) return v;
    const embed = url.pathname.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,20})/);
    return embed ? embed[1] : null;
  } catch {
    return null;
  }
}

/** 构造 B 站外链播放器地址（仅当 bvid 合法时）。 */
export function buildBilibiliEmbed(bvid, page = 1) {
  if (!BV_PATTERN.test(String(bvid || ''))) return null;
  const p = Number.isFinite(Number(page)) && Number(page) >= 1 ? Math.floor(Number(page)) : 1;
  return `https://player.bilibili.com/player.html?bvid=${bvid}&page=${p}&autoplay=0&danmaku=0&high_quality=1`;
}

/**
 * 为一个视频条目计算最终的播放信息。
 * @returns {{embeddable: boolean, embedUrl: string|null, watchUrl: string, reason: string, playbackVerified: boolean}}
 */
export function resolveVideoPlayback(video) {
  if (!video || typeof video !== 'object') {
    return { embeddable: false, embedUrl: null, watchUrl: '', reason: '视频数据缺失', playbackVerified: false };
  }
  // 渲染边界再次过滤：导入的备份可能带 javascript:/data: 链接
  const watchUrl = isSafeHttpUrl(video.watchUrl) ? String(video.watchUrl).trim() : '';
  if (video.provider === 'bilibili' && video.bvid) {
    const embedUrl = buildBilibiliEmbed(video.bvid, video.page || 1);
    if (embedUrl) {
      return {
        embeddable: true,
        embedUrl,
        watchUrl,
        playbackVerified: video.playbackVerified === true,
        reason: 'B 站官方外链播放器（需用户点击后才加载，避免自动请求第三方资源）。',
      };
    }
  }
  return {
    embeddable: false,
    embedUrl: null,
    watchUrl,
    playbackVerified: false,
    reason: video.playbackVerified === true ? '该来源未提供站内嵌入播放。' : '来源可达性未在本机验证，仅提供外链跳转。',
  };
}

/** 视频来源可信度徽标文案（如实描述验证级别）。 */
export function verificationBadge(video) {
  if (!video) return { level: 'unknown', label: '来源未知', tone: 'muted' };
  if (video.verification && video.verification.status === 'ok' && video.verification.creatorVerified) {
    return { level: 'verified-channel', label: '来源已验证 · 官方认证账号', tone: 'ok' };
  }
  if (video.verification && video.verification.status === 'ok') {
    return { level: 'verified-page', label: '来源已核实 · 未认证账号', tone: 'warn' };
  }
  if (video.sourceKind === 'user') return { level: 'user', label: '用户自定义来源 · 未验证', tone: 'warn' };
  return { level: 'unknown', label: '来源未验证', tone: 'muted' };
}

