import { h } from '../dom.js';
import { badge, emptyState, progressBar, typeLabel } from '../components.js';
import { GOALS, LEVELS, defaultPreferences, goalLabel, levelLabel } from '../../core/personalize.js';
import { VIDEO_LIBRARY } from '../../data/videos.js';
import { buildRoute } from '../../core/router.js';
import { normalizeWorkerUrl, PROXY_DISCLAIMER } from '../../core/ai-client.js';
import { formatMinutes } from '../../core/format.js';
import { COURSE_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate, isKnownTemplateId, normalizeTemplateId } from '../../data/course-templates.js';

const QUOTA_FACT = '只要发起了模型调用，这次尝试就会计入当日额度并可能产生费用——即使输出无效或失败，供应商也可能照样计费。';

const ERROR_HINTS = {
  'visitor-quota-exceeded': `你今天的模型尝试额度已用完（默认 10 次/天），明天会重置。完整建课只能通过你自己部署的 AI 代理 Worker 完成；直连模式仅支持课时页的「AI 讲解」，不能用来建课。`,
  'site-quota-exceeded': `本站今天的模型尝试额度已用完，请明天再试；或按 worker/README.md 部署你自己的 Worker，用你自带的供应商额度建课。直连模式仅支持「AI 讲解」。`,
  'concurrency-limit': '当前同时进行的生成请求已达上限（默认 2 个）。请等前一个请求结束再试；被拒绝的请求不会发起新的模型调用，也不占额度。',
  'output-truncated': `模型输出达到长度上限被截断，课程没有生成完整，因此没有保存。${QUOTA_FACT}可以调大 Worker 的 PROVIDER_MAX_OUTPUT_TOKENS，或把主题缩小后重试。`,
  'worker-configuration-error': 'Worker 还没有配置完成（缺少密钥或允许源），请按 worker/README.md 完成部署。',
  'invalid-model-output': `模型返回的内容没有通过结构校验，课程未被保存。${QUOTA_FACT}`,
  'invalid-outline': `服务返回的课程大纲不完整或格式不对（缺少标题/简介、没有知识点、知识点缺 id 或 id 重复），本次已中止，没有继续为知识点发起调用。未被截断的部分不会被保存；这次大纲调用已经计入额度。`,
  'invalid-concept': `某个知识点的返回内容与请求的知识点对不上（id 不符，或缺少正文/测验），已中止以免拼出错误课程。已完成的其它知识点仍保留在当前标签页内存里，重试只会补这一个。`,
  'budget-exhausted': '本次生成的时间预算已用完；为避免继续调用产生费用，已停止后续请求。重试只会补未完成的知识点。',
  'timeout': `等待服务返回超时，本次没有拿到可用结果；已发出的调用仍可能被供应商计费。${QUOTA_FACT}`,
  'provider-timeout': `模型响应超时，课程未被保存。${QUOTA_FACT}`,
  'provider-error': `模型服务出错了，课程未被保存。${QUOTA_FACT}`,
  'bad-worker-url': 'Worker 地址不合法，请在设置中检查（完整建课必须填写代理 Worker 地址）。',
  'network-error': '网络请求失败，请检查 Worker 地址与网络连通性。',
};

