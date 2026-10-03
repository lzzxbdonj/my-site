import { readFileSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('tools/probe4.out.json', 'utf8'));
const v = data.videos['BV1tDsgzxECr'];
console.log('### FULL PARTS BV1tDsgzxECr (' + v.owner + ') parts=' + v.videos);
console.log(v.pages.map((p) => 'P' + p.page + ' ' + p.part).join('\n'));
async function j(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try { const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 Chrome/124.0' } }); const text = await res.text(); try { return JSON.parse(text); } catch (e) { return null; } }
  catch (e) { return null; } finally { clearTimeout(t); }
}
const kws = ['尚硅谷 机器学习', '黑马程序员 机器学习', '黑马程序员 人工智能 大模型入门', '尚硅谷 AI 人工智能'];
const found = {};
for (const kw of kws) {
  const j = await j('https://api.bilibili.com/x/web-interface/search/all/v2?keyword=' + encodeURIComponent(kw));
  const grp = j && j.data && (j.data.result || []).find((x) => x.result_type === 'video');
  const list = ((grp ? grp.data : []) || []).map((x) => ({ bvid: x.bvid, title: String(x.title).replace(/<[^>]+>/g, ''), author: x.author, mid: x.mid, duration: x.duration }));
  found[kw] = list;
  console.log('== ' + kw);
  for (const it of list.filter((x) => [302417610, 37974444].includes(x.mid)).concat(list.filter((x) => ![302417610, 37974444].includes(x.mid)).slice(0, 4))) {
    console.log('   ' + it.bvid + ' | ' + it.author + ' | ' + it.duration + ' | ' + it.title);
  }
}
writeFileSync('tools/probe6.out.json', JSON.stringify({ parts: v.pages, found }, null, 2));
