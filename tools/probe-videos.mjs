import { writeFileSync } from 'node:fs';
const yt = [
  ['3b1b-nn1', 'aircAruvnKk'],
  ['3b1b-nn2', 'IHZwWFHWa-w'],
  ['3b1b-nn3', 'Ilg3gGewQ5U'],
  ['3b1b-la1', 'fNk_zzaMoSs'],
  ['3b1b-la2', 'k7RM-ot2NWY'],
  ['3b1b-la3', 'kYB8IZa5AuE'],
  ['3b1b-la4', 'XkY2DOUCWMU'],
  ['3b1b-la5', 'Ip3X9LOh2dk'],
  ['3b1b-la6', 'PFDu9oVAE-g'],
  ['3b1b-calc1', 'WUvTyaaNkzM'],
  ['fcc-python', 'rfscVS0vtbw'],
  ['fcc-ml', 'NWONebJ2BpY'],
  ['fcc-ml2', 'i_LwzRVP7bg'],
  ['cs50-0', '8mAITcNt710'],
  ['cs50-py', '5aPkHY8r7gQ'],
  ['mit-1806-1', 'ZK3O_e2nvFY']
];
const pages = [
  ['mit-ocw-1806', 'https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/'],
  ['mit-ocw-600', 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/'],
  ['mit-ocw-6036', 'https://ocw.mit.edu/courses/6-036-introduction-to-machine-learning-fall-2020/'],
  ['freecodecamp', 'https://www.freecodecamp.org/learn/'],
  ['bilibili-home', 'https://www.bilibili.com/']
];
const out = { fetchedAt: new Date().toISOString(), youtube: [], pages: [], bili: [] };
async function get(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, Object.assign({ signal: ctrl.signal, redirect: 'follow' }, init));
    const text = await res.text();
    return { status: res.status, finalUrl: res.url, text };
  } catch (err) {
    return { status: 0, error: String((err && err.message) || err) };
  } finally { clearTimeout(t); }
}
for (const pair of yt) {
  const key = pair[0], id = pair[1];
  const r = await get('https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D' + id + '&format=json');
  let meta = null;
  if (r.status === 200) { try { const j = JSON.parse(r.text); meta = { title: j.title, author: j.author_name, authorUrl: j.author_url }; } catch (e) {} }
  out.youtube.push({ key, id, watch: 'https://www.youtube.com/watch?v=' + id, status: r.status, error: r.error || null, meta });
  console.log('YT ' + key + ' ' + id + ' -> ' + r.status + ' ' + (meta ? meta.title + ' / ' + meta.author : (r.error || '')));
}
for (const pair of pages) {
  const key = pair[0], url = pair[1];
  const r = await get(url);
  const m = (r.text || '').match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  out.pages.push({ key, url, status: r.status, error: r.error || null, finalUrl: r.finalUrl || null, title: m ? m[1].trim() : null, bytes: (r.text || '').length });
  console.log('PAGE ' + key + ' -> ' + r.status + ' ' + (m ? m[1].trim() : (r.error || '')));
}
for (const bv of ['BV1dK4y1C7Km']) {
  const r = await get('https://api.bilibili.com/x/web-interface/view?bvid=' + bv, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  out.bili.push({ bv, url: 'https://www.bilibili.com/video/' + bv, status: r.status, body: (r.text || '').slice(0, 400), error: r.error || null });
  console.log('BILI ' + bv + ' -> ' + r.status + ' ' + (r.text || '').slice(0, 200));
}
writeFileSync('tools/probe-videos.out.json', JSON.stringify(out, null, 2));
console.log('wrote tools/probe-videos.out.json');