export function generateView(ctx) {  const ai = ctx.state.ai || {};
  const worker = normalizeWorkerUrl(ai.workerUrl || '');
  const directReady = Boolean(ai.enabled && ai.endpoint);
  // 建课必须走代理 Worker：直连模式只用于「讲解」，避免把大提示词与密钥都放到浏览器
  const ready = worker.ok;
  const draft = { ...defaultPreferences(), topic: '', ...(ctx.aiDraft || {}) };
  const status = ctx.aiStatus || { state: 'idle' };
  const preview = ctx.aiPreview;

  return h('div', { class: 'view view-generate' },
    h('header', { class: 'view-head' },
      h('h1', { text: '智能建课' }),
      h('p', { class: 'muted', text: '告诉它你想学什么，它会生成一门完整课程：知识点顺序、正文讲解、练习、带解析的测验，以及动手单元。分两步生成（先大纲、再逐个知识点），过程中会显示进度；生成结果先给你预览，只有你点「保存」才会进入你的课程库。' })
    ),

    h('section', { class: `panel notice ${ready ? '' : 'notice-warn'}` },
      h('h2', { text: ready ? '智能服务已就绪' : '智能建课还没有就绪' }),
      ready
        ? h('ul', {},
            h('li', { text: '直接开始就行，不需要任何设置；密钥保存在服务端，浏览器不接触。' }),
            h('li', { text: '生成会真实调用模型，因此会消耗服务端的调用额度；失败或输出无效不会计入你的额度。' }),
            h('li', { text: PROXY_DISCLAIMER }))
        : h('ul', {},
            h('li', { text: '课程库、定制课程、课件、视频、测验与学习进度都可以照常使用，不受影响。' }),
            h('li', { text: directReady
              ? '你当前填的是「直连接口」：它只支持课时页的讲解，不支持完整建课。完整建课需要连接一个服务端地址。'
              : '要使用建课与讲解，需要连接一个智能服务；自己部署的话，在设置里填入地址即可。' })),
      ready ? null : h('div', { class: 'panel-actions' }, h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('settings') }, text: '去设置' }))
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '① 描述你的学习需求' }),
      templatePicker(ctx, { draft, loading: status.state === 'loading' }),
      h('div', { class: 'generate-form' },
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: '学科 / 主题（越具体越好）' }),
          h('input', {
            class: 'text-input',
            attrs: { type: 'text', placeholder: '例如：数据结构与算法入门 / 概率论与数理统计 / 用 Python 做数据分析', value: draft.topic, maxlength: '80', 'data-focus-key': 'generate-topic' },
            on: { input: (e) => ctx.actions.setAiDraft({ ...draft, topic: e.target.value }) },
          })
        ),
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: '学习目标' }),
          h('select', { class: 'text-input', attrs: { 'data-focus-key': 'generate-goal' }, on: { change: (e) => ctx.actions.setAiDraft({ ...draft, goal: e.target.value }) } },
            GOALS.map((g) => h('option', { attrs: { value: g.id, selected: g.id === draft.goal ? 'selected' : null }, text: `${g.label} — ${g.hint}` })))
        ),
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: '当前水平' }),
          h('select', { class: 'text-input', attrs: { 'data-focus-key': 'generate-level' }, on: { change: (e) => ctx.actions.setAiDraft({ ...draft, level: e.target.value }) } },
            LEVELS.map((l) => h('option', { attrs: { value: l.id, selected: l.id === draft.level ? 'selected' : null }, text: `${l.label} — ${l.hint}` })))
        ),
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: `每周可投入：${draft.weeklyHours} 小时` }),
          h('input', { class: 'range', attrs: { type: 'range', min: '1', max: '20', value: String(draft.weeklyHours), 'data-focus-key': 'generate-weekly' }, on: { input: (e) => ctx.actions.setAiDraft({ ...draft, weeklyHours: Number(e.target.value) }) } })
        ),
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: `单次专注时长：${draft.lessonMinutes} 分钟` }),
          h('input', { class: 'range', attrs: { type: 'range', min: '15', max: '120', step: '5', value: String(draft.lessonMinutes), 'data-focus-key': 'generate-lesson' }, on: { input: (e) => ctx.actions.setAiDraft({ ...draft, lessonMinutes: Number(e.target.value) }) } })
        )
      ),
      unchangedHint(ctx) ? unchangedHint(ctx) : null,
      h('div', { class: 'panel-actions' },
        h('button', {
          class: 'btn btn-primary',
          attrs: { type: 'button', 'data-action': 'generate-course', disabled: status.state === 'loading' ? 'disabled' : null },
          on: { click: () => ctx.actions.generateCourse(draft) },
          text: status.state === 'loading' ? '正在生成…' : '生成完整课程',
        }),
        h('span', { class: 'muted small', text: `将匹配 ${VIDEO_LIBRARY.length} 条已核实视频；找不到合适视频时会如实标注「无匹配」，不会编造链接。` })
      ),
      status.state === 'loading'
        ? h('div', { class: 'form-status', attrs: { 'aria-live': 'polite' } },
            h('p', { text: loadingText(status) }),
            status.total > 0
              ? progressBar(Math.round(((status.done || 0) / status.total) * 100), { label: `${status.done || 0}/${status.total} 个知识点` })
              : null
          )
        : null,
      status.state === 'error'
        ? h('div', { class: 'panel error-panel' },
            h('h3', { text: `生成失败：${status.error}` }),
            h('p', { class: 'muted', text: ERROR_HINTS[status.code] || '请检查 AI 通道配置后重试。' }),
            status.resumable
              ? h('p', { class: 'muted', text: `已完成 ${status.done || 0}/${status.total || 0} 个知识点${status.failedConcept ? `（卡在「${status.failedConcept}」）` : ''}。这些进度只保存在当前标签页的内存里：刷新或关掉标签页就会丢失。点「续跑未完成的知识点」只会补没完成的部分，已完成的不会再次请求（每次请求都算一次模型尝试额度）。` })
              : null,
            status.attempts
              ? h('p', { class: 'muted small', text: `本次已发出的模型尝试：${status.attempts} 次。` })
              : null,
            status.usageText ? h('p', { class: 'muted small', text: `累计用量：${status.usageText}` }) : null,
            status.problems?.length ? h('ul', {}, status.problems.map((p) => h('li', { text: p }))) : null,
            h('div', { class: 'panel-actions' },
              h('button', { class: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: () => ctx.actions.retryCourse(draft) }, text: status.resumable ? '续跑未完成的知识点' : '重试' }),
              status.resumable
                ? h('button', { class: 'btn btn-ghost danger', attrs: { type: 'button' }, on: { click: () => ctx.actions.discardAiPreview() }, text: '放弃并重新开始' })
                : null,
              h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('settings') }, text: '检查配置' })
            ))
        : null
    ),

    status.state === 'ready' && preview
      ? previewPanel(ctx, preview, ctx.aiUsage)
      : null,

    h('section', { class: 'panel' },
      h('h2', { text: '我的 AI 课程' }),
      (ctx.state.generatedCourses || []).length === 0
        ? h('p', { class: 'muted', text: '还没有生成过课程。生成并保存后，它会像内置课程一样出现在课程库、定制计划与进度里。' })
        : h('ul', { class: 'generated-list' }, (ctx.state.generatedCourses || []).map((course) =>
            h('li', {},
              h('div', {},
                h('a', { class: 'card-link', attrs: { href: buildRoute('course', { courseId: course.id }) }, text: course.title }),
                h('p', { class: 'muted small', text: `${course.concepts.length} 个单元 · 生成于 ${course.aiMeta?.generatedAt?.slice(0, 10) || '未知'} · 模型 ${course.aiMeta?.model || '未标注'}` })
              ),
              h('div', { class: 'panel-actions' },
                h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('plan', {}, { course: course.id }) }, text: '为它定制计划' }),
                h('button', { class: 'btn btn-ghost danger', attrs: { type: 'button' }, on: { click: () => ctx.actions.deleteGeneratedCourse(course.id) }, text: '删除' })
              )
            )))
    ),

    h('section', { class: 'panel notice' },
      h('h2', { text: '这些课程是什么、不是什么' }),
      h('ul', {},
        h('li', { text: '它是模型生成的原创内容，未经人工逐条审核：请把它当作「一位助教替你整理的初稿」，重要结论请用教材或课程视频核对。' }),
        h('li', { text: '视频只从项目内已核实的来源里匹配；没有匹配到就是没有匹配到，不会生成视频链接。' }),
        h('li', { text: '生成的课程保存在你的浏览器里（可导出备份），不会被上传到本站或其他服务器。' }),
        h('li', { text: '生成过程中的「大纲 + 已完成知识点」只保留在当前标签页的内存里，没有写入本地存储：刷新或关闭标签页就会丢失，需要自己重新生成。' }),
        h('li', { text: '页面上的「AI 生成」标记始终保留，避免把模型内容误认为官方课程。' })
      )
    )
  );
}

