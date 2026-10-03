import { writeFileSync } from 'node:fs';
const out = { fetchedAt: new Date().toISOString(), results: [] };
async function get(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, Object.assign({ signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' } }, init || {}));
    const text = await res.text();
    return { status: res.status, text };
  } catch (err) { return { status: 0, error: String((err && err.message) || err) }; }
  finally { clearTimeout(t); }
}
function rec(key, url, r, extra) {
  const entry = { key, url, status: r.status, error: r.error || null, bytes: (r.text || '').length };
  Object.assign(entry, extra || {});
  out.results.push(entry);
  console.log(key + ' -> ' + r.status + ' ' + (r.error || '') + ' ' + (r.text || '').slice(0, 220).replace(/\s+/g, ' '));
}
const kw = encodeURIComponent('线性代数 MIT 公开课');
let r = await get('https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + kw + '&page=1');
rec('search-type', 'search/type?keyword=' + kw, r);
r = await get('https://api.bilibili.com/x/web-interface/search/all/v2?keyword=' + kw);
rec('search-all', 'search/all/v2', r);
r = await get('https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + kw, { headers: { cookie: 'buvid3=' + 'A'.repeat(8) + '-infoc' } });
rec('search-type-cookie', 'search/type with buvid3', r);
r = await get('https://api.bilibili.com/x/web-interface/view?bvid=BV1dK4y1C7Km');
let title = null, owner = null, dur = null;
try { const j = JSON.parse(r.text); title = j.data.title; owner = j.data.owner.name; dur = j.data.duration; } catch (e) {}
rec('view-ok', 'view?bvid=BV1dK4y1C7Km', r, { title, owner, durationSeconds: dur });
r = await get('https://player.bilibili.com/player.html?bvid=BV1dK4y1C7Km&page=1&autoplay=0');
rec('player-embed', 'player.bilibili.com/player.html', r);
r = await get('https://www.icourse163.org/search.htm?search=' + encodeURIComponent('线性代数'));
rec('icourse163-search', 'icourse163 search', r);
r = await get('https://www.xuetangx.com/search?query=' + encodeURIComponent('线性代数'));
rec('xuetangx-search', 'xuetangx search', r);
writeFileSync(process.argv[2] || 'probe2.out.json', JSON.stringify(out, null, 2));
console.log('done');
