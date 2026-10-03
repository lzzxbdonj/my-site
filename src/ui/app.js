/**
 * 应用入口：状态管理 + hash 路由 + 视图渲染 + 本地持久化。
 * 设计取舍：全量重渲染（状态少、逻辑简单、可预测），只在需要保留输入焦点与播放器时做特殊处理。
 */

import { h, clear, renderInto } from './dom.js';
import { orbitalMark, badge } from './components.js';
import { createStore, createLocalStorageBackend, createMemoryBackend, createSecretStore, exportState, importState, createEmptyState } from '../core/storage.js';
import { parseRoute, buildRoute, NAV_ITEMS, routeTitle } from '../core/router.js';
import { PRODUCT_NAME, PRODUCT_TAGLINE, BRAND_ARIA_LABEL, brandDocumentTitle } from '../core/brand.js';
import { getCourse, getConcept, registerGeneratedCourses } from '../core/catalog.js';
import { explainViaWorker, normalizeWorkerUrl, defaultWorkerUrl } from '../core/ai-client.js';
import {
  startGithubLogin as requestGithubLogin,
  fetchSession,
  fetchAuthSupport,
  readCallbackToken,
  createAuthTokenStore,
  clearAuthToken,
} from '../core/auth-client.js';
import { runCourseGeneration, resumeCourseGeneration, discardPlan, planSummary, normalizeDraft, summarizeUsage, draftChangedFields } from '../core/ai-generate.js';
import { defaultPreferences } from '../core/personalize.js';
import { COURSE_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate as getCourseTemplate, templatePreferences } from '../data/course-templates.js';
import { VIDEO_LIBRARY } from '../data/videos.js';
import { COURSES } from '../data/courses.js';
import { classifyVideoUrl } from '../core/video.js';
import { requestExplanation } from '../core/ai.js';
import * as progress from '../core/progress.js';
import { dashboardView } from './views/dashboard.js';
import { exploreView } from './views/explore.js';
import { planView } from './views/plan.js';
import { courseView } from './views/course.js';
import { lessonView } from './views/lesson.js';
import { slidesView } from './views/slides.js';
import { videosView } from './views/videos.js';
import { generateView } from './views/generate.js';
import { profileView, settingsView, aboutView } from './views/account.js';

const APP_VERSION = '1.0.0';

function detectTestMode() {
  return typeof location !== 'undefined' && /[?&]e2e=1/.test(location.search);
}

/** 用量汇总文案：覆盖「大纲 + 全部知识点」，并明确它不是精确账单。 */
function usageTextOf(summary) {
  if (!summary) return null;
  const usage = summarizeUsage(summary.usage, { model: summary.model, attempts: summary.attempts });
  return usage ? usage.text : null;
}

/** 取当前建课计划的只读摘要（界面据此显示完成数与是否可续跑）。 */
function summaryOf(plan) {
  return planSummary(plan);
}