/**
 * 课程模板选择器：一键填好「目标 / 水平 / 每周时长 / 单次时长 / 示例主题」。
 *
 * 纪律：
 *  - 只是本地表单预设，选模板/改模板都不发任何网络请求；只有点「生成完整课程」才调用 AI。
 *  - 生成过程中禁用切换（当前请求的模板身份不能被中途改掉）。
 *  - 模板与全部草稿字段一起构成生成身份：改了模板就不会续用旧需求的正文。
 */
function templatePicker(ctx, { draft, loading }) {
  const currentId = isKnownTemplateId(draft.templateId) ? draft.templateId : DEFAULT_TEMPLATE_ID;
  const chosen = getTemplate(currentId) || getTemplate(DEFAULT_TEMPLATE_ID);
  const changed = Array.isArray(ctx.aiPendingChange) ? ctx.aiPendingChange : [];
  const templateChanged = changed.includes('templateId');
  const plan = ctx.aiPlanSummary;

  return h('div', { class: 'template-picker' },
    h('div', { class: 'template-head' },
      h('h3', { text: '课程模板（可选）' }),
      h('p', { class: 'muted small', text: '选一个模板会把下面几项填成推荐值——只是省去你自己调参数，生成仍然会真实调用模型并按服务端回报的用量计费。所有字段都可以再改。' })
    ),
    h('div', { class: 'template-grid', attrs: { role: 'group', 'aria-label': '课程模板' } },
      COURSE_TEMPLATES.map((template) => {
        const selected = template.id === currentId;
        return h('button', {
          class: `template-card${selected ? ' is-selected' : ''}`,
          attrs: {
            type: 'button',
            'data-template-id': template.id,
            'aria-pressed': selected ? 'true' : 'false',
            disabled: loading ? 'disabled' : null,
          },
          on: { click: () => ctx.actions.setAiTemplate(template.id) },
        },
          h('span', { class: 'template-card-top' },
            h('strong', { text: template.label }),
            selected ? badge('已选', 'soft') : null
          ),
          h('span', { class: 'muted small', text: template.tagline }),
          template.prefs
            ? h('span', { class: 'muted small', text: `每周 ${template.prefs.weeklyHours} 小时 · 单次 ${template.prefs.lessonMinutes} 分钟 · 目标「${goalLabel(template.prefs.goal)}」/ 水平「${levelLabel(template.prefs.level)}」` })
            : h('span', { class: 'muted small', text: '全部自己填' })
        );
      })
    ),
    h('div', { class: 'template-detail', attrs: { 'data-template-current': currentId } },
      h('p', { class: 'muted small', text: `适合谁：${chosen.audience}` }),
      chosen.exampleTopic ? h('p', { class: 'muted small', text: `示例主题：${chosen.exampleTopic}（主题为空时点模板会自动填入，已写内容不会被覆盖）` }) : null
    ),
    loading
      ? h('p', { class: 'muted small', text: '生成进行中：模板已锁定，等这次生成结束后再切换。' })
      : templateChanged && plan?.hasOutline
        ? h('p', { class: 'muted small', text: '模板已改变：之前那份进度是按另一个模板生成的，点「生成完整课程」会按新模板重新开始（不会拿旧正文凑）。' })
        : null
  );
}

