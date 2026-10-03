/**
 * 本地持久化层：版本化、可校验、可导入导出，并且默认不保存任何密钥。
 * 刻意与 localStorage 解耦（后端可注入），因此可以在 Node 单元测试里直接验证。
 *
 * 安全立场：导入的备份是「不可信输入」。normalizeState 会深度重建结构，
 * 丢弃危险键名（__proto__/constructor/prototype）、非法 URL、伪造的验证标记，
 * 并强制自定义视频一律为「未验证」。
 */

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'studymate.state.v1';
export const SECRET_KEY = 'studymate.session.secret.v1';

/** 会被导出/持久化流程剔除的敏感字段名（防御性，正常状态下不会写入这些字段）。 */
const SECRET_FIELD_PATTERN = /(apikey|api_key|secret|token|password|authorization|bearer)/i;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeKey(key) {
  return typeof key === 'string' && key !== '' && !DANGEROUS_KEYS.has(key);
}

/** 只接受 http(s) 的绝对地址，其余（javascript:/data:/file:/相对路径）一律返回空串。 */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/** 内存后端，供测试与 SSR 场景使用。 */
export function createMemoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    kind: 'memory',
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()],
  };
}

/** 浏览器 localStorage 后端的薄封装（读写都可能抛异常：隐私模式/配额）。 */
export function createLocalStorageBackend(storage = globalThis.localStorage) {
  return {
    kind: 'localStorage',
    getItem: (k) => storage.getItem(k),
    setItem: (k, v) => storage.setItem(k, String(v)),
    removeItem: (k) => storage.removeItem(k),
    keys: () => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(Boolean),
  };
}

/** 空状态。 */
export function createEmptyState(now = new Date().toISOString()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: {
      name: '',
      goal: 'starter',
      level: 'new',
      weeklyHours: 4,
      lessonMinutes: 40,
      interests: [],
      updatedAt: now,
    },
    courses: {},
    generatedCourses: [],
    preferences: { reduceMotion: false, autoLoadVideo: false, fontScale: 1 },
    ai: { endpoint: '', model: '', workerUrl: '', enabled: false, keyStorage: 'session' },
    stats: { studyDays: [], totalMinutes: 0 },
    meta: { createdAt: now, updatedAt: now, app: 'StudyMate-Web' },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeString(value, maxLength = 200) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 任务清单勾选状态：{ "3": true }，只接受布尔值。 */
export function normalizeTasks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (isSafeKey(k) && /^\d{1,3}$/.test(k) && v === true) out[k] = true;
  }
  return out;
}

/**
 * 自定义视频：只保留安全字段，URL 必须是 http(s)，
 * 并强制把「用户来源」标记为未验证（不信任备份里自填的 verified）。
 */
export function normalizeCustomVideo(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const watchUrl = safeHttpUrl(raw.watchUrl);
  if (!watchUrl) return null;
  const title = safeString(raw.title, 120).trim();
  if (!title) return null;
  const provider = ['bilibili', 'youtube', 'external'].includes(raw.provider)
    ? raw.provider
    : watchUrl.includes('bilibili.com') ? 'bilibili' : 'external';
  const bvid = typeof raw.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(raw.bvid) ? raw.bvid : null;
  return {
    id: /^[\w-]{1,64}$/.test(String(raw.id || '')) ? String(raw.id) : `user-${Math.random().toString(36).slice(2, 10)}`,
    provider,
    sourceKind: 'user',
    bvid,
    page: safeInt(raw.page, { min: 1, max: 9999, fallback: 1 }),
    title,
    creator: '用户自定义',
    creatorProfile: safeHttpUrl(raw.creatorProfile),
    creatorVerified: false,
    durationSeconds: raw.durationSeconds === null || raw.durationSeconds === undefined ? null : safeInt(raw.durationSeconds, { min: 0, max: 86400 * 8, fallback: 0 }),
    subjectId: safeString(raw.subjectId, 64),
    knowledgePoints: Array.isArray(raw.knowledgePoints)
      ? raw.knowledgePoints.filter((k) => typeof k === 'string' && isSafeKey(k)).slice(0, 12)
      : [],
    reason: safeString(raw.reason, 300) || '用户自定义来源，未经本站核实。',
    watchUrl,
    verification: { method: 'user-provided', status: 'unverified', creatorVerified: false, checkedAt: safeString(raw.verification?.checkedAt, 32) || now.slice(0, 10) },
    playbackVerified: false,
  };
}

