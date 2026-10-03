import { h } from '../dom.js';
import { badge, emptyState, progressBar, roadmap, typeLabel, videoCard } from '../components.js';
import { courseProgress, conceptStateMap, nextConcepts } from '../../core/progress.js';
import { CONCEPT_STATES, STATE_LABELS } from '../../core/graph.js';
import { buildRoute } from '../../core/router.js';
import { resolveCourseVideos } from '../../core/catalog.js';
import { formatMinutes, formatRelative } from '../../core/format.js';
import { goalLabel, levelLabel } from '../../core/personalize.js';

const TABS = [
  { id: 'map', label: '课程地图' },
  { id: 'lessons', label: '课时列表' },
  { id: 'videos', label: '配套视频' },
  { id: 'plan', label: '我的计划' },
  { id: 'notes', label: '笔记与收藏' },
];

export function courseView(ctx) {
  const course = ctx.course;
  if (!course) return emptyState({ title: '课程不存在', description: '链接可能已失效。', actionLabel: '返回课程库', onAction: () => ctx.actions.navigate('explore') });
  const tab = TABS.some((t) => t.id === ctx.route.query.tab) ? ctx.route.query.tab : 'map';
  const progress = courseProgress(ctx.state, course);
  const states = conceptStateMap(ctx.state, course);
  const next = nextConcepts(ctx.state, course, 1)[0];

  return h('div', { class: `view view-course accent-${course.accent || 'indigo'}` },
    h('nav', { class: 'breadcrumb', attrs: { 'aria-label': '面包屑' } },
      h('a', { class: 'link', attrs: { href: buildRoute('explore') }, text: '课程库' }),
      h('span', { text: ' / ' }),
      h('span', { text: course.title })
    ),
    h('header', { class: 'course-head card' },
      h('div', { class: 'course-head-main' },
        h('h1', { text: course.title }),
        h('p', { class: 'hero-sub', text: course.subtitle }),
        h('p', { text: course.summary }),
        h('div', { class: 'tag-row' }, course.tags.map((t) => h('span', { class: 'tag', text: t }))),
        h('ul', { class: 'meta-list' },
          h('li', { text: `难度定位：${course.level}` }),
          h('li', { text: `预计投入：约 ${course.estimatedHours} 小时` }),
          h('li', { text: `学习单元：${course.concepts.length} 个（含实战与实验室）` }),
          h('li', { text: `配套视频：${resolveCourseVideos(course, ctx.state).length} 条` })
        )
      ),
      h('aside', { class: 'course-head-side' },
        h('h2', { text: '学习成果' }),
        h('ul', {}, course.outcomes.map((o) => h('li', { text: o }))),
        progressBar(progress.percent, { label: `${progress.mastered}/${progress.total} 已掌握` }),
        next
          ? h('a', { class: 'btn btn-primary', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: next.id }) }, text: `继续：${next.title}` })
          : h('p', { class: 'muted', text: '这门课的所有单元都已完成，去课程地图解锁进阶内容吧。' })
      )
    ),

    h('nav', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': '课程内容切换' } }, TABS.map((t) =>
      h('a', {
        class: t.id === tab ? 'tab is-active' : 'tab',
        attrs: { href: buildRoute('course', { courseId: course.id }, { tab: t.id }), role: 'tab', 'aria-selected': t.id === tab ? 'true' : 'false' },
        text: t.label,
      }))),

    tab === 'map'
      ? h('section', { class: 'panel' },
          h('h2', { text: '依赖路线图' }),
          h('p', { class: 'muted', text: '每一层都可以从左到右并行学习；下一层需要上一层的全部前置完成。颜色表示当前状态。' }),
          roadmap(course, states, { onSelect: (conceptId) => ctx.actions.navigate('lesson', { courseId: course.id, conceptId }) })
        )
      : null,

    tab === 'lessons'
      ? h('section', { class: 'panel' },
          h('h2', { text: '课时列表' }),
          h('ol', { class: 'lesson-list' }, course.concepts.map((concept) => {
            const state = states[concept.id]?.state || CONCEPT_STATES.available;
            const attempts = (ctx.state.courses?.[course.id]?.quizAttempts || []).filter((a) => a.quizId === concept.quizId);
            const passed = attempts.some((a) => a.passed);
            return h('li', { class: `lesson-row state-${state}` },
              h('div', { class: 'lesson-row-main' },
                h('a', { class: 'card-link', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: concept.id }) }, text: concept.title }),
                h('p', { class: 'muted small', text: concept.summary })
              ),
              h('div', { class: 'lesson-row-side' },
                badge(typeLabel(concept.type), 'soft'),
                badge(STATE_LABELS[state], state === CONCEPT_STATES.mastered ? 'ok' : state === CONCEPT_STATES.locked ? 'muted' : 'warn'),
                h('span', { class: 'muted small', text: `${formatMinutes(concept.estimatedMinutes)}` }),
                concept.quizId ? h('span', { class: 'muted small', text: passed ? `测验已通过（最佳 ${bestScore(attempts)}）` : attempts.length ? `测验未通过（尝试 ${attempts.length} 次）` : '未测验' }) : null,
                h('a', { class: 'link small', attrs: { href: buildRoute('slides', { courseId: course.id, conceptId: concept.id }) }, text: '课件模式' })
              )
            );
          }))
        )
      : null,

    tab === 'videos'
      ? h('section', { class: 'panel' },
          h('h2', { text: '配套视频' }),
          h('p', { class: 'muted', text: '视频为第三方外链，默认不自动加载播放器；点击后才请求。所有条目都标注来源与入选理由。' }),
          h('div', { class: 'video-grid' }, resolveCourseVideos(course, ctx.state).map((video) => videoCard(video, ctx)))
        )
      : null,

    tab === 'plan'
      ? planTab(ctx, course, states)
      : null,

    tab === 'notes'
      ? notesTab(ctx, course)
      : null
  );
}

