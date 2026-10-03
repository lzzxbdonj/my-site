import { h } from '../dom.js';
import { orbitalMark, statTile, badge, emptyState, progressBar, typeLabel } from '../components.js';
import { buildRoute } from '../../core/router.js';
import { courseProgress, nextConcepts, studyStats, conceptStateMap } from '../../core/progress.js';
import { formatMinutes, percent, formatRelative } from '../../core/format.js';
import { goalLabel, levelLabel } from '../../core/personalize.js';
import { CONCEPT_STATES } from '../../core/graph.js';

export function dashboardView(ctx) {
  const { state, courses } = ctx;
  const stats = studyStats(state, courses);
  const activePlans = courses
    .map((course) => ({ course, plan: state.courses?.[course.id]?.customPlan }))
    .filter((x) => x.plan);

  return h('div', { class: 'view view-dashboard' },
    h('section', { class: 'hero card' },
      h('div', { class: 'hero-mark' }, orbitalMark(72)),
      h('div', { class: 'hero-body' },
        h('p', { class: 'eyebrow', text: '本地优先 · 不需要登录 · 数据只存在这台设备' }),
        h('h1', { text: greet(state) }),
        h('p', { class: 'hero-sub', text: `目标「${goalLabel(state.profile.goal)}」 · 水平「${levelLabel(state.profile.level)}」 · 每周 ${state.profile.weeklyHours} 小时。所有进度保存在浏览器本地，随时可导出备份。` }),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn btn-primary', attrs: { href: continueHref(ctx) }, text: activePlans.length ? '继续我的定制课程' : '从第一课开始' }),
          h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('plan') }, text: '重新定制学习计划' }),
          h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('explore') }, text: '浏览课程库' }),
          h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('slides', { courseId: 'linear-algebra', conceptId: 'la-vectors' }) }, text: '看一份示例课件' })
        )
      )
    ),

    h('section', { class: 'stat-grid' },
      statTile({ label: '连续学习', value: `${stats.streak} 天`, hint: stats.streak > 0 ? '保持住' : '今天开始第一天', tone: 'indigo' }),
      statTile({ label: '本周活跃', value: `${stats.activeThisWeek} 天`, hint: '近 7 天有学习记录的天数' }),
      statTile({ label: '已掌握概念', value: `${stats.masteredTotal}`, hint: '通过随堂测验即视为掌握（无测验的课时以完成为准）', tone: 'teal' }),
      statTile({ label: '累计学习', value: formatMinutes(stats.totalMinutes), hint: '按完成的课时累计' }),
      statTile({ label: '待复习', value: `${stats.reviewQueue.length}`, hint: '完成超过 7 天未再巩固', tone: stats.reviewQueue.length > 0 ? 'amber' : 'default' })
    ),

    h('section', { class: 'panel' },
      h('header', { class: 'panel-head' },
        h('h2', { text: '今天学什么' }),
        h('a', { class: 'link', attrs: { href: buildRoute('plan') }, text: '调整计划 →' })
      ),
      todayList(ctx, activePlans)
    ),

    h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', { text: '课程进度' })),
      h('div', { class: 'course-progress-list' }, courses.map((course) => {
        const progress = courseProgress(state, course);
        return h('article', { class: 'progress-row' },
          h('div', { class: 'progress-row-head' },
            h('a', { class: 'card-link', attrs: { href: buildRoute('course', { courseId: course.id }) }, text: course.title }),
            h('span', { class: 'muted small', text: `${progress.mastered}/${progress.total} 个单元` })
          ),
          progressBar(progress.percent),
          h('p', { class: 'muted small', text: progress.percent === 0 ? '还没有开始，第一课只要 40 分钟。' : `已完成 ${progress.percent}%，累计投入 ${formatMinutes(progress.minutes)}。` })
        );
      }))
    ),

    stats.reviewQueue.length > 0
      ? h('section', { class: 'panel' },
          h('header', { class: 'panel-head' }, h('h2', { text: '复习提醒' }), h('span', { class: 'muted small', text: '完成 7 天后自动进入复习队列' })),
          h('ul', { class: 'review-list' }, stats.reviewQueue.map((item) =>
            h('li', {},
              h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: item.courseId, conceptId: item.conceptId }) }, text: item.conceptTitle }),
              h('span', { class: 'muted small', text: ` · ${item.courseTitle} · 上次完成 ${formatRelative(item.completedAt)}` })
            )))
        )
      : null,

    h('section', { class: 'panel notice' },
      h('h2', { text: '这个网站的边界（如实说明）' }),
      h('ul', {},
        h('li', { text: '所有进度、笔记、计划都存在你自己的浏览器里（localStorage），换浏览器或清理数据就会丢失，请在「我的进度」里定期导出备份。' }),
        h('li', { text: 'AI 建课与 AI 讲解都是可选功能：推荐配置自建代理 Worker（密钥留在 Cloudflare 机密里，浏览器只填 Worker 地址）；也保留仅用于讲解的直连模式（密钥只存在当前会话、不会写入备份）。未配置时全部核心功能照常可用。' }),
        h('li', { text: '教学视频为第三方站点外链，本站不转存视频，也不保证任何时刻都能播放。' })
      )
    )
  );
}