const GENERATED_MARKUP_PATTERN = /(<\/?[a-z][\s\S]*?>|https?:\/\/|javascript:|data:text\/html)/i;

function cleanText(value, maxLength) {
  const text = safeString(value, maxLength).trim();
  return GENERATED_MARKUP_PATTERN.test(text) ? '' : text;
}

/**
 * AI 生成课程的持久化清洗：只保留已知字段、限制数量与长度、
 * 丢弃包含 HTML/链接的文本，并且只保留指向已核实视频库形状的 id 字符串。
 */
export function normalizeGeneratedCourse(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = safeString(raw.id, 64);
  const title = cleanText(raw.title, 80);
  if (!/^[\p{L}\p{N}_-]{4,64}$/u.test(id) || title.length < 4) return null;
  const concepts = [];
  for (const concept of (Array.isArray(raw.concepts) ? raw.concepts : []).slice(0, 12)) {
    if (!concept || typeof concept !== 'object') continue;
    const conceptId = safeString(concept.id, 40);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(conceptId)) continue;
    const sections = (Array.isArray(concept.lesson?.sections) ? concept.lesson.sections : []).slice(0, 5).map((section) => ({
      heading: cleanText(section?.heading, 60) || '小节',
      body: (Array.isArray(section?.body) ? section.body : []).map((p) => cleanText(p, 800)).filter(Boolean).slice(0, 4),
      points: (Array.isArray(section?.points) ? section.points : []).map((p) => cleanText(p, 120)).filter(Boolean).slice(0, 4),
    }));
    concepts.push({
      id: conceptId,
      type: ['concept', 'practical', 'lab'].includes(concept.type) ? concept.type : 'concept',
      title: cleanText(concept.title, 80) || conceptId,
      summary: cleanText(concept.summary, 300),
      difficulty: safeInt(concept.difficulty, { min: 1, max: 3, fallback: 2 }),
      estimatedMinutes: safeInt(concept.estimatedMinutes, { min: 10, max: 180, fallback: 40 }),
      examWeight: 2,
      prerequisites: (Array.isArray(concept.prerequisites) ? concept.prerequisites : []).filter((p) => typeof p === 'string' && /^[a-z0-9-]{1,40}$/.test(p)).slice(0, 4),
      objectives: (Array.isArray(concept.objectives) ? concept.objectives : []).map((o) => cleanText(o, 120)).filter(Boolean).slice(0, 5),
      keyTerms: (Array.isArray(concept.keyTerms) ? concept.keyTerms : []).map((t) => ({ term: cleanText(t?.term, 40), definition: cleanText(t?.definition, 200) })).filter((t) => t.term && t.definition).slice(0, 6),
      lesson: {
        sections,
        takeaways: (Array.isArray(concept.lesson?.takeaways) ? concept.lesson.takeaways : []).map((t) => cleanText(t, 200)).filter(Boolean).slice(0, 4),
        pitfalls: (Array.isArray(concept.lesson?.pitfalls) ? concept.lesson.pitfalls : []).map((t) => cleanText(t, 200)).filter(Boolean).slice(0, 3),
      },
      exercises: (Array.isArray(concept.exercises) ? concept.exercises : []).map((e) => ({ prompt: cleanText(e?.prompt, 300), hint: cleanText(e?.hint, 200) })).filter((e) => e.prompt).slice(0, 5),
      tasks: (Array.isArray(concept.tasks) ? concept.tasks : []).map((t) => ({ title: cleanText(t?.title, 60), detail: cleanText(t?.detail, 300), acceptance: cleanText(t?.acceptance, 200) })).filter((t) => t.title).slice(0, 6),
      project: concept.project && typeof concept.project === 'object'
        ? {
            goal: cleanText(concept.project.goal, 400),
            steps: [],
            deliverables: (Array.isArray(concept.project.deliverables) ? concept.project.deliverables : []).map((d) => cleanText(d, 120)).filter(Boolean).slice(0, 5),
            rubric: (Array.isArray(concept.project.rubric) ? concept.project.rubric : []).map((r) => ({ criterion: cleanText(r?.criterion, 80), weight: safeInt(r?.weight, { min: 1, max: 100, fallback: 20 }) })).filter((r) => r.criterion).slice(0, 5),
          }
        : null,
      videoIds: (Array.isArray(concept.videoIds) ? concept.videoIds : []).filter((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{2,64}$/.test(v)).slice(0, 4),
      quizId: concept.quizId ? safeString(concept.quizId, 64) : null,
      source: 'ai',
    });
  }
  if (concepts.length < 4) return null;
  const quizzes = {};
  for (const [quizId, quiz] of Object.entries(raw.quizzes || {})) {
    if (!isSafeKey(quizId) || !quiz || typeof quiz !== 'object') continue;
    const questions = (Array.isArray(quiz.questions) ? quiz.questions : []).slice(0, 6).map((q, i) => ({
      id: safeString(q?.id, 40) || ('q' + (i + 1)),
      type: ['single', 'multiple', 'judge', 'fill'].includes(q?.type) ? q.type : 'single',
      stem: cleanText(q?.stem, 300),
      options: (Array.isArray(q?.options) ? q.options : []).map((o) => cleanText(o, 200)).slice(0, 5),
      answer: Array.isArray(q?.answer) ? q.answer.slice(0, 5) : q?.answer,
      explanation: cleanText(q?.explanation, 400),
      knowledgePoint: cleanText(q?.knowledgePoint, 60) || '综合',
    })).filter((q) => q.stem && q.explanation);
    if (questions.length < 2) continue;
    quizzes[quizId] = { id: quizId, courseId: id, conceptId: safeString(quiz.conceptId, 40), passScore: 0.6, questions };
  }
  // 没有保住测验的概念必须同时清掉悬空引用，避免界面指向不存在的测验
  for (const concept of concepts) {
    if (concept.quizId && !quizzes[concept.quizId]) concept.quizId = null;
  }
  return {
    id,
    title,
    subtitle: cleanText(raw.subtitle, 120),
    summary: cleanText(raw.summary, 600),
    subjects: [{ id: 'ai-generated', name: 'AI 生成课程' }],
    tags: (Array.isArray(raw.tags) ? raw.tags : []).map((t) => cleanText(t, 20)).filter(Boolean).slice(0, 6),
    level: ['入门', '中级', '进阶'].includes(raw.level) ? raw.level : '入门',
    accent: 'indigo',
    estimatedHours: safeInt(raw.estimatedHours, { min: 1, max: 200, fallback: 12 }),
    outcomes: (Array.isArray(raw.outcomes) ? raw.outcomes : []).map((o) => cleanText(o, 120)).filter(Boolean).slice(0, 6),
    concepts,
    quizzes,
    source: 'ai',
    aiMeta: {
      generatedAt: safeString(raw.aiMeta?.generatedAt, 40) || now,
      model: cleanText(raw.aiMeta?.model, 60) || '（未标注）',
      disclaimer: 'AI 生成内容，请自行核对。',
      matchedVideoCount: safeInt(raw.aiMeta?.matchedVideoCount, { min: 0, max: 99, fallback: 0 }),
      noVerifiedVideoMatch: raw.aiMeta?.noVerifiedVideoMatch === true,
      subject: cleanText(raw.aiMeta?.subject, 40),
    },
  };
}

