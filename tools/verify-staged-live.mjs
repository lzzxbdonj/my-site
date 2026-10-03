/**
 * 分阶段建课的**可选**真实冒烟验证（默认不会打真实模型）。
 *
 * 为什么默认不跑：它会产生真实、已计费的供应商调用。只有显式加 `--live`
 * 才会发请求，因此它可以安全地留在仓库里，也不会被任何自动验收命令触发。
 *
 * 纪律：
 *  - 一次运行最多 **1 门课**：1 次大纲 + ≤12 个知识点；**不做任何自动重试**；
 *    任一知识点失败就停止发新请求，已拿到的结果留在缓存里。
 *  - 结果写入 `.cache/live-smoke/<runId>/`（已被 .gitignore 排除），
 *    下次运行可 `--reuse <runId>` 复用已完成的知识点，避免重复付费。
 *  - 只打印服务端回报的用量与结构统计；**绝不打印密钥**（密钥只存在于
 *    worker/.dev.vars，本脚本从不读取它）。
 *  - 上报的 usage 只来自成功响应，失败/超时通常没有 usage，因此汇总会**低估**
 *    真实支出；这里不做任何人民币金额或单价推算。
 *
 * 用法：
 *   node tools/verify-staged-live.mjs              # 预演：不发请求，只说明会做什么
 *   node tools/verify-staged-live.mjs --live       # 真实运行（产生费用）
 *   node tools/verify-staged-live.mjs --live --reuse <runId>
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { VIDEO_LIBRARY } from '../src/data/videos.js';
import { toAppCourse } from '../src/core/ai-course.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_ROOT = path.join(ROOT, '.cache', 'live-smoke');
const WORKER = process.env.STUDYMATE_WORKER_URL || 'http://127.0.0.1:8787';
const ORIGIN = process.env.STUDYMATE_ORIGIN || 'http://127.0.0.1:4173';
const MAX_CONCEPTS = 12;
const CONCURRENCY = 2;

const argv = process.argv.slice(2);
const live = argv.includes('--live');
const reuseIndex = argv.indexOf('--reuse');
const reuseId = reuseIndex === -1 ? null : argv[reuseIndex + 1];

const input = {
  topic: process.env.STUDYMATE_TOPIC || 'Python 列表与字典入门',
  goal: 'starter',
  level: 'new',
  weeklyHours: 4,
  lessonMinutes: 40,
};

const headers = { origin: ORIGIN, 'content-type': 'application/json' };

async function post(pathname, body) {
  const res = await fetch(`${WORKER}${pathname}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应保持 null */ }
  return { status: res.status, json, text };
}

function plan() {
  console.log('预演（未发送任何请求）。真实运行请加 --live。');
  console.log(`  Worker：${WORKER}`);
  console.log(`  Origin：${ORIGIN}（必须与 Worker 的 ALLOWED_ORIGINS 一致，否则会被 403 拒绝）`);
  console.log(`  主题：${input.topic}`);
  console.log(`  上限：1 次大纲 + 最多 ${MAX_CONCEPTS} 个知识点，并发 ${CONCURRENCY}，不自动重试`);
  console.log('  会产生真实费用；失败时停止发新请求并保留已完成结果。');
  console.log(`  缓存目录：${path.relative(ROOT, CACHE_ROOT)}/<runId>/`);
}

async function health() {
  try {
    const res = await fetch(`${WORKER}/api/health`, { headers: { origin: ORIGIN } });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message || error) };
  }
}

async function loadReuse(runId) {
  const dir = path.join(CACHE_ROOT, runId);
  const outline = JSON.parse(await readFile(path.join(dir, 'outline.json'), 'utf8'));
  const contents = {};
  for (const file of await readdir(path.join(dir, 'lessons')).catch(() => [])) {
    if (!file.endsWith('.json')) continue;
    contents[file.replace(/\.json$/, '')] = JSON.parse(await readFile(path.join(dir, 'lessons', file), 'utf8'));
  }
  return { outline, contents };
}

