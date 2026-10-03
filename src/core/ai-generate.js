/**
 * 分阶段建课的状态机（纯逻辑，不碰 DOM，便于单元测试）。
 *
 * 为什么把它从视图层抽出来：续跑、去重与计费相关行为都是「正确性」问题，
 * 必须在没有浏览器的情况下也能被测试。这里刻意只依赖注入的 fetch 与一个
 * 普通对象 store（序列化只包含普通数据，函数放在 WeakMap 里）。
 *
 * 关键约定：
 *  - identity 同时包含**全部草稿字段**与**规范化后的 Worker 地址**。
 *    只比较主题会造成「换了目标/水平/时长却续用旧正文」这种静默错误。
 *  - 同一 identity 同时只允许一次进行中的生成；重复点击会恢复到同一次运行，
 *    不会发出第二份请求（每次请求都可能已被供应商计费）。
 *  - 只有已确认返回的知识点才算「已完成」；任何知识点都不会被重复请求，
 *    包括失败后重试、重复点击与成功后的再次点击。
 *  - 失败后保留「大纲 + 已完成知识点」（仅当前标签页内存，刷新即失效），
 *    重试只补未完成的部分；不会整门课重跑。
 *  - usage 汇总覆盖「大纲 + 全部知识点」，不是只取最后一次响应。
 */

import {
  buildOutlinePayload,
  buildLessonPayload,
  normalizeWorkerUrl,
  generateOutlineViaWorker,
  generateLessonViaWorker,
  WORKER_DEADLINES,
} from './ai-client.js';
import { toAppCourse } from './ai-course.js';
import {
  normalizeTemplateId,
  templateSignature,
  MIN_WEEKLY_HOURS,
  MAX_WEEKLY_HOURS,
  MIN_LESSON_MINUTES,
  MAX_LESSON_MINUTES,
} from '../data/course-templates.js';

/** 提示词版本：提示词/结构约定变化时手动递增，避免跨版本续跑。 */
export const PROMPT_VERSION = 'staged-2026-10-03';
export const MAX_CONCEPTS = 12;
export const LESSON_CONCURRENCY = 2;
/** 单次生成的总预算（毫秒）：一次大纲 + 全部知识点，超出即停止继续请求。 */
export const GENERATION_BUDGET_MS = 15 * 60 * 1000;

const DRAFT_FIELDS = ['topic', 'goal', 'level', 'weeklyHours', 'lessonMinutes', 'templateId'];

const USAGE_FIELDS = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens'];
const META_FIELDS = ['model', 'stage', 'conceptId', 'generatedAt', 'catalogVersion', 'conceptCount', 'matchedVideoIds', 'noVerifiedVideoMatch', 'ignoredClientVideoEntries', 'disclaimer'];

const identities = new WeakMap();

const recordFor = (store) => {
  let record = identities.get(store);
  if (!record) {
    record = new Map();
    identities.set(store, record);
  }
  return record;
};
const listAttempts = (store) => recordFor(store).get('attempts') || new Map();
const setAttempts = (store, map) => recordFor(store).set('attempts', map);
const activePromiseOf = (store, identity = store?.identity) => (identity ? listAttempts(store).get(identity) || null : null);
/** 该 store 上是否有任意身份正在生成（用于串行化不同身份的请求）。 */
const activeRunOf = (store) => recordFor(store).get('activeRun') || null;
const setActiveRun = (store, value) => recordFor(store).set('activeRun', value);

/** 归一化草稿：数字与字符串统一到稳定形式，避免 "4" 与 4 被判成不同身份。 */
export function normalizeDraft(draft = {}) {
  const topic = String(draft.topic || '').trim();
  const numeric = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  return {
    topic,
    goal: String(draft.goal || '').trim(),
    level: String(draft.level || '').trim(),
    weeklyHours: numeric(draft.weeklyHours, 4, MIN_WEEKLY_HOURS, MAX_WEEKLY_HOURS),
    lessonMinutes: numeric(draft.lessonMinutes, 40, MIN_LESSON_MINUTES, MAX_LESSON_MINUTES),
    // 模板只接受受信任的 id；未知/伪造值退化为「自定义」，不影响提示词
    templateId: normalizeTemplateId(draft.templateId),
  };
}

