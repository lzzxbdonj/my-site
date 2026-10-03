import { h } from '../dom.js';
import { courseCard, emptyState, badge } from '../components.js';
import { filterCourses, listSubjects, searchConcepts } from '../../core/catalog.js';
import { courseProgress, conceptStateMap } from '../../core/progress.js';
import { buildRoute } from '../../core/router.js';
import { CONCEPT_STATES, STATE_LABELS } from '../../core/graph.js';

export function exploreView(ctx) {
  const { state, query = '', subjectId = 'all' } = ctx;
  const subjects = listSubjects();
  const results = filterCourses({ subjectId, query });
  const conceptHits = query ? searchConcepts(query, { limit: 12 }) : [];

  const searchInput = h('input', {
    class: 'text-input search-input',
    attrs: { type: 'search', placeholder: '搜索课程、知识点、关键词，例如「特征值」「函数」', value: query, 'aria-label': '搜索课程与知识点', 'data-focus-key': 'explore-search' },
    on: { input: (event) => ctx.actions.setSearch(event.target.value) },
  });

  return h('div', { class: 'view view-explore' },
    h('header', { class: 'view-head' },
      h('h1', { text: '课程库' }),
      h('p', { class: 'muted', text: '三门结构完整的课程，每门都由概念课、随堂测验、实战任务与实验室项目组成。课程内容原创撰写，教学视频来自公开的权威渠道。' })
    ),
    h('div', { class: 'toolbar' },
      searchInput,
      h('div', { class: 'chip-row' },
        h('button', { class: `chip ${subjectId === 'all' ? 'is-active' : ''}`, attrs: { type: 'button' }, on: { click: () => ctx.actions.setSubject('all') }, text: `全部（${ctx.courses.length}）` }),
        subjects.map((subject) =>
          h('button', {
            class: `chip ${subjectId === subject.id ? 'is-active' : ''}`,
            attrs: { type: 'button' },
            on: { click: () => ctx.actions.setSubject(subject.id) },
            text: `${subject.name}（${subject.courseIds.length}）`,
          }))
      )
    ),
    results.length === 0
      ? emptyState({
          title: '没有匹配的课程',
          description: '试试更短的关键词，或者点击「全部」查看所有课程。',
          actionLabel: '清空搜索',
          onAction: () => { ctx.actions.setSearch(''); ctx.actions.setSubject('all'); },
        })
      : h('div', { class: 'course-grid' }, results.map((course) => courseCard(course, { progress: courseProgress(state, course) }))),

    query
      ? h('section', { class: 'panel' },
          h('h2', { text: `知识点命中（${conceptHits.length}）` }),
          conceptHits.length === 0
            ? h('p', { class: 'muted', text: '没有找到对应知识点，可以尝试更宽泛的词。' })
            : h('ul', { class: 'concept-hits' }, conceptHits.map((hit) => {
                const course = ctx.courses.find((c) => c.id === hit.courseId);
                const concept = course?.concepts.find((c) => c.id === hit.conceptId);
                const stateMap = course ? conceptStateMap(state, course) : {};
                const conceptState = stateMap[hit.conceptId]?.state || CONCEPT_STATES.available;
                return h('li', {},
                  h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: hit.courseId, conceptId: hit.conceptId }) }, text: hit.title }),
                  h('span', { class: 'muted small', text: ` · ${hit.courseTitle} · 约 ${concept?.estimatedMinutes || 40} 分钟` }),
                  badge(STATE_LABELS[conceptState], conceptState === CONCEPT_STATES.mastered ? 'ok' : 'soft')
                );
              }))
        )
      : null
  );
}

