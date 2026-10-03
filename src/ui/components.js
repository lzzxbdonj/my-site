/** 视觉组件：全部用原生 DOM 构建，无框架、无运行时依赖。 */

import { h } from './dom.js';
import { formatDuration, formatMinutes } from '../core/format.js';
import { roadmapLevels, CONCEPT_STATES, STATE_LABELS } from '../core/graph.js';
import { gradeQuiz, questionTypeLabel } from '../core/quiz.js';
import { resolveVideoPlayback, verificationBadge } from '../core/video.js';
import { safeHttpUrl } from '../core/storage.js';
import { buildRoute } from '../core/router.js';
import { PRODUCT_MARK_LABEL } from '../core/brand.js';

/**
 * 品牌标记：圆角方块 + 手绘「自」字（Stroke 描边，不用字体，因此任何环境渲染一致）。
 *
 * 为什么改成这样：原来的三个同心椭圆（轨道）在小尺寸下糊成一团，且是最常见的
 * 「抽象几何 + 发光」套路，一眼就像模板。现在改用**品牌首字作为单字徽标**：
 * 在 24–34px 下依然清晰，且与「ai自学通」直接对应。
 */
export function brandMark(size = 40) {
  return h('svg', {
    class: 'brand-mark',
    attrs: { viewBox: '0 0 48 48', width: size, height: size, role: 'img', 'aria-label': PRODUCT_MARK_LABEL },
  },
    h('rect', { attrs: { class: 'bm-tile', x: 0, y: 0, width: 48, height: 48, rx: 13 } }),
    h('g', { class: 'bm-glyph', attrs: { fill: 'none', 'stroke-width': 3.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
      // 「自」= 目 + 顶上一小竖；用四条笔画画出来，不依赖任何字体
      h('path', { attrs: { d: 'M24 10.5v3.2' } }),
      h('path', { attrs: { d: 'M16.8 18.2h14.4v19.6H16.8z' } }),
      h('path', { attrs: { d: 'M16.8 24.7h14.4' } }),
      h('path', { attrs: { d: 'M16.8 31.2h14.4' } })
    )
  );
}

export function badge(label, tone = 'muted') {
  return h('span', { class: `badge badge-${tone}`, text: label });
}

export function progressBar(value, { label = null } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return h('div', { class: 'progress', attrs: { role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 } },
    h('div', { class: 'progress-fill', style: { width: `${pct}%` } }),
    label ? h('span', { class: 'progress-label', text: label }) : null
  );
}

export function statTile({ label, value, hint, tone = 'default' }) {
  return h('div', { class: `stat-tile stat-${tone}` },
    h('span', { class: 'stat-label', text: label }),
    h('strong', { class: 'stat-value', text: value }),
    hint ? h('span', { class: 'stat-hint', text: hint }) : null
  );
}

export function emptyState({ title, description, actionLabel, onAction, secondary }) {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-glyph', attrs: { 'aria-hidden': 'true' } }, brandMark(48)),
    h('h3', { text: title }),
    description ? h('p', { text: description }) : null,
    actionLabel ? h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: onAction }, text: actionLabel }) : null,
    secondary || null
  );
}

export function tagRow(tags = []) {
  return h('div', { class: 'tag-row' }, tags.map((t) => h('span', { class: 'tag', text: t })));
}

export function courseCard(course, { progress }) {
  return h('article', { class: `card course-card accent-${course.accent || 'indigo'}` },
    h('header', { class: 'course-card-head' },
      h('h3', {}, h('a', { class: 'card-link', attrs: { href: buildRoute('course', { courseId: course.id }) }, text: course.title })),
      badge(course.level, 'soft')
    ),
    h('p', { class: 'card-sub', text: course.subtitle }),
    tagRow(course.tags.slice(0, 4)),
    h('div', { class: 'course-meta' },
      h('span', { text: `${course.concepts.length} 个学习单元` }),
      h('span', { text: `约 ${course.estimatedHours} 小时` }),
      h('span', { text: progress ? `已掌握 ${progress.mastered}/${progress.total}` : '' })
    ),
    progressBar(progress?.percent || 0),
    h('div', { class: 'card-actions' },
      h('a', { class: 'btn btn-primary', attrs: { href: buildRoute('course', { courseId: course.id }) }, text: '进入课程' }),
      h('a', { class: 'btn btn-ghost', attrs: { href: buildRoute('plan', {}, { course: course.id }) }, text: '定制学习计划' })
    )
  );
}

