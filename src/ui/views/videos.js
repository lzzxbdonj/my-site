import { h } from '../dom.js';
import { badge, emptyState, videoCard } from '../components.js';
import { VIDEO_LIBRARY, VERIFIED_AT } from '../../data/videos.js';
import { classifyVideoUrl } from '../../core/video.js';
import { formatDuration } from '../../core/format.js';
import { getCourse } from '../../core/catalog.js';

export function videosView(ctx) {
  const subjectId = ctx.videoFilter?.subjectId || 'all';
  const conceptId = ctx.videoFilter?.conceptId || 'all';
  const subjects = [...new Map(VIDEO_LIBRARY.map((v) => [v.subjectId, getCourse(v.subjectId)?.title || v.subjectId])).entries()];
  const conceptOptions = ctx.courses
    .filter((c) => subjectId === 'all' || c.id === subjectId)
    .flatMap((c) => c.concepts.map((concept) => ({ id: concept.id, label: `${concept.title}（${c.title}）` })));

  const list = VIDEO_LIBRARY.filter((v) => (subjectId === 'all' || v.subjectId === subjectId) && (conceptId === 'all' || v.knowledgePoints.includes(conceptId)));
  const customVideos = ctx.courses.flatMap((course) => (ctx.state.courses?.[course.id]?.customVideos || []).map((v) => ({ ...v, subjectId: course.id })));

  return h('div', { class: 'view view-videos' },
    h('header', { class: 'view-head' },
      h('h1', { text: '视频课' }),
      h('p', { class: 'muted', text: `共 ${VIDEO_LIBRARY.length} 条人工筛选的教学视频，全部为第三方站点外链，本站不下载、不转存。每条都标注了作者、来源、知识点与入选理由。` })
    ),
    h('section', { class: 'panel verification-note' },
      h('h2', { text: '我们如何核实这些视频' }),
      h('ul', {},
        h('li', { text: `可复现脚本：npm run verify:videos（调用哔哩哔哩公开接口核对标题/UP 主/分 P/时长，核对 MIT OCW 页面可访问性）。最近一次核实的基线日期：${VERIFIED_AT}。` }),
        h('li', { text: '「来源已验证 · 官方认证账号」表示该视频由平台认证的官方账号发布，且接口返回的标题与本站记录一致。' }),
        h('li', { text: '「播放未验证」是诚实的标注：我们验证了来源页面与播放器地址可达，但没有验证视频在嵌入播放器中一定成功播放（受地区、登录、浏览器策略影响）。' }),
        h('li', { text: '如果播放器打不开，请始终使用「打开来源页」按钮，这是设计上保证可用的兜底路径。' })
      )
    ),
    h('div', { class: 'toolbar' },
      h('div', { class: 'chip-row' },
        h('button', { class: `chip ${subjectId === 'all' ? 'is-active' : ''}`, attrs: { type: 'button' }, on: { click: () => ctx.actions.setVideoFilter({ subjectId: 'all', conceptId: 'all' }) }, text: '全部课程' }),
        subjects.map(([id, title]) => h('button', {
          class: `chip ${subjectId === id ? 'is-active' : ''}`,
          attrs: { type: 'button' },
          on: { click: () => ctx.actions.setVideoFilter({ subjectId: id, conceptId: 'all' }) },
          text: title,
        }))
      ),
      h('label', { class: 'field inline' },
        h('span', { class: 'field-label', text: '按知识点筛选' }),
        h('select', { class: 'text-input', attrs: { 'data-focus-key': 'video-filter-concept' }, on: { change: (e) => ctx.actions.setVideoFilter({ conceptId: e.target.value }) } },
          h('option', { attrs: { value: 'all', selected: conceptId === 'all' ? 'selected' : null }, text: '全部知识点' }),
          conceptOptions.map((c) => h('option', { attrs: { value: c.id, selected: conceptId === c.id ? 'selected' : null }, text: c.label })))
      )
    ),
    list.length === 0
      ? emptyState({ title: '该筛选条件下暂无视频', description: '换一个课程或知识点试试。', actionLabel: '重置筛选', onAction: () => ctx.actions.setVideoFilter({ subjectId: 'all', conceptId: 'all' }) })
      : h('div', { class: 'video-grid' }, list.map((video) => videoCard(video, ctx))),

    customVideos.length
      ? h('section', { class: 'panel' },
          h('header', { class: 'panel-head' }, h('h2', { text: `我添加的视频（${customVideos.length}）` }), badge('仅保存在本机', 'soft')),
          h('div', { class: 'video-grid' }, customVideos.map((video) =>
            h('div', { class: 'custom-video-slot' },
              videoCard({ ...video, reason: video.reason || '用户自定义来源' }, ctx),
              h('button', { class: 'btn btn-ghost danger', attrs: { type: 'button' }, on: { click: () => ctx.actions.removeCustomVideo(video.subjectId, video.id) }, text: '删除这条自定义视频' })
            )))
        )
      : null,

    h('section', { class: 'panel' },
      h('h2', { text: '添加自己的视频' }),
      h('p', { class: 'muted', text: '支持哔哩哔哩链接（会生成站内播放器）或其他 https 页面（仅外链打开）。请确保你有权使用该链接。' }),
      customVideoForm(ctx)
    )
  );
}

