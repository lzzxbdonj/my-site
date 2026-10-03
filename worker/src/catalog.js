/**
 * 服务端权威视频目录。
 *
 * 安全要点：客户端提交的「已核实视频库」只是**提示**，不能作为可信来源。
 * 服务端直接使用仓库里同一份精选视频数据（src/data/videos.js），因此：
 *  - 提示词里的视频只来自服务端目录；
 *  - 模型返回的 videoIds 只接受服务端已知的 id，客户端伪造的条目一律忽略；
 *  - 返回给前端的 meta 里会说明忽略了多少条客户端条目，绝不把客户端文本说成「已核实」。
 */

import { VIDEO_LIBRARY } from '../../src/data/videos.js';

export const SERVER_VIDEOS = VIDEO_LIBRARY.map((video) => ({
  id: video.id,
  title: video.title,
  creator: video.creator,
  creatorVerified: video.creatorVerified === true,
  subjectId: video.subjectId,
  knowledgePoints: Array.isArray(video.knowledgePoints) ? video.knowledgePoints.slice(0, 8) : [],
  provider: video.provider,
  durationSeconds: video.durationSeconds ?? null,
  enrichment: video.enrichment === true,
}));

export const SERVER_VIDEO_IDS = new Set(SERVER_VIDEOS.map((video) => video.id));
export const SERVER_CATALOG_VERSION = `videos:${SERVER_VIDEOS.length}`;

/** 只接受服务端已知的 id。 */
export function knownVideoIds(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((id) => String(id)).filter((id) => SERVER_VIDEO_IDS.has(id)))];
}

/**
 * 建课时**检索**配套视频：用模型给出的检索关键词（+ 知识点标题/目标）在服务端目录里检索。
 *
 * 为什么由服务端检索而不是让模型挑 id：
 *  - 模型只能给「检索意图」（关键词），不能凭空指定视频，因此不可能编造 id 或链接；
 *  - 检索结果仍然只来自服务端目录，客户端与模型都无法把外部内容塞进课程。
 */
export function searchServerVideos({ keywords = [], topic = '', limit = 3 } = {}) {
  const words = [...keywords, ...String(topic).split(/[\s,，、/|]+/)]
    .map((word) => String(word).trim().toLowerCase())
    .filter((word) => word.length >= 2);
  const unique = [...new Set(words)].slice(0, 24);
  const scored = SERVER_VIDEOS.map((video) => {
    const haystack = `${video.title} ${video.creator} ${video.subjectId} ${(video.knowledgePoints || []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const word of unique) if (haystack.includes(word)) score += 3;
    if (video.enrichment) score -= 1;
    return { video, score };
  }).filter((item) => item.score > 0).sort((a, b) => (b.score - a.score) || a.video.id.localeCompare(b.video.id));
  return {
    videos: scored.slice(0, Math.max(0, Math.min(limit, 6))).map((item) => item.video),
    keywords: unique,
    matched: scored.length > 0,
  };
}

/**
 * 依据学习主题挑选相关视频作为提示词素材（仍然只是候选，由模型在给定集合内选择）。
 * 关键字命中标题/作者/知识点/学科时优先；没有命中时返回全部（并明确告知模型可留空）。
 */
export function selectServerVideos({ topic = '', limit = 24 } = {}) {
  const keywords = String(topic)
    .toLowerCase()
    .split(/[\s,，、/|]+/)
    .filter((word) => word.length >= 2);
  const scored = SERVER_VIDEOS.map((video) => {
    const haystack = `${video.title} ${video.creator} ${video.subjectId} ${(video.knowledgePoints || []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const word of keywords) if (haystack.includes(word)) score += 3;
    if (haystack.includes('linear-algebra') && /线性代数|矩阵|向量/.test(topic)) score += 6;
    if (haystack.includes('python') && /python|编程|脚本/i.test(topic)) score += 6;
    if (haystack.includes('machine-learning') && /机器学习|模型|人工智能|ai/i.test(topic)) score += 6;
    if (video.enrichment) score -= 1;
    return { video, score };
  });
  const relevant = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const chosen = (relevant.length > 0 ? relevant : scored.sort((a, b) => a.video.id.localeCompare(b.video.id))).slice(0, limit);
  return {
    videos: chosen.map((item) => item.video),
    matchedByTopic: relevant.length > 0,
  };
}
