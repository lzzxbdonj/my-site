import { h } from '../dom.js';
import { badge, brandMark, progressBar, statTile } from '../components.js';
import { GOALS, LEVELS } from '../../core/personalize.js';
import { courseProgress, studyStats } from '../../core/progress.js';
import { catalogStats } from '../../data/courses.js';
import { VIDEO_LIBRARY, VERIFIED_AT } from '../../data/videos.js';
import { formatMinutes, formatRelative, percent, todayKey } from '../../core/format.js';
import { validateEndpoint } from '../../core/ai.js';
import { normalizeWorkerUrl } from '../../core/ai-client.js';
import { detectBasePath } from '../../core/paths.js';
import { PRODUCT_NAME, BRAND_DATA_NOTE } from '../../core/brand.js';

export function profileView(ctx) {
  const stats = studyStats(ctx.state, ctx.courses);
  const courses = ctx.courses.map((course) => ({ course, progress: courseProgress(ctx.state, course) }));
  const days = new Set(stats.studyDays);
  const last28 = [];
  for (let i = 27; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last28.push({ key: todayKey(d), active: days.has(todayKey(d)) });
  }

  return h('div', { class: 'view view-profile' },
    h('header', { class: 'view-head' },
      h('h1', { text: '我的进度' }),
      h('p', { class: 'muted', text: '所有内容都保存在这台设备的浏览器里。换设备时请先导出备份，再在新设备上导入。' })
    ),

    h('section', { class: 'stat-grid' },
      statTile({ label: '连续学习', value: `${stats.streak} 天`, tone: 'indigo' }),
      statTile({ label: '累计学习', value: formatMinutes(stats.totalMinutes) }),
      statTile({ label: '已掌握概念', value: String(stats.masteredTotal), tone: 'teal' }),
      statTile({ label: '笔记/收藏', value: String(countNotes(ctx)), hint: '仅本机' })
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '近 28 天活跃情况' }),
      h('div', { class: 'heat-strip', attrs: { role: 'img', 'aria-label': `近 28 天中 ${last28.filter((d) => d.active).length} 天有学习记录` } },
        last28.map((day) => h('span', { class: day.active ? 'heat-cell is-active' : 'heat-cell', attrs: { title: day.key } }))),
      h('p', { class: 'muted small', text: `近 7 天活跃 ${stats.activeThisWeek} 天。` })
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '学习档案' }),
      profileForm(ctx)
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '课程进度明细' }),
      h('div', { class: 'course-progress-list' }, courses.map(({ course, progress }) =>
        h('article', { class: 'progress-row' },
          h('div', { class: 'progress-row-head' },
            h('strong', { text: course.title }),
            h('span', { class: 'muted small', text: `${progress.mastered}/${progress.total} 单元 · ${formatMinutes(progress.minutes)}` })
          ),
          progressBar(progress.percent)
        )))
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '备份与恢复' }),
      h('p', { class: 'muted', text: '导出的 JSON 不包含任何密钥；导入时会校验格式并丢弃可疑的密钥字段。' }),
      h('div', { class: 'panel-actions' },
        h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, on: { click: () => ctx.actions.exportData() }, text: '导出备份（JSON 文件）' }),
        h('label', { class: 'btn btn-ghost file-btn' }, h('span', { text: '从文件导入' }), h('input', { attrs: { type: 'file', accept: 'application/json,.json' }, on: { change: (event) => {
          const file = event.target.files?.[0];
          if (file) ctx.actions.importFile(file);
          event.target.value = '';
        } } })),
        h('button', { class: 'btn btn-ghost danger', attrs: { type: 'button' }, on: { click: () => ctx.actions.resetAll() }, text: '清空全部本地数据' })
      ),
      h('p', { class: 'muted small', text: `上次保存：${formatRelative(ctx.state.meta?.updatedAt)} · 存储键：studymate.state.v1` })
    )
  );
}

function countNotes(ctx) {
  let n = 0;
  for (const entry of Object.values(ctx.state.courses || {})) {
    n += Object.values(entry.notes || {}).reduce((acc, list) => acc + list.length, 0);
    n += (entry.bookmarks || []).length;
  }
  return n;
}

