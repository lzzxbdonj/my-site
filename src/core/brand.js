/**
 * 品牌唯一来源：界面上的产品名只在这里写一次，避免各处硬编码后逐渐不一致。
 *
 * 重要边界（改名不影响数据）：
 *  - 这里只改**用户可见**的品牌文案；
 *  - localStorage 键、备份文件里的 app/schema 标识、Worker 名与 Durable Object
 *    迁移名等**技术标识保持原样**（'studymate.state.v1'、'studymate-web'、
 *    'studymate-ai-proxy'、'RateLimiter'），否则老用户的进度与备份会读不出来；
 *  - 上游项目 Study-Mate 的 URL、MIT 许可与 Cattofu 版权声明原样保留在
 *    NOTICE / LICENSE / 关于页，不因改名而改动。
 */

/** 用户可见产品名（注意：用户指定的写法是「ai自学通」，ai 为小写）。 */
export const PRODUCT_NAME = 'ai自学通';

/** 主标题后缀：标题栏与 SEO 用。 */
export const PRODUCT_TAGLINE = '定制课程 · 精选视频 · 本地进度';

/** 品牌无障碍标签（导航 logo 与关于页）。 */
export const BRAND_ARIA_LABEL = `${PRODUCT_NAME} 首页`;

/** 品牌标记的替代文本（原创几何图形，不含任何上游角色形象）。 */
export const PRODUCT_MARK_LABEL = `${PRODUCT_NAME} 的品牌标记`;

/** 文档标题：`<页面> · ai自学通`；没有页面名时只显示产品名。 */
export function brandDocumentTitle(section = '') {
  const trimmed = String(section || '').trim();
  return trimmed ? `${trimmed} · ${PRODUCT_NAME}` : PRODUCT_NAME;
}

/**
 * 备份文件名前缀：刻意**保持原样**（studymate-backup-...）。
 * 旧备份文件名与导入流程都按这个前缀被识别/说明，改名不应改变数据交换格式。
 */
export const BACKUP_FILE_PREFIX = 'studymate-backup';

/** 一段话说明：这是同一个产品的品牌名，数据没有迁移。 */
export const BRAND_DATA_NOTE = `本页面当前的产品名是「${PRODUCT_NAME}」；本地存储键、备份标识与 Worker 名称等技术标识保持不变，因此改名前后已有的进度与备份仍然可以继续使用。`;