const ROADMAP_STATE_TONE = {
  [CONCEPT_STATES.mastered]: 'mastered',
  [CONCEPT_STATES.inProgress]: 'progress',
  [CONCEPT_STATES.available]: 'ready',
  [CONCEPT_STATES.locked]: 'locked',
};

/** 依赖/状态着色的概念路线图（原创绘制）。 */
export function roadmap(course, states, { onSelect }) {
  const levels = roadmapLevels(course.concepts || []);
  return h('div', { class: 'roadmap' },
    h('div', { class: 'roadmap-legend' },
      [CONCEPT_STATES.mastered, CONCEPT_STATES.inProgress, CONCEPT_STATES.available, CONCEPT_STATES.locked].map((state) =>
        h('span', { class: 'legend-item' },
          h('span', { class: `legend-dot tone-${ROADMAP_STATE_TONE[state]}` }),
          h('span', { text: STATE_LABELS[state] })
        ))
    ),
    h('ol', { class: 'roadmap-levels' },
      levels.map((nodes, index) =>
        h('li', { class: 'roadmap-level' },
          h('div', { class: 'level-head' },
            h('span', { class: 'level-index', text: `第 ${index + 1} 层` }),
            h('span', { class: 'level-hint', text: nodes.length > 1 ? '可并行学习' : '顺序学习' })
          ),
          h('div', { class: 'level-nodes' },
            nodes.map((concept) => {
              const state = states[concept.id]?.state || CONCEPT_STATES.available;
              const blocked = states[concept.id]?.blockedBy || [];
              return h('button', {
                class: `roadmap-node tone-${ROADMAP_STATE_TONE[state]}`,
                attrs: { type: 'button', 'aria-label': `${concept.title}，${STATE_LABELS[state]}` },
                dataset: { conceptId: concept.id },
                on: { click: () => onSelect(concept.id) },
              },
                h('span', { class: 'node-title', text: concept.title }),
                h('span', { class: 'node-meta', text: `${typeLabel(concept.type)} · ${formatMinutes(concept.estimatedMinutes)}` }),
                state === CONCEPT_STATES.locked
                  ? h('span', { class: 'node-blocked', text: `需先完成：${blocked.map((id) => conceptTitle(course, id)).join('、')}` })
                  : null
              );
            })
          ),
          index < levels.length - 1 ? h('div', { class: 'level-connector', attrs: { 'aria-hidden': 'true' } }) : null
        ))
    )
  );
}

export function typeLabel(type) {
  return type === 'practical' ? '实战' : type === 'lab' ? '实验室' : '概念课';
}

function conceptTitle(course, id) {
  return (course.concepts || []).find((c) => c.id === id)?.title || id;
}

/**
 * 视频卡片。
 * 约束：
 *  - 默认不请求任何第三方资源；只有用户点击「加载站内播放器」或显式开启「自动加载」偏好后才创建 iframe；
 *  - 无论是否加载播放器，来源页链接始终保留（兜底路径）；
 *  - 所有 href 都经过 safeHttpUrl 过滤，导入的恶意链接不会被渲染。
 */
