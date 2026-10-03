import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBilibiliRef,
  classifyVideoUrl,
  buildBilibiliEmbed,
  resolveVideoPlayback,
  verificationBadge,
  isSafeHttpUrl,
  isHttpsUrl,
  extractYouTubeId,
} from '../../src/core/video.js';
import { VIDEO_LIBRARY, VERIFIED_AT } from '../../src/data/videos.js';
import { COURSES } from '../../src/data/courses.js';

test('B 站链接解析支持多种写法并拒绝非法输入', () => {
  assert.deepEqual(parseBilibiliRef('https://www.bilibili.com/video/BV1tDsgzxECr'), { ok: true, bvid: 'BV1tDsgzxECr', page: 1 });
  assert.deepEqual(parseBilibiliRef('https://www.bilibili.com/video/BV1tDsgzxECr?p=35'), { ok: true, bvid: 'BV1tDsgzxECr', page: 35 });
  assert.deepEqual(parseBilibiliRef('https://player.bilibili.com/player.html?bvid=BV1tDsgzxECr&page=2'), { ok: true, bvid: 'BV1tDsgzxECr', page: 2 });
  assert.equal(parseBilibiliRef('https://m.bilibili.com/video/BV1tDsgzxECr').ok, true);
  assert.equal(parseBilibiliRef('https://www.youtube.com/watch?v=abc').ok, false, '非 B 站域名应拒绝');
  assert.equal(parseBilibiliRef('https://www.bilibili.com/video/BV123').ok, false, '非法 BV 号应拒绝');
  assert.equal(parseBilibiliRef('').ok, false);
  assert.equal(parseBilibiliRef('https://www.bilibili.com/video/BV1tDsgzxECr?p=0').page, 1, '非法分 P 回退为 1');
});

test('视频链接校验拒绝危险协议，只接受 http(s)', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'about:blank', 'blob:https://x/y']) {
    const result = classifyVideoUrl(bad);
    assert.equal(result.ok, false, `${bad} 不应通过`);
  }
  assert.equal(classifyVideoUrl('https://example.com/lesson').ok, true);
  assert.equal(classifyVideoUrl('https://example.com/lesson').embeddable, false, '未知来源只能外链打开');
  assert.equal(classifyVideoUrl('http://example.com/lesson').ok, false, '明文 http 外部链接应拒绝');
  const bili = classifyVideoUrl('https://www.bilibili.com/video/BV1tDsgzxECr?p=3');
  assert.equal(bili.provider, 'bilibili');
  assert.equal(bili.embeddable, true);
  assert.equal(bili.playbackVerified, false, '不得声称播放已验证');
  assert.equal(isSafeHttpUrl('https://x.com'), true);
  assert.equal(isSafeHttpUrl('javascript:x'), false);
  assert.equal(isHttpsUrl('http://x.com'), false);
});

test('YouTube 只做格式校验，并如实说明无法验证', () => {
  const result = classifyVideoUrl('https://www.youtube.com/watch?v=rfscVS0vtbw');
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'youtube');
  assert.equal(result.playbackVerified, false);
  assert.match(result.note, /无法访问|未做/);
  assert.equal(extractYouTubeId('https://youtu.be/rfscVS0vtbw'), 'rfscVS0vtbw');
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=short'), null);
});

test('播放器地址只由合法 BV 号生成', () => {
  const embed = buildBilibiliEmbed('BV1tDsgzxECr', 7);
  assert.match(embed, /^https:\/\/player\.bilibili\.com\/player\.html\?bvid=BV1tDsgzxECr&page=7/);
  assert.equal(buildBilibiliEmbed('not-a-bv', 1), null);
  assert.match(buildBilibiliEmbed('BV1tDsgzxECr', 0), /page=1/, '非法分 P 回退为 1');
});

test('渲染边界再次过滤不安全链接（防止导入的恶意数据被点开）', () => {
  const playback = resolveVideoPlayback({ provider: 'bilibili', bvid: 'BV1tDsgzxECr', watchUrl: 'javascript:alert(1)' });
  assert.equal(playback.watchUrl, '', '不安全的 watchUrl 必须被清空');
  assert.match(playback.embedUrl, /^https:\/\/player\.bilibili\.com/, '但合法的 bvid 仍可生成播放器地址');
  const external = resolveVideoPlayback({ provider: 'external', watchUrl: 'http://example.com/x' });
  assert.equal(external.embeddable, false);
  assert.equal(resolveVideoPlayback(null).watchUrl, '');
});