async function main() {
  if (!live) { plan(); return 0; }

  const runId = reuseId || new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(CACHE_ROOT, runId);
  await mkdir(path.join(dir, 'lessons'), { recursive: true });

  const probe = await health();
  if (!probe.ok) {
    console.error(`Worker 不可用（${WORKER}）：${probe.status || probe.error}`);
    console.error('请先启动本地 Worker（npm run worker:dev:local），并确认 Origin 在白名单内。');
    return 1;
  }
  console.log(`Worker 健康检查通过：model=${probe.body?.model || '未知'} status=${probe.status}`);

  let outline;
  const contents = {};
  if (reuseId) {
    ({ outline, contents } = await loadReuse(reuseId));
    console.log(`复用 ${reuseId}：大纲 1 份，已完成知识点 ${Object.keys(contents).length} 个`);
  }

  const t0 = Date.now();
  const usage = { prompt: 0, completion: 0, calls: 0 };

  if (!outline) {
    const res = await post('/api/course/outline', {
      ...input,
      videoLibrary: VIDEO_LIBRARY.slice(0, 60).map((v) => ({
        id: v.id, title: v.title, creator: v.creator, subjectId: v.subjectId,
        knowledgePoints: (v.knowledgePoints || []).slice(0, 8),
      })),
    });
    usage.calls += 1;
    if (res.status !== 200) {
      console.error(`大纲失败：status=${res.status}`);
      console.error(res.text.slice(0, 400));
      return 1;
    }
    outline = res.json.outline;
    usage.prompt += res.json.meta?.usage?.prompt_tokens || 0;
    usage.completion += res.json.meta?.usage?.completion_tokens || 0;
    await writeFile(path.join(dir, 'outline.json'), JSON.stringify(outline, null, 2), 'utf8');
    console.log(`大纲：${outline.title}／${outline.concepts.length} 个知识点（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  }

  const concepts = outline.concepts.slice(0, MAX_CONCEPTS);
  const queue = concepts.filter((c) => !contents[c.id]);
  const failed = [];

  const runOne = async () => {
    while (queue.length > 0 && failed.length === 0) {
      const concept = queue.shift();
      const started = Date.now();
      const res = await post('/api/course/lesson', { ...input, outline, conceptId: concept.id });
      usage.calls += 1;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (res.status !== 200) {
        failed.push({ id: concept.id, status: res.status, error: res.json?.error || 'unknown' });
        console.error(`[lesson ${concept.id}] 失败 status=${res.status} error=${res.json?.error}（已停止发新请求）`);
        return;
      }
      usage.prompt += res.json.meta?.usage?.prompt_tokens || 0;
      usage.completion += res.json.meta?.usage?.completion_tokens || 0;
      contents[concept.id] = res.json.concept;
      await writeFile(path.join(dir, 'lessons', `${concept.id}.json`), JSON.stringify(res.json.concept, null, 2), 'utf8');
      const c = res.json.concept;
      console.log(`[lesson ${concept.id}] ${secs}s 正文${c.lesson.sections.length}节 术语${c.keyTerms.length} 练习${c.exercises.length} 测验${c.quiz?.questions?.length ?? 0} 任务${c.tasks?.length ?? 0} 视频${c.videoIds?.length ?? 0} 出tokens=${res.json.meta?.usage?.completion_tokens ?? '无'}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, queue.length)) }, runOne));

  const summary = {
    runId,
    model: 'deepseek-chat（由 Worker 配置决定）',
    elapsedSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    requests: usage.calls,
    conceptsTotal: concepts.length,
    conceptsCompleted: Object.keys(contents).length,
    failed,
    usageReported: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.prompt + usage.completion },
    usageNote: '仅统计成功响应的 usage；失败/超时通常不返回 usage，因此这是真实支出的下界，不是账单金额。',
  };

  if (failed.length === 0) {
    const merged = { ...outline, concepts: concepts.map((c) => ({ ...c, ...contents[c.id] })) };
    const converted = toAppCourse(merged, { videoLibrary: VIDEO_LIBRARY, model: 'deepseek' });
    summary.assembled = converted.ok;
    if (converted.ok) {
      const course = converted.course;
      summary.course = {
        concepts: course.concepts.length,
        quizzes: Object.keys(course.quizzes).length,
        handsOn: course.concepts.filter((c) => c.type !== 'concept').length,
        videosMatched: course.concepts.reduce((n, c) => n + c.videoIds.length, 0),
      };
    } else {
      summary.assembleErrors = converted.errors.slice(0, 5);
    }
  }

  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n结果：${summary.conceptsCompleted}/${summary.conceptsTotal} 个知识点，请求 ${summary.requests} 次，耗时 ${summary.elapsedSeconds}s`);
  console.log(`用量（成功响应）：输入 ${usage.prompt} / 输出 ${usage.completion} tokens —— 真实支出的下界，不是账单`);
  if (failed.length > 0) console.log(`失败：${failed.map((f) => f.id).join('、')}（可 --reuse ${runId} 续跑）`);
  else console.log(`拼装与前端二次校验：${summary.assembled ? '通过' : '失败'} ${JSON.stringify(summary.course || summary.assembleErrors || {})}`);
  console.log(`缓存：${path.relative(ROOT, dir)}`);
  return failed.length === 0 ? 0 : 1;
}

process.exitCode = await main();
