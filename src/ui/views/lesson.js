import { h } from '../dom.js';
import { badge, emptyState, projectPanel, quizWidget, taskChecklist, typeLabel, videoCard, progressBar } from '../components.js';
import { buildRoute } from '../../core/router.js';
import { conceptStateMap, courseProgress } from '../../core/progress.js';
import { CONCEPT_STATES, STATE_LABELS } from '../../core/graph.js';
import { formatMinutes, formatRelative } from '../../core/format.js';
import { videoById } from '../../core/catalog.js';
import { AI_DISCLAIMER, validateEndpoint } from '../../core/ai.js';
import { normalizeWorkerUrl } from '../../core/ai-client.js';

export function lessonView(ctx) {
  const { course, concept } = ctx;
  if (!course || !concept) {
    return emptyState({ title: '课时不存在', description: '可能是链接里的课程或知识点标识不正确。', actionLabel: '返回课程库', onAction: () => ctx.actions.navigate('explore') });
  }
  const states = conceptStateMap(ctx.state, course);
  const state = states[concept.id]?.state || CONCEPT_STATES.available;
  const lessonState = ctx.state.courses?.[course.id]?.lessons?.[concept.id];
  const bookmarked = (ctx.state.courses?.[course.id]?.bookmarks || []).includes(concept.id);
  const quiz = course.quizzes?.[concept.quizId];
  const ordered = course.concepts;
  const index = ordered.findIndex((c) => c.id === concept.id);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const customVideos = (ctx.state.courses?.[course.id]?.customVideos || []).filter((v) => (v.knowledgePoints || []).includes(concept.id));
  const videos = [...(concept.videoIds || []).map((id) => videoById(id) || (ctx.state.courses?.[course.id]?.customVideos || []).find((v) => v.id === id)).filter(Boolean), ...customVideos];
  const progress = courseProgress(ctx.state, course);

  return h('div', { class: `view view-lesson accent-${course.accent || 'indigo'}` },
    h('nav', { class: 'breadcrumb', attrs: { 'aria-label': '面包屑' } },
      h('a', { class: 'link', attrs: { href: buildRoute('explore') }, text: '课程库' }),
      h('span', { text: ' / ' }),
      h('a', { class: 'link', attrs: { href: buildRoute('course', { courseId: course.id }) }, text: course.title }),
      h('span', { text: ' / ' }),
      h('span', { text: concept.title })
    ),

    h('header', { class: 'lesson-head card' },
      h('div', { class: 'lesson-head-main' },
        h('div', { class: 'lesson-badges' },
          badge(typeLabel(concept.type), 'soft'),
          badge(STATE_LABELS[state], state === CONCEPT_STATES.mastered ? 'ok' : state === CONCEPT_STATES.locked ? 'muted' : 'warn'),
          badge(`难度 ${'★'.repeat(Number(concept.difficulty) || 1)}`, 'soft'),
          badge(formatMinutes(concept.estimatedMinutes), 'soft')
        ),
        h('h1', { text: concept.title }),
        h('p', { class: 'hero-sub', text: concept.summary }),
        state === CONCEPT_STATES.locked
          ? h('p', { class: 'warning', text: `这节课的前置还未完成：${(states[concept.id]?.blockedBy || []).join('、')}。仍可以先阅读，但建议按路线图顺序学习。` })
          : null
      ),
      h('aside', { class: 'lesson-head-side' },
        progressBar(progress.percent, { label: `本课进度：${progress.mastered}/${progress.total}` }),
        h('div', { class: 'lesson-actions' },
          lessonState?.status === 'completed'
            ? h('button', { class: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: () => ctx.actions.uncompleteLesson(course.id, concept.id) }, text: '标记为未完成' })
            : h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: () => ctx.actions.completeLesson(course.id, concept.id, concept.estimatedMinutes) }, text: '标记本课已完成' }),
          h('button', { class: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: () => ctx.actions.toggleBookmark(course.id, concept.id) }, text: bookmarked ? '已收藏 ★' : '收藏本课 ☆' }),
          h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('slides', { courseId: course.id, conceptId: concept.id }) }, text: '以课件模式打开' })
        ),
        lessonState?.completedAt ? h('p', { class: 'muted small', text: `上次完成：${formatRelative(lessonState.completedAt)}` }) : null
      )
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '学完这节课你应该能' }),
      h('ul', { class: 'objectives' }, concept.objectives.map((o) => h('li', { text: o })))
    ),

    videos.length
      ? h('section', { class: 'panel' },
          h('h2', { text: '配套视频' }),
          h('p', { class: 'muted', text: '视频默认不加载，点击按钮后才会请求第三方播放器；播放器不可用时请使用来源页链接。' }),
          h('div', { class: 'video-grid' }, videos.map((video) => videoCard(video, ctx, { fromConceptId: concept.id })))
        )
      : null,

    h('section', { class: 'panel lesson-body' },
      (concept.lesson?.sections || []).map((section) =>
        h('article', { class: 'lesson-section' },
          h('h2', { text: section.heading }),
          (section.body || []).map((p) => h('p', { text: p })),
          (section.points || []).length
            ? h('ul', { class: 'points' }, section.points.map((p) => h('li', { text: p })))
            : null
        )),
      (concept.lesson?.takeaways || []).length
        ? h('aside', { class: 'callout callout-key' }, h('h3', { text: '关键结论' }), h('ul', {}, concept.lesson.takeaways.map((t) => h('li', { text: t }))))
        : null,
      (concept.lesson?.pitfalls || []).length
        ? h('aside', { class: 'callout callout-warn' }, h('h3', { text: '常见误解' }), h('ul', {}, concept.lesson.pitfalls.map((t) => h('li', { text: t }))))
        : null
    ),

    (concept.keyTerms || []).length
      ? h('section', { class: 'panel' },
          h('h2', { text: '术语表' }),
          h('dl', { class: 'terms' }, concept.keyTerms.flatMap((term) => [h('dt', { text: term.term }), h('dd', { text: term.definition })]))
        )
      : null,

    (concept.exercises || []).length
      ? h('section', { class: 'panel' },
          h('h2', { text: '动手练习' }),
          h('ol', { class: 'exercises' }, concept.exercises.map((ex) =>
            h('li', {}, h('p', { text: ex.prompt }), h('p', { class: 'hint', text: `提示：${ex.hint}` }))))
        )
      : null,

    taskChecklist(concept, lessonState, ctx, { courseId: course.id }),
    projectPanel(concept),

    quiz ? h('section', { class: 'panel' }, quizWidget(quiz, ctx, { conceptId: concept.id, courseId: course.id })) : null,

    h('section', { class: 'panel' }, notesPanel(ctx, course, concept)),
    aiPanel(ctx, course, concept),

    h('nav', { class: 'lesson-nav', attrs: { 'aria-label': '课时导航' } },
      prev
        ? h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: prev.id }) }, text: `← 上一课：${prev.title}` })
        : h('span', {}),
      next
        ? h('a', { class: 'btn btn-primary', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: next.id }) }, text: `下一课：${next.title} →` })
        : h('a', { class: 'btn btn-primary', attrs: { href: buildRoute('course', { courseId: course.id }) }, text: '回到课程总览' })
    )
  );
}