export function createApp({ root }) {
  const backend = safeBackend();
  const store = createStore(backend);
  const secrets = createSecretStore();
  let state = store.load();
  let route = parseRoute(typeof location !== 'undefined' ? location.hash : '#/');
  const ui = {
    query: '',
    subjectId: 'all',
    videoFilter: { subjectId: 'all', conceptId: 'all' },
    draft: { step: 1, prefs: null, courseId: null },
    customVideoDraft: { url: '', title: '', reason: '', courseId: COURSES[0].id },
    videoLoad: {},
    aiDraft: {},
    aiPreview: null,
    // 分阶段建课的进度计划（大纲 + 已完成知识点）。由 ai-generate.js 的状态机负责，
    // 只保留在当前标签页内存里：刷新页面即失效，并不会有任何恢复承诺。
    genPlan: null,
    aiStatus: { state: 'idle' },
    // 登录态：与课程进度无关，令牌存在独立键里（备份导出天然不含它）
    auth: { status: 'unknown', user: null, error: null, enabled: null, checking: false, settling: false, callbackHandled: false },
    slideIndex: 1,
    navOpen: false,
    resetArmed: false,
  };
  const testMode = detectTestMode();

  function setState(next, { silent = false } = {}) {
    state = next;
    if (!silent) {
      const result = store.save(state);
      const error = store.getLastError();
      if (!result.ok && error) toast(error, 'bad');
      render();
    } else {
      store.save(state);
    }
  }

  function toast(message, tone = 'info') {
    if (testMode) return;
    const region = root.querySelector('.toast-region');
    if (!region) return;
    const el = h('div', { class: `toast toast-${tone}`, attrs: { role: 'status' }, text: message });
    region.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  const actions = {
    navigate(view, params = {}, query = {}) {
      const href = buildRoute(view, params, query);
      if (location.hash === href) render();
      else location.hash = href;
    },
    setSearch(query) { ui.query = query; render(); },
    setSubject(subjectId) { ui.subjectId = subjectId; render(); },
    setVideoFilter(patch) { ui.videoFilter = { ...ui.videoFilter, ...patch }; render(); },
    setDraft(patch) { ui.draft = { ...ui.draft, ...patch }; render(); },
    setAiDraft(patch) { ui.aiDraft = { ...ui.aiDraft, ...patch }; render(); },
    /**
     * 选择课程模板：只改本地草稿，**不发任何网络请求**。
     *  - 目标/水平/每周时长/单次时长用模板推荐值（都落在既有范围内）；
     *  - 主题只在当前为空（或还停留在另一个模板的示例）时才填入示例，不覆盖用户自己写的内容；
     *  - 选完之后所有字段仍然可以自由编辑。
     */
    setAiTemplate(templateId) {
      if (ui.aiStatus?.state === 'loading') return; // 生成中不允许切换模板
      const current = { ...defaultPreferences(), ...(ui.aiDraft || {}) };
      const prefs = templatePreferences(templateId);
      const template = getCourseTemplate(templateId);
      const topicNow = String(current.topic || '').trim();
      const exampleTopics = COURSE_TEMPLATES.map((t) => t.exampleTopic).filter(Boolean);
      const topic = topicNow === '' || exampleTopics.includes(topicNow) ? (template?.exampleTopic || topicNow) : topicNow;
      ui.aiDraft = {
        ...current,
        ...prefs,
        templateId: template?.id || DEFAULT_TEMPLATE_ID,
        topic,
      };
      render();
    },
    setSlideIndex(index, total = 1) {
      const next = Math.min(Math.max(1, Number(index) || 1), Math.max(1, Number(total) || 1));
      ui.slideIndex = next;
      const { courseId, conceptId } = route.params;
      if (route.view === 'slides' && courseId && conceptId) {
        // 让页码进入 URL：既可深链分享，也保证键盘翻页与索引点击语义一致
        const href = buildRoute('slides', { courseId, conceptId }, { i: next });
        if (location.hash !== href) {
          location.hash = href;
          return;
        }
      }
      render();
      const stage = root.querySelector('.deck');
      if (stage && typeof stage.scrollIntoView === 'function') stage.scrollIntoView({ block: 'nearest' });
    },
    discardAiPreview() {
      // 只丢弃当前标签页内存里的进度与预览；已保存到本地的课程不受影响
      discardPlan(ui);
      ui.aiPreview = null;
      ui.aiStatus = { state: 'idle' };
      render();
    },
    /**
     * 分阶段建课：先取大纲，再逐个知识点取正文、练习与测验，最后拼装成一门完整课程。
     *
     * 为什么分阶段：一门课的完整内容远超单次模型输出上限（实测会稳定截断）。
     * 拆开后每次响应都在预算内，进度可见，且失败只需要补未完成的知识点。
     *
     * 真正的编排逻辑在 core/ai-generate.js（同样的代码可以在没有浏览器时被单元测试）：
     * 身份包含全部草稿字段与规范化 Worker 地址；同一身份只允许一次进行中的生成；
     * 已确认返回的知识点永远不会被重复请求。
     */
    async generateCourse(draft) {
      const normalizedDraft = normalizeDraft(draft);
      if (normalizedDraft.topic.length < 2) {
        toast('请先填写至少 2 个字的学科或主题', 'warn');
        return { ok: false, code: 'bad-topic', error: '主题过短' };
      }
      const worker = normalizeWorkerUrl(state.ai?.workerUrl || '');
      if (!worker.ok) {
        ui.aiStatus = { state: 'error', error: worker.reason, code: 'bad-worker-url' };
        render();
        return { ok: false, code: 'bad-worker-url', error: worker.reason };
      }
      ui.aiPreview = null;
      ui.aiStatus = { state: 'loading', phase: 'outline', done: 0, total: 0, attempts: 0 };
      render();

      const result = await runCourseGeneration({
        store: ui,
        workerUrl: worker.base,
        draft: normalizedDraft,
        videoLibrary: VIDEO_LIBRARY,
        loadCourseContext: () => registerGeneratedCourses(state.generatedCourses || []),
        onProgress: (patch) => { ui.aiStatus = { state: 'loading', ...patch }; render(); },
        onDiscarded: () => {
          // 输入或 Worker 变了：旧预览属于另一份需求，必须一起丢弃
          ui.aiPreview = null;
          toast('输入、模板或 Worker 地址已改变，之前的进度不再适用，本次从头生成', 'info');
        },
      });

      if (!result.ok) {
        const summary = planSummary(ui.genPlan);
        ui.aiStatus = {
          state: 'error',
          error: result.error || '生成失败',
          code: result.code || 'error',
          problems: result.problems || [],
          failedConcept: result.failedConcept || summary?.lastFailure?.failedConcept || null,
          done: summary?.done || 0,
          total: summary?.total || 0,
          attempts: summary?.attempts || 0,
          usageText: usageTextOf(summary),
          resumable: Boolean(summary?.resumable),
        };
        render();
        return result;
      }

      ui.aiPreview = result.preview;
      ui.aiStatus = { state: 'ready', attempts: result.attempts || 0, usageText: usageTextOf(summaryOf(ui.genPlan)) };
      render();
      return { ok: true, reused: Boolean(result.reused) };
    },
    /**
     * 失败后重试：先等在途调用结算，再只补未完成的知识点。
     * 已确认完成的知识点不会被再次请求（每一次请求都可能已经被供应商计费）。
     */
    async retryCourse(draft) {
      const normalizedDraft = normalizeDraft(draft);
      const worker = normalizeWorkerUrl(state.ai?.workerUrl || '');
      if (!worker.ok) {
        ui.aiStatus = { state: 'error', error: worker.reason, code: 'bad-worker-url' };
        render();
        return { ok: false, code: 'bad-worker-url', error: worker.reason };
      }
      const before = planSummary(ui.genPlan);
      ui.aiStatus = {
        state: 'loading',
        phase: before?.hasOutline ? 'lesson' : 'outline',
        done: before?.done || 0,
        total: before?.total || 0,
        attempts: before?.attempts || 0,
      };
      render();

      const result = await resumeCourseGeneration({
        store: ui,
        workerUrl: worker.base,
        draft: normalizedDraft,
        videoLibrary: VIDEO_LIBRARY,
        loadCourseContext: () => registerGeneratedCourses(state.generatedCourses || []),
        onProgress: (patch) => { ui.aiStatus = { state: 'loading', ...patch }; render(); },
        onDiscarded: () => {
          // 输入或 Worker 变了：旧预览属于另一份需求，必须一起丢弃
          ui.aiPreview = null;
          toast('输入、模板或 Worker 地址已改变，之前的进度不再适用，本次从头生成', 'info');
        },
      });

      if (!result.ok) {
        const summary = planSummary(ui.genPlan);
        ui.aiStatus = {
          state: 'error',
          error: result.error || '生成失败',
          code: result.code || 'error',
          problems: result.problems || [],
          failedConcept: result.failedConcept || summary?.lastFailure?.failedConcept || null,
          done: summary?.done || 0,
          total: summary?.total || 0,
          attempts: summary?.attempts || 0,
          usageText: usageTextOf(summary),
          resumable: Boolean(summary?.resumable),
        };
        render();
        return result;
      }
      ui.aiPreview = result.preview;
      ui.aiStatus = { state: 'ready', attempts: result.attempts || 0, usageText: usageTextOf(summaryOf(ui.genPlan)) };
      render();
      return { ok: true, reused: Boolean(result.reused) };
    },
    saveGeneratedCourse(course) {
      const existing = state.generatedCourses || [];
      const next = [course, ...existing.filter((c) => c.id !== course.id)].slice(0, 10);
      ui.aiPreview = null;
      ui.aiStatus = { state: 'idle' };
      setState({ ...state, generatedCourses: next });
      toast('已保存到「我的 AI 课程」', 'ok');
      actions.navigate('course', { courseId: course.id });
    },
    deleteGeneratedCourse(courseId) {
      const next = (state.generatedCourses || []).filter((c) => c.id !== courseId);
      setState({ ...state, generatedCourses: next });
      toast('已删除该 AI 课程', 'info');
      if (route.params.courseId === courseId) actions.navigate('generate');
    },
    /**
     * 用 GitHub 登录（可选功能）。
     * 登录由**你自己部署的 Worker** 完成：client secret 与签名密钥都只存在 Worker 机密里，
     * 浏览器拿到的只是「跳转地址」和登录成功后的会话令牌。
     */
    async startGithubLogin() {
      if (ui.auth.checking) return { ok: false, code: 'busy' };
      const worker = normalizeWorkerUrl(state.ai?.workerUrl || '');
      if (!worker.ok) {
        ui.auth = { ...ui.auth, status: 'error', enabled: false, error: '请先填写 AI 代理 Worker 地址——登录由你自己的 Worker 处理。' };
        render();
        return { ok: false, code: 'bad-worker-url' };
      }
      ui.auth = { ...ui.auth, checking: true, status: 'checking', error: null };
      render();
      const result = await requestGithubLogin({
        workerUrl: worker.base,
        // 回跳地址必须是本站源（Worker 会校验并追加 #/auth/complete?token=…）
        returnTo: `${location.origin}${location.pathname}`,
      });
      ui.auth = { ...ui.auth, checking: false };
      if (!result.ok) {
        ui.auth = { ...ui.auth, status: 'error', error: result.error, code: result.code };
        render();
        return result;
      }
      toast('正在跳转到 GitHub 登录…', 'info');
      location.assign(result.url);
      return { ok: true };
    },
    /** 检查 Worker 是否配置了登录，并在有令牌时校验会话是否仍然有效。 */
    async refreshSession() {
      const token = createAuthTokenStore().read();
      const worker = normalizeWorkerUrl(state.ai?.workerUrl || '');
      if (!worker.ok) {
        ui.auth = { ...ui.auth, status: 'unknown', user: null, enabled: null, checking: false };
        render();
        return { ok: false, code: 'bad-worker-url' };
      }
      const support = await fetchAuthSupport({ workerUrl: worker.base });
      const enabled = support.ok ? support.enabled : null;
      if (!token) {
        ui.auth = { ...ui.auth, status: 'anonymous', user: null, checking: false, enabled, error: support.ok ? null : support.error };
        render();
        return { ok: true, anonymous: true };
      }
      ui.auth = { ...ui.auth, checking: true, status: 'checking' };
      render();
      const session = await fetchSession({ workerUrl: worker.base, token });
      if (!session.ok) {
        // 令牌无效或过期：立刻清掉，不留一个「看起来已登录」的假状态
        clearAuthToken();
        ui.auth = { ...ui.auth, checking: false, status: 'anonymous', user: null, enabled, error: session.code === 'unauthorized' ? '登录已过期，请重新登录。' : session.error };
        render();
        return session;
      }
      ui.auth = { ...ui.auth, checking: false, status: 'signed-in', user: session.user, enabled: true, error: null };
      render();
      return { ok: true, user: session.user };
    },
    /** 处理 GitHub 回跳（#/auth/complete?token=…）：存令牌、校验会话，然后立刻离开带令牌的地址。 */
    async completeGithubLogin(query) {
      ui.auth = { ...ui.auth, settling: true };
      const token = readCallbackToken(query);
      if (!token) {
        ui.auth = { ...ui.auth, settling: false, status: 'error', error: '登录回跳缺少有效令牌，请重新登录。' };
        toast('登录失败：回跳缺少有效令牌', 'warn');
        actions.navigate('settings');
        return { ok: false, code: 'bad-token' };
      }
      createAuthTokenStore().write(token);
      const worker = normalizeWorkerUrl(state.ai?.workerUrl || '');
      const session = worker.ok
        ? await fetchSession({ workerUrl: worker.base, token })
        : { ok: false, code: 'bad-worker-url', error: '未配置 Worker 地址，无法校验登录。' };
      if (!session.ok) {
        clearAuthToken();
        ui.auth = { ...ui.auth, settling: false, status: 'error', user: null, error: session.error || '登录失败。' };
        toast('登录失败', 'warn');
        actions.navigate('settings');
        return session;
      }
      ui.auth = { ...ui.auth, settling: false, status: 'signed-in', user: session.user, enabled: true, error: null };
      toast(`已登录：${session.user.name || session.user.login}`, 'ok');
      actions.navigate('settings');
      return { ok: true, user: session.user };
    },
    logout() {
      clearAuthToken();
      ui.auth = { ...ui.auth, status: 'anonymous', user: null, error: null };
      toast('已退出登录（本地课程与学习进度不受影响）', 'info');
      render();
    },
    setCustomVideoDraft(draft) { ui.customVideoDraft = draft; render(); },
    // 播放器状态由视频卡片本地管理，这里只做静默记录（避免重渲染打断播放）
    setVideoLoad(videoId, status) { ui.videoLoad = { ...ui.videoLoad, [videoId]: status }; },
    savePlan(courseId, plan) {
      setState(progress.setCustomPlan(state, courseId, plan));
      toast(`已保存《${plan.courseTitle}》的 ${plan.stats.weeks} 周计划`, 'ok');
      actions.navigate('course', { courseId }, { tab: 'plan' });
    },
    clearPlan(courseId) {
      setState(progress.setCustomPlan(state, courseId, null));
      toast('已删除这份计划', 'info');
    },
    completeLesson(courseId, conceptId, minutes) {
      setState(progress.markLessonCompleted(state, courseId, conceptId, minutes));
      toast('已标记完成，进度已保存到本机', 'ok');
    },
    uncompleteLesson(courseId, conceptId) {
      setState(progress.markLessonUncompleted(state, courseId, conceptId));
    },
    toggleTask(courseId, conceptId, index) {
      setState(progress.toggleTask(state, courseId, conceptId, index));
    },
    recordQuiz(courseId, result) {
      // 静默写入：测验组件会在仍然挂载的节点里展示分数与解析，重渲染会让用户看不到结果
      setState(progress.recordQuizAttempt(state, courseId, result), { silent: true });
      toast(result.passed ? `测验通过：${result.score}/${result.total}` : `本次未通过：${result.score}/${result.total}，可查看解析后重做`, result.passed ? 'ok' : 'warn');
      return {
        quizId: result.quizId,
        attempts: (state.courses?.[courseId]?.quizAttempts || []).filter((a) => a.quizId === result.quizId),
      };
    },
    addNote(courseId, conceptId, text) {
      const next = progress.addNote(state, courseId, conceptId, text);
      if (next === state) { toast('笔记内容为空', 'warn'); return; }
      setState(next);
      toast('笔记已保存到本机', 'ok');
    },
    removeNote(courseId, conceptId, noteId) {
      setState(progress.removeNote(state, courseId, conceptId, noteId));
    },
    toggleBookmark(courseId, conceptId) {
      setState(progress.toggleBookmark(state, courseId, conceptId));
    },
    markVideoOpened(video) {
      // 静默写入：避免重渲染打断正在播放的播放器
      setState(progress.markVideoOpened(state, video.subjectId, video.id), { silent: true });
    },
    addCustomVideo(draft) {
      const url = String(draft.url || '').trim();
      const title = String(draft.title || '').trim();
      if (!url) return { ok: false, error: '请填写视频链接' };
      if (!title) return { ok: false, error: '请填写视频标题' };
      if (title.length > 120) return { ok: false, error: '标题过长（最多 120 字）' };
      const classified = classifyVideoUrl(url);
      if (!classified.ok) return { ok: false, error: classified.reason };
      const video = {
        id: `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`,
        provider: classified.provider,
        sourceKind: 'user',
        bvid: classified.bvid || null,
        page: classified.page || 1,
        title,
        creator: '用户自定义',
        creatorVerified: false,
        durationSeconds: null,
        subjectId: draft.courseId,
        knowledgePoints: draft.conceptId ? [draft.conceptId] : [],
        reason: String(draft.reason || '').trim() || '用户自定义来源，未经本站核实。',
        watchUrl: classified.url,
        verification: { method: 'local format check', status: 'unverified', creatorVerified: false, checkedAt: new Date().toISOString().slice(0, 10) },
        playbackVerified: false,
      };
      setState(progress.addCustomVideo(state, draft.courseId, video));
      toast('已添加自定义视频', 'ok');
      return { ok: true };
    },
    removeCustomVideo(courseId, videoId) {
      setState(progress.removeCustomVideo(state, courseId, videoId));
      toast('已删除该自定义视频', 'info');
    },
    updateProfile(patch) {
      setState({ ...state, profile: { ...state.profile, ...patch, updatedAt: new Date().toISOString() } });
    },
    updatePreferences(patch) {
      setState({ ...state, preferences: { ...state.preferences, ...patch } });
    },
    updateAi(patch) {
      setState({ ...state, ai: { ...state.ai, ...patch } });
    },
    saveSecret(value) {
      const result = secrets.write(value);
      toast(result.ok ? (value ? '密钥已保存到当前会话（关闭标签页即失效）' : '已清除密钥') : `密钥只保存在内存中：${result.error}`, result.ok ? 'ok' : 'warn');
      render();
    },
    exportData() {
      const json = exportState(state, { appVersion: APP_VERSION });
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { attrs: { href: url, download: `studymate-backup-${new Date().toISOString().slice(0, 10)}.json` } });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('备份已导出（不含任何密钥）', 'ok');
    },
    async importFile(file) {
      try {
        const text = await file.text();
        actions.importJson(text);
      } catch (error) {
        toast(`读取文件失败：${error.message}`, 'bad');
      }
    },
    importJson(text) {
      const result = importState(text);
      if (!result.ok) { toast(`导入失败：${result.error}`, 'bad'); return { ok: false, error: result.error }; }
      setState(result.state);
      toast(result.warnings.length ? `导入完成，注意：${result.warnings.join(' ')}` : '导入完成', result.warnings.length ? 'warn' : 'ok');
      return { ok: true };
    },
    resetAll() {
      if (!ui.resetArmed) {
        ui.resetArmed = true;
        render();
        toast('再点一次「确认清空」才会删除全部本地数据', 'warn');
        return;
      }
      ui.resetArmed = false;
      store.clear();
      secrets.clear();
      // 登录令牌存在独立键里，清空本地数据时必须一并清除
      clearAuthToken();
      ui.auth = { ...ui.auth, status: 'anonymous', user: null, error: null };
      setState(createEmptyState());
      toast('本地数据已清空', 'info');
    },
    async requestAiExplanation(course, concept) {
      const payload = {
        concept: { title: concept.title, summary: concept.summary },
        level: state.profile.level,
        goal: state.profile.goal,
        courseTitle: course.title,
      };
      const worker = normalizeWorkerUrl(state.ai?.workerUrl || '');
      if (worker.ok) {
        // 代理模式（推荐）：密钥留在 Cloudflare Worker 机密里
        const result = await explainViaWorker({ workerUrl: worker.base, payload });
        return result.ok ? { ok: true, text: result.text, model: result.meta?.model || '' } : result;
      }
      // 直连模式（次级）：密钥只存在于当前会话
      return requestExplanation({
        endpoint: state.ai.endpoint,
        model: state.ai.model,
        apiKey: secrets.read(),
        concept,
        courseTitle: course.title,
        level: state.profile.level,
        goal: state.profile.goal,
      });
    },
    toast,
  };

  function context() {
    registerGeneratedCourses(state.generatedCourses || []);
    const course = route.params.courseId ? getCourse(route.params.courseId) : null;
    const conceptLookup = route.params.conceptId && route.params.courseId ? getConcept(route.params.courseId, route.params.conceptId) : { concept: null };
    const currentDraft = { ...defaultPreferences(), ...(ui.aiDraft || {}) };
    // 与「上一次生成所用的输入」相比改了哪些字段：界面据此如实提示会重新生成
    const pendingChange = draftChangedFields(ui.genPlan, currentDraft);
    return {
      state,
      courses: COURSES,
      route,
      query: ui.query,
      subjectId: ui.subjectId,
      videoFilter: ui.videoFilter,
      draft: ui.draft,
      customVideoDraft: ui.customVideoDraft,
      videoLoad: ui.videoLoad,
      aiDraft: ui.aiDraft,
      slideIndex: ui.slideIndex,
      aiPreview: ui.aiPreview,
      aiStatus: ui.aiStatus,
      auth: ui.auth,
      aiUsage: ui.aiStatus?.usageText || null,
      aiPendingChange: pendingChange,
      aiPlanSummary: planSummary(ui.genPlan),
      secrets,
      actions,
      course,
      concept: conceptLookup.concept,
    };
  }

  /** 登录回跳页：令牌只在内存与地址栏里短暂存在，处理完立刻跳到设置页。 */
  function authCompleteView() {
    return h('div', { class: 'view' },
      h('header', { class: 'view-head' }, h('h1', { text: '正在完成登录' })),
      h('section', { class: 'panel' },
        h('p', { attrs: { 'aria-live': 'polite' }, text: ui.auth.settling ? '正在校验登录信息…' : '正在跳转…' }),
        h('p', { class: 'muted small', text: '登录令牌不会留在地址栏里：无论成功与否，本页都会立刻跳转到设置页。' })));
  }

  function viewFor(ctx) {
    switch (route.view) {
      case 'dashboard': return dashboardView(ctx);
      case 'explore': return exploreView(ctx);
      case 'plan': return planView(ctx);
      case 'generate': return generateView(ctx);
      case 'course': return courseView(ctx);
      case 'lesson': return lessonView(ctx);
      case 'slides': return slidesView(ctx);
      case 'videos': return videosView(ctx);
      case 'profile': return profileView(ctx);
      case 'settings': return settingsView(ctx);
      case 'authComplete': return authCompleteView(ctx);
      case 'about': return aboutView(ctx);
      default: return h('div', { class: 'view' }, h('h1', { text: '页面不存在' }), h('p', { class: 'muted', text: '请从导航栏重新进入。' }));
    }
  }

  function render() {
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.focusKey : null;
    const selectionStart = focusKey && typeof active.selectionStart === 'number' ? active.selectionStart : null;

    route = parseRoute(typeof location !== 'undefined' ? location.hash : '#/');
    // GitHub 回跳：同步打标后交给异步动作处理（避免重复处理同一份令牌）
    if (route.view === 'authComplete') {
      if (!ui.auth.callbackHandled) {
        ui.auth = { ...ui.auth, callbackHandled: true, settling: true };
        Promise.resolve().then(() => actions.completeGithubLogin(route.query));
      }
    } else if (ui.auth.callbackHandled) {
      // 离开回跳页时复位：否则同一标签页内第二次登录会被这次标记静默忽略
      ui.auth = { ...ui.auth, callbackHandled: false, settling: false };
    }
    const ctx = context();
    applyPreferences(state);
    clear(root);
    root.appendChild(shell(ctx));
    const activeLink = root.querySelector(`.nav-link[href="${buildRoute(route.view, route.params, {})}"]`);
    if (activeLink) activeLink.setAttribute('aria-current', 'page');

    if (focusKey) {
      const next = root.querySelector(`[data-focus-key="${focusKey}"]`);
      if (next && typeof next.focus === 'function') {
        next.focus();
        if (selectionStart !== null && typeof next.setSelectionRange === 'function') {
          try { next.setSelectionRange(selectionStart, selectionStart); } catch { /* 非文本输入忽略 */ }
        }
      }
    }
    if (testMode) {
      document.documentElement.dataset.e2eReady = '1';
    }
  }

  function shell(ctx) {
    return h('div', { class: 'app-shell' },
      h('a', { class: 'skip-link', attrs: { href: '#main' }, text: '跳到主要内容' }),
      header(ctx),
      h('main', { attrs: { id: 'main', tabindex: '-1' }, class: 'app-main' }, viewFor(ctx)),
      footer(ctx),
      h('div', { class: 'toast-region', attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' } })
    );
  }

  function header(ctx) {
    return h('header', { class: 'app-header' },
      h('div', { class: 'header-inner' },
        h('a', { class: 'brand', attrs: { href: buildRoute('dashboard'), 'aria-label': BRAND_ARIA_LABEL } },
          orbitalMark(34),
          h('span', { class: 'brand-text' },
            h('strong', { text: PRODUCT_NAME }),
            h('span', { class: 'brand-sub', text: PRODUCT_TAGLINE })
          )
        ),
        h('button', {
          class: 'nav-toggle',
          attrs: { type: 'button', 'aria-expanded': ui.navOpen ? 'true' : 'false', 'aria-controls': 'primary-nav' },
          on: { click: () => { ui.navOpen = !ui.navOpen; render(); } },
        }, h('span', { class: 'nav-toggle-bars', attrs: { 'aria-hidden': 'true' } }, h('span'), h('span'), h('span')), h('span', { class: 'nav-toggle-text', text: '菜单' })),
        h('nav', { class: ui.navOpen ? 'primary-nav is-open' : 'primary-nav', attrs: { id: 'primary-nav', 'aria-label': '主导航' } },
          NAV_ITEMS.map((item) =>
            h('a', {
              class: 'nav-link',
              attrs: { href: buildRoute(item.view) },
              on: { click: () => { ui.navOpen = false; } },
              text: item.label,
            })),
          h('a', { class: 'nav-link nav-link-cta', attrs: { href: buildRoute('settings') }, text: '设置' })
        ),
        h('div', { class: 'header-side' },
          h('span', { class: 'header-streak', text: `${ctx.state.profile.name || '学习者'}` }),
          badge('本地存储', 'soft')
        )
      )
    );
  }

  function footer() {
    return h('footer', { class: 'app-footer' },
      h('div', { class: 'footer-inner' },
        h('p', { text: `${PRODUCT_NAME} —— 受 Miaotofu01/Study-Mate（MIT, Copyright (c) 2026 Cattofu）启发的独立网页改编；界面、课程与测验内容为原创。产品改名不影响本地数据：存储键、备份标识与 Worker 名称都保持原样。` }),
        h('p', { class: 'muted small' },
          h('span', { text: '数据只存储在本机浏览器；' }),
          h('a', { class: 'link', attrs: { href: buildRoute('about') }, text: '查看能力对照与已知边界' }),
          h('span', { text: ' · ' }),
          h('a', { class: 'link', attrs: { href: 'https://github.com/Miaotofu01/Study-Mate', target: '_blank', rel: 'noopener noreferrer' }, text: '上游仓库' })
        )
      )
    );
  }

  function applyPreferences(prefs) {
    const reduceMotion = prefs.reduceMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.classList.toggle('reduce-motion', Boolean(reduceMotion));
    document.documentElement.style.setProperty('--font-scale', String(prefs.fontScale || 1));
    document.title = brandDocumentTitle(routeTitle(route));
  }

  function start() {
    window.addEventListener('hashchange', render);
    // 课件模式键盘导航（← → / PageUp / PageDown / Home / End / Esc）
    window.addEventListener('keydown', (event) => {
      if (route.view !== 'slides') return;
      const tag = (event.target && event.target.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      const deck = root.querySelector('.deck');
      const total = deck?.dataset.slideCount ? Number(deck.dataset.slideCount) : 0;
      const activeSlide = deck?.querySelector('.deck-slide.is-active');
      const current = activeSlide ? Number(activeSlide.dataset.slide) : (ui.slideIndex || 1);
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        actions.setSlideIndex(current + 1, total);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        actions.setSlideIndex(current - 1, total);
      } else if (event.key === 'Home') {
        event.preventDefault();
        actions.setSlideIndex(1, total);
      } else if (event.key === 'End') {
        event.preventDefault();
        actions.setSlideIndex(total, total);
      } else if (event.key === 'Escape') {
        const courseId = route.params.courseId;
        const conceptId = route.params.conceptId;
        if (courseId && conceptId) {
          event.preventDefault();
          actions.navigate('lesson', { courseId, conceptId });
        }
      }
    });
    if (!location.hash) location.hash = '#/';
    // 同源部署（例如 Cloudflare Pages：前端与 /api/* 反代同域）时自动填好代理地址，
    // 用户在新设备上打开即可用；不发任何请求，只是按主机名判断。
    if (!state.ai?.workerUrl) {
      const fallback = defaultWorkerUrl();
      if (fallback) setState({ ...state, ai: { ...state.ai, workerUrl: fallback } }, { silent: true });
    }
    // 只有**本机确实存有登录令牌**时才向自己的 Worker 校验一次会话：
    // 否则每次刷新都停在「尚未检查登录状态」，用户会以为登录没生效。
    // 没有令牌时一个请求都不发。
    if (createAuthTokenStore().read()) {
      Promise.resolve().then(() => actions.refreshSession());
    }
    render();
  }

  return { start, render, getState: () => state, actions, ui, store };
}

function safeBackend() {
  try {
    const probeKey = 'studymate.probe';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return createLocalStorageBackend(localStorage);
  } catch {
    return createMemoryBackend();
  }
}