export function videoCard(video, ctx, { fromConceptId = null } = {}) {
  const playback = resolveVideoPlayback(video);
  const vBadge = verificationBadge(video);
  const opened = Boolean(ctx.state?.courses?.[video.subjectId]?.videos?.[video.id]?.opened);
  const autoLoad = Boolean(ctx.state?.preferences?.autoLoadVideo) && video.sourceKind !== 'user';
  const container = h('article', { class: 'card video-card', dataset: { videoId: video.id } });

  const watchUrl = safeHttpUrl(playback.watchUrl || video.watchUrl);
  const creatorUrl = safeHttpUrl(video.creatorProfile);
  const player = h('div', { class: 'video-player' });
  let loaded = Boolean(ctx.videoLoad?.[video.id]) && playback.embeddable;
  if (autoLoad) loaded = true;

  const mountPlayer = () => {
    if (!playback.embeddable || !playback.embedUrl) return;
    const frame = h('iframe', {
      class: 'video-frame',
      attrs: {
        src: playback.embedUrl,
        title: video.title,
        loading: 'lazy',
        allowfullscreen: 'true',
        referrerpolicy: 'no-referrer',
        sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
      },
    });
    player.replaceChildren(
      frame,
      h('p', { class: 'video-note', text: '播放器来自哔哩哔哩外链服务。若长时间空白，请使用下方「打开来源页」。本站不转存视频，也不保证任何时刻都能播放。' })
    );
  };

  const mountPlaceholder = () => {
    player.replaceChildren(
      h('div', { class: 'video-placeholder' },
        h('p', { text: playback.embeddable ? '为避免自动请求第三方资源，播放器需要你手动加载（可在设置中改为自动加载）。' : '该来源不提供站内嵌入播放，请使用下方按钮打开来源页。' }),
        playback.embeddable
          ? h('button', {
              class: 'btn btn-primary',
              attrs: { type: 'button' },
              on: { click: () => {
                loaded = true;
                ctx.actions.markVideoOpened?.(video);
                mountPlayer();
                const hint = container.querySelector('.video-loaded-hint');
                if (hint) hint.textContent = '已在本页加载播放器（播放成功与否由第三方服务决定）。';
              } },
              text: '加载站内播放器',
            })
          : null,
        watchUrl ? h('a', { class: 'btn btn-ghost', attrs: { href: watchUrl, target: '_blank', rel: 'noopener noreferrer' }, text: '打开来源页' }) : null
      )
    );
  };

  if (loaded) mountPlayer();
  else mountPlaceholder();

  container.append(
    h('header', { class: 'video-head' },
      h('h4', { text: video.title }),
      h('div', { class: 'video-badges' },
        vBadge,
        video.enrichment ? badge('拓展材料 · 非必看', 'muted') : null,
        video.playbackVerified ? badge('播放已验证', 'ok') : badge('播放未验证', 'muted')
      )
    ),
    h('ul', { class: 'video-meta' },
      h('li', {}, h('span', { class: 'meta-key', text: '作者/机构' }), h('span', { text: video.creator || '未标注' })),
      h('li', {}, h('span', { class: 'meta-key', text: '来源' }), h('span', { text: providerName(video.provider) })),
      h('li', {}, h('span', { class: 'meta-key', text: '时长' }), h('span', { text: video.durationSeconds ? formatDuration(video.durationSeconds) : '未记录' })),
      fromConceptId ? null : h('li', {}, h('span', { class: 'meta-key', text: '知识点' }), h('span', { text: (video.knowledgePoints || []).length ? video.knowledgePoints.join('、') : '拓展材料（不属于单一知识点）' })),
      h('li', {}, h('span', { class: 'meta-key', text: '选择理由' }), h('span', { text: video.reason || '未说明' }))
    ),
    playback.embeddable ? null : h('p', { class: 'video-note', text: playback.reason }),
    player,
    h('p', { class: 'video-note video-loaded-hint', text: '' }),
    h('footer', { class: 'video-foot' },
      watchUrl ? h('a', { class: 'link', attrs: { href: watchUrl, target: '_blank', rel: 'noopener noreferrer' }, text: '打开来源页 ↗' }) : h('span', { class: 'muted small', text: '该条目的链接不合法，已隐藏' }),
      creatorUrl ? h('a', { class: 'link', attrs: { href: creatorUrl, target: '_blank', rel: 'noopener noreferrer' }, text: '作者主页 ↗' }) : null,
      video.verification?.checkedAt ? h('span', { class: 'muted small', text: `核实于 ${video.verification.checkedAt}` }) : null,
      opened ? h('span', { class: 'muted small', text: '已记录打开' }) : null
    )
  );
  return container;
}