function profileForm(ctx) {
  const { profile } = ctx.state;
  const update = (patch) => ctx.actions.updateProfile(patch);
  return h('form', { class: 'profile-form', on: { submit: (event) => event.preventDefault() } },
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '称呼（可留空）' }),
      h('input', { class: 'text-input', attrs: { type: 'text', value: profile.name, maxlength: '40', 'data-focus-key': 'profile-name' }, on: { input: (e) => update({ name: e.target.value }) } })
    ),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '学习目标' }),
      h('select', { class: 'text-input', on: { change: (e) => update({ goal: e.target.value }) } },
        GOALS.map((g) => h('option', { attrs: { value: g.id, selected: g.id === profile.goal ? 'selected' : null }, text: `${g.label} — ${g.hint}` })))
    ),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: '当前水平' }),
      h('select', { class: 'text-input', on: { change: (e) => update({ level: e.target.value }) } },
        LEVELS.map((l) => h('option', { attrs: { value: l.id, selected: l.id === profile.level ? 'selected' : null }, text: `${l.label} — ${l.hint}` })))
    ),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: `每周可投入：${profile.weeklyHours} 小时` }),
      h('input', { class: 'range', attrs: { type: 'range', min: '1', max: '20', value: String(profile.weeklyHours), 'data-focus-key': 'profile-weekly' }, on: { input: (e) => update({ weeklyHours: Number(e.target.value) }) } })
    ),
    h('label', { class: 'field' },
      h('span', { class: 'field-label', text: `单次专注时长：${profile.lessonMinutes} 分钟` }),
      h('input', { class: 'range', attrs: { type: 'range', min: '15', max: '120', step: '5', value: String(profile.lessonMinutes), 'data-focus-key': 'profile-lesson' }, on: { input: (e) => update({ lessonMinutes: Number(e.target.value) }) } })
    )
  );
}

/**
 * 账号面板（GitHub 登录，可选）。
 *
 * 隐私约定：这里**没有任何后台请求** —— 只有在用户点击「登录 / 检查登录状态」时才访问 Worker，
 * 与「外部请求只发生在明确动作上」的承诺一致。不登录也能使用全部课程、视频、测验与进度功能。
 */
function authPanel(ctx) {
  const auth = ctx.auth || { status: 'unknown' };
  const worker = normalizeWorkerUrl(ctx.state.ai?.workerUrl || '');
  const user = auth.user;
  const statusText = {
    'signed-in': user ? `已登录：${user.name || user.login}（@${user.login}）` : '已登录',
    anonymous: '未登录',
    checking: '正在检查…',
    unknown: '尚未检查登录状态',
    error: `登录出错：${auth.error || '未知错误'}`,
  }[auth.status] || '尚未检查登录状态';

  return h('section', { class: 'panel' },
    h('h2', { text: '账号（可选，GitHub 登录）' }),
    h('p', { class: 'muted', text: '用 GitHub 登录，学习进度与用量就能绑到你自己的账号上。不登录也可以使用课程库、定制课程、视频、测验与学习进度。' }),
    h('p', { class: worker.ok ? `form-status ${auth.status === 'signed-in' ? 'ok' : ''}` : 'form-status', text: worker.ok ? `◆ ${statusText}` : `⚠ ${worker.reason}` }),
    auth.enabled === false
      ? h('p', { class: 'form-status', text: `⚠ 这个服务还没有开启登录${auth.error ? `：${auth.error}` : '。'}` })
      : null,
    h('div', { class: 'panel-actions' },
      auth.status === 'signed-in'
        ? h('button', { class: 'btn btn-ghost danger', attrs: { type: 'button' }, on: { click: () => ctx.actions.logout() }, text: '退出登录' })
        : h('button', {
            class: 'btn btn-primary',
            attrs: { type: 'button', disabled: !worker.ok || auth.checking || auth.enabled === false },
            on: { click: () => ctx.actions.startGithubLogin() },
            text: auth.checking ? '正在跳转…' : '用 GitHub 登录',
          }),
      h('button', {
        class: 'btn btn-ghost',
        attrs: { type: 'button', disabled: !worker.ok || auth.checking },
        on: { click: () => ctx.actions.refreshSession() },
        text: '检查登录状态',
      })
    ),
    h('ul', { class: 'privacy-list' },
      h('li', { text: '登录信息只保存在这台设备上，导出备份不会包含它，也不会用于任何统计或追踪。' }),
      h('li', { text: '登录状态最长保持 30 天，到期后需要重新登录。' })
    ),
    h('details', { class: 'advanced' },
      h('summary', { text: '登录的技术细节' }),
      h('ul', { class: 'privacy-list' },
        h('li', { text: '令牌只保存在本机的独立存储键里，不进入主状态对象。' }),
        h('li', { text: '实现是无状态签名（HMAC-SHA256），因此无法单独吊销某一个令牌；在服务端更换 AUTH_TOKEN_SECRET 可让所有旧令牌立即失效。' }),
        h('li', { text: '前端与接口分属不同站点时用 Authorization 头而不是 Cookie 维持登录态（跨站 Cookie 不可靠）；若你把它部署到同一个自有域名下，可以改用更安全的同站 Cookie。' })
      )
    )
  );
}