function customVideoForm(ctx) {
  const draft = ctx.customVideoDraft || { url: '', title: '', courseId: ctx.courses[0].id, reason: '' };
  const status = h('p', { class: 'form-status', attrs: { 'aria-live': 'polite' } });

  const update = (patch) => ctx.actions.setCustomVideoDraft({ ...draft, ...patch });

  return h('form', { class: 'custom-video-form', attrs: { novalidate: 'novalidate' }, on: { submit: (event) => {
    event.preventDefault();
    const result = ctx.actions.addCustomVideo(draft);
    if (result.ok) {
      status.replaceChildren(h('span', { class: 'ok', text: '已添加，可在课程课时页看到。' }));
      ctx.actions.setCustomVideoDraft({ url: '', title: '', reason: '', courseId: draft.courseId });
    } else {
      status.replaceChildren(h('span', { class: 'bad', text: result.error }));
    }
  } } },
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '视频链接' }),
      h('input', { class: 'text-input', attrs: { type: 'url', placeholder: 'https://www.bilibili.com/video/BV...', value: draft.url, 'data-focus-key': 'custom-video-url' }, on: { input: (e) => update({ url: e.target.value }) } })
    ),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '标题' }),
      h('input', { class: 'text-input', attrs: { type: 'text', placeholder: '例如：线性代数第 3 讲', value: draft.title, 'data-focus-key': 'custom-video-title' }, on: { input: (e) => update({ title: e.target.value }) } })
    ),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '加入哪门课' }),
      h('select', { class: 'text-input', attrs: { 'data-focus-key': 'custom-video-course' }, on: { change: (e) => update({ courseId: e.target.value }) } },
        ctx.courses.map((c) => h('option', { attrs: { value: c.id, selected: c.id === draft.courseId ? 'selected' : null }, text: c.title })))
    ),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '选择理由（可选，会显示在卡片上）' }),
      h('input', { class: 'text-input', attrs: { type: 'text', value: draft.reason, placeholder: '例如：老师讲得细，配套代码齐全', 'data-focus-key': 'custom-video-reason' }, on: { input: (e) => update({ reason: e.target.value }) } })
    ),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn btn-primary', attrs: { type: 'submit' }, text: '校验并添加' }),
      h('span', { class: 'muted small', text: draft.url ? previewHint(draft.url) : '链接会在本地校验：只接受 https 与合法 BV 号。' })
    ),
    status
  );
}

function previewHint(url) {
  const result = classifyVideoUrl(url);
  if (!result.ok) return `⚠ ${result.reason}`;
  return `✓ 识别为 ${result.provider}${result.embeddable ? '（可站内播放）' : '（仅外链）'}`;
}

export function videoDurationLabel(video) {
  return video.durationSeconds ? formatDuration(video.durationSeconds) : '未记录';
}