function greet(state) {
  const hour = new Date().getHours();
  const name = state.profile.name ? `${state.profile.name}，` : '';
  const period = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return `${name}${period}`;
}

function continueHref(ctx) {
  for (const course of ctx.courses) {
    const states = conceptStateMap(ctx.state, course);
    const running = course.concepts.find((c) => states[c.id]?.state === CONCEPT_STATES.inProgress);
    if (running) return buildRoute('lesson', { courseId: course.id, conceptId: running.id });
  }
  for (const course of ctx.courses) {
    const next = nextConcepts(ctx.state, course, 1)[0];
    if (next) return buildRoute('lesson', { courseId: course.id, conceptId: next.id });
  }
  return buildRoute('explore');
}

function todayList(ctx, activePlans) {
  const { state } = ctx;
  if (activePlans.length === 0) {
    const suggestions = ctx.courses.flatMap((course) => nextConcepts(state, course, 2).map((c) => ({ course, concept: c })));
    if (suggestions.length === 0) {
      return emptyState({
        title: '还没有学习计划',
        description: '先做一次三步定制，系统会按你的目标和每周时间排出周计划。',
        actionLabel: '开始定制',
        onAction: () => ctx.actions.navigate('plan'),
      });
    }
    return h('div', {},
      h('p', { class: 'muted', text: '还没有定制计划，下面是按依赖顺序推荐的起点：' }),
      h('ul', { class: 'today-list' }, suggestions.slice(0, 4).map(({ course, concept }) =>
        h('li', {},
          h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: concept.id }) }, text: concept.title }),
          h('span', { class: 'muted small', text: ` · ${course.title} · ${typeLabel(concept.type)} · ${formatMinutes(concept.estimatedMinutes)}` })
        ))));
  }
  return h('div', { class: 'plan-list' }, activePlans.map(({ course, plan }) => {
    const states = conceptStateMap(state, course);
    const pending = plan.weeks.flatMap((w) => w.items).filter((item) => states[item.conceptId]?.state !== CONCEPT_STATES.mastered);
    const week = plan.weeks.find((w) => w.items.some((i) => states[i.conceptId]?.state !== CONCEPT_STATES.mastered)) || plan.weeks[0];
    const firstPending = pending[0];
    return h('article', { class: 'plan-card card' },
      h('header', {},
        h('h3', {}, h('a', { class: 'card-link', attrs: { href: buildRoute('course', { courseId: course.id }) }, text: course.title })),
        badge(`${plan.stats.weeks} 周计划`, 'soft')
      ),
      h('p', { text: `第 ${week.index} 周 · ${week.theme}：${week.focus}` }),
      firstPending
        ? h('div', { class: 'plan-actions' },
            h('a', { class: 'btn btn-primary', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: firstPending.conceptId }) }, text: `继续：${firstPending.title}` }),
            h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('course', { courseId: course.id }, { tab: 'plan' }) }, text: '查看完整计划' })
          )
        : h('p', { class: 'muted', text: '这份计划里的单元已经全部完成，可以重新定制或到课程地图里解锁进阶内容。' }),
      h('p', { class: 'muted small', text: `剩余 ${pending.length} 个单元 · 计划生成于 ${formatRelative(plan.generatedAt)}` })
    );
  }));
}



