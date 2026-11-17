// Lesson videos with the network truly off, the way a child meets them: Who's playing? (a child of the class whose
// videos were saved), Home, the Videos door, a lesson, play, scrub ahead, then the questions after it.
//   CB_BASE=http://localhost:8813 DEVICE_KEY=… node rig/videos-check.mjs <class> [how many lessons, default 3]
// Run after Get ready saved that class's videos in this profile (rig/ready-check.mjs --videos <class>).
// "Truly off": the pilot server drops every connection (OFFLINE) AND the browser is offline. A lesson's video is a
// link to another site (Cloudflare R2); offline it can only come from the copy on the drive.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, shot, BASE, controlled } from './cb.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = path.join(ROOT, 'OFFLINE');
const KEY = process.env.DEVICE_KEY;
const [grade, countArg] = process.argv.slice(2);
const COUNT = Number(countArg) || 3;
if (!KEY || !grade) { console.error('usage: DEVICE_KEY=… node rig/videos-check.mjs <class> [lessons]'); process.exit(1); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const { ctx, page, log } = await launch({ fresh: false });
const outside = []; // every answer that came from another site itself (not from the worker's saved copy) while offline
let saved = 0;       // answers for another site's files that the worker gave from the drive
page.on('response', (r) => { if (r.url().startsWith(BASE)) return; if (r.fromServiceWorker()) saved += 1; else outside.push(r.url().split('?')[0].slice(0, 90)); });

try {
  fs.rmSync(OFFLINE, { force: true });
  await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
  check('the offline worker is in charge', await controlled(page));
  const have = await page.evaluate(() => JSON.parse(localStorage.getItem('cb-videos') || '{}'));
  check(`Get ready saved Class ${grade}'s lesson videos on this device`, have[grade] && have[grade].saved === have[grade].n && have[grade].n > 0, have[grade] ? `${have[grade].saved} of ${have[grade].n} lessons, ${have[grade].mb} MB` : 'none');

  // ---- the network goes off, for the rest of the run ----
  fs.writeFileSync(OFFLINE, '');
  await ctx.setOffline(true);
  await page.waitForTimeout(2500);
  const mark = new Date().toISOString();
  outside.length = 0; saved = 0;

  // Who's playing? A child of that class (the first on its list; no name is printed or pictured).
  await page.goto(`${BASE}/who`, { waitUntil: 'load' });
  await page.click(`[data-g="${grade}"]`);
  if (await page.locator('[data-s]').count()) await page.locator('[data-s]').first().click();
  await page.locator('.tile.name').first().click();
  await page.waitForURL(/\/cb\?picked=1/, { timeout: 15000 });
  const picked = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('cb-child') || 'null'); return c ? { grade: c.grade, sel: localStorage.getItem('wq_sel_videos.' + localStorage.getItem('cb-kid')) } : null; });
  check(`offline: a Class ${grade} child is picked on Who's playing?, and the Videos door is set to Class ${grade}`, picked && String(picked.grade) === String(grade) && picked.sel === String(grade), picked ? `door: ${picked.sel === '' ? 'left on the home class' : 'Class ' + picked.sel}` : '');

  await page.goto(`${BASE}/cb/home#videos`, { waitUntil: 'load' });
  await page.waitForSelector('#wq[data-m="H3-videos"][data-fetch="done"] .wq-vcard', { timeout: 20000 }).catch(() => {});
  const door = await page.evaluate(() => ({ cards: document.querySelectorAll('.wq-vcard').length, label: (document.querySelector('.wq-vgl') || {}).innerText || '', shelves: document.querySelectorAll('[data-vshelf]').length, fetch: document.getElementById('wq').getAttribute('data-fetch'), text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120) }));
  check(`offline: the Videos door opens on Class ${grade} with every lesson`, door.cards === have[grade].n && new RegExp(`\\b${grade}\\b`).test(door.label), `${door.cards} lessons on ${door.shelves} shelves, picker says "${door.label.trim()}"`);
  await shot(page, `videos-offline-door-class-${grade}`);
  // (a picture is only drawn once its card scrolls into view, so each lesson's picture is asked for instead)
  const thumbs = await page.evaluate(async () => {
    const im = [...document.querySelectorAll('.wq-vtimg')]; let got = 0;
    for (const i of im) { try { const r = await fetch(i.getAttribute('src'), { mode: 'no-cors' }); if (r.status === 200 && /^image\//.test(r.headers.get('content-type') || '')) got += 1; } catch (e) { /* not on the drive */ } }
    return { n: im.length, got, drawn: im.filter((i) => i.complete && i.naturalWidth > 0).length };
  });
  check('offline: every lesson\'s picture is on the drive', thumbs.n > 0 && thumbs.got === thumbs.n && thumbs.drawn > 0, `${thumbs.got} of ${thumbs.n} (${thumbs.drawn} drawn so far, the ones in view)`);

  // Lessons spread across the door: first, middle, last, …
  const total = door.cards;
  const picks = [...new Set(Array.from({ length: COUNT }, (_, i) => Math.round(i * (total - 1) / Math.max(1, COUNT - 1))))];
  for (const idx of picks) {
    await page.goto(`${BASE}/cb/home#videos`, { waitUntil: 'load' });
    await page.waitForSelector('#wq[data-m="H3-videos"][data-fetch="done"] .wq-vcard', { timeout: 20000 });
    const card = page.locator('.wq-vcard').nth(idx);
    const title = (await card.innerText()).replace(/\s+/g, ' ').slice(0, 50);
    await card.locator('.wq-vtap').first().click();
    await page.waitForSelector('video.wq-video', { timeout: 20000 }).catch(() => {});
    const opened = await page.evaluate(() => ({ path: location.pathname, video: !!document.querySelector('video.wq-video'), text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 100) }));
    if (!opened.video) { check(`offline: lesson ${idx + 1} "${title}" opens`, false, opened.text); continue; }
    // play, as the child's tap does; then scrub to 60 % and play on from there
    const played = await page.evaluate(async () => {
      const v = document.querySelector('video.wq-video');
      const wait = (fn, ms) => new Promise((ok) => { const t0 = Date.now(); const tick = () => (fn() ? ok(true) : Date.now() - t0 > ms ? ok(false) : setTimeout(tick, 200)); tick(); });
      v.muted = true;
      try { await v.play(); } catch (e) { return { err: e.name + ': ' + e.message }; }
      const started = await wait(() => v.currentTime > 1.5, 20000);
      const dur = v.duration;
      v.currentTime = dur * 0.6;
      const from = v.currentTime;
      const scrubbed = await wait(() => v.currentTime > from + 1.5 && !v.seeking, 20000);
      const out = { started, scrubbed, dur: Math.round(dur), at: Math.round(v.currentTime), w: v.videoWidth, h: v.videoHeight, err: v.error ? v.error.message : null, src: (v.currentSrc || '').split('?')[0].split('/').slice(-1)[0] };
      v.pause();
      return out;
    });
    check(`offline: lesson ${idx + 1} "${title}" plays from the saved copy and scrubs ahead`, played.started && played.scrubbed && !played.err, played.err || `${played.dur} s long, ${played.w}x${played.h}, playing at ${played.at} s after scrubbing (${played.src})`);
    if (idx === picks[0]) await shot(page, `videos-offline-playing-class-${grade}`);
    // the questions after the lesson
    const go = page.locator('button, a').filter({ hasText: /Go to the questions|سوالات/ }).first();
    if (await go.count()) {
      await go.click().catch(() => {});
      await page.waitForFunction(() => { const w = document.getElementById('wq'); return w && /^M(4|6)/.test(w.getAttribute('data-m') || ''); }, null, { timeout: 15000 }).catch(() => {});
      const q = await page.evaluate(() => ({ m: document.getElementById('wq').getAttribute('data-m'), text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 90) }));
      check(`offline: the questions after lesson ${idx + 1} open`, /^M(4|6)/.test(q.m || ''), `${q.m}: ${q.text}`);
      if (idx === picks[0]) await shot(page, `videos-offline-questions-class-${grade}`);
    }
  }
  const rows = fs.readFileSync(path.join(ROOT, 'logs', 'requests.jsonl'), 'utf8').trim().split('\n').slice(-5000).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((r) => r.t > mark);
  check('offline: nothing reached the pilot server', rows.filter((r) => !r.dropped).length === 0, `${rows.filter((r) => r.dropped).length} connections dropped, ${rows.filter((r) => !r.dropped).length} answered`);
  check('offline: nothing came from another site (R2); its files came from the drive', outside.length === 0 && saved > 0, outside.length ? outside.slice(0, 3).join(' | ') : `${saved} answers for R2 files given by the worker from the saved copy, 0 from R2`);
} catch (e) {
  check('the run finished', false, String(e && e.message || e).split('\n')[0]);
} finally {
  fs.rmSync(OFFLINE, { force: true });
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) console.log(log.filter((l) => /pageerror|\[error\]/.test(l)).slice(-10).join('\n'));
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
}
