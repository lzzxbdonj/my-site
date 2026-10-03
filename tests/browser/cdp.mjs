/**
 * 极简 Chrome DevTools Protocol 客户端（零依赖）。
 * 用于在真实浏览器里跑端到端流程：Edge/Chrome 无头模式 + Node 内置 WebSocket。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const CANDIDATES = {
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

/** 项目根目录（所有测试产物都必须落在其中）。 */
export function projectRoot() {
  return path.resolve(import.meta.dirname, '../..');
}

/** 判断 target 是否位于 root 之内（含 root 自身）。 */
export function isContained(target, root) {
  const rel = path.relative(root, path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertContained(target, root) {
  if (!isContained(target, root)) {
    throw new Error(`拒绝在项目范围之外创建/删除内容：${target}`);
  }
  return target;
}

/**
 * 证据采集（截图与报告文件）是**显式 opt-in**：
 * 默认的验收运行不得改写仓库里已交付的 docs/evidence 资源。
 * 需要刷新截图时显式设置 STUDYMATE_CAPTURE_EVIDENCE=1。
 */
export function evidenceCaptureEnabled() {
  return process.env.STUDYMATE_CAPTURE_EVIDENCE === '1';
}

/** 仅在显式开启采集时写入截图；返回是否写入。 */
export async function captureEvidence(session, filePath) {
  if (!evidenceCaptureEnabled()) return false;
  await session.screenshot(filePath);
  return true;
}

/** 清理项目内 .cache 下的浏览器 profile（只删除经过包含性校验的目录）。 */
export async function cleanupCacheProfiles(root = projectRoot()) {
  const cacheRoot = path.join(root, '.cache');
  if (!existsSync(cacheRoot)) return 0;
  const { readdir } = await import('node:fs/promises');
  let removed = 0;
  for (const entry of await readdir(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.join(cacheRoot, entry.name);
    if (!isContained(target, cacheRoot) || target === cacheRoot) continue;
    await rm(target, { recursive: true, force: true }).catch(() => {});
    removed += 1;
  }
  return removed;
}

export function findBrowser() {
  const envPath = process.env.STUDYMATE_BROWSER;
  if (envPath && existsSync(envPath)) return envPath;
  for (const candidate of CANDIDATES[process.platform] || []) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function launchBrowser({ browserPath, url = 'about:blank' } = {}) {
  const executable = browserPath || findBrowser();
  if (!executable) throw new Error('未找到可用的浏览器（Edge/Chrome），无法运行浏览器测试');
  // 浏览器 profile / 缓存必须留在项目内（.cache/ 已加入 .gitignore），
  // 不污染系统临时目录，也不会写到冻结范围之外。
  const cacheRoot = path.join(projectRoot(), '.cache');
  await mkdir(cacheRoot, { recursive: true });
  const userDataDir = await mkdtemp(path.join(cacheRoot, 'browser-profile-'));
  assertContained(userDataDir, projectRoot());
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--window-size=1280,900',
    url,
  ];
  // stdio 使用 ignore：沙箱下抓取子进程管道会 EPERM
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
  const port = await waitForPort(userDataDir, child);
  const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
  const version = await versionRes.json();
  return {
    child,
    port,
    userDataDir,
    browser: version.Browser,
    close: async () => {
      try { child.kill(); } catch { /* ignore */ }
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          killer.on('exit', resolve);
          killer.on('error', resolve);
        });
      }
      // 只清理经过包含性校验的路径，避免误删其他目录
      if (isContained(userDataDir, projectRoot())) {
        await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

async function waitForPort(userDataDir, child, timeoutMs = 30000) {
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`浏览器进程提前退出，退出码 ${child.exitCode}`);
    if (existsSync(portFile)) {
      const content = await readFile(portFile, 'utf8').catch(() => '');
      const port = Number(content.split('\n')[0]);
      if (port > 0) return port;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('等待浏览器调试端口超时');
}

/** 打开一个新页面并返回会话对象。 */
export async function openPage(port, { url = 'about:blank' } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = await res.json();
  const session = await connect(target.webSocketDebuggerUrl);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  return session;
}

export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Set();
    const errors = [];

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message || 'CDP error'}`));
        else res(msg.result);
        return;
      }
      for (const listener of listeners) listener(msg);
    });
    ws.addEventListener('error', (event) => errors.push(event?.message || 'websocket error'));

    const session = {
      send(method, params = {}) {
        const id = nextId++;
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              rej(new Error(`CDP 调用超时：${method}`));
            }
          }, 30000);
        });
      },
      onEvent(handler) { listeners.add(handler); return () => listeners.delete(handler); },
      waitForEvent(method, timeoutMs = 20000) {
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { off(); rej(new Error(`等待事件超时：${method}`)); }, timeoutMs);
          const off = session.onEvent((msg) => {
            if (msg.method === method) { clearTimeout(timer); off(); res(msg.params); }
          });
        });
      },
      async evaluate(expression, { awaitPromise = true } = {}) {
        const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
        if (result.exceptionDetails) {
          throw new Error(`页面脚本异常：${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
        }
        return result.result.value;
      },
      async goto(url, { waitMs = 250 } = {}) {
        // 关键优化：只是 hash 变化（单页应用最常见的路由切换）时，不要等待 Page.loadEventFired。
        // 同文档内改 hash 不会再触发加载事件，等待它只能一路等到 20 秒超时；而 20 秒 × 每次路由
        // 跳转会让整个浏览器测试无谓地耗掉几分钟（冻结的 300 秒超时就是这么被吃掉的）。
        const diff = await session.evaluate(`(() => {
          try {
            const target = new URL(${JSON.stringify(url)}, location.href);
            if (location.href === target.href) return 'same';
            return target.origin === location.origin && target.pathname === location.pathname && target.search === location.search
              ? 'hash'
              : 'document';
          } catch { return 'document'; }
        })()`).catch(() => 'document');

        if (diff === 'same') {
          if (waitMs) await session.wait(waitMs);
          return;
        }
        if (diff === 'hash') {
          const changed = session.waitForEvent('Page.navigatedWithinDocument', 5000).catch(() => null);
          await session.send('Page.navigate', { url });
          await changed;
          if (waitMs) await session.wait(waitMs);
          return;
        }
        const loaded = session.waitForEvent('Page.loadEventFired', 20000).catch(() => null);
        await session.send('Page.navigate', { url });
        await loaded;
        if (waitMs) await session.wait(waitMs);
      },
      async reload({ waitMs = 250 } = {}) {
        const loaded = session.waitForEvent('Page.loadEventFired', 20000).catch(() => null);
        await session.send('Page.reload', { ignoreCache: true });
        await loaded;
        if (waitMs) await session.wait(waitMs);
      },
      wait(ms) { return new Promise((res) => setTimeout(res, ms)); },
      async setViewport(width, height, { mobile = false } = {}) {
        await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      },
      async screenshot(filePath) {
        const { data } = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const { writeFile, mkdir } = await import('node:fs/promises');
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, Buffer.from(data, 'base64'));
        return filePath;
      },
      /** 按可见文本点击元素（真实用户交互路径）。 */
      async clickByText(selector, text) {
        return session.evaluate(`(() => {
          const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
          const target = nodes.find((n) => (n.textContent || '').trim().includes(${JSON.stringify(text)}));
          if (!target) return false;
          target.click();
          return true;
        })()`);
      },
      async click(selector) {
        return session.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.click();
          return true;
        })()`);
      },
      async textOf(selector) {
        return session.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          return el ? (el.textContent || '').trim() : null;
        })()`);
      },
      async count(selector) {
        return session.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
      },
      /** 等待某个条件成立（轮询页面内表达式）。 */
      async waitFor(expression, { timeoutMs = 8000, interval = 100 } = {}) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await session.evaluate(`Boolean(${expression})`).catch(() => false);
          if (value) return true;
          await session.wait(interval);
        }
        return false;
      },
      close() { try { ws.close(); } catch { /* ignore */ } },
      get errors() { return errors; },
    };

    ws.addEventListener('open', () => resolve(session));
    ws.addEventListener('error', (event) => {
      if (pending.size === 0 && !ws.OPEN) reject(new Error(`无法连接调试端口：${event?.message || 'websocket 连接失败'}`));
    });
    setTimeout(() => { if (ws.readyState !== 1) reject(new Error('连接浏览器调试端口超时')); }, 15000);
  });
}

