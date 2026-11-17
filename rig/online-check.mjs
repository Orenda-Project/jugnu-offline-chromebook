// "If there is internet and content is not downloaded it should still play" (operator, 18 Nov 2026), and with no
// internet what is not saved must say so plainly to a child, never a blank or a broken page.
//   CB_BASE=http://localhost:8843 DEVICE_KEY=… node rig/online-check.mjs fresh
//   CB_BASE=…                     DEVICE_KEY=… node rig/online-check.mjs partly   <a class NOT saved here> <another class NOT saved here>
//   CB_BASE=…                     DEVICE_KEY=… node rig/online-check.mjs offline  <a class that IS saved here>
//   CB_BASE=…                     DEVICE_KEY=… node rig/online-check.mjs never
//
// fresh    a new profile; the setup link is opened, Get ready is NOT pressed; the network is on. A lesson video of each
//          of Classes 1 to 5 plays and scrubs ahead, a storybook is read aloud by Jugnu, the big flight's map opens
//          and a part starts, a class quiz reaches its first screen. Nothing was saved, and playing saves no video.
//          (its own profile, .chrome-profile-online, unless CB_PROFILE says otherwise)
// partly   a profile that ran Get ready with some classes' videos. Network on: a lesson of a class that is not saved
//          plays and scrubs. It also sets up what `offline` needs and leaves notes in logs/online-check.json: of the
//          first class, one lesson watched now (A), one whose page is on the drive but was never opened (B), one that
//          is nowhere on the drive (C); and the second class's lists taken off the drive (never looked at).
// offline  the same profile, the network truly off (the server drops every connection AND the browser is offline):
//          a saved class's lesson plays from the drive; the door of the class never looked at, lesson C's page, and
//          lesson B's player each say "This needs the internet" (never a blank or a dead player); lesson A's page is
//          whole; Home still opens; a saved storybook is read aloud, the saved quiz and the saved game open; nothing
//          reaches the server or the media store.
// never    the `fresh` profile again (it never ran Get ready; it only played a few things while online), the
//          network truly off: the home opens from what was kept as it loaded; a storybook, a game, a quiz and a
//          lesson that were never opened each say "This needs the internet", with a way on (Home, or back); nothing
//          is blank; nothing reaches the server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mode, arg1, arg2] = process.argv.slice(2);
const unsaved = arg1, unseen = arg2, savedClass = arg1; // partly: <unsaved> <unseen>; offline: <saved>
if (!['fresh', 'partly', 'offline', 'never'].includes(mode) || (['partly', 'offline'].includes(mode) && !arg1) || (mode === 'partly' && !arg2)) { console.error('usage: node rig/online-check.mjs fresh | partly <unsaved class> <another unsaved class> | offline <saved class> | never'); process.exit(1); }
if ((mode === 'fresh' || mode === 'never') && !process.env.CB_PROFILE) process.env.CB_PROFILE = '.chrome-profile-online';
const { launch, shot, BASE, controlled } = await import('./cb.mjs');
const KEY = process.env.DEVICE_KEY;
const OFFLINE = path.join(ROOT, 'OFFLINE');
const NOTES = path.join(ROOT, 'logs', 'online-check.json');
const QUIZ = JSON.parse(process.env.CB_CONFIG || fs.readFileSync(path.join(ROOT, 'cb-config.json'), 'utf8')).quizzes[0];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const { ctx, page, log } = await launch({ fresh: mode === 'fresh', height: 633 });
// every sound or video a page starts: did it start, how far it got
await ctx.addInitScript(() => {
  const rec = (window.__cbMedia = []);
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this; let r = el.__cb;
    if (!r) { r = el.__cb = { src: '', ok: null, max: 0 }; rec.push(r); el.addEventListener('timeupdate', () => { if (el.currentTime > r.max) r.max = el.currentTime; }); }
    r.src = String(el.currentSrc || el.src || '').split('?')[0].slice(-70);
    const p = orig.apply(el, arguments);
    if (p && p.then) p.then(() => { r.ok = true; }, (e) => { r.ok = (e && e.name) || 'rejected'; });
    return p;
  };
});
const fromNet = []; const fromDrive = []; // answers for files of another site (R2): from there, or given by the worker
page.on('response', (r) => { if (!r.url().startsWith(BASE) && /^https?:/.test(r.url())) (r.fromServiceWorker() ? fromDrive : fromNet).push(r.url().split('?')[0].slice(-60)); });