function notesPanel(ctx, course, concept) {
  const notes = (ctx.state.courses?.[course.id]?.notes?.[concept.id]) || [];
  const input = h('textarea', { class: 'text-input', attrs: { rows: '3', placeholder: '写点自己的理解、疑问或例子（只保存在本机）' } });
  return h('div', { class: 'notes-panel' },
    h('h2', { text: '我的笔记' }),
    h('form', { on: { submit: (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      ctx.actions.addNote(course.id, concept.id, value);
      input.value = '';
    } } },
      input,
      h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', attrs: { type: 'submit' }, text: '保存笔记' }))
    ),
    notes.length === 0
      ? h('p', { class: 'muted small', text: '还没有笔记。' })
      : h('ul', { class: 'note-list' }, notes.map((note) =>
          h('li', {},
            h('p', { text: note.text }),
            h('div', { class: 'note-foot' },
              h('span', { class: 'muted small', text: formatRelative(note.at) }),
              h('button', { class: 'btn btn-ghost danger small', attrs: { type: 'button' }, on: { click: () => ctx.actions.removeNote(course.id, concept.id, note.id) }, text: '删除' })
            ))))
  );
}

function aiPanel(ctx, course, concept) {
  const ai = ctx.state.ai || {};
  const check = validateEndpoint(ai.endpoint);
  const worker = normalizeWorkerUrl(ai.workerUrl || '');
  const hasKey = Boolean(ctx.secrets?.read?.());
  const box = h('div', { class: 'ai-output', attrs: { 'aria-live': 'polite' } });
  const proxyMode = worker.ok;

  if (!proxyMode && (!ai.enabled || !check.ok)) {
    return h('section', { class: 'panel ai-panel' },
      h('h2', { text: 'AI 讲解（可选，未启用）' }),
      h('p', { class: 'muted', text: check.ok ? '你已经在设置里填写了接口地址，但功能尚未启用。' : `尚未配置可用的 AI 接口：${check.reason || '未启用'}` }),
      h('p', { class: 'muted small', text: '这个网站不内置任何 AI 服务、也不伪造 AI 回答。没有接口时，课程、视频、测验与进度功能全部正常可用。' }),
      h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('settings') }, text: '去设置 AI 接口' })
    );
  }

  return h('section', { class: 'panel ai-panel' },
    h('h2', { text: 'AI 讲解（可选）' }),
    h('p', { class: 'muted small', text: proxyMode
      ? `代理模式：${worker.base} · 供应商密钥保存在 Cloudflare Worker 机密中，浏览器不会拿到。`
      : `直连模式（次级）：${ai.endpoint}${ai.model ? ` · 模型：${ai.model}` : ''} · 密钥：${hasKey ? '已填入当前会话' : '未填写（若接口需要鉴权请到设置中填写）'}` }),
    h('p', { class: 'muted small', text: AI_DISCLAIMER }),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: async () => {
        box.replaceChildren(h('p', { class: 'muted', text: '生成中…' }));
        const result = await ctx.actions.requestAiExplanation(course, concept);
        box.replaceChildren(result.ok
          ? h('div', {}, h('p', { class: 'ai-text', text: result.text }), h('p', { class: 'muted small', text: `模型：${result.model || ai.model || '未标注'} · 内容由 AI 生成，请自行核对。` }))
          : h('p', { class: 'bad', text: `生成失败：${result.error}` }));
      } }, text: '为这节课生成讲解' }),
      h('span', { class: 'muted small', text: '会把你所选知识点的标题与摘要发送到上面的接口。' })
    ),
    box
  );
}