/** 自定义课程计划：结构必须完整合法，否则整份丢弃（返回 null）。 */
export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!Array.isArray(raw.weeks) || raw.weeks.length === 0 || raw.weeks.length > 60) return null;
  const weeks = [];
  for (const week of raw.weeks) {
    if (!week || typeof week !== 'object' || !Array.isArray(week.items) || week.items.length === 0) return null;
    const items = [];
    for (const item of week.items.slice(0, 40)) {
      if (!item || typeof item !== 'object') return null;
      const conceptId = safeString(item.conceptId, 64);
      if (!conceptId) return null;
      items.push({
        conceptId,
        title: safeString(item.title, 120) || conceptId,
        type: ['concept', 'practical', 'lab'].includes(item.type) ? item.type : 'concept',
        difficulty: safeInt(item.difficulty, { min: 1, max: 5, fallback: 1 }),
        minutes: safeInt(item.minutes, { min: 5, max: 600, fallback: 40 }),
        videoIds: Array.isArray(item.videoIds) ? item.videoIds.filter((v) => typeof v === 'string' && isSafeKey(v)).slice(0, 12) : [],
        quizId: item.quizId ? safeString(item.quizId, 64) : null,
        tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string').slice(0, 6) : [],
      });
    }
    weeks.push({
      index: safeInt(week.index, { min: 1, max: 60, fallback: weeks.length + 1 }),
      theme: safeString(week.theme, 40),
      focus: safeString(week.focus, 200),
      minutes: safeInt(week.minutes, { min: 0, max: 100000, fallback: items.reduce((n, i) => n + i.minutes, 0) }),
      items,
    });
  }
  return {
    courseId: safeString(raw.courseId, 64),
    courseTitle: safeString(raw.courseTitle, 120),
    generatedAt: safeString(raw.generatedAt, 40),
    prefs: {
      goal: safeString(raw.prefs?.goal, 20) || 'starter',
      level: safeString(raw.prefs?.level, 20) || 'new',
      weeklyHours: safeInt(raw.prefs?.weeklyHours, { min: 1, max: 40, fallback: 4 }),
      lessonMinutes: safeInt(raw.prefs?.lessonMinutes, { min: 10, max: 180, fallback: 40 }),
    },
    weeks,
    skipped: Array.isArray(raw.skipped) ? raw.skipped.filter((s) => s && typeof s === 'object' && isSafeKey(String(s.id))).slice(0, 60) : [],
    rescued: Array.isArray(raw.rescued) ? raw.rescued.filter((s) => s && typeof s === 'object' && isSafeKey(String(s.id))).slice(0, 60) : [],
    stats: {
      weeks: weeks.length,
      concepts: weeks.reduce((n, w) => n + w.items.length, 0),
      practical: weeks.reduce((n, w) => n + w.items.filter((i) => i.type !== 'concept').length, 0),
      minutes: weeks.reduce((n, w) => n + w.items.reduce((m, i) => m + i.minutes, 0), 0),
      hours: Math.round(weeks.reduce((n, w) => n + w.items.reduce((m, i) => m + i.minutes, 0), 0) / 6) / 10,
      videos: new Set(weeks.flatMap((w) => w.items.flatMap((i) => i.videoIds))).size,
      quizzes: weeks.reduce((n, w) => n + w.items.filter((i) => i.quizId).length, 0),
      weeklyBudgetMinutes: safeInt(raw.stats?.weeklyBudgetMinutes, { min: 10, max: 2400, fallback: 216 }),
    },
    rationale: Array.isArray(raw.rationale) ? raw.rationale.filter((r) => typeof r === 'string').slice(0, 12).map((r) => r.slice(0, 300)) : [],
  };
}