/**
 * 生成身份：规范化 Worker 地址 + 全部草稿字段 + 模板取向 + 提示词版本。
 * 换 Worker、换模板、换目标/水平/时长，或提示词升级，都会得到新身份 → 全新生成，
 * 因此不会在需求已经变化的情况下静默续跑旧正文。
 */
export function buildGenerationIdentity(workerUrl, draft) {
  const normalizedUrl = normalizeWorkerUrl(workerUrl);
  const base = normalizedUrl.ok ? normalizedUrl.base : String(workerUrl || '').trim();
  const input = normalizeDraft(draft);
  return JSON.stringify({
    worker: base,
    prompt: PROMPT_VERSION,
    topic: input.topic,
    goal: input.goal,
    level: input.level,
    weeklyHours: input.weeklyHours,
    lessonMinutes: input.lessonMinutes,
    template: templateSignature(input.templateId),
  });
}

/** 与上次生成相比，哪些输入发生了变化（用于如实告知「为什么是重新开始」）。 */
export function changedGenerationFields(previous, current) {
  if (!previous) return [];
  const before = JSON.parse(previous);
  const after = JSON.parse(current);
  return Object.keys(after).filter((key) => before[key] !== after[key]);
}

/**
 * 当前界面上的输入与「上一次生成所用的输入」相比，哪些字段变了。
 * 界面据此提示：改动需求会导致重新生成，之前保留在内存里的进度不再适用。
 */
export function draftChangedFields(plan, draft) {
  if (!plan?.draft) return [];
  const before = plan.draft;
  const after = normalizeDraft(draft);
  const changed = DRAFT_FIELDS.filter((key) => before[key] !== after[key]);
  if (!changed.includes('templateId') && before.templateId !== after.templateId) changed.push('templateId');
  return changed;
}

/** 面向用户的输入摘要（沿用界面上的中文标签）。 */
export function summarizeDraft(draft) {
  const input = normalizeDraft(draft);
  return {
    topic: input.topic,
    goal: input.goal,
    level: input.level,
    weeklyHours: input.weeklyHours,
    lessonMinutes: input.lessonMinutes,
    templateId: input.templateId,
  };
}

/** 只保留必要字段：供应商原始 usage 与元信息，绝不做整份透传。 */
export function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return { usage: {}, fields: {} };
  const usage = {};
  for (const key of USAGE_FIELDS) {
    const value = Number(meta.usage?.[key]);
    if (Number.isFinite(value) && value >= 0) usage[key] = Math.round(value);
  }
  const fields = {};
  for (const key of META_FIELDS) {
    const value = meta[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' || typeof value === 'boolean') fields[key] = value;
    else if (typeof value === 'string') fields[key] = value.slice(0, 80);
  }
  return { usage, fields };
}

/** 把一次响应里的 usage 累加进汇总（大纲 + 每次知识点都各算一次）。 */
export function mergeUsage(total, meta) {
  const { usage } = sanitizeMeta(meta);
  const next = { ...(total || {}) };
  for (const [key, value] of Object.entries(usage)) next[key] = (next[key] || 0) + value;
  return next;
}

/** 产生面向用户的汇总文案；明确这不是精确账单。 */
export function summarizeUsage(usage, { model = '', attempts: attemptCount = 0 } = {}) {
  const input = Number(usage?.prompt_tokens) || 0;
  const output = Number(usage?.completion_tokens) || 0;
  const cached = Number(usage?.prompt_cache_hit_tokens) || 0;
  const total = Number(usage?.total_tokens) || input + output;
  if (total === 0 && attemptCount === 0) return null;
  const parts = [`输入 ${input} tokens`, `输出 ${output} tokens`];
  if (cached > 0) parts.push(`其中缓存命中 ${cached} tokens`);
  if (total > 0) parts.push(`合计 ${total} tokens`);
  return {
    input, output, cached, total, attempts: attemptCount, model: model || '',
    text: `${parts.join(' · ')}（${attemptCount} 次模型尝试）。这是服务端回报的用量，不等于供应商账单的精确金额。`,
  };
}

