import { writeFileSync } from 'node:fs';
async function api(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try { const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 Chrome/124.0' } }); const text = await res.text(); try { return JSON.parse(text); } catch (e) { return null; } }
  catch (e) { return null; } finally { clearTimeout(t); }
}
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '');
const found = new Map();
for (const kw of ['3Blue1Brown 线性代数', '线性代数的本质', '线性代数的本质 特征向量', '线性代数的本质 行列式', '线性代数的本质 点积', '线性代数的本质 逆矩阵']) {
  for (let p = 1; p <= 3; p++) {
    const res = await api('https://api.bilibili.com/x/web-interface/search/all/v2?keyword=' + encodeURIComponent(kw) + '&page=' + p);
    const grp = res && res.data && (res.data.result || []).find((x) => x.result_type === 'video');
    for (const v of ((grp ? grp.data : []) || [])) if (v.mid === 88461692) found.set(v.bvid, { bvid: v.bvid, title: strip(v.title), duration: v.duration, pubdate: v.pubdate });
  }
}
console.log('=== 3Blue1Brown official LA/calc episodes found: ' + found.size);
for (const v of found.values()) console.log(v.bvid + ' | ' + v.duration + ' | ' + v.title);
const ml = {};
for (const bv of ['BV1BYe4z5E9z', 'BV1Fzszz4Ek7', 'BV1R4411N78S', 'BV1zb411P7iV']) {
  const res = await api('https://api.bilibili.com/x/web-interface/view?bvid=' + bv);
  const d = res && res.data;
  if (!d) { console.log('VIEW ' + bv + ' FAILED'); continue; }
  ml[bv] = { title: d.title, owner: d.owner && d.owner.name, mid: d.owner && d.owner.mid, videos: d.videos, pages: (d.pages || []).map((p) => ({ page: p.page, part: p.part, duration: p.duration })) };
  console.log('### ' + bv + ' | ' + (d.owner && d.owner.name) + ' | ' + d.title + ' | parts=' + d.videos);
  for (const p of d.pages.slice(0, 60)) console.log('   P' + p.page + ' [' + p.duration + 's] ' + p.part);
}
writeFileSync('tools/probe8.out.json', JSON.stringify({ official3b1b: [...found.values()], ml }, null, 2));