test('来源徽标如实区分「官方认证 / 未认证 / 用户自定义 / 未验证」', () => {
  assert.equal(verificationBadge({ verification: { status: 'ok', creatorVerified: true } }).level, 'verified-channel');
  assert.equal(verificationBadge({ verification: { status: 'ok', creatorVerified: false } }).level, 'verified-page');
  assert.equal(verificationBadge({ sourceKind: 'user' }).level, 'user');
  assert.equal(verificationBadge({}).level, 'unknown');
  assert.match(verificationBadge({ sourceKind: 'user' }).label, /未验证/);
});

test('精选视频库自检：字段完整、链接安全、不声称播放已验证', () => {
  assert.match(VERIFIED_AT, /^\d{4}-\d{2}-\d{2}$/);
  for (const video of VIDEO_LIBRARY) {
    assert.ok(isHttpsUrl(video.watchUrl), `${video.id} 的 watchUrl 必须是 https`);
    assert.equal(video.playbackVerified, false, `${video.id} 不得标记为播放已验证`);
    assert.equal(video.verification.status, 'ok', `${video.id} 需要有可核实的来源记录`);
    assert.ok(video.verification.checkedAt, `${video.id} 缺少核实日期`);
    assert.ok(video.creator, `${video.id} 缺少作者信息`);
    assert.ok(video.reason && video.reason.length >= 10, `${video.id} 必须给出入选理由`);
    assert.ok(Array.isArray(video.knowledgePoints), `${video.id} 的 knowledgePoints 必须是数组`);
  }
  const bilibili = VIDEO_LIBRARY.filter((v) => v.provider === 'bilibili');
  assert.ok(bilibili.length >= 30, `B 站精选视频应不少于 30 条，实际 ${bilibili.length}`);
  assert.ok(bilibili.every((v) => /^BV[0-9A-Za-z]{10}$/.test(v.bvid)), '每条 B 站视频都要有合法 BV 号');
  assert.ok(VIDEO_LIBRARY.every((v) => !/\b(https?:\/\/localhost|javascript:)/i.test(v.watchUrl)), '不得出现本地或脚本链接');
});

test('知识点映射必须双向一致，拓展材料不得冒充知识点视频', () => {
  const concepts = new Map();
  for (const course of COURSES) for (const concept of course.concepts) concepts.set(concept.id, { courseId: course.id, videoIds: concept.videoIds || [] });
  for (const video of VIDEO_LIBRARY) {
    for (const kp of video.knowledgePoints) {
      const meta = concepts.get(kp);
      assert.ok(meta, `${video.id} 指向了不存在的知识点 ${kp}`);
      assert.ok(meta.videoIds.includes(video.id), `知识点 ${kp} 的课时没有引用 ${video.id}`);
    }
    if (video.enrichment) assert.deepEqual(video.knowledgePoints, [], `${video.id} 标为拓展材料时不应绑定知识点`);
    else assert.ok(video.knowledgePoints.length > 0, `${video.id} 必须绑定至少一个知识点，或标记为拓展材料`);
  }
  for (const [id, meta] of concepts) {
    for (const videoId of meta.videoIds) {
      const video = VIDEO_LIBRARY.find((v) => v.id === videoId);
      assert.ok(video, `${id} 引用了不存在的视频 ${videoId}`);
      assert.ok(video.knowledgePoints.includes(id), `${id} 引用了 ${videoId}，但该视频未标注这个知识点`);
    }
  }
  const calc = VIDEO_LIBRARY.find((v) => v.id === 'bili-calc-01');
  assert.equal(calc.enrichment, true, '微积分动机视频应作为拓展材料，而不是线性代数知识点视频');
  assert.deepEqual(calc.knowledgePoints, []);
  const dot = VIDEO_LIBRARY.find((v) => v.id === 'bili-la-07');
  assert.equal(dot.enrichment, true, '点积对偶性视频不得冒充特征值知识点的配套视频');
});

test('每个概念课至少有一条配套视频，视频来源均为已核实账号或官方页面', () => {
  for (const course of COURSES) {
    for (const concept of course.concepts) {
      assert.ok((concept.videoIds || []).length > 0, `${course.id}/${concept.id} 缺少配套视频`);
    }
  }
  const creators = new Set(VIDEO_LIBRARY.map((v) => v.creator));
  for (const name of creators) {
    assert.ok(/3Blue1Brown|尚硅谷|黑马程序员|MIT OpenCourseWare/.test(name), `出现了未经筛选的来源：${name}`);
  }
});
