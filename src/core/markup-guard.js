/**
 * HTML / 脚本注入检测（Worker 与前端共用同一实现，避免两套规则漂移）。
 *
 * 为什么不用宽松的 `/<\/?[a-z][\s\S]*?>/i`：
 * 编程与数学内容里天然会出现 `<class 'int'>`、`List<int>`、`a<b and c>d`
 * 这类文本。宽松规则会把它们当成 HTML 标签，导致**合法课程被拒绝**——
 * 实测中 Python 课程就因为正文里的 `<class 'int'>` 整段被拦下。
 *
 * 因此这里只拦截「形状上确实是标签」的四类情况：
 *   1. 闭合标签        </div>
 *   2. 带属性的开标签  <div class="x"> / <img src=x>
 *   3. 已知元素名      <script> / <div> / <iframe>
 *   4. 事件处理属性    onclick= / onerror=
 *
 * 安全边界说明：渲染层始终使用 textContent 构建 DOM（全项目没有 innerHTML、
 * insertAdjacentHTML 或 outerHTML），因此这是纵深防御，而不是唯一的注入屏障。
 */

const KNOWN_ELEMENTS = [
  'script', 'style', 'iframe', 'object', 'embed', 'applet', 'img', 'image', 'svg', 'math',
  'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'template',
  'body', 'html', 'head', 'title', 'div', 'span', 'table', 'tbody', 'thead', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'br', 'hr', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'canvas', 'video', 'audio', 'source', 'track', 'marquee', 'noscript', 'frameset', 'frame',
  'param', 'col', 'colgroup',
].join('|');

const RE_CLOSING_TAG = /<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/;
const RE_TAG_WITH_ATTRS = /<[a-zA-Z][a-zA-Z0-9-]*\s+[a-zA-Z-]+\s*=/;
const RE_KNOWN_ELEMENT = new RegExp(`<(${KNOWN_ELEMENTS})\\b[^<>]*>`, 'i');
const RE_EVENT_HANDLER = /\son[a-z]+\s*=/i;

/** 是否包含形如 HTML 标签的片段。 */
export function containsHtmlMarkup(value) {
  const text = String(value ?? '');
  if (text === '') return false;
  if (RE_EVENT_HANDLER.test(text)) return true;
  if (RE_CLOSING_TAG.test(text)) return true;
  if (RE_TAG_WITH_ATTRS.test(text)) return true;
  if (RE_KNOWN_ELEMENT.test(text)) return true;
  return false;
}

export { KNOWN_ELEMENTS };
