import { writeFileSync } from 'node:fs';
const out = { fetchedAt: new Date().toISOString(), cards: {}, videos: {}, series: {} };
async function j(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0', referer: 'https://www.bilibili.com/' } });
    const text = await res.text();
    try { return { status: res.status, json: JSON.parse(text) }; } catch (e) { return { status: res.status, json: null, text: text.slice(0, 200) }; }
  } catch (e) { return { status: 0, error: String((e && e.message) || e) }; }
  finally { clearTimeout(t); }
}
const mids = [88461692, 302417610, 37974444, 3493134768016008, 95228778, 40323036, 66607740, 1232187625, 2061186491];
for (const mid of mids) {
  const r = await j('https://api.bilibili.com/x/web-interface/card?mid=' + mid + '&photo=false');
  const c = r.json && r.json.data && r.json.data.card;
  const ov = c && c.official_verify;
  out.cards[mid] = { status: r.status, code: r.json && r.json.code, name: c && c.name, fans: c && c.fans, official_verify: ov || null, sign: (c && c.sign || '').slice(0, 60) };
  console.log('CARD ' + mid + ' -> ' + r.status + ' code=' + (r.json && r.json.code) + ' name=' + (c && c.name) + ' official=' + JSON.stringify(ov || null) + ' fans=' + (c && c.fans));
}
const bvs = ['BV1Ys411k7yQ','BV1ns41167b9','BV1rs411k7ru','BV1qW411N7FU','BV1tDsgzxECr','BV1eZ421b7ag','BV1qW4y1a7fU','BV1ex411x7Em','BV1owrpYKEtP','BV1DTxXzUEvW','BV1JXppejE8q','BV13GaG6iE8y','BV1u4411H7Ry','BV1u4411H7kZ'];
for (const bv of bvs) {
  const r = await j('https://api.bilibili.com/x/web-interface/view?bvid=' + bv);
  const d = r.json && r.json.data;
  if (!d) { console.log('VIEW ' + bv + ' -> ' + r.status + ' code=' + (r.json && r.json.code)); continue; }
  out.videos[bv] = { status: r.status, title: d.title, owner: d.owner && d.owner.name, mid: d.owner && d.owner.mid, pubdate: d.pubdate, duration: d.duration, videos: d.videos, pages: (d.pages || []).slice(0, 80).map((p) => ({ page: p.page, part: p.part, duration: p.duration })) };
  console.log('VIEW ' + bv + ' ok | ' + (d.owner && d.owner.name) + ' | ' + d.title + ' | parts=' + d.videos + ' | pages=' + (d.pages || []).length);
}
const seriesKw = ['线性代数的本质', '微积分的本质'];
for (const kw of seriesKw) {
  const list = [];
  for (let p = 1; p <= 3; p++) {
    const r = await j('https://api.bilibili.com/x/web-interface/search/all/v2?keyword=' + encodeURIComponent(kw) + '&page=' + p);
    const grp = r.json && r.json.data && (r.json.data.result || []).find((x) => x.result_type === 'video');
    for (const v of (grp ? grp.data : [])) {
      const clean = String(v.title || '').replace(/<[^>]+>/g, '');
      if (v.mid === 88461692) list.push({ bvid: v.bvid, title: clean, duration: v.duration, pubdate: v.pubdate });
    }
  }
  const seen = new Set();
  out.series[kw] = list.filter((x) => (seen.has(x.bvid) ? false : (seen.add(x.bvid), true)));
  console.log('SERIES ' + kw + ' -> ' + out.series[kw].length + ' official items');
  for (const v of out.series[kw]) console.log('   ' + v.bvid + ' | ' + v.duration + ' | ' + v.title);
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