export function settingsView(ctx) {
  const ai = ctx.state.ai;
  const prefs = ctx.state.preferences;
  const check = validateEndpoint(ai.endpoint);
  const workerCheck = normalizeWorkerUrl(ai.workerUrl || '');
  const keyPresent = Boolean(ctx.secrets?.read?.());
  // 服务地址可用时，界面上就把这件事说成「已就绪」，把技术字段收进高级设置：
  // 用户不需要知道什么 Worker、什么接口地址。
  const aiReady = workerCheck.ok;

  return h('div', { class: 'view view-settings' },
    h('header', { class: 'view-head' },
      h('h1', { text: '设置' }),
      h('p', { class: 'muted', text: '所有设置都只影响这台设备上的这个浏览器。' })
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '智能服务' }),
      h('p', { class: aiReady ? 'form-status ok' : 'form-status', text: aiReady
        ? `✓ 已就绪，开箱即用（${workerCheck.base}）`
        : '尚未就绪：需要填写服务地址（见下方「高级设置」）。' }),
      h('p', { class: 'muted', text: aiReady
        ? '建课与讲解都已配置好，这一页不需要你做任何设置。密钥保存在服务端，浏览器不接触、也不会上传你的学习数据。'
        : '本站不内置 AI 服务，也不会伪造回答。若你部署了自己的服务，请在下方高级设置里填入地址。' }),

      h('details', { class: 'advanced' },
        h('summary', { text: '高级设置（一般不需要动）' }),
        h('p', { class: 'muted small', text: '只有在你自己部署服务、或需要接自建接口时才会用到下面这些字段。' }),
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: '服务地址（代理模式，支持完整建课与讲解）' }),
          h('input', { class: 'text-input', attrs: { type: 'url', value: ai.workerUrl || '', placeholder: 'https://studymate-ai-proxy.<你的子域>.workers.dev', 'data-focus-key': 'ai-worker' }, on: { input: (e) => ctx.actions.updateAi({ workerUrl: e.target.value }) } })
        ),
        h('p', { class: workerCheck.ok ? 'form-status ok' : 'form-status', text: workerCheck.ok ? `✓ 代理模式可用：${workerCheck.base}` : `未启用代理模式：${workerCheck.reason}` }),
        h('p', { class: 'muted small', text: '部署方式见仓库中的 worker/README.md（wrangler secret put PROVIDER_API_KEY / IP_SALT，默认额度 60 次/访客/天、200 次/全站/天，可在 Worker 变量中调整）。' }),

        h('h3', { text: '直连模式（仅用于讲解，不推荐）' }),
        h('p', { class: 'muted small', text: '浏览器直接调用你的 OpenAI 兼容接口。密钥会暴露给该接口方，且无法限制调用次数；仅建议在本地或自建服务上使用。' }),
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: '接口地址（https，或本机 http://localhost）' }),
          h('input', { class: 'text-input', attrs: { type: 'url', value: ai.endpoint, placeholder: 'https://api.openai.com', 'data-focus-key': 'ai-endpoint' }, on: { input: (e) => ctx.actions.updateAi({ endpoint: e.target.value }) } })
        ),
        h('p', { class: check.ok ? 'form-status ok' : 'form-status', text: check.ok ? '✓ 地址格式可用' : `⚠ ${check.reason}` }),
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: '模型名' }),
          h('input', { class: 'text-input', attrs: { type: 'text', value: ai.model, placeholder: '例如 gpt-4o-mini / qwen-plus', 'data-focus-key': 'ai-model' }, on: { input: (e) => ctx.actions.updateAi({ model: e.target.value }) } })
        ),
        h('label', { class: 'field' },
          h('span', { class: 'field-label', text: `API 密钥（${keyPresent ? '当前会话已填写' : '未填写'}）` }),
          h('input', { class: 'text-input', attrs: { type: 'password', placeholder: '只会写入 sessionStorage / 内存，导出备份时被剔除', autocomplete: 'off', 'data-focus-key': 'ai-key' }, on: { change: (e) => ctx.actions.saveSecret(e.target.value) } })
        ),
        h('div', { class: 'panel-actions' },
          h('label', { class: 'checkbox' },
            h('input', { attrs: { type: 'checkbox' }, checked: ai.enabled, on: { change: (e) => ctx.actions.updateAi({ enabled: e.target.checked }) } }),
            h('span', { text: '启用直连模式（仅讲解；代理模式下无需开启）' })
          ),
          h('button', { class: 'btn btn-ghost danger', attrs: { type: 'button' }, on: { click: () => { ctx.actions.saveSecret(''); ctx.actions.toast('已清除当前会话中的密钥'); } }, text: '清除本次会话密钥' })
        ),
        h('ul', { class: 'privacy-list' },
          h('li', { text: '密钥默认只保存在 sessionStorage（关闭标签页即失效），不会写入 localStorage，也不会出现在导出文件里。' }),
          h('li', { text: '只有你点击「生成讲解」时，才会把这个知识点的标题与摘要发送到你填写的接口。' }),
          h('li', { text: '注意：浏览器直连第三方接口会暴露密钥给该接口方，请自行评估风险，建议使用限额密钥。' })
        )
      )
    ),

    authPanel(ctx),

    h('section', { class: 'panel' },
      h('h2', { text: '显示与行为' }),
      h('label', { class: 'checkbox' },
        h('input', { attrs: { type: 'checkbox' }, checked: prefs.autoLoadVideo, on: { change: (e) => ctx.actions.updatePreferences({ autoLoadVideo: e.target.checked }) } }),
        h('span', { text: '自动加载视频播放器（默认关闭，开启后会向第三方站点发起请求）' })
      ),
      h('label', { class: 'checkbox' },
        h('input', { attrs: { type: 'checkbox' }, checked: prefs.reduceMotion, on: { change: (e) => ctx.actions.updatePreferences({ reduceMotion: e.target.checked }) } }),
        h('span', { text: '减少动画（系统设置了「减少动态效果」时也会自动生效）' })
      ),
      h('label', { class: 'field' },
        h('span', { class: 'field-label', text: `正文字号：${Math.round(prefs.fontScale * 100)}%` }),
        h('input', { class: 'range', attrs: { type: 'range', min: '90', max: '140', step: '5', value: String(Math.round(prefs.fontScale * 100)), 'data-focus-key': 'pref-fontscale' }, on: { input: (e) => ctx.actions.updatePreferences({ fontScale: Number(e.target.value) / 100 }) } })
      )
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '运行环境信息' }),
      h('ul', { class: 'kv-list' },
        h('li', {}, h('span', { text: '部署基路径（自动推断）' }), h('code', { text: detectBasePath(location.pathname) })),
        h('li', {}, h('span', { text: '页面地址' }), h('code', { text: location.origin + location.pathname })),
        h('li', {}, h('span', { text: '本地存储可用' }), h('code', { text: storageAvailable() ? '是' : '否（可能是隐私模式）' })),
        h('li', {}, h('span', { text: '课程数据' }), h('code', { text: JSON.stringify(catalogStats()) }))
      )
    )
  );
}

