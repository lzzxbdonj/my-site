/**
 * GitHub 登录的浏览器端到端测试（模拟 Worker，**不访问 github.com、不产生任何费用**）。
 *
 * 覆盖真实用户路径：设置页点击「用 GitHub 登录」→ Worker 返回授权地址 → 浏览器跳转回本站
 * → 前端从回跳地址取令牌 → 用 Bearer 校验会话 → 界面显示已登录 → 地址栏不再残留令牌。
 * 另外覆盖：令牌无效时自我清除、以及令牌不会进入主状态（导出备份不含它）。
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { createStaticServer } from '../../scripts/serve.mjs';
import { launchBrowser, openPage, findBrowser, captureEvidence, cleanupCacheProfiles, evidenceCaptureEnabled } from './cdp.mjs';
import { mkdir } from 'node:fs/promises';

const root = path.resolve(import.meta.dirname, '../..');
const evidenceDir = path.join(root, 'docs', 'evidence');

const VALID_TOKEN = 'c2Vzc2lvbg.valid-signature';
const REJECTED_TOKEN = 'c2Vzc2lvbg.rejected-signature';

let siteServer;
let apiServer;
let browser;
let page;
let baseUrl;
let apiUrl;
const apiState = { requests: [] };

function startApi() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        apiState.requests.push({ url: req.url, method: req.method, headers: req.headers, body });
        const headers = {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type, authorization',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        };
        if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
        const pathname = String(req.url).split('?')[0];

        if (pathname === '/api/health') {
          res.writeHead(200, headers);
          res.end(JSON.stringify({ ok: true, service: 'mock', model: 'mock-model', auth: { enabled: true, error: null } }));
          return;
        }
        if (pathname === '/api/auth/login') {
          // 真实场景这里指向 github.com；测试里直接指回本站的回跳地址，
          // 这样可以在**不访问外网**的前提下走完整的「跳转 → 取令牌」流程。
          const returnTo = new URL(req.url, 'http://127.0.0.1').searchParams.get('return') || baseUrl;
          res.writeHead(200, headers);
          res.end(JSON.stringify({
            ok: true,
            url: `${returnTo}#/auth/complete?token=${encodeURIComponent(VALID_TOKEN)}`,
            returnTo,
            scope: 'read:user',
          }));
          return;
        }
        if (pathname === '/api/auth/me') {
          const auth = req.headers.authorization || '';
          if (auth === `Bearer ${VALID_TOKEN}`) {
            res.writeHead(200, headers);
            res.end(JSON.stringify({ ok: true, user: { sub: '4242', login: 'octocat', name: '测试用户', issuedAt: 1, expiresAt: 2 } }));
            return;
          }
          res.writeHead(401, headers);
          res.end(JSON.stringify({ ok: false, error: 'unauthorized', reason: 'bad-signature', message: '请重新登录。' }));
          return;
        }
        res.writeHead(404, headers);
        res.end(JSON.stringify({ ok: false, error: 'not-found' }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

before(async () => {
  assert.ok(findBrowser(), '未找到 Edge/Chrome');
  if (evidenceCaptureEnabled()) await mkdir(evidenceDir, { recursive: true });
  siteServer = createStaticServer(path.join(root, 'dist'));
  await new Promise((resolve) => siteServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${siteServer.address().port}`;
  apiServer = await startApi();
  apiUrl = `http://127.0.0.1:${apiServer.address().port}`;
  browser = await launchBrowser({ url: 'about:blank' });
  page = await openPage(browser.port, { url: 'about:blank' });
});

after(async () => {
  page?.close();
  await cleanupCacheProfiles(root);
  if (browser) await browser.close();
  if (siteServer) await new Promise((resolve) => siteServer.close(resolve));
  if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
});

async function goto(hash) {
  await page.goto(`${baseUrl}/index.html${hash}`, { waitMs: 400 });
  await page.waitFor('window.__STUDYMATE__');
}

async function configureWorker() {
  await goto('#/settings');
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-focus-key="ai-worker"]');
    input.value = ${JSON.stringify(apiUrl)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.ok(await page.waitFor('document.querySelector(".view-settings")'), '设置页应保持渲染');
}

const tokenInStorage = () => page.evaluate(`window.localStorage.getItem('studymate.auth.v1')`);

test('GitHub 登录：点击登录 → 跳回本站 → 校验会话 → 显示已登录，且地址栏不再残留令牌', async () => {
  apiState.requests.length = 0;
  await configureWorker();

  const panelText = await page.textOf('.view-settings');
  assert.match(panelText, /账号（可选，GitHub 登录）/, '设置页应有账号面板');
  assert.match(panelText, /未登录|尚未检查/, '初始应为未登录或未检查');

  const clicked = await page.clickByText('.panel-actions button', '用 GitHub 登录');
  assert.ok(clicked, '未找到「用 GitHub 登录」按钮');

  // 等待**终态**：界面显示已登录、且地址栏不再带令牌。
  // （只等「设置页 + 无 token」会立刻成立——点击后页面还停在设置页，属于竞态。）
  assert.ok(await page.waitFor(
    'document.querySelector(".view-settings") && document.body.innerText.indexOf("已登录") !== -1 && window.location.hash.indexOf("token=") === -1',
    { timeoutMs: 20000 },
  ), '应完成登录并离开带令牌的地址');

  const loginReq = apiState.requests.find((r) => r.url.includes('/api/auth/login'));
  assert.ok(loginReq, '应调用 /api/auth/login');
  assert.match(decodeURIComponent(loginReq.url), /return=http/, '应带上本站回跳地址');

  // 带 authorization 头的才是真正的会话校验请求（前面还有一次 CORS 预检）
  const meReqs = apiState.requests.filter((r) => r.url.includes('/api/auth/me') && r.headers.authorization);
  assert.ok(meReqs.length >= 1, '应调用 /api/auth/me 校验会话');
  assert.equal(meReqs[0].headers.authorization, `Bearer ${VALID_TOKEN}`, '必须用 Authorization 头（跨站不能用 Cookie）');

  assert.equal(await tokenInStorage(), VALID_TOKEN, '令牌应保存在独立存储键里');

  const afterText = await page.textOf('.view-settings');
  assert.match(afterText, /已登录：测试用户/, '界面应显示已登录用户');
  assert.match(afterText, /@octocat/, '应显示 GitHub 用户名');

  // 令牌不能泄漏进主状态（导出备份因此不会包含它）
  const mainState = await page.evaluate(`window.localStorage.getItem('studymate.state.v1') || ''`);
  assert.ok(!mainState.includes(VALID_TOKEN), '令牌绝不能进入主状态对象');

  await captureEvidence(page, path.join(evidenceDir, 'auth-signed-in.png'));
});

test('令牌被服务端拒绝时：本地令牌自动清除，界面回到未登录', async () => {
  await goto('#/settings');
  await page.evaluate(`window.localStorage.setItem('studymate.auth.v1', ${JSON.stringify(REJECTED_TOKEN)})`);
  await configureWorker();

  assert.ok(await page.clickByText('.panel-actions button', '检查登录状态'), '未找到「检查登录状态」按钮');
  assert.ok(await page.waitFor(`window.localStorage.getItem('studymate.auth.v1') === null`, { timeoutMs: 15000 }),
    '无效令牌必须被清除，不能留下「看起来已登录」的假状态');

  const text = await page.textOf('.view-settings');
  assert.match(text, /未登录|过期/, '应回到未登录或提示过期');
});

test('回跳地址里的垃圾令牌不会被写进存储', async () => {
  await page.evaluate('window.localStorage.removeItem("studymate.auth.v1")');
  await goto('#/auth/complete?token=not-a-valid-token');
  assert.ok(await page.waitFor('document.querySelector(".view-settings")', { timeoutMs: 15000 }), '应跳回设置页');
  assert.equal(await tokenInStorage(), null, '非法令牌不得写入存储');
  assert.equal(await page.count('.preview-panel'), 0);
});

test('退出登录：清除令牌但不影响本地课程进度', async () => {
  await configureWorker();
  await page.evaluate(`window.localStorage.setItem('studymate.auth.v1', ${JSON.stringify(VALID_TOKEN)})`);
  await page.clickByText('.panel-actions button', '检查登录状态');
  assert.ok(await page.waitFor('document.querySelector(".view-settings")'), '设置页应保持渲染');

  // 造一条学习进度，确认退出登录不会把它清掉
  await page.evaluate(`(() => {
    const raw = JSON.parse(window.localStorage.getItem('studymate.state.v1') || '{}');
    raw.profile = { ...(raw.profile || {}), goal: 'starter', level: 'new' };
    raw.notes = { 'python/py-setup': [{ id: 'n1', text: '退出登录不应删除这条笔记', createdAt: '2026-01-01T00:00:00.000Z' }] };
    window.localStorage.setItem('studymate.state.v1', JSON.stringify(raw));
  })()`);
  await goto('#/settings');

  assert.ok(await page.clickByText('.panel-actions button', '退出登录'), '未找到「退出登录」按钮');
  assert.equal(await tokenInStorage(), null, '退出登录必须清除令牌');
  const state = await page.evaluate(`window.localStorage.getItem('studymate.state.v1') || ''`);
  assert.match(state, /退出登录不应删除这条笔记/, '退出登录不得影响本地学习数据');
  const text = await page.textOf('.view-settings');
  assert.match(text, /未登录|尚未检查/, '界面应回到未登录状态');
});