function providerName(provider) {
  return provider === 'bilibili' ? '哔哩哔哩（外链）' : provider === 'mit-ocw' ? 'MIT OpenCourseWare（外部页面）' : '外部来源';
}

/**
 * 随堂测验。
 * 重要：提交后只在「仍然挂载在文档中的节点」上写入结果，
 * 并通过静默写入持久化这次尝试（不触发整页重渲染），
 * 否则用户会看不到分数与解析。
 */
export function quizWidget(quiz, ctx, { conceptId, courseId }) {
  if (!quiz) return emptyState({ title: '本课暂无测验', description: '这门课的测验正在补充中。' });
  const answers = {};
  const wrapper = h('div', { class: 'quiz' });
  const feedback = h('div', { class: 'quiz-feedback' });
  const scoreBox = h('div', { class: 'quiz-score', attrs: { 'aria-live': 'polite' } });
  const historyBox = h('p', { class: 'muted small', text: historyText(ctx, quiz, courseId) });

  const form = h('form', { class: 'quiz-form', attrs: { novalidate: 'novalidate' } },
    quiz.questions.map((q, index) => renderQuestion(q, index, answers))
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = gradeQuiz(quiz, answers);
    // 静默持久化（不重渲染），并用返回的最新记录刷新历史文案
    const latest = ctx.actions.recordQuiz?.(courseId, result);
    scoreBox.replaceChildren(
      h('strong', { text: result.passed ? `通过：${result.score}/${result.total}` : `未通过：${result.score}/${result.total}` }),
      h('span', { text: `（通过线 ${Math.round(result.passRatio * 100)}%，已作答 ${result.answeredCount}/${result.total}）` })
    );
    scoreBox.setAttribute('class', `quiz-score ${result.passed ? 'is-pass' : 'is-fail'}`);
    feedback.replaceChildren(...result.perQuestion.map((item) =>
      h('div', { class: `feedback-item ${item.correct ? 'ok' : 'bad'}` },
        h('p', { class: 'feedback-head' }, h('strong', { text: item.correct ? '回答正确' : '回答有误' }), h('span', { text: ` ${item.stem}` })),
        item.correct ? null : h('p', { class: 'feedback-answer', text: `正确答案：${item.expectedText}` }),
        h('p', { class: 'feedback-explain', text: item.explanation })
      )));
    historyBox.textContent = historyText(ctx, quiz, courseId, latest);
  });

  wrapper.append(
    h('div', { class: 'quiz-head' },
      h('h3', { text: '随堂测验' }),
      h('p', { class: 'muted', text: `共 ${quiz.questions.length} 题，答对 ${Math.ceil(quiz.passScore * quiz.questions.length)} 题即通过（≥${Math.round(quiz.passScore * 100)}%）。` }),
      historyBox
    ),
    form,
    h('div', { class: 'quiz-actions' },
      h('button', { class: 'btn btn-primary', attrs: { type: 'submit' }, on: { click: () => form.requestSubmit() }, text: '提交并查看解析' }),
      h('button', {
        class: 'btn btn-ghost',
        attrs: { type: 'button' },
        on: { click: () => {
          form.reset();
          Object.keys(answers).forEach((k) => delete answers[k]);
          feedback.replaceChildren();
          scoreBox.replaceChildren();
          scoreBox.setAttribute('class', 'quiz-score');
        } },
        text: '重做',
      })
    ),
    scoreBox,
    feedback
  );
  return wrapper;
}

/** 取分数最高的一次尝试；空数组返回 null。全错（0 分）时也必须能正确返回一次尝试。 */
export function bestAttempt(attempts = []) {
  return attempts.reduce((acc, a) => (acc === null || a.score / Math.max(1, a.total) > acc.score / Math.max(1, a.total) ? a : acc), null);
}

