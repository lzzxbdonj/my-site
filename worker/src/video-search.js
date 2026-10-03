/**
 * 联网搜索配套视频，并**逐个核实**后才加入课程。
 *
 * 为什么要服务端做：用户所在网络常常访问不了视频站点（实测被 DNS 污染与连接重置），
 * 但 **Worker 跑在 Cloudflare 边缘，出网是通的**。于是「找 + 核实」都放在服务端，
 * 浏览器只连 pages.dev，永远不直接碰视频站。
 *
 * 安全与诚实边界：
 *  - 只从搜索结果里取 **bvid**，观看链接由服务端自己拼（`https://www.bilibili.com/video/<bvid>`），
 *    **绝不使用接口返回的任何 URL**，避免把外部链接塞进课程；
 *  - 标题/作者会被清洗（去掉搜索结果里的 `<em>` 高亮标签、收敛空白、截断长度）；
 *  - 每个候选都要再查一次详情接口核实：`code === 0`、`bvid` 与请求一致、有标题，才认可；
 *  - 只声称「该视频存在且元数据一致」，**不声称一定能播放**（受地区/登录/浏览器策略影响）；
 *  - 搜索或核实失败**绝不影响建课**：调用方会退回本地目录。
 */

const SEARCH_ENDPOINT = 'https://api.bilibili.com/x/web-interface/search/type';
const VIEW_ENDPOINT = 'https://api.bilibili.com/x/web-interface/view';
const BILIBILI_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  referer: 'https://www.bilibili.com/',
  accept: 'application/json',
};

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

/** 搜索结果里的标题带 `<em class="keyword">` 高亮标签，必须清掉；同时约束长度。 */
function cleanText(value, max) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function watchUrlFor(bvid) {
  return `https://www.bilibili.com/video/${bvid}`;
}

async function fetchJson(url, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: BILIBILI_HEADERS, signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    try { return JSON.parse(text); } catch { return null; }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 拿候选列表（只取 bvid + 已知元数据，不信任任何 URL）。 */
async function searchCandidates({ keyword, fetchImpl, timeoutMs }) {
  const url = `${SEARCH_ENDPOINT}?search_type=video&keyword=${encodeURIComponent(keyword)}`;
  const data = await fetchJson(url, { fetchImpl, timeoutMs });
  if (!data || data.code !== 0 || !data.data || !Array.isArray(data.data.result)) return [];
  return data.data.result
    .map((item) => {
      const bvid = String(item?.bvid || '').trim();
      if (!BVID_PATTERN.test(bvid)) return null; // 广告位等没有 bvid 的条目直接丢掉
      return {
        bvid,
        title: cleanText(item?.title, 120),
        creator: cleanText(item?.author, 60),
        durationSeconds: Number.isFinite(Number(item?.duration)) ? Number(item.duration) : null,
      };
    })
    .filter(Boolean);
}

/** 逐个核实：详情接口确认存在且元数据一致。 */
async function verifyCandidate({ candidate, fetchImpl, timeoutMs }) {
  const data = await fetchJson(`${VIEW_ENDPOINT}?bvid=${candidate.bvid}`, { fetchImpl, timeoutMs });
  if (!data || data.code !== 0 || !data.data) return null;
  const view = data.data;
  if (String(view.bvid || '') !== candidate.bvid) return null; // 返回的不是同一个视频，拒绝
  const title = cleanText(view.title, 120);
  if (!title) return null;
  return {
    id: candidate.bvid,
    title,
    creator: cleanText(view.owner?.name, 60) || candidate.creator,
    durationSeconds: Number.isFinite(Number(view.duration)) ? Number(view.duration) : candidate.durationSeconds,
    watchUrl: watchUrlFor(candidate.bvid),
    provider: 'bilibili',
    source: 'online-search',
    verifiedAt: new Date().toISOString(),
  };
}

/**
 * 搜索并核实视频。任何一步失败都返回空数组（调用方据此退回本地目录），
 * 绝不因为视频搜索失败而让建课失败。
 */
export async function searchVideosOnline({ keywords = [], limit = 3, fetchImpl = fetch, timeoutMs = 8000, maxConcurrency = 6 } = {}) {
  const words = [...new Set(keywords.map((word) => cleanText(word, 40)).filter((word) => word.length >= 2))].slice(0, 2);
  if (words.length === 0) return { videos: [], searched: 0, verified: 0, reason: 'no-keywords' };

  const candidates = [];
  const seen = new Set();
  for (const keyword of words) {
    const found = await searchCandidates({ keyword, fetchImpl, timeoutMs }).catch(() => []);
    for (const candidate of found) {
      if (seen.has(candidate.bvid)) continue;
      seen.add(candidate.bvid);
      candidates.push(candidate);
    }
    if (candidates.length >= limit * 4) break;
  }
  const shortlist = candidates.slice(0, Math.max(limit * 3, 6));
  if (shortlist.length === 0) return { videos: [], searched: candidates.length, verified: 0, reason: 'no-candidates' };

  // 并发核实，但保持有界，避免对第三方接口造成压力
  const verified = [];
  for (let index = 0; index < shortlist.length && verified.length < limit; index += maxConcurrency) {
    const batch = shortlist.slice(index, index + maxConcurrency);
    const results = await Promise.all(batch.map((candidate) => verifyCandidate({ candidate, fetchImpl, timeoutMs }).catch(() => null)));
    for (const video of results) {
      if (video && verified.length < limit && !verified.some((v) => v.id === video.id)) verified.push(video);
    }
  }
  return { videos: verified, searched: candidates.length, verified: verified.length };
}
