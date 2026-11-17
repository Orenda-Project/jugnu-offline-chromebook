// How big are the lesson videos, grade by grade? Read from Jugnu's own library lists (each lesson says its size in MB
// and its length), through the pilot, as this Chromebook's child. Nothing is downloaded and nothing is started.
//   CB_BASE=http://localhost:8813 DEVICE_KEY=… node rig/videos-sizes.mjs [--json out.json]
import fs from 'node:fs';

import { launch, BASE, controlled } from './cb.mjs';

const KEY = process.env.DEVICE_KEY;
if (!KEY) { console.error('set DEVICE_KEY'); process.exit(1); }
const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const { ctx, page } = await launch({ fresh: false });
try {
  await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.register('/__cb/sw.js', { scope: '/' }));
  await controlled(page);
  const h = await page.evaluate((key) => new Promise((ok) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => ok(e.data); navigator.serviceWorker.controller.postMessage({ type: 'home', key, device: 'rig-sizes' }, [ch.port2]); }), KEY);
  await page.goto(`${BASE}/h/${h.hub}`, { waitUntil: 'load' });
  await page.waitForSelector('a.wq-door', { timeout: 15000 });
  const rows = await page.evaluate(async (hub) => {
    const d = JSON.parse(localStorage.getItem('wq_d'));
    const kid = (await fetch('/api/wq/hub/' + hub, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_ref: d }) }).then((r) => r.json())).kid;
    const get = (q) => fetch(`/api/wq/lib/h/${hub}?kid=${kid}&l=en${q}`).then((r) => r.json());
    const top = await get('');
    const all = [];
    for (const g of top.grades.map((x) => x.g)) {
      const gq = String(g) === String(top.grade) ? '' : '&g=' + encodeURIComponent(g);
      const subjects = (await get(gq)).subjects || [];
      for (const s of subjects) {
        const list = await get(gq + '&s=' + encodeURIComponent(s.key));
        for (const c of list.chapters || []) for (const v of c.videos || []) all.push({ g: String(g), subject: s.key, vid: v.vid, mb: v.mb || 0, secs: v.secs || 0, code: !!v.code });
      }
    }
    return all;
  }, h.hub);
  const by = {};
  for (const r of rows) (by[r.g] = by[r.g] || []).push(r);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  console.log('grade     lessons   total MB   median MB   largest MB   hours   no size   by subject (MB)');
  let tot = 0; let n = 0;
  for (const g of Object.keys(by)) {
    const v = by[g]; const mb = v.map((x) => x.mb); const sum = mb.reduce((a, b) => a + b, 0);
    const subj = {}; for (const x of v) subj[x.subject] = (subj[x.subject] || 0) + x.mb;
    tot += sum; n += v.length;
    console.log(`${g.padEnd(9)} ${String(v.length).padStart(7)} ${sum.toFixed(0).padStart(10)} ${med(mb).toFixed(1).padStart(11)} ${Math.max(...mb).toFixed(1).padStart(12)} ${(v.reduce((a, x) => a + x.secs, 0) / 3600).toFixed(1).padStart(7)} ${String(v.filter((x) => !x.mb).length).padStart(9)}   ${Object.entries(subj).map(([k, m]) => `${k} ${m.toFixed(0)}`).join(', ')}`);
  }
  console.log(`${'all'.padEnd(9)} ${String(n).padStart(7)} ${tot.toFixed(0).padStart(10)}`);
  if (out) fs.writeFileSync(out, JSON.stringify(rows));
} finally { await ctx.close(); }