/** 去掉对象里的敏感字段，深拷贝输出。 */
export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!isSafeKey(k) || SECRET_FIELD_PATTERN.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}

/**
 * 把任意（可能损坏或恶意）的输入收敛成合法状态。
 * 未知字段会被丢弃，类型错误会被纠正，避免导入坏数据后整站崩溃或执行恶意链接。
 */
export function normalizeState(raw, now = new Date().toISOString()) {
  const base = createEmptyState(now);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const state = clone(raw);
  const profile = state.profile && typeof state.profile === 'object' ? state.profile : {};
  const weeklyHours = Number(profile.weeklyHours);
  const lessonMinutes = Number(profile.lessonMinutes);
  base.profile = {
    name: safeString(profile.name, 40),
    goal: ['starter', 'exam', 'project', 'advanced'].includes(profile.goal) ? profile.goal : 'starter',
    level: ['new', 'some', 'advanced'].includes(profile.level) ? profile.level : 'new',
    weeklyHours: Number.isFinite(weeklyHours) ? Math.min(40, Math.max(1, Math.round(weeklyHours))) : 4,
    lessonMinutes: Number.isFinite(lessonMinutes) ? Math.min(180, Math.max(10, Math.round(lessonMinutes))) : 40,
    interests: Array.isArray(profile.interests) ? profile.interests.filter((x) => typeof x === 'string').slice(0, 12) : [],
    updatedAt: safeString(profile.updatedAt, 40) || now,
  };
  const prefs = state.preferences && typeof state.preferences === 'object' ? state.preferences : {};
  const fontScale = Number(prefs.fontScale);
  base.preferences = {
    reduceMotion: prefs.reduceMotion === true,
    autoLoadVideo: prefs.autoLoadVideo === true,
    fontScale: Number.isFinite(fontScale) ? Math.min(1.4, Math.max(0.9, fontScale)) : 1,
  };
  const ai = state.ai && typeof state.ai === 'object' ? state.ai : {};
  const workerUrl = safeString(ai.workerUrl, 300);
  base.ai = {
    endpoint: safeString(ai.endpoint, 300),
    model: safeString(ai.model, 120),
    // Worker 地址必须是无凭据的 https（本机 http 允许），其余一律丢弃
    workerUrl: /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(workerUrl) && !/^https?:\/\/[^/]*@/.test(workerUrl) ? workerUrl : '',
    enabled: ai.enabled === true,
    keyStorage: ai.keyStorage === 'memory' ? 'memory' : 'session',
  };
  base.courses = {};
  if (state.courses && typeof state.courses === 'object') {
    for (const [courseId, entry] of Object.entries(state.courses)) {
      if (!isSafeKey(courseId) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const lessons = {};
      if (entry.lessons && typeof entry.lessons === 'object') {
        for (const [conceptId, lesson] of Object.entries(entry.lessons)) {
          if (!isSafeKey(conceptId) || !lesson || typeof lesson !== 'object') continue;
          lessons[conceptId] = {
            status: ['not-started', 'in-progress', 'completed'].includes(lesson.status) ? lesson.status : 'not-started',
            openedAt: safeString(lesson.openedAt, 40) || null,
            completedAt: safeString(lesson.completedAt, 40) || null,
            minutes: safeInt(lesson.minutes, { min: 0, max: 100000 }),
            tasks: normalizeTasks(lesson.tasks),
          };
        }
      }
      const attempts = Array.isArray(entry.quizAttempts)
        ? entry.quizAttempts
            .filter((a) => a && typeof a === 'object' && typeof a.quizId === 'string')
            .slice(-50)
            .map((a) => ({
              quizId: safeString(a.quizId, 64),
              score: safeInt(a.score, { min: 0, max: 999 }),
              total: safeInt(a.total, { min: 0, max: 999 }),
              passed: a.passed === true,
              at: safeString(a.at, 40) || now,
            }))
        : [];
      const notes = {};
      if (entry.notes && typeof entry.notes === 'object') {
        for (const [conceptId, list] of Object.entries(entry.notes)) {
          if (!isSafeKey(conceptId) || !Array.isArray(list)) continue;
          notes[conceptId] = list
            .filter((n) => n && typeof n === 'object' && typeof n.text === 'string' && n.text.trim() !== '')
            .slice(-30)
            .map((n, i) => ({
              id: /^[\w-]{1,80}$/.test(String(n.id || '')) ? String(n.id) : `${conceptId}-${i}-${Math.random().toString(36).slice(2, 6)}`,
              text: safeString(n.text, 2000),
              at: safeString(n.at, 40) || now,
            }));
        }
      }
      const videos = {};
      if (entry.videos && typeof entry.videos === 'object') {
        for (const [videoId, v] of Object.entries(entry.videos)) {
          if (!isSafeKey(videoId) || !v || typeof v !== 'object') continue;
          videos[videoId] = { opened: v.opened === true, lastAt: safeString(v.lastAt, 40) || null };
        }
      }
      const customVideos = Array.isArray(entry.customVideos)
        ? entry.customVideos.map((v) => normalizeCustomVideo(v, now)).filter(Boolean).slice(0, 50)
        : [];
      base.courses[courseId] = {
        customPlan: normalizePlan(entry.customPlan),
        customVideos,
        lessons,
        quizAttempts: attempts,
        notes,
        videos,
        bookmarks: Array.isArray(entry.bookmarks) ? entry.bookmarks.filter((x) => typeof x === 'string' && isSafeKey(x)).slice(0, 200) : [],
      };
    }
  }
  base.generatedCourses = (Array.isArray(state.generatedCourses) ? state.generatedCourses : [])
    .map((course) => normalizeGeneratedCourse(course, now))
    .filter(Boolean)
    .slice(0, 10);
  const stats = state.stats && typeof state.stats === 'object' ? state.stats : {};
  base.stats = {
    studyDays: Array.isArray(stats.studyDays) ? stats.studyDays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-400) : [],
    totalMinutes: safeInt(stats.totalMinutes, { min: 0, max: 10_000_000 }),
  };
  base.meta = {
    createdAt: safeString(state.meta?.createdAt, 40) || now,
    updatedAt: safeString(state.meta?.updatedAt, 40) || now,
    app: 'StudyMate-Web',
  };
  return base;
}

