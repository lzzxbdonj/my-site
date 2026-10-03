/**
 * 课程生成模板（预设）目录：**前端与 Worker 共用同一份可信清单**。
 *
 * 为什么放在这里：模板不是自由文本。客户端只提交 `templateId`，
 * 服务端用这份清单把 id 映射成受控的教学取向说明——这样：
 *  - 未知名 / 伪造的 id 不会把任意文本注入提示词（只回退到通用取向）；
 *  - 前端显示与提示词实际生效的取向不会各写一份而逐渐漂移。
 *
 * 纪律：
 *  - 模板只是「省事的起点」，不承诺任何结果，也不承诺零 token；
 *    生成仍然要真实调用模型，按服务端回报的用量计费。
 *  - 模板字段（每周时长、单次时长）必须落在既有范围内：
 *    每周 1-20 小时、单次 15-120 分钟（与前端滑杆一致）。
 *  - 选模板本身不发任何网络请求。
 */

import { GOALS, LEVELS } from '../core/personalize.js';

const goalIds = new Set(GOALS.map((g) => g.id));
const levelIds = new Set(LEVELS.map((l) => l.id));

export const MIN_WEEKLY_HOURS = 1;
export const MAX_WEEKLY_HOURS = 20;
export const MIN_LESSON_MINUTES = 15;
export const MAX_LESSON_MINUTES = 120;

/**
 * 五个可落地的预设 + `custom`（自定义）。
 * `focus` 是给模型的受控教学取向说明；`audience` / `exampleTopic` 是给用户看的。
 */
export const COURSE_TEMPLATES = [
  {
    id: 'custom',
    label: '自定义',
    tagline: '完全自己填',
    audience: '已经清楚自己想学什么的人',
    exampleTopic: '',
    prefs: null,
    focus: '',
    outlineEmphasis: '',
    lessonEmphasis: '',
  },
  {
    id: 'starter',
    label: '零基础入门',
    tagline: '先把地基打牢',
    audience: '完全没接触过这个领域、需要从直觉和最小可用知识开始的人',
    exampleTopic: 'Python 编程入门',
    prefs: { goal: 'starter', level: 'new', weeklyHours: 5, lessonMinutes: 40 },
    focus: '零基础启蒙：先用直觉和生活中的例子建立概念，再引入术语与符号；每一步都要交代「为什么需要它」。',
    outlineEmphasis: '知识点顺序必须由浅入深，前两个知识点不许出现需要前置数学或工具经验的内容；至少一个动手单元用来跑通第一个最小例子。',
    lessonEmphasis: '每节先用具体例子讲直觉，再给定义；不要假设读者会任何工具或符号约定，遇到新符号要当场解释。',
  },
  {
    id: 'exam',
    label: '考试复习',
    tagline: '按考点密度排',
    audience: '有考试日期、需要在有限时间里覆盖高频考点与题型的人',
    exampleTopic: '概率论与数理统计 期末复习',
    prefs: { goal: 'exam', level: 'some', weeklyHours: 8, lessonMinutes: 45 },
    focus: '考试复习：以高频考点与常见题型组织内容，强调计算步骤、判分要点与易错点，而不是工程背景。',
    outlineEmphasis: '按考点权重排序：把最容易考、分值最高的主题放在前面；每个知识点都要能对应到典型题型。',
    lessonEmphasis: '每节给出一道典型题的完整解题步骤，并明确指出常见错误与判分要点；结论用可背诵的形式收束。',
  },
  {
    id: 'project',
    label: '项目实战',
    tagline: '边做边学',
    audience: '想用做一个小项目来学会它的人',
    exampleTopic: '用 Python 做一个数据分析小工具',
    prefs: { goal: 'project', level: 'some', weeklyHours: 8, lessonMinutes: 60 },
    focus: '项目驱动：以一个可交付的小项目为主线，知识点服务于「把它做出来、能验证、能交付」。',
    outlineEmphasis: '至少两个动手单元，且最后一个单元必须是一个端到端可交付的小项目；概念单元的讲解要直接指向该项目里的用法。',
    lessonEmphasis: '每节都说明这个知识点在当前项目里用在什么地方，并给出可执行的下一步；动手单元要写清验收标准。',
  },
  {
    id: 'sprint',
    label: '技能速成',
    tagline: '80/20 最短路径',
    audience: '只求能在短时间内上手干活、不需要完整理论体系的人',
    exampleTopic: 'Excel 数据透视表速成',
    prefs: { goal: 'starter', level: 'some', weeklyHours: 6, lessonMinutes: 30 },
    focus: '速成：只保留能立刻上手干活的最小充分集合，明确砍掉理论枝节，但绝不省略安全与常见坑。',
    outlineEmphasis: '知识点数量尽量控制在 5-7 个，每个都必须对应一个「马上能用」的操作或判断。',
    lessonEmphasis: '每节保持在最短路径上：先给可直接照做的步骤，再补一句为什么；明确写出什么时候不该用这个方法。',
  },
  {
    id: 'gap',
    label: '查漏补缺',
    tagline: '按薄弱点补',
    audience: '已经学过一遍、但某些环节总是不顺、需要定点补强的人',
    exampleTopic: '线性代数：特征值与特征向量补强',
    prefs: { goal: 'advanced', level: 'advanced', weeklyHours: 4, lessonMinutes: 40 },
    focus: '查漏补缺：假定学习者已学过主干内容，重点放在易混、易错的边界情形与它和相邻概念的关系上。',
    outlineEmphasis: '知识点要围绕「容易搞混的边界与前置缺口」组织；允许直接跳过最简单的入门内容，但必须补齐被跳过内容的前置依赖。',
    lessonEmphasis: '每节先点明常见误解或断裂点，再对照正确理解；基础内容只作快速复述，重点放在区别与适用条件上。',
  },
];

