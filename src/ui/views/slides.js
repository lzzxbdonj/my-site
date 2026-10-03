import { h } from '../dom.js';
import { badge, emptyState, progressBar } from '../components.js';
import { buildDeck, DECK_PRINT_NOTE } from '../../core/slides.js';
import { buildRoute } from '../../core/router.js';
import { conceptStateMap, isConceptMastered } from '../../core/progress.js';
import { CONCEPT_STATES, STATE_LABELS } from '../../core/graph.js';

/**
 * 课件模式：16:9 放映式课时页。
 * 键盘：← → 翻页、Home/End 首尾、Esc 返回课时页；打印时每页独占一张纸。
 */
export function slidesView(ctx) {
  const { course, concept } = ctx;
  const deck = buildDeck(course, concept, { state: ctx.state });
  if (!course || !concept || deck.slides.length === 0) {
    return emptyState({ title: '课件不可用', description: '该课时缺少可放映的内容。', actionLabel: '返回课程库', onAction: () => ctx.actions.navigate('explore') });
  }
  const states = conceptStateMap(ctx.state, course);
  const state = states[concept.id]?.state || CONCEPT_STATES.available;
  const current = Math.min(deck.slides.length, Math.max(1, Number(ctx.route.query.i) || Number(ctx.slideIndex) || 1));

  const stage = h('div', {
    class: 'deck',
    dataset: { 'print': 'all', 'slideCount': String(deck.slides.length), 'current': String(current), 'source': deck.source },
    attrs: { role: 'group', 'aria-label': `${course.title} · ${concept.title} 课件` },
  }, deck.slides.map((slide, index) => renderSlide(slide, index + 1 === current)));

  const index = h('ol', { class: 'deck-index', attrs: { 'aria-label': '课件页索引' } }, deck.slides.map((slide, i) =>
    h('li', {},
      h('a', {
        class: i + 1 === current ? 'deck-dot is-active' : 'deck-dot',
        attrs: { href: buildRoute('slides', { courseId: course.id, conceptId: concept.id }, { i: i + 1 }), 'aria-current': i + 1 === current ? 'true' : 'false', title: slide.title },
        text: String(i + 1),
      }))));

  return h('div', { class: `view view-slides accent-${course.accent || 'indigo'}` },
    h('nav', { class: 'breadcrumb', attrs: { 'aria-label': '面包屑' } },
      h('a', { class: 'link', attrs: { href: buildRoute('course', { courseId: course.id }) }, text: course.title }),
      h('span', { text: ' / ' }),
      h('a', { class: 'link', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: concept.id }) }, text: concept.title }),
      h('span', { text: ' / 课件模式' })
    ),

    h('header', { class: 'deck-toolbar' },
      h('div', { class: 'deck-toolbar-main' },
        h('span', { class: 'deck-kicker', text: deck.source === 'ai' ? 'COURSEWARE · 课件模式 · AI 生成' : 'COURSEWARE · 课件模式' }),
        h('h1', { text: concept.title }),
        h('p', { class: 'muted small', text: `${course.title} · 第 ${deck.slides.length} 页 · ${STATE_LABELS[state]}${isConceptMastered(ctx.state, course, concept.id) ? ' · 已通过测验' : ''}` })
      ),
      h('div', { class: 'deck-toolbar-side' },
        h('button', { class: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: () => ctx.actions.setSlideIndex(current - 1, deck.slides.length) }, text: '← 上一页' }),
        h('span', { class: 'deck-folio', text: deck.slides[current - 1].folio }),
        h('button', { class: 'btn btn-ghost', attrs: { type: 'button' }, on: { click: () => ctx.actions.setSlideIndex(current + 1, deck.slides.length) }, text: '下一页 →' }),
        h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: () => window.print() }, text: '打印 / 另存 PDF' }),
        h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('lesson', { courseId: course.id, conceptId: concept.id }) }, text: '退出课件模式' })
      )
    ),

    index,
    stage,
    h('p', { class: 'deck-hint muted small' },
      h('span', { text: '键盘：← → 翻页 · Home/End 首尾 · Esc 返回课时页。' }),
      h('span', { text: ` ${DECK_PRINT_NOTE}` })
    ),
    h('p', { class: 'deck-hint muted small', text: '移动端会自动切换为「纵向阅读」：所有页面按顺序堆叠，正文保持可读字号，不需要横向滚动。' })
  );
}

function renderSlide(slide, isActive) {
  return h('section', {
    class: isActive ? 'deck-slide is-active' : 'deck-slide',
    dataset: { slide: String(slide.index), kind: slide.kind },
    attrs: { 'aria-hidden': isActive ? 'false' : 'true', 'aria-label': `第 ${slide.index} 页：${slide.title}` },
  },
    h('div', { class: 'deck-slide-inner' },
      h('header', { class: 'deck-slide-head' },
        h('span', { class: 'deck-kicker', text: slide.kicker }),
        slide.bigNumber ? h('span', { class: 'deck-bignum', attrs: { 'aria-hidden': 'true' }, text: slide.bigNumber }) : null
      ),
      h('h2', { class: 'deck-title', text: slide.title }),
      slide.subtitle ? h('p', { class: 'deck-subtitle', text: slide.subtitle }) : null,
      h('div', { class: 'deck-blocks' }, slide.blocks.map(renderBlock)),
      h('footer', { class: 'deck-slide-foot' },
        h('span', { class: 'deck-folio', text: slide.folio }),
        slide.meta ? h('span', { class: 'deck-meta', text: slide.meta.join(' · ') }) : null
      )
    ),
    h('span', { class: 'deck-rule', attrs: { 'aria-hidden': 'true' } })
  );
}

function renderBlock(block) {
  switch (block.type) {
    case 'paragraph':
      return h('p', { class: 'deck-text', text: block.text });
    case 'paragraphs':
      return h('div', { class: 'deck-paragraphs' }, block.items.map((item) => h('p', { class: 'deck-text', text: item })));
    case 'points':
      return h('div', { class: 'deck-points' },
        block.label ? h('h3', { class: 'deck-label', text: block.label }) : null,
        h('ul', {}, block.items.map((item) => h('li', { text: item }))));
    case 'terms':
      return h('dl', { class: 'deck-terms' }, block.items.flatMap((term) => [h('dt', { text: term.term }), h('dd', { text: term.definition })]));
    case 'example':
      return h('div', { class: 'deck-example' },
        h('p', { class: 'deck-label', text: '题目' }),
        h('p', { class: 'deck-text', text: block.prompt }),
        h('p', { class: 'deck-label', text: '提示' }),
        h('p', { class: 'deck-text muted', text: block.hint }));
    case 'tasks':
      return h('ol', { class: 'deck-tasks' }, block.items.map((task) =>
        h('li', {},
          h('strong', { text: task.title }),
          h('span', { class: 'deck-task-detail', text: ` — ${task.detail}` }),
          task.acceptance ? h('span', { class: 'deck-task-acceptance', text: ` 验收：${task.acceptance}` }) : null)));
    case 'videos':
      return h('ul', { class: 'deck-videos' }, block.items.map((video) =>
        h('li', {},
          h('a', { class: 'card-link', attrs: { href: video.url, target: '_blank', rel: 'noopener noreferrer' }, text: video.title }),
          h('span', { class: 'muted small', text: ` · ${video.creator}${video.duration ? ` · ${Math.floor(video.duration / 60)} 分钟` : ''}` }),
          badge(video.verified ? '来源已验证 · 官方认证账号' : '来源已核实', video.verified ? 'ok' : 'warn'),
          h('p', { class: 'muted small', text: video.reason }))));
    default:
      return null;
  }
}
