/**
 * 联网搜索 + 核实视频的测试（全部使用假的 fetch，不访问外网）。
 *
 * 重点守护的行为：
 *  - 只认 bvid，观看链接由服务端自己拼，**绝不使用接口返回的 URL**；
 *  - 标题里的 `<em>` 高亮标签、HTML 实体必须被清洗；
 *  - 没有 bvid 的条目（广告位）被丢弃；
 *  - 详情接口 `code !== 0`、或返回的 bvid 与请求不一致 → 视为未核实，不加进课程；
 *  - 搜索/核实失败一律返回空数组，**绝不影响建课**。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { searchVideosOnline } from '../../worker/src/video-search.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockBilibili({ searchCode = 0, results = [], viewByBvid = {} } = {}) {
  const calls = [];
  const impl = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/search/type')) {
      return json({ code: searchCode, data: { result: results } });
    }
    if (target.includes('/view')) {
      const bvid = new URL(target).searchParams.get('bvid');
      const view = viewByBvid[bvid];
      if (!view) return json({ code: -404, message: '啥都木有' });
      return json({ code: 0, data: view });
    }
    return json({ code: -1 }, 404);
  };
  return { impl, calls };
}

const result = (bvid, title, author = '某UP', duration = 600) => ({ bvid, title, author, duration });

test('搜索并核实：只保留核实通过的视频，链接由服务端拼', async () => {
  const mock = mockBilibili({
    results: [result('BV1NX4y1K75G', 'Python基础语法：<em class="keyword">列表</em>'), result('', '广告位')],
    viewByBvid: {
      BV1NX4y1K75G: { bvid: 'BV1NX4y1K75G', title: 'Python基础语法：列表', owner: { name: '周周学Python' }, duration: 620 },
    },
  });
  const found = await searchVideosOnline({ keywords: ['列表'], fetchImpl: mock.impl });
  assert.equal(found.videos.length, 1);
  const video = found.videos[0];
  assert.equal(video.id, 'BV1NX4y1K75G');
  assert.equal(video.title, 'Python基础语法：列表', '标题里的 <em> 高亮标签必须清掉');
  assert.equal(video.creator, '周周学Python', '作者应以详情接口为准');
  assert.equal(video.durationSeconds, 620);
  assert.equal(video.watchUrl, 'https://www.bilibili.com/video/BV1NX4y1K75G', '链接必须由服务端自己拼');
  assert.equal(video.source, 'online-search');
  assert.ok(video.verifiedAt, '应记录核实时间');
});

test('详情接口返回别的 bvid：视为未核实，不加进课程', async () => {
  const mock = mockBilibili({
    results: [result('BV1NX4y1K75G', '标题')],
    viewByBvid: { BV1NX4y1K75G: { bvid: 'BV0000000000', title: '另一个视频' } },
  });
  const found = await searchVideosOnline({ keywords: ['列表'], fetchImpl: mock.impl });
  assert.deepEqual(found.videos, [], 'bvid 不一致必须拒绝');
});

test('详情接口 code !== 0（视频被删/不存在）：不加进课程', async () => {
  const mock = mockBilibili({ results: [result('BV1NX4y1K75G', '标题')], viewByBvid: {} });
  const found = await searchVideosOnline({ keywords: ['列表'], fetchImpl: mock.impl });
  assert.deepEqual(found.videos, []);
});

test('搜索结果里的非视频条目（无 bvid）被丢弃', async () => {
  const mock = mockBilibili({ results: [result('', '推广'), result('not-a-bvid', '奇怪条目')] });
  const found = await searchVideosOnline({ keywords: ['列表'], fetchImpl: mock.impl });
  assert.deepEqual(found.videos, []);
  assert.equal(found.reason, 'no-candidates');
});

test('绝不使用接口返回的 URL（即使返回了恶意链接）', async () => {
  const mock = mockBilibili({
    results: [{ bvid: 'BV1NX4y1K75G', title: '标题', author: 'UP', arcurl: 'https://evil.example/steal' }],
    viewByBvid: { BV1NX4y1K75G: { bvid: 'BV1NX4y1K75G', title: '标题', owner: { name: 'UP' }, duration: 10 } },
  });
  const found = await searchVideosOnline({ keywords: ['列表'], fetchImpl: mock.impl });
  assert.equal(found.videos[0].watchUrl, 'https://www.bilibili.com/video/BV1NX4y1K75G');
  assert.ok(!JSON.stringify(found.videos).includes('evil.example'), '响应里的外部链接绝不能被带出来');
});

test('搜索接口失败、超时、返回非 JSON：一律返回空数组，不抛错（不能影响建课）', async () => {
  const failing = async () => { throw new Error('network down'); };
  const a = await searchVideosOnline({ keywords: ['列表'], fetchImpl: failing });
  assert.deepEqual(a.videos, []);

  const notJson = async () => new Response('<html>被拦截</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const b = await searchVideosOnline({ keywords: ['列表'], fetchImpl: notJson });
  assert.deepEqual(b.videos, []);

  const blocked = async () => json({ code: -412, message: '请求被拦截' });
  const c = await searchVideosOnline({ keywords: ['列表'], fetchImpl: blocked });
  assert.deepEqual(c.videos, []);
  assert.equal(c.reason, 'no-candidates');
});

test('没有可用关键词时不发请求', async () => {
  let called = 0;
  const impl = async () => { called += 1; return json({}); };
  const found = await searchVideosOnline({ keywords: ['', ' a '], fetchImpl: impl });
  assert.deepEqual(found.videos, []);
  assert.equal(called, 0);
  assert.equal(found.reason, 'no-keywords');
});

test('最多返回 limit 条，且不重复', async () => {
  const bvids = ['BV1NX4y1K75G', 'BV1tDsgzxECr', 'BV1aaaaaaaaa', 'BV1bbbbbbbbb'];
  const mock = mockBilibili({
    results: bvids.map((bvid) => result(bvid, `标题${bvid}`)),
    viewByBvid: Object.fromEntries(bvids.map((bvid) => [bvid, { bvid, title: `标题${bvid}`, owner: { name: 'UP' }, duration: 100 }])),
  });
  const found = await searchVideosOnline({ keywords: ['列表'], limit: 2, fetchImpl: mock.impl });
  assert.equal(found.videos.length, 2);
  assert.equal(new Set(found.videos.map((v) => v.id)).size, 2, '不得重复');
});
