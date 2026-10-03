import { h } from '../dom.js';
import { badge, emptyState, typeLabel } from '../components.js';
import { GOALS, LEVELS, buildCustomCourse, defaultPreferences, goalLabel, levelLabel } from '../../core/personalize.js';
import { formatMinutes } from '../../core/format.js';
import { buildRoute } from '../../core/router.js';
import { getCourse } from '../../core/catalog.js';

const STEPS = [
  { id: 1, title: '学习目标', hint: '决定内容取舍与优先级' },
  { id: 2, title: '当前水平', hint: '决定从哪一层开始' },
  { id: 3, title: '时间投入', hint: '决定每周排多少内容' },
  { id: 4, title: '确认与保存', hint: '生成周计划并加入课程' },
];

export function planView(ctx) {
  const draft = ctx.draft || {};
  const step = Math.min(4, Math.max(1, Number(draft.step) || 1));
  const prefs = { ...defaultPreferences(), ...(draft.prefs || {}) };
  const courseId = draft.courseId || ctx.route.query.course || ctx.courses[0].id;
  const course = getCourse(courseId) || ctx.courses[0];
  const plan = buildCustomCourse(course, prefs);

  return h('div', { class: 'view view-plan' },
    h('header', { class: 'view-head' },
      h('h1', { text: '定制学习计划' }),
      h('p', { class: 'muted', text: '四步生成一份按依赖顺序排列的周计划。所有判断都在本地完成，不上传任何信息。' })
    ),
    h('ol', { class: 'wizard-steps' }, STEPS.map((s) =>
      h('li', { class: s.id === step ? 'step is-active' : s.id < step ? 'step is-done' : 'step' },
        h('span', { class: 'step-index', text: String(s.id) }),
        h('span', { class: 'step-title', text: s.title }),
        h('span', { class: 'step-hint', text: s.hint })
      ))),

    h('section', { class: 'panel wizard-panel' },
      h('div', { class: 'wizard-fields' },
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: '要定制哪门课' }),
          h('select', { class: 'text-input', attrs: { 'data-focus-key': 'plan-course' }, on: { change: (e) => ctx.actions.setDraft({ courseId: e.target.value }) } },
            ctx.courses.map((c) => h('option', { attrs: { value: c.id, selected: c.id === course.id ? 'selected' : null }, text: c.title })))
        ),
        step === 1 ? choiceField('目标', GOALS, prefs.goal, (v) => ctx.actions.setDraft({ prefs: { ...prefs, goal: v } })) : null,
        step === 2 ? choiceField('水平', LEVELS, prefs.level, (v) => ctx.actions.setDraft({ prefs: { ...prefs, level: v } })) : null,
        step === 3 ? h('div', { class: 'field-group' },
          numberField('每周可投入小时', prefs.weeklyHours, 1, 20, (v) => ctx.actions.setDraft({ prefs: { ...prefs, weeklyHours: v } }), '小时'),
          numberField('单次专注时长', prefs.lessonMinutes, 15, 120, (v) => ctx.actions.setDraft({ prefs: { ...prefs, lessonMinutes: v } }), '分钟'),
          h('p', { class: 'muted small', text: '每周排课量按投入时间的 90% 计算，留出复习与补课的余量。' })
        ) : null,
        step === 4 ? h('div', { class: 'field-group' },
          h('p', { text: `将生成：${plan.stats.weeks} 周 · ${plan.stats.concepts} 个学习单元 · 约 ${plan.stats.hours} 小时 · ${plan.stats.videos} 个配套视频 · ${plan.stats.quizzes} 次测验。` }),
          h('p', { class: 'muted small', text: `目标「${goalLabel(prefs.goal)}」 · 水平「${levelLabel(prefs.level)}」 · 每周 ${prefs.weeklyHours} 小时 · 单次 ${prefs.lessonMinutes} 分钟` })
        ) : null
      ),
      h('div', { class: 'wizard-actions' },
        h('button', { class: 'btn btn-ghost', attrs: { type: 'button', disabled: step === 1 ? 'disabled' : null }, on: { click: () => ctx.actions.setDraft({ step: step - 1 }) }, text: '上一步' }),
        step < 4
          ? h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: () => ctx.actions.setDraft({ step: step + 1 }) }, text: '下一步' })
          : h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: () => ctx.actions.savePlan(course.id, plan) }, text: '保存为我的课程计划' })
      )
    ),

    h('section', { class: 'panel' },
      h('header', { class: 'panel-head' },
        h('h2', { text: `${course.title} · 计划预览` }),
        badge(`${plan.stats.weeks} 周`, 'soft')
      ),
      h('ul', { class: 'rationale' }, plan.rationale.map((line) => h('li', { text: line }))),
      h('div', { class: 'weeks' }, plan.weeks.map((week) =>
        h('article', { class: 'week card' },
          h('header', {},
            h('h3', { text: `第 ${week.index} 周 · ${week.theme}` }),
            h('span', { class: 'muted small', text: `${formatMinutes(week.minutes)} · 预算内` })
          ),
          h('p', { class: 'week-focus', text: week.focus }),
          h('ol', { class: 'week-items' }, week.items.map((item) =>
            h('li', {},
              h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: item.conceptId }) }, text: item.title }),
              h('span', { class: 'muted small', text: ` · ${typeLabel(item.type)} · ${formatMinutes(item.minutes)}` }),
              item.tags.length ? h('span', { class: 'tag-row inline' }, item.tags.map((t) => h('span', { class: 'tag', text: t }))) : null
            )))
        ))),
      plan.skipped.length
        ? h('div', { class: 'skipped' },
            h('h3', { text: `按当前目标跳过 ${plan.skipped.length} 个主题（仍可单独学习）` }),
            h('ul', {}, plan.skipped.map((s) =>
              h('li', {},
                h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: s.id }) }, text: s.title }),
                h('span', { class: 'muted small', text: ` — ${s.reason}` })
              )))
          )
        : null
    ),
    plan.weeks.length === 0
      ? emptyState({ title: '当前条件没有可安排的单元', description: '请回到第 2 步调整水平，或提高每周投入时间。' })
      : null
  );
}

function choiceField(label, options, value, onChange) {
  return h('div', { class: 'field-group' },
    h('span', { class: 'field-label', text: label }),
    h('div', { class: 'choice-row' }, options.map((option) =>
      h('button', {
        class: `choice ${option.id === value ? 'is-active' : ''}`,
        attrs: { type: 'button', 'aria-pressed': option.id === value ? 'true' : 'false' },
        on: { click: () => onChange(option.id) },
      },
        h('strong', { text: option.label }),
        h('span', { class: 'choice-hint', text: option.hint })
      )))
  );
}

function numberField(label, value, min, max, onChange, unit) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label', text: `${label}（${value} ${unit}）` }),
    h('input', {
      class: 'range',
      attrs: { type: 'range', min: String(min), max: String(max), step: '1', value: String(value), 'aria-label': label, 'data-focus-key': 'plan-' + label },
      on: { input: (event) => onChange(Number(event.target.value)) },
    })
  );
}