/** 该知识点是否已有可用内容。 */
export function hasContent(contents, rawConcept) {
  const id = typeof rawConcept === 'string' ? rawConcept : rawConcept?.id;
  const value = id ? contents?.[id] : null;
  return Boolean(value) && typeof value === 'object';
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * 拒绝畸形大纲：服务端已校验，但客户端不能假设它一定会做。
 * 返回 null 表示可用，否则返回错误说明（同时供界面展示）。
 */
export function normalizeOutline(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '服务返回的大纲不是对象' };
  if (!isNonEmptyString(raw.title) || !isNonEmptyString(raw.subject) || !isNonEmptyString(raw.summary)) {
    return { ok: false, error: '服务返回的大纲缺少课程标题/学科/简介' };
  }
  if (!Array.isArray(raw.concepts) || raw.concepts.length === 0) return { ok: false, error: '服务返回的大纲没有任何知识点' };
  if (raw.concepts.length > MAX_CONCEPTS) return { ok: false, error: `服务返回的知识点超过 ${MAX_CONCEPTS} 个，已拒绝` };
  for (const [index, concept] of raw.concepts.entries()) {
    if (!concept || typeof concept !== 'object') return { ok: false, error: `大纲第 ${index + 1} 个知识点不是对象` };
    if (!isNonEmptyString(concept.id)) return { ok: false, error: `大纲第 ${index + 1} 个知识点缺少 id` };
    if (!isNonEmptyString(concept.title)) return { ok: false, error: `大纲第 ${index + 1} 个知识点缺少标题` };
  }
  const ids = raw.concepts.map((c) => String(c.id).trim().toLowerCase());
  if (new Set(ids).size !== ids.length) return { ok: false, error: '大纲中存在重复的知识点 id' };
  return { ok: true, outline: { ...raw, concepts: raw.concepts.map((c) => ({ ...c, id: String(c.id).trim().toLowerCase() })) } };
}

/** 拒绝身份不符的知识点内容（服务端返回了另一个知识点时必须报错，不能静默拼错）。 */
export function normalizeConceptContent(raw, expectedId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '服务返回的知识点内容不是对象' };
  if (!isNonEmptyString(raw.id)) return { ok: false, error: `服务返回的知识点内容缺少 id（期望 ${expectedId}）` };
  if (raw.id !== expectedId) return { ok: false, error: `服务返回的知识点 id 不匹配：期望 ${expectedId}，实际 ${raw.id}` };
  if (!Array.isArray(raw.lesson?.sections) || raw.lesson.sections.length === 0) return { ok: false, error: `知识点 ${expectedId} 的内容缺少正文小节` };
  if (!raw.quiz || !Array.isArray(raw.quiz.questions) || raw.quiz.questions.length < 2) return { ok: false, error: `知识点 ${expectedId} 的内容缺少随堂测验` };
  return { ok: true, concept: raw };
}

function emptyPlan(identity) {
  const draft = JSON.parse(identity);
  const templateId = typeof draft.template === 'string' ? JSON.parse(draft.template).id : 'custom';
  return {
    identity,
    draft: {
      topic: draft.topic,
      goal: draft.goal,
      level: draft.level,
      weeklyHours: draft.weeklyHours,
      lessonMinutes: draft.lessonMinutes,
      templateId,
    },
    workerUrl: draft.worker,
    promptVersion: draft.prompt,
    templateId,
    outline: null,
    contents: {},
    usage: {},
    totals: { attempts: 0, lessonsCompleted: 0, lessonsTotal: 0 },
    meta: {},
    lastFailure: null,
    updatedAt: null,
    partial: false,
  };
}

/** 读取与当前输入匹配的计划；不匹配返回 null（调用方据此判断「换输入 → 重新开始」）。 */
export function planFor(store, identity) {
  const plan = store?.genPlan;
  return plan && plan.identity === identity ? plan : null;
}

/** 只把「已确认完成」的知识点算进完成数；两个并发调用下也不会数错。 */
export function countCompleted(outline, contents) {
  const concepts = Array.isArray(outline?.concepts) ? outline.concepts : [];
  return concepts.filter((c) => hasContent(contents, c)).length;
}