/**
 * 改了需求（或换模板）时的如实提示：点「生成完整课程」= 按新需求重新开始，
 * 之前保留在内存里的进度不再适用，也不会拿来凑当前需求。
 */
function unchangedHint(ctx) {
  const changed = Array.isArray(ctx.aiPendingChange) ? ctx.aiPendingChange : [];
  const plan = ctx.aiPlanSummary;
  if (changed.length === 0 || !plan?.hasOutline) return null;
  const templateChanged = changed.includes('templateId');
  return h('p', { class: 'muted small', text: templateChanged
    ? '你换了模板：点「生成完整课程」会按新模板从头生成（旧需求的大纲与正文不会复用）。'
    : '你改了学习需求：点「生成完整课程」会按新需求从头生成（旧需求的大纲与正文不会复用）。' });
}

function loadingText(status) {
  if (status.phase === 'outline') {
    return '第 1 步：正在生成课程大纲（知识点顺序与依赖关系），通常需要 10-30 秒，请不要关闭页面…';
  }
  return `第 2 步：正在逐个生成知识点内容${status.current ? `（当前：${status.current}）` : ''}，每个知识点约 10-20 秒，请不要关闭页面…`;
}

function previewPanel(ctx, preview, usageText) {
  const { course, warnings, meta } = preview;
  const order = [];
  const seen = new Set();
  const visit = (concept) => {
    if (seen.has(concept.id)) return;
    for (const p of concept.prerequisites || []) {
      const dep = course.concepts.find((c) => c.id === p);
      if (dep) visit(dep);
    }
    seen.add(concept.id);
    order.push(concept);
  };
  course.concepts.forEach(visit);

  const videos = order.flatMap((c) => c.videoIds.map((id) => VIDEO_LIBRARY.find((v) => v.id === id)).filter(Boolean));
  return h('section', { class: 'panel preview-panel' },
    h('header', { class: 'panel-head' },
      h('h2', { text: '② 预览生成结果' }),
      badge('AI 生成 · 请自行核对', 'warn')
    ),
    h('div', { class: 'preview-head' },
      h('h3', { text: course.title }),
      h('p', { text: course.summary }),
      h('div', { class: 'tag-row' }, course.tags.map((t) => h('span', { class: 'tag', text: t }))),
      h('ul', { class: 'meta-list' },
        h('li', { text: `单元数：${course.concepts.length}（含 ${course.concepts.filter((c) => c.type !== 'concept').length} 个动手单元）` }),
        h('li', { text: `预计时长：约 ${course.estimatedHours} 小时 · 测验 ${Object.keys(course.quizzes).length} 套` }),
        h('li', { text: `匹配到已核实视频：${videos.length} 条${videos.length === 0 ? '（没有匹配到，已如实留空）' : ''}` }),
        h('li', { text: `生成模型：${meta?.model || '未标注'}` }),
        h('li', { text: `模型尝试次数：${meta?.attempts ?? '未标注'} 次（大纲 1 次 + 每个知识点 1 次）` })
      ),
      usageText
        ? h('p', { class: 'muted small', text: `本次累计用量（大纲 + 全部知识点）：${usageText}` })
        : null
    ),
    warnings?.length ? h('ul', { class: 'preview-warnings' }, warnings.map((w) => h('li', { text: w }))) : null,
    h('ol', { class: 'preview-concepts' }, order.map((concept) =>
      h('li', { class: `preview-concept type-${concept.type}` },
        h('div', { class: 'preview-concept-head' },
          h('strong', { text: concept.title }),
          badge(typeLabel(concept.type), 'soft'),
          badge(formatMinutes(concept.estimatedMinutes), 'soft')
        ),
        h('p', { class: 'muted small', text: concept.summary }),
        h('p', { class: 'muted small', text: `前置：${concept.prerequisites.length ? concept.prerequisites.join('、') : '无'} · 正文 ${concept.lesson.sections.length} 节 · 练习 ${concept.exercises.length} 条 · 测验 ${concept.quizId ? course.quizzes[concept.quizId].questions.length + ' 题' : '无'}` }),
        concept.videoIds.length
          ? h('ul', { class: 'preview-videos' }, concept.videoIds.map((id) => {
              const video = VIDEO_LIBRARY.find((v) => v.id === id);
              return h('li', { text: `🎬 ${video ? `${video.title}（${video.creator}）` : id}` });
            }))
          : h('p', { class: 'muted small', text: '该单元没有匹配到已核实视频。' })
      ))),
    h('div', { class: 'panel-actions' },
      h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: () => ctx.actions.saveGeneratedCourse(course) }, text: '保存到我的课程' }),
      h('button', { class: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: () => ctx.actions.discardAiPreview() }, text: '放弃这次结果' }),
      h('span', { class: 'muted small', text: '生成过程会经过你配置的 Worker 与模型供应商（因此有额度与费用影响）；点「保存」之后，课程内容只存在你本机浏览器里，之后学习不需要再联网。' })
    )
  );
}

export function emptyGenerateState(ctx) {
  return emptyState({
    title: '先配置 AI 通道',
    description: '代理模式只需要一个 Worker 地址；未配置时核心学习功能不受影响。',
    actionLabel: '去设置',
    onAction: () => ctx.actions.navigate('settings'),
  });
}

export { progressBar, goalLabel, levelLabel };