/**
 * 状态仓库：读取时容错，写入时剔除密钥并返回结果对象（不抛异常）。
 */
export function createStore(backend, { key = STORAGE_KEY, now = () => new Date().toISOString() } = {}) {
  let lastError = null;
  return {
    backendKind: backend.kind,
    key,
    load() {
      let raw = null;
      try {
        raw = backend.getItem(key);
      } catch (error) {
        lastError = `读取本地数据失败：${error.message}`;
        return createEmptyState(now());
      }
      if (!raw) return createEmptyState(now());
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.schemaVersion > SCHEMA_VERSION) {
          lastError = `本地数据版本（${parsed.schemaVersion}）高于当前应用支持的版本（${SCHEMA_VERSION}），已按可用字段兼容读取。`;
        }
        return normalizeState(parsed, now());
      } catch (error) {
        lastError = `本地数据解析失败，已重置为空状态：${error.message}`;
        return createEmptyState(now());
      }
    },
    save(state) {
      const safe = stripSecrets(normalizeState(state, now()));
      safe.meta.updatedAt = now();
      try {
        backend.setItem(key, JSON.stringify(safe));
        lastError = null;
        return { ok: true, state: safe };
      } catch (error) {
        lastError = `保存失败（可能是浏览器存储被禁用或超出配额）：${error.message}`;
        return { ok: false, error: lastError, state: safe };
      }
    },
    clear() {
      try {
        backend.removeItem(key);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },
    getLastError() {
      return lastError;
    },
  };
}