export const DEFAULT_TEMPLATE_ID = 'custom';

const BY_ID = new Map(COURSE_TEMPLATES.map((template) => [template.id, template]));

export const TEMPLATE_IDS = COURSE_TEMPLATES.map((template) => template.id);

/** 受信任的模板查询；未知 id 一律返回 null（调用方回退到通用取向，不注入任何文本）。 */
export function getTemplate(id) {
  return BY_ID.get(String(id || '')) || null;
}

export function isKnownTemplateId(id) {
  return BY_ID.has(String(id || ''));
}

/**
 * 归一化模板输入：只接受受信任的 id，其他一切（未知、伪造、超长、非字符串）
 * 都退化为默认自定义模板。返回的 `id` 一定在 `TEMPLATE_IDS` 内。
 */
export function normalizeTemplateId(raw) {
  const id = typeof raw === 'string' ? raw.trim().slice(0, 40) : '';
  return BY_ID.has(id) ? id : DEFAULT_TEMPLATE_ID;
}

/** 选择模板时要写入的偏好（全部落在既有范围内；自定义返回空对象）。 */
export function templatePreferences(id) {
  const template = getTemplate(id);
  if (!template?.prefs) return {};
  const { goal, level, weeklyHours, lessonMinutes } = template.prefs;
  return {
    goal: goalIds.has(goal) ? goal : undefined,
    level: levelIds.has(level) ? level : undefined,
    weeklyHours: clamp(weeklyHours, MIN_WEEKLY_HOURS, MAX_WEEKLY_HOURS, undefined),
    lessonMinutes: clamp(lessonMinutes, MIN_LESSON_MINUTES, MAX_LESSON_MINUTES, undefined),
  };
}

/**
 * 生成身份里使用的模板签名：模板换了就等于换了需求，不能静默续跑旧正文。
 * 只包含受信任的 id 与它带来的受控取向文本，不包含任何用户输入。
 */
export function templateSignature(id) {
  const template = getTemplate(id) || BY_ID.get(DEFAULT_TEMPLATE_ID);
  return JSON.stringify({
    id: template.id,
    focus: template.focus,
    outlineEmphasis: template.outlineEmphasis,
    lessonEmphasis: template.lessonEmphasis,
  });
}

/** 给提示词用的受控取向说明；自定义返回空串（提示词与旧版本完全一致）。 */
export function templateFocusFor(id, { stage = 'outline' } = {}) {
  const template = getTemplate(id);
  if (!template) return '';
  if (stage === 'lesson') return template.lessonEmphasis || template.focus || '';
  return template.outlineEmphasis || template.focus || '';
}

/** 请求体里携带的模板元数据（只发 id，不发文本）。 */
export function toTemplatePayload(id) {
  const normalized = normalizeTemplateId(id);
  return normalized === DEFAULT_TEMPLATE_ID ? {} : { templateId: normalized };
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