const keptVideos = () => page.evaluate(async () => (await (await caches.open('cb-pilot-v1')).keys()).filter((k) => /\.(mp4|webm)$/.test(new URL(k.url).pathname)).length);
const home = async () => {
  await page.goto(`${BASE}/cb/home`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('a.wq-door', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(800);
  for (const t of ['Skip', 'چھوڑیں']) await page.getByText(t, { exact: true }).first().click({ timeout: 500 }).catch(() => {});
  // the child's chip (Jugnu keeps a class per child under it): in the page's own requests, or kept by Get ready
  return page.evaluate(() => {
    const seen = performance.getEntriesByType('resource').map((r) => (/[?&]kid=([0-9a-f]{16})/.exec(r.name) || [])[1]).filter(Boolean)[0];
    const link = [...document.querySelectorAll('a[href*="kid="]')].map((a) => (/[?&]kid=([0-9a-f]{16})/.exec(a.getAttribute('href')) || [])[1]).filter(Boolean)[0];
    return { doors: document.querySelectorAll('a.wq-door').length, kid: new URLSearchParams(location.search).get('kid') || seen || link || localStorage.getItem('cb-kid') || '', text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80) };
  });
};
/** The Videos door on one class (what the door's own class picker stores), ready to tap. */
const door = async (kid, grade) => {
  await page.evaluate(([k, g]) => localStorage.setItem('wq_sel_videos.' + k, g), [kid, String(grade)]);
  await page.goto(`${BASE}/cb/home#videos`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => { const w = document.getElementById('wq'); return w && w.getAttribute('data-m') === 'H3-videos' && /done|failed/.test(w.getAttribute('data-fetch') || ''); }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({ fetch: document.getElementById('wq') && document.getElementById('wq').getAttribute('data-fetch'), cards: document.querySelectorAll('.wq-vcard').length, label: ((document.querySelector('.wq-vgl') || {}).innerText || '').trim(), needs: (document.querySelector('[data-cb-needs-list]') || {}).innerText || null, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160) }));
};
/** A lesson with its player showing: a lesson this profile already began opens on its questions instead (Jugnu's
 *  "Welcome back"), so the next card is tried. `back` re-opens the door between tries. */
