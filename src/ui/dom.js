/**
 * 极小 DOM 构造工具。
 * 关键约定：字符串内容一律通过 textContent 写入，绝不拼接 HTML，
 * 因此课程数据、用户笔记、导入的备份都不构成 XSS 风险。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'ellipse', 'defs', 'linearGradient', 'stop', 'use', 'title', 'tspan', 'mask']);

/**
 * 创建元素。
 * @param {string} tag
 * @param {object} [props] 允许：class / text / attrs / dataset / style / on / ref
 * @param {...(Node|string|null|false|Array)} children
 */
export function h(tag, props = {}, ...children) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class' || key === 'className') el.setAttribute('class', String(value));
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'attrs') {
      for (const [k, v] of Object.entries(value)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) el.dataset[k] = String(v);
    } else if (key === 'style') {
      for (const [k, v] of Object.entries(value)) el.style.setProperty(k, String(v));
    } else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) if (typeof handler === 'function') el.addEventListener(event, handler);
    } else if (key === 'ref') {
      if (typeof value === 'function') value(el);
    } else if (key === 'value' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      el.value = String(value);
    } else if (key === 'checked' && el.tagName === 'INPUT') {
      el.checked = Boolean(value);
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

function append(el, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (typeof child === 'string' || typeof child === 'number') el.appendChild(document.createTextNode(String(child)));
    else if (child instanceof Node) el.appendChild(child);
  }
}

/** 文本节点（显式表达「这里是纯文本」）。 */
export function text(value) {
  return document.createTextNode(String(value));
}

/** 清空并替换容器内容。 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function renderInto(container, node) {
  clear(container);
  if (Array.isArray(node)) node.forEach((n) => container.appendChild(n));
  else if (node) container.appendChild(node);
  return container;
}