function historyText(ctx, quiz, courseId, latest = null) {
  const attempts = latest?.quizId === quiz.id
    ? latest.attempts
    : (ctx.state?.courses?.[courseId]?.quizAttempts || []).filter((a) => a.quizId === quiz.id);
  if (!Array.isArray(attempts) || attempts.length === 0) return `还没有测验记录，共 ${quiz.questions.length} 题。`;
  const best = bestAttempt(attempts);
  if (!best) return `共尝试 ${attempts.length} 次。`;
  return `历史最佳：${best.score}/${best.total}（${best.passed ? '已通过' : '未通过'}），共尝试 ${attempts.length} 次。`;
}

function renderQuestion(question, index, answers) {
  const name = `q-${question.id}`;
  const body = [];
  if (question.type === 'single' || question.type === 'judge') {
    const options = question.type === 'judge' ? ['正确', '错误'] : question.options;
    body.push(h('div', { class: 'options' }, options.map((opt, i) => {
      const value = question.type === 'judge' ? i === 0 : i;
      return h('label', { class: 'option' },
        h('input', {
          attrs: { type: 'radio', name, value: String(value) },
          on: { change: () => { answers[question.id] = value; } },
        }),
        h('span', { text: opt })
      );
    })));
  } else if (question.type === 'multiple') {
    body.push(h('div', { class: 'options' }, question.options.map((opt, i) =>
      h('label', { class: 'option' },
        h('input', { attrs: { type: 'checkbox', name, value: String(i) }, on: { change: (event) => {
          const set = new Set(Array.isArray(answers[question.id]) ? answers[question.id] : []);
          if (event.target.checked) set.add(i); else set.delete(i);
          answers[question.id] = [...set].sort((a, b) => a - b);
        } } }),
        h('span', { text: opt })
      ))));
  } else {
    body.push(h('input', { class: 'text-input', attrs: { type: 'text', name, placeholder: '填写答案' }, on: { input: (event) => { answers[question.id] = event.target.value; } } }));
  }
  return h('fieldset', { class: 'question' },
    h('legend', {}, h('span', { class: 'q-index', text: `第 ${index + 1} 题` }), badge(questionTypeLabel(question.type), 'soft')),
    h('p', { class: 'q-stem', text: question.stem }),
    ...body
  );
}

/** 实战/实验任务清单（勾选状态会持久化）。 */
export function taskChecklist(concept, lessonState, ctx, { courseId }) {
  const tasks = concept.tasks || concept.project?.steps || [];
  if (tasks.length === 0) return null;
  const done = lessonState?.tasks || {};
  return h('section', { class: 'task-list' },
    h('h3', { text: concept.type === 'lab' ? '实验步骤与验收标准' : '任务清单与验收标准' }),
    h('ol', {}, tasks.map((task, index) =>
      h('li', { class: done[String(index)] ? 'task done' : 'task' },
        h('label', {},
          h('input', {
            attrs: { type: 'checkbox' },
            checked: Boolean(done[String(index)]),
            on: { change: () => ctx.actions.toggleTask(courseId, concept.id, index) },
          }),
          h('span', { class: 'task-title', text: task.title })
        ),
        h('p', { class: 'task-detail', text: task.detail }),
        h('p', { class: 'task-acceptance', text: `验收：${task.acceptance}` })
      )))
  );
}

export function projectPanel(concept) {
  const project = concept.project;
  if (!project) return null;
  return h('section', { class: 'project-panel' },
    h('h3', { text: '项目目标' }),
    h('p', { text: project.goal }),
    h('h4', { text: '交付物' }),
    h('ul', {}, (project.deliverables || []).map((d) => h('li', { text: d }))),
    h('h4', { text: '评分标准' }),
    h('ul', { class: 'rubric' }, (project.rubric || []).map((r) => h('li', { text: `${r.criterion}（${r.weight}%）` })))
  );
}