const lesson = async (idx, back) => {
  let r = null;
  for (let t = 0; t < 6; t += 1) {
    r = await lessonAt(idx + t);
    if (!r.err || !/Welcome back|answers are saved|جوابات محفوظ/.test(r.err)) break;
    if (back) await back();
  }
  return r;
};
/** Tap a lesson's card, press play, then scrub to 60 % and play on. */
const lessonAt = async (idx) => {
  const card = page.locator('.wq-vcard').nth(idx);
  const title = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ').replace(/^\d+ min /, '').replace(/ Quiz$/, '').slice(0, 40);
  await card.locator('.wq-vtap').first().click({ timeout: 10000 });
  await page.waitForSelector('video.wq-video', { timeout: 30000 }).catch(() => {});
  const url = page.url().replace(BASE, '');
  const r = await page.evaluate(async () => {
    const v = document.querySelector('video.wq-video');
    if (!v) return { err: 'no player: ' + document.body.innerText.replace(/\s+/g, ' ').slice(0, 80) };
    const wait = (fn, ms) => new Promise((ok) => { const t0 = Date.now(); const tick = () => (fn() ? ok(Date.now() - t0) : Date.now() - t0 > ms ? ok(-1) : setTimeout(tick, 100)); tick(); });
    v.muted = true;
    const t0 = Date.now();
    try { await v.play(); } catch (e) { return { err: e.name + ': ' + e.message }; }
    const moved = await wait(() => v.currentTime > 0.3, 30000);
    const first = moved < 0 ? -1 : Date.now() - t0; // from the tap on play to the picture moving
    const started = await wait(() => v.currentTime > 1.5, 30000);
    const dur = v.duration;
    v.currentTime = dur * 0.6; const from = v.currentTime;
    const scrubbed = await wait(() => v.currentTime > from + 1.2 && !v.seeking, 30000);
    v.pause();
    return { first: first, started: started >= 0, scrubbed: scrubbed >= 0, scrubMs: scrubbed, dur: Math.round(dur), at: Math.round(v.currentTime), w: v.videoWidth, host: new URL(v.currentSrc).hostname.replace(/^[^.]+\.[0-9a-f]{32}/, 'bucket'), file: v.currentSrc.split('?')[0].split('/').pop() };
  });
  return { title, url, ...r };
};
const played = (l) => l.started && l.scrubbed && !l.err;
const said = (l) => l.err || `${l.dur} s long, first picture ${(l.first / 1000).toFixed(1)} s after the tap, playing at ${l.at} s ${(l.scrubMs / 1000).toFixed(1)} s after scrubbing (${l.file})`;
const story = async () => {
  await page.goto(`${BASE}/cb/home#stories`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('.wqs-book', { timeout: 25000 }).catch(() => {});
  const title = await page.locator('.wqs-book').first().innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 40)).catch(() => '');
  await page.locator('.wqs-book').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.wqs .wqs-stage img, .wqs .wqra-pic', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => (window.__cbMedia || []).length);
  // Jugnu reads: "Listen" is the main button, or "Hear it first" under "Your turn" (Classes 3 to 5), as rig/stories.mjs
  const listen = (await page.locator('[data-main].wqs-listen').count()) ? '[data-main].wqs-listen' : '[data-tap="alt"]';
  await page.locator(listen).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForFunction((n) => (window.__cbMedia || []).slice(n).concat(window.__cbMedia || []).some((m) => /\/s\//.test(m.src) && m.ok === true && m.max > 1.2), before, { timeout: 30000 }).catch(() => {});
  const m = await page.evaluate(() => (window.__cbMedia || []).filter((x) => /\/s\//.test(x.src)).slice(-1)[0] || null);
  const pic = await page.evaluate(() => { const i = document.querySelector('.wqs .wqs-stage img, .wqs .wqra-pic img, .wqs img'); return !!i && i.complete && i.naturalWidth > 0; });
  return { title, pic, voice: m };
};
const game = async () => {
  await page.goto(`${BASE}/cb/home#games`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
  await page.waitForSelector('a.wq-drow', { timeout: 25000 }).catch(() => {});
  const rows = await page.locator('a.wq-drow').count();
  await page.locator('a.wq-drow[data-item="bigtest"]').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.sg-map', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const map = await page.evaluate(() => ({ map: !!document.querySelector('.sg-map'), islands: document.querySelectorAll('.sg-isl, .sg-tower').length, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 90) }));
  // into the island that is next: its intro, then Start (the part's own page)
  let part = null;
  if (map.map) {
    // (the next island bobs for ever: click where it is, as rig/games/flight.mjs does)
    await page.locator('.sg-isl.is-next, .sg-isl').first().click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForSelector('[data-tap="run"]', { timeout: 25000 }).catch(() => {});
    await page.locator('[data-tap="run"]').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForURL(/\/sa\/play/, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3500);
    part = await page.evaluate(() => ({ path: location.pathname, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 100), buttons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent).length }));
  }
  return { rows, ...map, part };
};
const quiz = async () => {
  await page.goto(`${BASE}/q/${QUIZ}`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => { const w = document.getElementById('wq'); return w && /^M/.test(w.getAttribute('data-m') || ''); }, null, { timeout: 25000 }).catch(() => {});
  return page.evaluate(() => ({ m: document.getElementById('wq') ? document.getElementById('wq').getAttribute('data-m') : null, needs: !!document.querySelector('[data-cb-needs-net]'), text: document.body.innerText.replace(/\s+/g, ' ').replace(/NIETE FOR STUDENTS /, '').slice(0, 90) }));
};
const serverRows = (since) => fs.readFileSync(path.join(ROOT, 'logs', 'requests.jsonl'), 'utf8').trim().split('\n').slice(-6000).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((r) => r.t > since);

try {
  fs.rmSync(OFFLINE, { force: true });
  if (mode === 'fresh') {
    await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}&stay=1`, { waitUntil: 'load' });
    const never = await page.evaluate(() => ({ run: localStorage.getItem('cb-run'), worker: !!navigator.serviceWorker.controller }));
    check('a new profile: the setup link was opened, Get ready was never pressed', never.run === null && never.worker === false);
    const h = await home();
    check('the child home opens from the internet', h.doors === 3 && !!h.kid, h.text);
    check('nothing is saved on this Chromebook', (await keptVideos()) === 0);
    for (const g of ['1', '2', '3', '4', '5']) {
      const d = await door(h.kid, g);
      if (!d.cards) { check(`Class ${g}: the Videos door lists its lessons`, false, d.text); continue; }
      const l = await lesson(Math.min(d.cards - 1, Number(g)), () => door(h.kid, g)); // not always the first lesson
      check(`Class ${g}: "${l.title}" plays from the internet and scrubs ahead`, played(l) && /^bucket\.r2\.cloudflarestorage\.com$/.test(l.host || ''), said(l));
      if (g === '3') await shot(page, 'online-fresh-class-3-playing');
    }
    check('playing them saved no video: each streamed, none was downloaded whole', (await keptVideos()) === 0, `${fromNet.concat(fromDrive).filter((u) => /\.mp4$/.test(u)).length} answers for video byte ranges, passed on from the media store; 0 videos on the drive`);
    const s = await story();
    check(`a storybook ("${s.title}") opens and Jugnu reads it aloud`, s.pic && s.voice && s.voice.ok === true && s.voice.max > 1.2, s.voice ? `${s.voice.src} played ${s.voice.max.toFixed(1)} s` : 'no voice started');
    await shot(page, 'online-fresh-story');
    const g = await game();
    check("the Games door lists the games and Jugnu's big flight opens its map", g.rows > 0 && g.map && g.islands > 0, `${g.rows} games, ${g.islands} islands`);
    check('a part of the big flight starts', g.part && /\/sa\/play/.test(g.part.path) && !/did not open|needs the internet/i.test(g.part.text), g.part ? g.part.text : 'no part');
    await shot(page, 'online-fresh-game');
    const q = await quiz();
    check('a class quiz opens at its first screen', /^M/.test(q.m || '') && !q.needs, `${q.m}: ${q.text}`);
  }

  if (mode === 'partly') {
    await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
    check('the offline worker is in charge', await controlled(page));
    const savedHere = await page.evaluate(() => JSON.parse(localStorage.getItem('cb-videos') || '{}'));
    const whole = Object.keys(savedHere).filter((g) => savedHere[g].saved && savedHere[g].saved === savedHere[g].n);
    check(`this Chromebook ran Get ready; lesson videos saved: Class ${whole.join(', ') || 'none'}; Class ${unsaved} is not`, whole.length > 0 && !whole.includes(String(unsaved)), JSON.stringify(savedHere[unsaved] || 'nothing of it'));
    const h = await home();
    const before = await keptVideos();
    const d = await door(h.kid, unsaved);
    check(`online: the Videos door lists Class ${unsaved}'s lessons`, d.cards > 0 && d.fetch === 'done', `${d.cards} lessons`);
    // two more lessons of that class, by address (read without keeping): B and C
    const others = await page.evaluate(async ([g]) => {
      const hub = localStorage.getItem('cb-hub'), kid = localStorage.getItem('cb-kid');
      const get = (q) => fetch(`/api/wq/lib/h/${hub}?kid=${kid}&l=en&g=${encodeURIComponent(g)}${q}`, { headers: { 'X-CB-Keep': 'no' } }).then((r) => r.json());
      const out = [];
      for (const s of ((await get('')).subjects || []).reverse()) for (const c of (await get('&s=' + encodeURIComponent(s.key))).chapters || []) for (const v of (c.videos || []).reverse()) if (v.code && v.k && out.length < 2) out.push(`/q/${v.code}?k=${v.k}&via=videos`);
      return out;
    }, [String(unsaved)]);
    const l = await lesson(0, () => door(h.kid, unsaved));
    check(`online: an unsaved lesson of Class ${unsaved} ("${l.title}") plays from the internet and scrubs ahead`, played(l), said(l));
    check('…and playing it saved no video', (await keptVideos()) === before, `${before} videos on the drive before and after`);
    await shot(page, `online-partly-class-${unsaved}-playing`);
    // for `offline`: B's page goes on the drive without being opened (as a page a child looked at online would);
    // C's page and the lists of the class never looked at are taken off the drive, whatever earlier runs left there
    const sw = (msg) => page.evaluate((m) => new Promise((ok) => { const ch = new MessageChannel(); const t = setTimeout(() => ok(null), 9000); ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); }; navigator.serviceWorker.controller.postMessage(m, [ch.port2]); }), msg);
    await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
    await page.evaluate((u) => fetch(u).then((r) => r.text()), others[0]);
    await sw({ type: 'drop', urls: [BASE + others[1]] });
    const lists = await page.evaluate(async ([g]) => {
      const hub = localStorage.getItem('cb-hub'), kid = localStorage.getItem('cb-kid');
      const u = (l, s) => `${location.origin}/api/wq/lib/h/${hub}?kid=${kid}&l=${l}&g=${encodeURIComponent(g)}${s ? '&s=' + encodeURIComponent(s) : ''}`;
      const subjects = ((await fetch(u('en'), { headers: { 'X-CB-Keep': 'no' } }).then((r) => r.json())).subjects || []).map((x) => x.key);
      return ['en', 'ur'].flatMap((l) => [u(l)].concat(subjects.map((x) => u(l, x))));
    }, [String(unseen)]);
    await sw({ type: 'drop', urls: lists });
    const state = await sw({ type: 'have', urls: [BASE + others[0], BASE + others[1], lists[0]] });
    check(`set up for the offline run: lesson B's page is on the drive, lesson C's is not, Class ${unseen}'s lists are not`, state && state[0] === true && state[1] === false && state[2] === false, JSON.stringify(state));
    fs.writeFileSync(NOTES, JSON.stringify({ unsaved: String(unsaved), unseen: String(unseen), A: l.url, B: others[0], C: others[1], kid: h.kid }));
  }

  if (mode === 'offline') {
    const notes = JSON.parse(fs.readFileSync(NOTES, 'utf8'));
    await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
    check('the offline worker is in charge', await controlled(page));
    fs.writeFileSync(OFFLINE, ''); await ctx.setOffline(true); await page.waitForTimeout(2500);
    const mark = new Date().toISOString(); fromNet.length = 0; fromDrive.length = 0;

    const h = await home();
    check('NO NETWORK: the child home opens from the drive', h.doors === 3, h.text);
    // saved content plays
    const ds = await door(notes.kid, savedClass);
    const ls = ds.cards ? await lesson(0, () => door(notes.kid, savedClass)) : { err: ds.text };
    check(`NO NETWORK: a saved lesson of Class ${savedClass} plays from the drive and scrubs ahead`, played(ls), said(ls));
    // never looked at and not saved: the door of that class
    const du = await door(notes.kid, notes.unseen);
    const whole = await page.evaluate(() => ({ header: !!document.querySelector('.wq-dtop, .wq-homebtn'), doors: document.querySelectorAll('a.wq-door').length, blank: document.body.innerText.trim().length < 20 }));
    check(`NO NETWORK: the Videos door of Class ${notes.unseen} (not saved, never looked at) says "This needs the internet"; the page is whole`, /This needs the internet/.test(du.needs || '') && whole.header && whole.doors === 3 && !whole.blank, (du.needs || du.text).replace(/\s+/g, ' ').slice(0, 120));
    await shot(page, 'offline-unsaved-door');
    // lesson C: its page is nowhere on the drive
    await page.goto(BASE + notes.C, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const pg = await page.evaluate(() => ({ needs: !!document.querySelector('[data-cb-needs-net]'), h1: (document.querySelector('h1') || {}).innerText || '', ur: (document.querySelector('.ur') || {}).innerText || '', home: !!document.querySelector('a[href="/cb/home"]'), pic: (() => { const i = document.querySelector('img'); return !!i && i.complete && i.naturalWidth > 0; })() }));
    check('NO NETWORK: a lesson page that is not saved is the "This needs the internet" page, in English and Urdu, Jugnu asleep', pg.needs && /This needs the internet/.test(pg.h1) && /انٹرنیٹ/.test(pg.ur) && pg.home && pg.pic, `${pg.h1} · ${pg.ur.split('\n')[0]}`);
    await shot(page, 'offline-unsaved-page');
    await page.click('a[href="/cb/home"]').catch(() => {});
    await page.waitForSelector('a.wq-door', { timeout: 20000 }).catch(() => {});
    check('…and its Home button opens the saved home', (await page.locator('a.wq-door').count()) === 3);
    // lesson B: its page is on the drive, its video is not
    await page.goto(BASE + notes.B, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForSelector('video.wq-video', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('[data-cb-needs-video]', { timeout: 15000 }).catch(() => {});
    const ov = await page.evaluate(() => { const o = document.querySelector('[data-cb-needs-video]'); const v = document.querySelector('video.wq-video'); const b = [...document.querySelectorAll('button, a')].filter((x) => x.offsetParent).map((x) => x.innerText.trim()); return { player: !!v, text: o ? o.innerText.replace(/\s+/g, ' ') : null, covers: (() => { if (!o || !v) return false; const a = o.getBoundingClientRect(), c = v.getBoundingClientRect(); return a.width >= c.width - 2 && a.height >= c.height - 2; })(), questions: b.some((t) => /Go to the questions|سوال/.test(t)) }; });
    check('NO NETWORK: a lesson whose page is on the drive and whose video is not: the player is covered by "This video needs the internet", the questions stay', ov.player && /This video needs the internet|اس ویڈیو کے لیے انٹرنیٹ چاہیے/.test(ov.text || '') && ov.covers && ov.questions, ov.text || (ov.player ? 'a bare player' : 'no player on the page'));
    await shot(page, 'offline-page-without-video');
    // lesson A: watched online a moment ago
    await page.goto(BASE + notes.A, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => { const w = document.getElementById('wq'); return w && /^M/.test(w.getAttribute('data-m') || ''); }, null, { timeout: 15000 }).catch(() => {});
    const pa = await page.evaluate(() => ({ m: document.getElementById('wq') ? document.getElementById('wq').getAttribute('data-m') : null, text: document.body.innerText.replace(/\s+/g, ' ').replace(/NIETE FOR STUDENTS /, '').slice(0, 80), dead: (() => { const v = document.querySelector('video.wq-video'); return !!v && !document.querySelector('[data-cb-needs-video]'); })() }));
    check('NO NETWORK: the lesson watched online a moment ago opens whole (its questions go on), no dead player', /^M/.test(pa.m || '') && !pa.dead, `${pa.m}: ${pa.text}`);
    // saved story, quiz and game
    const s = await story();
    check(`NO NETWORK: a saved storybook ("${s.title}") is read aloud from the drive`, s.pic && s.voice && s.voice.ok === true && s.voice.max > 1.2, s.voice ? `${s.voice.src} played ${s.voice.max.toFixed(1)} s` : 'no voice started');
    const q = await quiz();
    check('NO NETWORK: the saved class quiz opens', /^M/.test(q.m || '') && !q.needs, `${q.m}: ${q.text}`);
    const g = await game();
    if (!g.map) await shot(page, 'offline-game-not-saved');
    check("NO NETWORK: the saved big flight opens its map", g.map && g.islands > 0, g.map ? `${g.islands} islands` : `no map: ${g.text}`);
    const rows = serverRows(mark);
    check('NO NETWORK: nothing reached the server, and nothing came from the media store', rows.filter((r) => !r.dropped).length === 0 && fromNet.length === 0, `${rows.filter((r) => r.dropped).length} connections dropped, ${rows.filter((r) => !r.dropped).length} answered; ${fromDrive.length} media answers from the drive, ${fromNet.length} from the store`);
  }
  if (mode === 'never') {
    await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
    const never = await page.evaluate(() => ({ run: localStorage.getItem('cb-run'), worker: !!navigator.serviceWorker.controller }));
    check('this profile never ran Get ready (the offline worker is there: it came with the first page)', never.run === null && never.worker === true);
    await home(); // online once more, as a Chromebook is before its Wi-Fi goes: the pilot's own page code is the current one
    await page.waitForTimeout(1500);
    fs.writeFileSync(OFFLINE, ''); await ctx.setOffline(true); await page.waitForTimeout(2500);
    const mark = new Date().toISOString(); fromNet.length = 0;
    const needs = () => page.evaluate(() => ({ page: !!document.querySelector('[data-cb-needs-net]'), card: ((document.querySelector('[data-cb-needs-list]') || {}).innerText || '').replace(/\s+/g, ' '), h1: ((document.querySelector('h1') || {}).innerText || ''), home: !!document.querySelector('a[href="/cb/home"]'), blank: document.body.innerText.trim().length < 20, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 110) }));
    const h = await home();
    check('NO NETWORK: the child home opens (kept as it loaded while online)', h.doors === 3, h.text);
    // a storybook that was never opened: Jugnu's own "could not open" screen, with the plain words over it
    await page.goto(`${BASE}/cb/home#stories`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    await page.waitForSelector('.wqs-book', { timeout: 20000 }).catch(() => {});
    const books = await page.locator('.wqs-book').count();
    await page.locator('.wqs-book').nth(Math.min(2, books - 1)).click({ timeout: 8000 }).catch(() => {});
    await page.waitForSelector('[data-cb-needs-list]', { timeout: 15000 }).catch(() => {});
    const b = await needs();
    const way = await page.evaluate(() => [...document.querySelectorAll('[data-tap="retry"], [data-tap="back"], .wq-homebtn, a.wq-door')].filter((x) => x.offsetParent !== null).length);
    check('NO NETWORK: a storybook never opened says "This needs the internet" (not only "Jugnu could not open this"), with a way on', /This needs the internet/.test(b.card) && !b.blank && way > 0, `${b.card.slice(0, 90)} · ${way} buttons to go on`);
    await shot(page, 'never-book');
    // a game never opened: the Games door's list was seen online, the game's own page was not
    await page.goto(`${BASE}/cb/home#games`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    await page.waitForSelector('a.wq-drow', { timeout: 20000 }).catch(() => {});
    const row = page.locator('a.wq-drow[href^="/c/"]').first();
    const gname = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 30);
    await row.click({ timeout: 8000 }).catch(() => {});
    await page.waitForSelector('[data-cb-needs-net]', { timeout: 15000 }).catch(() => {});
    const g = await needs();
    check(`NO NETWORK: a game never opened ("${gname}") is the "This needs the internet" page, with Home`, g.page && /This needs the internet/.test(g.h1) && g.home, g.text);
    await page.click('a[href="/cb/home"]').catch(() => {});
    await page.waitForSelector('a.wq-door', { timeout: 20000 }).catch(() => {});
    check('…and Home opens the home again', (await page.locator('a.wq-door').count()) === 3);
    // a class quiz whose link was never opened on this Chromebook
    await page.evaluate(() => { location.href = '/q/NEVER01'; }).catch(() => {});
    await page.waitForSelector('[data-cb-needs-net]', { timeout: 15000 }).catch(() => {});
    const q = await needs();
    check('NO NETWORK: a quiz never opened is the "This needs the internet" page, with Home', q.page && /This needs the internet/.test(q.h1) && q.home, q.text);
    await shot(page, 'never-quiz');
    await page.click('a[href="/cb/home"]').catch(() => {});
    await page.waitForSelector('a.wq-door', { timeout: 20000 }).catch(() => {});
    // a lesson never opened: the Videos door's list (of the class last looked at) was seen online
    await page.evaluate(() => { location.hash = '#videos'; }).catch(() => {});
    await page.waitForSelector('.wq-vcard', { timeout: 20000 }).catch(() => {});
    const cards = await page.locator('.wq-vcard').count();
    let lessonSaid = null;
    for (let i = cards - 1; i >= Math.max(0, cards - 4) && !lessonSaid; i -= 1) { // (from the end: the first ones were played online)
      await page.locator('.wq-vcard').nth(i).locator('.wq-vtap').first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-cb-needs-net], [data-cb-needs-video], [data-cb-needs-list]', { timeout: 12000 }).catch(() => {});
      const n = await needs();
      const over = await page.evaluate(() => ((document.querySelector('[data-cb-needs-video]') || {}).innerText || '').replace(/\s+/g, ' '));
      if (n.page || over || n.card) lessonSaid = n.page ? 'the page: ' + n.h1 : over ? 'over the player: ' + over : 'a card: ' + n.card;
      else { await page.goto(`${BASE}/cb/home#videos`, { waitUntil: 'load', timeout: 30000 }).catch(() => {}); await page.waitForSelector('.wq-vcard', { timeout: 15000 }).catch(() => {}); }
    }
    check('NO NETWORK: a lesson never opened says it needs the internet', cards > 0 && /needs the internet|انٹرنیٹ/.test(lessonSaid || ''), cards ? (lessonSaid || 'nothing said').slice(0, 110) : 'the Videos door listed no lessons');
    await shot(page, 'never-lesson');
    await page.waitForTimeout(1500);
    const rows = serverRows(mark);
    check('NO NETWORK: nothing reached the server, and nothing came from the media store', rows.filter((r) => !r.dropped).length === 0 && fromNet.length === 0, `${rows.filter((r) => r.dropped).length} connections dropped, ${rows.filter((r) => !r.dropped).length} answered`);
  }
} catch (e) {
  check('the run finished', false, String(e && e.message || e).split('\n')[0]);
} finally {
  fs.rmSync(OFFLINE, { force: true });
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) console.log(log.filter((l) => /pageerror/.test(l)).slice(-8).join('\n'));
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
}