function bestScore(attempts) {
  const best = attempts.reduce((acc, a) => (acc === null || a.score / Math.max(1, a.total) > acc.score / Math.max(1, a.total) ? a : acc), null);
  return best ? `${best.score}/${best.total}` : '—';
}

function planTab(ctx, course, states) {
  const plan = ctx.state.courses?.[course.id]?.customPlan;
  if (!plan) {
    return emptyState({
      title: '还没有为这门课定制计划',
      description: '三步定制会按你的目标、水平和每周时间排出周计划。',
      actionLabel: '去定制',
      onAction: () => ctx.actions.navigate('plan', {}, { course: course.id }),
    });
  }
  const items = plan.weeks.flatMap((w) => w.items);
  const done = items.filter((i) => states[i.conceptId]?.state === CONCEPT_STATES.mastered).length;
  return h('section', { class: 'panel' },
    h('header', { class: 'panel-head' },
      h('h2', { text: '我的学习计划' }),
      badge(`${done}/${items.length} 已完成`, done === items.length ? 'ok' : 'soft')
    ),
    h('p', { class: 'muted', text: `目标「${goalLabel(plan.prefs.goal)}」 · 水平「${levelLabel(plan.prefs.level)}」 · 每周 ${plan.prefs.weeklyHours} 小时 · 生成于 ${formatRelative(plan.generatedAt)}` }),
    h('ul', { class: 'rationale' }, plan.rationale.map((line) => h('li', { text: line }))),
    h('div', { class: 'weeks' }, plan.weeks.map((week) =>
      h('article', { class: 'week card' },
        h('header', {}, h('h3', { text: `第 ${week.index} 周 · ${week.theme}` }), h('span', { class: 'muted small', text: formatMinutes(week.minutes) })),
        h('ol', { class: 'week-items' }, week.items.map((item) => {
          const state = states[item.conceptId]?.state || CONCEPT_STATES.available;
          return h('li', { class: `state-${state}` },
            h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: item.conceptId }) }, text: item.title }),
            h('span', { class: 'muted small', text: ` · ${typeLabel(item.type)} · ${formatMinutes(item.minutes)} · ${STATE_LABELS[state]}` })
          );
        }))
      ))),
    h('div', { class: 'panel-actions' },
      h('button', { class: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: () => ctx.actions.navigate('plan', {}, { course: course.id }) }, text: '重新定制' }),
      h('button', { class: 'btn btn-ghost danger', attrs: { type: 'button' }, on: { click: () => ctx.actions.clearPlan(course.id) }, text: '删除这份计划' })
    ),
    plan.skipped.length
      ? h('div', { class: 'skipped' }, h('h3', { text: '按当前目标跳过（仍可单独学习）' }), h('ul', {}, plan.skipped.map((s) => h('li', { text: `${s.title} — ${s.reason}` }))))
      : null
  );
}

function notesTab(ctx, course) {
  const entry = ctx.state.courses?.[course.id] || {};
  const notes = Object.entries(entry.notes || {});
  const bookmarks = entry.bookmarks || [];
  return h('section', { class: 'panel' },
    h('h2', { text: '笔记' }),
    notes.length === 0
      ? h('p', { class: 'muted', text: '还没有笔记。在任意课时页底部可以随手记录，笔记只存在本机。' })
      : h('ul', { class: 'note-list' }, notes.flatMap(([conceptId, list]) => list.map((note) => {
          const concept = course.concepts.find((c) => c.id === conceptId);
          return h('li', {},
            h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId }) }, text: concept?.title || conceptId }),
            h('p', { text: note.text }),
            h('span', { class: 'muted small', text: formatRelative(note.at) })
          );
        }))),
    h('h2', { text: '收藏' }),
    bookmarks.length === 0
      ? h('p', { class: 'muted', text: '还没有收藏。课时页右上角的「收藏本课」会把内容加入这里。' })
      : h('ul', { class: 'bookmark-list' }, bookmarks.map((id) => {
          const concept = course.concepts.find((c) => c.id === id);
          return h('li', {}, concept
            ? h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: id }) }, text: concept.title })
            : h('span', { text: id }));
        }))
  );
}
