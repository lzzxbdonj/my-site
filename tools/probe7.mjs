import { writeFileSync } from 'node:fs';
async function api(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try { const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 Chrome/124.0' } }); const text = await res.text(); try { return JSON.parse(text); } catch (e) { return null; } }
  catch (e) { return null; } finally { clearTimeout(t); }
}
const kws = ['尚硅谷 机器学习', '黑马程序员 机器学习', '黑马程序员 人工智能 大模型', '尚硅谷 AI 人工智能 教程'];
const found = {};
for (const kw of kws) {
  const res = await api('https://api.bilibili.com/x/web-interface/search/all/v2?keyword=' + encodeURIComponent(kw));
  const grp = res && res.data && (res.data.result || []).find((x) => x.result_type === 'video');
  const list = ((grp ? grp.data : []) || []).map((x) => ({ bvid: x.bvid, title: String(x.title).replace(/<[^>]+>/g, ''), author: x.author, mid: x.mid, duration: x.duration }));
  found[kw] = list;
  console.log('== ' + kw);
  const off = list.filter((x) => [302417610, 37974444].includes(x.mid));
  const other = list.filter((x) => ![302417610, 37974444].includes(x.mid)).slice(0, 5);
  for (const it of off.concat(other)) console.log('   ' + it.bvid + ' | ' + it.author + ' | ' + it.duration + ' | ' + it.title);
}
writeFileSync('tools/probe7.out.json', JSON.stringify(found, null, 2));