/** 汇总当前计划的用户可见状态（完成数 / 总量 / 用量 / 是否可续跑）。 */
export function planSummary(plan) {
  if (!plan) return null;
  const total = Array.isArray(plan.outline?.concepts) ? plan.outline.concepts.length : 0;
  const done = countCompleted(plan.outline, plan.contents);
  return {
    identity: plan.identity,
    done,
    total,
    attempts: plan.totals?.attempts || 0,
    hasOutline: Boolean(plan.outline),
    incomplete: Math.max(0, total - done),
    resumable: Boolean(plan.outline) && done < total,
    usage: plan.usage || {},
    model: plan.meta?.model || '',
    lastFailure: plan.lastFailure || null,
  };
}

/** 等待该 store 上所有在途生成结算（重试前必须先结算，避免两批请求交叉）。 */
export async function settleGeneration(store, identity, explicit) {
  const map = listAttempts(store);
  const pending = explicit
    ? [explicit]
    : (identity ? [map.get(identity)] : [...map.values()]);
  await Promise.all(pending.filter(Boolean).map((item) => item.catch(() => {})));
}

/** 丢弃当前计划的进度（仅内存；不影响已保存到本地的课程）。 */
export function discardPlan(store) {
  if (!store) return;
  store.genPlan = null;
}

/**
 * 执行分阶段建课（大纲 → 逐知识点）。同一个 store 同时只允许一次进行中的生成。
 *
 * @returns {Promise<{ok: true, reused?: boolean, preview?: object} | {ok: false, code?: string, error?: string, problems?: string[]}>}
 */
