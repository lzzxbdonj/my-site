#!/usr/bin/env node
/**
 * 精选视频核实脚本（可复现）。
 *
 * 做三件事：
 *  1) 调哔哩哔哩公开接口核对每条视频真实存在、标题、UP 主与分 P 时长；
 *  2) 核对 MIT OCW 课程页可访问（HTTP 200 + 标题）；
 *  3) 把结果写成 docs/video-verification.json，并把不一致项打印出来（不一致时以非零码退出）。
 *
 * 说明：脚本只验证「来源页面/元数据可达且一致」，不验证嵌入播放是否成功播放。
 * 请使用 `node --use-system-ca tools/verify-videos.mjs`（本机 TLS 需要系统证书）。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { VIDEO_LIBRARY, VERIFIED_AT } from '../src/data/videos.js';

const root = path.resolve(import.meta.dirname, '..');
const outFile = path.join(root, 'docs', 'video-verification.json');

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'StudyMate-Web/1.0 (+video verification)', referer: 'https://www.bilibili.com/' },
    });
    const text = await response.text();
    return { status: response.status, json: safeJson(text), text };
  } catch (error) {
    return { status: 0, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const report = {
  app: 'StudyMate-Web',
  checkedAt: new Date().toISOString(),
  baselineDate: VERIFIED_AT,
  method: [
    'bilibili: https://api.bilibili.com/x/web-interface/view?bvid=... 核对存在性/合集标题/分 P 标题/UP 主/时长（单 P 视频比对 data.title，多 P 视频比对 pages[].part）',
    'bilibili: https://api.bilibili.com/x/web-interface/card?mid=... 核对账号认证状态',
    'mit-ocw: 课程页 HTTP 200 与页面 <title>',
  ],
  playbackVerification: 'none（本脚本不验证嵌入播放器是否成功播放，也不做任何相关声称）',
  items: [],
  problems: [],
  notes: [],
};

const creatorCache = new Map();

for (const video of VIDEO_LIBRARY) {
  const entry = { id: video.id, provider: video.provider, watchUrl: video.watchUrl, ok: false };

  if (video.provider === 'bilibili') {
    const result = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${video.bvid}`);
    const data = result.json?.data;
    entry.httpStatus = result.status;
    entry.apiCode = result.json?.code ?? null;
    if (!data) {
      entry.error = result.error || `接口返回 code=${result.json?.code}`;
      report.problems.push(`${video.id}: 无法核实（${entry.error}）`);
    } else {
      const page = (data.pages || []).find((p) => p.page === (video.page || 1));
      entry.actual = {
        title: data.title,
        owner: data.owner?.name,
        mid: data.owner?.mid,
        durationSeconds: page ? page.duration : data.duration,
        partTitle: page?.part || null,
        videos: data.videos,
      };
      // 多分 P 视频：接口的 data.title 是合集标题，分 P 标题在 pages[].part
      const expectedTitle = (video.page || 1) > 1 ? (page?.part || null) : data.title;
      const titleMatch = expectedTitle === video.title;
      const ownerMatch = data.owner?.name === video.creator;
      const durationMatch = video.durationSeconds === null || entry.actual.durationSeconds === video.durationSeconds;
      entry.collectionTitle = data.title;
      entry.expectedTitle = expectedTitle;
      entry.titleMatch = titleMatch;
      entry.ownerMatch = ownerMatch;
      entry.durationMatch = durationMatch;
      entry.ok = Boolean(titleMatch && ownerMatch && durationMatch);
      if (!titleMatch) report.problems.push(`${video.id}: 标题不一致（记录「${video.title}」/ 实际「${expectedTitle}」）`);
      // series 只是界面用的短标签，与接口的合集全名不一致时仅作提示，不作为核实失败
      if (video.series && data.title !== video.series) report.notes.push(`${video.id}: 短标签「${video.series}」对应的合集全名是「${data.title}」`);
      if (!ownerMatch) report.problems.push(`${video.id}: UP 主不一致（记录「${video.creator}」/ 实际「${data.owner?.name}」）`);
      if (!durationMatch) report.problems.push(`${video.id}: 时长不一致（记录 ${video.durationSeconds}s / 实际 ${entry.actual.durationSeconds}s）`);

      if (video.creatorMid) {
        if (!creatorCache.has(video.creatorMid)) {
          const card = await getJson(`https://api.bilibili.com/x/web-interface/card?mid=${video.creatorMid}&photo=false`);
          const info = card.json?.data?.card;
          creatorCache.set(video.creatorMid, {
            name: info?.name || null,
            officialVerify: info?.official_verify?.desc || null,
            officialType: info?.official_verify?.type ?? null,
            fans: info?.fans ?? null,
          });
        }
        entry.creatorVerification = creatorCache.get(video.creatorMid);
        if (entry.creatorVerification?.name && entry.creatorVerification.name !== video.creator) {
          report.problems.push(`${video.id}: 账号名称与记录不一致（${video.creator} vs ${entry.creatorVerification.name}）`);
        }
      }
    }
  } else {
    const result = await getJson(video.watchUrl);
    entry.httpStatus = result.status;
    const title = (result.text || '').match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
    entry.actual = { pageTitle: title ? title[1].trim() : null };
    entry.ok = result.status === 200;
    if (!entry.ok) report.problems.push(`${video.id}: 页面不可访问（HTTP ${result.status || 'error'}）`);
  }

  report.items.push(entry);
}

report.summary = {
  total: report.items.length,
  verified: report.items.filter((i) => i.ok).length,
  failed: report.items.filter((i) => !i.ok).length,
  creators: [...creatorCache.entries()].map(([mid, info]) => ({ mid, ...info })),
};

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`视频核实完成：${report.summary.verified}/${report.summary.total} 条一致，写入 ${path.relative(root, outFile)}`);
for (const problem of report.problems) console.log(` - 问题：${problem}`);
for (const note of report.notes) console.log(` - 提示：${note}`);
if (report.problems.length > 0) {
  console.log('提示：不一致项需要人工确认后再更新 src/data/videos.js（不要直接照抄接口结果，先核对内容是否仍适合该知识点）。');
  process.exitCode = 1;
}
