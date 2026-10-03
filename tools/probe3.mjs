import { writeFileSync } from 'node:fs';
const kws = [
  '3Blue1Brown 线性代数的本质',
  '线性代数 MIT 18.06 Gilbert Strang',
  'Python 入门 尚硅谷',
  'Python 教程 黑马程序员',
  '机器学习 吴恩达',
  '机器学习 入门 李宏毅',
  '微积分 本质 3Blue1Brown',
  '概率论 与 数理统计 公开课',
  '数据结构与算法 王卓',
  '李永乐 线性代数'
];
const out = { fetchedAt: new Date().toISOString(), queries: {} };
async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0' } });
    return { status: res.status, text: await res.text() };
  } catch (e) { return { status: 0, error: String((e && e.message) || e) }; }
  finally { clearTimeout(t); }
}
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '');
for (const kw of kws) {
  const r = await get('https://api.bilibili.com/x/web-interface/search/all/v2?keyword=' + encodeURIComponent(kw));
  const entry = { status: r.status, error: r.error || null, videos: [] };
  if (r.status === 200) {
    try {
      const j = JSON.parse(r.text);
      const grp = (j.data.result || []).find((x) => x.result_type === 'video');
      for (const v of (grp ? grp.data : []).slice(0, 12)) {
        entry.videos.push({ bvid: v.bvid, title: strip(v.title), author: v.author, mid: v.mid, duration: v.duration, play: v.play, pubdate: v.pubdate, typename: v.typename });
      }
    } catch (e) { entry.parseError = String(e.message); }
  }
  out.queries[kw] = entry;
  console.log('== ' + kw + ' status=' + r.status);
  for (const v of entry.videos) console.log('   ' + v.bvid + ' | ' + v.author + ' (mid ' + v.mid + ') | ' + v.duration + ' | ' + v.title);
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