export async function runCourseGeneration({
  store,
  workerUrl,
  draft,
  videoLibrary = [],
  fetchImpl,
  onProgress = () => {},
  onDiscarded = () => {},
  now = () => Date.now(),
  budgetMs = GENERATION_BUDGET_MS,
  lessonConcurrency = LESSON_CONCURRENCY,
  loadCourseContext = () => {},
} = {}) {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!normalized.ok) {
    return { ok: false, code: 'bad-worker-url', error: normalized.reason };
  }
  const input = normalizeDraft(draft);
  if (input.topic.length < 2) return { ok: false, code: 'bad-topic', error: '请先填写至少 2 个字的学科或主题' };

  const identity = buildGenerationIdentity(normalized.base, input);
  // 同一身份已经有进行中的生成：在下面注册之后恢复到那一次
  const existing = activePromiseOf(store, identity);
  const previous = store?.genPlan || null;
  const sameIdentity = Boolean(previous && previous.identity === identity);
  const succeeded = sameIdentity ? previous.succeeded : null;
  const stale = previous && !sameIdentity ? previous : null;
  // 提交守卫：只有「当前计划仍然是本次这份」时才写回 store，
  // 保证被丢弃的旧计划不会在结算时复活（旧运行只提交自己的对象引用）。
  const commit = (plan) => {
    if (store.genPlan !== plan) {
      onProgress({ phase: 'stale', done: 0, total: 0, attempts: plan?.totals?.attempts || 0 });
      return false;
    }
    store.genPlan = plan;
    return true;
  };

  async function body() {
    if (stale) {
      // 输入/模板/Worker 变了：不能拿旧正文续跑，如实告知并从头开始
      store.genPlan = null;
      onDiscarded(stale);
    }

    const run = async ({ deadline = now() + budgetMs, runVideoLibrary = videoLibrary } = {}) => {
      // 本运行已经被更新的运行取代：不要继续，也不要留下任何计划
      if (activeRunOf(store) !== runGate) return { ok: false, code: 'superseded', error: '这次生成已被更新的请求取代（需求已改变）。' };
      // 成功结果按身份复用：同一批输入不会因为再次点击而重复请求
      if (succeeded && store.genPlan === previous) return { ...succeeded, reused: true };
      const cached = store.genPlan && store.genPlan.identity === identity ? store.genPlan : null;
      const plan = cached || emptyPlan(identity);
      plan.workerUrl = normalized.base;
      if (!cached) {
        // 只有在本次运行仍然是「当前运行」时才写入，避免旧运行把新计划覆盖掉
        if (activeRunOf(store) === runGate) store.genPlan = plan;
        onProgress({ phase: 'outline', done: 0, total: 0, attempts: plan.totals.attempts });
      }

      let outline = plan.outline;
      if (!outline) {
        if (now() > deadline) return { ok: false, code: 'budget-exhausted', error: '本次生成的时间预算已用完，未再发起新的模型调用。' };
        const result = await generateOutlineViaWorker({
          workerUrl: normalized.base,
          // input 里已经包含受信任的 templateId；服务端据此查共用目录得到受控取向说明
          payload: buildOutlinePayload({ ...input, videoLibrary: runVideoLibrary }),
          ...(fetchImpl ? { fetchImpl } : {}),
        });
        plan.totals.attempts += 1;
        if (!result.ok) {
          const failure = { ...result, stage: 'outline', failedConcept: null };
          plan.lastFailure = { code: failure.code || 'error', error: failure.error, stage: 'outline' };
          plan.partial = false;
          plan.updatedAt = new Date(now()).toISOString();
          commit(plan);
          return failure;
        }
        const checked = normalizeOutline(result.outline);
        if (!checked.ok) {
          plan.lastFailure = { code: 'invalid-outline', error: checked.error, stage: 'outline' };
          plan.updatedAt = new Date(now()).toISOString();
          commit(plan);
          return { ok: false, code: 'invalid-outline', error: checked.error };
        }
        outline = checked.outline;
        plan.outline = outline;
        plan.usage = mergeUsage(plan.usage, result.meta);
        plan.meta = { ...plan.meta, ...sanitizeMeta(result.meta).fields };
        plan.totals.lessonsTotal = outline.concepts.length;
      }

      const contents = plan.contents || {};
      const queue = outline.concepts.filter((concept) => !hasContent(contents, concept));
      if (queue.length > 0) {
        onProgress({
          phase: 'lesson',
          done: countCompleted(outline, contents),
          total: outline.concepts.length,
          current: queue[0].title,
          attempts: plan.totals.attempts,
        });
        let failed = null;
        // 并发上限与服务端默认一致；用固定数量 worker 消费队列，绝不会把同一个知识点交给两个 worker
        const workerCount = Math.max(1, Math.min(Number(lessonConcurrency) || 1, queue.length));
        const runOne = async () => {
          while (queue.length > 0 && !failed) {
            const concept = queue.shift();
            if (now() > deadline) {
              failed = { ok: false, code: 'budget-exhausted', error: `知识点「${concept.title}」之前的时间预算已用完，未再发起新的模型调用。`, failedConcept: concept.title };
              return;
            }
            onProgress({
              phase: 'lesson',
              done: countCompleted(outline, contents),
              total: outline.concepts.length,
              current: concept.title,
              attempts: plan.totals.attempts,
            });
            const result = await generateLessonViaWorker({
              workerUrl: normalized.base,
              payload: buildLessonPayload({ ...input, outline, conceptId: concept.id }),
              ...(fetchImpl ? { fetchImpl } : {}),
            });
            plan.totals.attempts += 1;
            if (!result.ok) {
              failed = { ...result, failedConcept: concept.title };
              return;
            }
            // 先把「身份 + 结构」全部校验通过，再把它记为已完成。
            // 顺序很重要：如果先写 contents 再校验 meta.conceptId 不符，
            // 这个知识点会被误标成「已完成」并在下次重试时被复用（既错又省了一次本该重发的请求）。
            const fields = sanitizeMeta(result.meta).fields;
            const checked = normalizeConceptContent(result.concept, concept.id);
            if (!checked.ok) {
              failed = { ok: false, code: 'invalid-concept', error: checked.error, failedConcept: concept.title };
              return;
            }
            if (fields.conceptId && fields.conceptId !== concept.id) {
              failed = { ok: false, code: 'invalid-concept', error: `服务返回的知识点 id 不匹配：期望 ${concept.id}，实际 ${fields.conceptId}`, failedConcept: concept.title };
              return;
            }
            contents[concept.id] = checked.concept;
            plan.contents = contents;
            plan.usage = mergeUsage(plan.usage, result.meta);
            plan.meta = { ...plan.meta, ...fields };
            plan.updatedAt = new Date(now()).toISOString();
            onProgress({
              phase: 'lesson',
              done: countCompleted(outline, contents),
              total: outline.concepts.length,
              current: concept.title,
              attempts: plan.totals.attempts,
            });
          }
        };
        await Promise.all(Array.from({ length: workerCount }, () => runOne()));
        plan.totals.lessonsCompleted = countCompleted(outline, contents);
        plan.totals.lessonsTotal = outline.concepts.length;
        if (failed) {
          plan.lastFailure = { code: failed.code || 'error', error: failed.error, stage: 'lesson', failedConcept: failed.failedConcept || null };
          plan.partial = plan.totals.lessonsCompleted > 0;
          plan.updatedAt = new Date(now()).toISOString();
          commit(plan);
          return failed;
        }
      }

      const merged = {
        ...outline,
        concepts: outline.concepts.map((concept) => ({ ...concept, ...(contents[concept.id] || {}) })),
      };
      loadCourseContext();
      const converted = toAppCourse(merged, { videoLibrary: runVideoLibrary, model: plan.meta.model || '' });
      if (!converted.ok) {
        plan.lastFailure = { code: 'invalid-model-output', error: '生成内容未通过前端二次校验', stage: 'assemble' };
        plan.updatedAt = new Date(now()).toISOString();
        commit(plan);
        return { ok: false, code: 'invalid-model-output', error: '生成内容未通过前端二次校验', problems: converted.errors };
      }

      plan.totals.lessonsCompleted = countCompleted(outline, contents);
      plan.totals.lessonsTotal = outline.concepts.length;
      plan.partial = false;
      plan.lastFailure = null;
      plan.updatedAt = new Date(now()).toISOString();
      const preview = {
        course: converted.course,
        warnings: converted.warnings,
        meta: { ...plan.meta, conceptCount: outline.concepts.length, attempts: plan.totals.attempts },
      };
      plan.succeeded = { ok: true, preview, usage: plan.usage, attempts: plan.totals.attempts };
      commit(plan);
      return { ok: true, preview: preview, usage: plan.usage, attempts: plan.totals.attempts };
    };

    return run({});
  }

  // 注册唯一进行中的运行（runGate 就是「本 store 有活跃运行」这一事实的标记），
  // 这一句与下面的 setAttempts 都在任何 await 之前同步完成；otherRun 是同一次同步读取里
  // 已经存在的活跃运行（若有），本次必须先等它结算。
  const otherRun = activeRunOf(store);
  let resolveRun;
  const runGate = new Promise((resolve) => { resolveRun = resolve; }).catch(() => {});
  setActiveRun(store, runGate);

  const promise = (async () => {
    if (existing) {
      // 同一身份已经在跑：恢复到那一次，绝不并发发第二份请求
      const settled = await existing.catch((error) => ({ ok: false, code: 'unexpected', error: String(error?.message || error) }));
      return settled?.ok ? { ...settled, reused: true } : settled;
    }
    if (otherRun) {
      // 另一个身份正在跑：先等它完全结算，再开始本次（绝不交叉进行）
      await settleGeneration(store, null, otherRun);
    }
    return body();
  })();
  setAttempts(store, new Map(listAttempts(store)).set(identity, promise));

  let settled;
  try {
    settled = await promise;
  } catch (error) {
    settled = { ok: false, code: 'unexpected', error: String(error?.message || error) };
  } finally {
    const map = new Map(listAttempts(store));
    if (map.get(identity) === promise) map.delete(identity);
    setAttempts(store, map);
    resolveRun();
    if (activeRunOf(store) === runGate) setActiveRun(store, null);
  }
  return settled;
}


/** 失败后重试：先等在途调用结算，再只补未完成的知识点（不会重跑已完成的）。 */
export async function resumeCourseGeneration(options = {}) {
  const { store } = options;
  await settleGeneration(store);
  return runCourseGeneration(options);
}

export { DRAFT_FIELDS };