/** 导出为可备份的 JSON 字符串（永远不含密钥）。 */
export function exportState(state, { appVersion = '1.0.0', now = new Date().toISOString() } = {}) {
  const payload = {
    app: 'StudyMate-Web',
    appVersion,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    data: stripSecrets(normalizeState(state, now)),
    note: '此备份不包含任何 API 密钥；密钥只在当前浏览器会话中保存。',
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 导入备份。输入永远视为不可信数据。
 * @returns {{ok: false, error: string} | {ok: true, state: object, warnings: string[]}}
 */
export function importState(json, { now = new Date().toISOString() } = {}) {
  if (typeof json !== 'string' || json.trim() === '') return { ok: false, error: '导入内容为空' };
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { ok: false, error: `不是合法的 JSON：${error.message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: '备份内容需要是一个 JSON 对象' };
  if (parsed.app && parsed.app !== 'StudyMate-Web') return { ok: false, error: `备份来自其他应用（${parsed.app}），已拒绝导入` };
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
  const warnings = [];
  if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > SCHEMA_VERSION) {
    warnings.push(`备份版本 ${parsed.schemaVersion} 高于当前应用版本 ${SCHEMA_VERSION}，仅导入兼容字段。`);
  }
  if (parsed.data === undefined) warnings.push('未找到 data 字段，已按整份文件尝试解析。');
  const droppedVideos = countDroppedVideos(data);
  const state = normalizeState(data, now);
  const keptVideos = Object.values(state.courses).reduce((n, c) => n + c.customVideos.length, 0);
  if (droppedVideos > keptVideos) warnings.push(`已丢弃 ${droppedVideos - keptVideos} 条含不安全链接或结构非法的自定义视频。`);
  othersSanitized(data, state, warnings);
  const strippedSecrets = JSON.stringify(data) !== JSON.stringify(stripSecrets(data));
  if (strippedSecrets) warnings.push('备份中包含疑似密钥或危险字段，已自动丢弃。');
  return { ok: true, state, warnings };
}

function countDroppedVideos(data) {
  let n = 0;
  for (const entry of Object.values(data?.courses || {})) {
    if (entry && Array.isArray(entry.customVideos)) n += entry.customVideos.length;
  }
  return n;
}

function othersSanitized(data, state, warnings) {
  for (const [courseId, entry] of Object.entries(data?.courses || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const normalized = state.courses[courseId];
    if (!normalized) continue;
    if (entry.customPlan && !normalized.customPlan) warnings.push(`已丢弃 ${courseId} 中结构不完整的自定义计划。`);
    for (const [key] of Object.entries(entry)) if (DANGEROUS_KEYS.has(key)) warnings.push('备份中包含危险键名，已忽略。');
  }
}

/** 会话级密钥存储：默认不进 localStorage，关闭标签页即失效。 */
export function createSecretStore({ session = globalThis.sessionStorage } = {}) {
  let memoryValue = '';
  return {
    read() {
      if (!session) return memoryValue;
      try {
        return session.getItem(SECRET_KEY) || '';
      } catch {
        return memoryValue;
      }
    },
    write(value) {
      memoryValue = String(value || '');
      if (!session) return { ok: true, mode: 'memory' };
      try {
        if (memoryValue) session.setItem(SECRET_KEY, memoryValue);
        else session.removeItem(SECRET_KEY);
        return { ok: true, mode: 'session' };
      } catch (error) {
        return { ok: false, mode: 'memory', error: String(error.message || error) };
      }
    },
    clear() {
      memoryValue = '';
      try {
        session?.removeItem(SECRET_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