function storageAvailable() {
  try {
    const key = 'studymate.probe';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function aboutView(ctx) {
  const stats = catalogStats();
  const verifiedChannels = [...new Set(VIDEO_LIBRARY.filter((v) => v.creatorVerified).map((v) => v.creator))];
  return h('div', { class: 'view view-about' },
    h('header', { class: 'view-head hero-small' },
      brandMark(56),
      h('div', {},
        h('h1', { text: '关于本项目' }),
        h('p', { class: 'muted', text: `${PRODUCT_NAME}：一个受 Study-Mate 启发的、可部署在 GitHub Pages 上的中文学习网站——定制课程 + 精选视频 + 真实测验 + 本地进度。` }),
        h('p', { class: 'muted small', attrs: { 'data-brand-note': 'rename' }, text: BRAND_DATA_NOTE })
      )
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '来源与许可' }),
      h('p', {}, h('span', { text: '灵感与功能参考来自上游项目 ' }), h('a', { class: 'link', attrs: { href: 'https://github.com/Miaotofu01/Study-Mate', target: '_blank', rel: 'noopener noreferrer' }, text: 'Miaotofu01/Study-Mate' }), h('span', { text: '（MIT License, Copyright (c) 2026 Cattofu）。' })),
      h('p', { text: '本项目为独立重写：没有复制上游的角色形象、美术资源或桌面端代码；界面、课程内容与文案均为原创。上游的 MIT 许可与版权声明完整保留在 NOTICE 文件中。' }),
      h('p', { text: '本站课程文字、测验题目、路线图与界面设计由本项目原创撰写；教学视频为第三方站点外链，版权归原作者所有，本站不下载、不转存、不二次分发。' })
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '能力对照（保留了什么、哪些做不到）' }),
      h('ul', { class: 'capability-list' },
        h('li', {}, h('strong', { text: '课程总览与路线图' }), h('span', { text: '保留了「依赖 + 状态着色」的概念地图，并改成可点击的网页版。' })),
        h('li', {}, h('strong', { text: '教材式课时' }), h('span', { text: '保留分段讲解、术语表、关键结论与常见误解；内容为本站原创。' })),
        h('li', {}, h('strong', { text: '定制练习与测评' }), h('span', { text: '保留随堂测验与解析，新增自动评分、通过线与历史最佳。' })),
        h('li', {}, h('strong', { text: '项目与实验室' }), h('span', { text: '保留项目式学习，新增可勾选的任务清单与评分标准。' })),
        h('li', {}, h('strong', { text: '目标/水平访谈' }), h('span', { text: '改为四步网页向导，并给出可解释的排课理由。' })),
        h('li', {}, h('strong', { text: '跨学科记忆与进度' }), h('span', { text: '保留，但改为浏览器本地存储；没有云端同步，因此换设备需要导出/导入备份。' })),
        h('li', {}, h('strong', { text: '本地资料与桌面端能力' }), h('span', { text: '未保留：纯静态站点无法读写本地目录、无法调用桌面壳/插件 API。' })),
        h('li', {}, h('strong', { text: 'AI 讲解/改写' }), h('span', { text: '保留为可选功能，需要用户自己配置代理 Worker（推荐，密钥留在 Cloudflare 机密中）或直连接口；不内置密钥、不伪造回答。新增的 AI 建课功能同样走这条代理通道，生成课程会先预览再保存。' }))
      )
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '内容与视频的事实' }),
      h('ul', { class: 'kv-list' },
        h('li', {}, h('span', { text: '课程 / 学习单元 / 测验 / 题目' }), h('code', { text: `${stats.courses} / ${stats.concepts} / ${stats.quizzes} / ${stats.questions}` })),
        h('li', {}, h('span', { text: '精选视频条目' }), h('code', { text: String(VIDEO_LIBRARY.length) })),
        h('li', {}, h('span', { text: '官方认证账号来源' }), h('code', { text: verifiedChannels.join('、') })),
        h('li', {}, h('span', { text: '视频信息核实基线' }), h('code', { text: VERIFIED_AT }))
      ),
      h('p', { class: 'muted small', text: '核实方式、逐条来源与已知限制见仓库中的 docs/video-sources.md；可用 npm run verify:videos 重新核对。' })
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '技术实现' }),
      h('ul', {},
        h('li', { text: '零运行时依赖的静态站点：原生 ES 模块 + 原生 CSS，构建脚本把源码复制为 dist（含 .nojekyll 与 404.html）。' }),
        h('li', { text: '全部资源使用相对路径 + hash 路由，因此在 https://<user>.github.io/<任意仓库名>/ 下都能直接运行。' }),
        h('li', { text: '测试：node --test（单元/集成）+ 真实浏览器 CDP 流程测试（Edge 无头模式），命令见 README。' })
      )
    ),

    h('section', { class: 'panel' },
      h('h2', { text: '已知边界' }),
      h('ul', {},
        h('li', { text: '嵌入播放器的成功播放未做验证；视频能否播放取决于地区、账号与浏览器策略，请使用「打开来源页」兜底。' }),
        h('li', { text: '本项目的构建环境无法访问 YouTube，因此没有收录 YouTube 视频，也没有对其可达性做任何声称。' }),
        h('li', { text: '进度只存在本地浏览器，不支持多设备同步。' }),
        h('li', { text: 'AI 功能依赖第三方接口，质量与可用性由该服务决定，本站只做诚实的错误提示。' })
      )
    )
  );
}


