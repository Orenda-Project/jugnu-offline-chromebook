// Storybooks end to end, as a child on a Chromebook (1366x633, no autoplay flag): for each book on the shelf, every
// page: Jugnu reads it (the clip plays to its end, the word pill moves), "Your turn" (the child reads into the
// microphone and the page answers), then the questions (a wrong pick's look-back page), the done screen, and what
// reached the server.
//
//   CB_BASE=http://localhost:8811 node rig/stories.mjs <hub token> [online|offline] [options]
//     --lang en|ur          the shelf's language (default: the link's)
//     --grade all|1..5      the shelf's grade chip (default: the child's own grade)
//     --books 3 | id,id     how many books from the shelf (default 1), or these book ids; "all" = the whole shelf
//     --pages 2             how many pages per book get the full listen + Your turn (default: all)
//     --turn none|voice|mic "voice": the microphone hears the page's own recorded voice (real speech, each page its
//                           own words, both languages); "mic": Chrome's fake microphone (its beep, or CB_SPEECH=<wav>);
//                           "none": listen only (default voice)
//     --no-listen           skip Jugnu's reading (Your turn and questions only)
//     --no-questions        stop after the last page
//     --reconnect           offline only: after the run, switch the network back on, wait for the device to send what
//                           it kept, and say what the server then holds
//     --json <file>         the full result as JSON
//
// offline = the pilot server's OFFLINE switch (every connection dropped) AND the browser offline: both, always.
// A browser's own offline switch does not reach the offline worker's requests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, shot, BASE } from './cb.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLAG = path.join(HERE, '..', 'OFFLINE');
const argv = process.argv.slice(2);
const VALUED = ['lang', 'grade', 'books', 'pages', 'turn', 'json'];
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (VALUED.includes(n) ? argv[i + 1] : true); };
const [token, mode = 'online'] = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(argv[i - 1].replace(/^--/, '')) && argv[i - 1].startsWith('--')));
if (!token) { console.error('usage: node rig/stories.mjs <hub token> [online|offline] [--lang en|ur] [--grade all|n] [--books n|all|ids] [--pages n] [--turn none|voice|mic] [--reconnect]'); process.exit(1); }
const offline = mode === 'offline';
const LANG = flag('lang', null), GRADE = flag('grade', null), BOOKS = String(flag('books', '1')), PAGES = Number(flag('pages', 0)) || 0;
const TURN = String(flag('turn', 'voice')), LISTEN = !argv.includes('--no-listen'), QUESTIONS = !argv.includes('--no-questions'), RECONNECT = argv.includes('--reconnect');
const tag = `stories-${mode}`;
const say = (t) => console.log(t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { ctx, page, log } = await launch({ fresh: false, autoplay: false, height: 633 });

// Every sound the page plays (did it start, how far it got, did it end), and for --turn voice a microphone that
// carries the page's own recorded voice: real speech, the words of that very page.
await ctx.addInitScript((turn) => {
  const rec = (window.__cbMedia = []);
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this;
    let r = el.__cb;
    if (!r) {
      r = el.__cb = { src: '', plays: 0, ok: null, max: 0, ended: 0, err: null };
      rec.push(r);
      el.addEventListener('timeupdate', () => { if (el.currentTime > r.max) r.max = el.currentTime; });
      el.addEventListener('ended', () => { r.ended += 1; r.max = Math.max(r.max, el.currentTime); });
      el.addEventListener('error', () => { r.err = el.error ? el.error.code : 'error'; });
    }
    r.src = String(el.currentSrc || el.src || '').split('?')[0].slice(-60); r.plays += 1; r.muted = el.muted;
    const p = orig.apply(el, arguments);
    if (p && p.then) p.then(() => { r.ok = true; }, (e) => { r.ok = (e && e.name) || 'rejected'; });
    return p;
  };
  if (turn === 'voice' && navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = async () => {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const dest = ac.createMediaStreamDestination();
      // a quiet room before and after the words: the stream never runs dry (a real microphone never does)
      const room = ac.createConstantSource(); const hush = ac.createGain(); hush.gain.value = 0.0001; room.connect(hush); hush.connect(dest); room.start();
      const url = window.__cbSpeech;
      if (url) {
        const buf = await fetch(url).then((r) => r.arrayBuffer()).then((b) => ac.decodeAudioData(b));
        const src = ac.createBufferSource();
        src.buffer = buf; src.connect(dest); src.start(ac.currentTime + 0.9);
      }
      window.__cbSpoke = url || null;
      return dest.stream;
    };
  }
}, TURN);

const net = [];
const hide = (t) => String(t || '').replace(/"api_key":"[^"]+"/, '"api_key":"<hidden>"');
page.on('response', async (r) => {
  const u = r.url();
  if (!/\/api\/wq\/(stories\/event|lr\/key)/.test(u)) return;
  let body = ''; try { body = hide(await r.text()).slice(0, 400); } catch (e) { /* gone */ }
  let reqBody = {}; try { reqBody = JSON.parse(r.request().postData() || '{}'); } catch (e) { /* none */ }
  net.push({ at: Date.now(), kind: /lr\/key/.test(u) ? 'key' : 'event', status: r.status(), local: r.headers()['x-cb-local'] === '1', event: reqBody.event, book: reqBody.book_id || reqBody.book, page: reqBody.page_n || reqBody.page, data: reqBody.data, res: body });
});
page.on('requestfailed', (r) => { if (/\/api\/wq\/(stories\/event|lr\/key)/.test(r.url())) net.push({ at: Date.now(), kind: 'failed', url: r.url().replace(BASE, '').slice(0, 60), why: r.failure() && r.failure().errorText }); });
const ws = [];
page.on('websocket', (s) => { const w = { url: s.url().slice(0, 60), sent: 0, got: 0, closed: false }; ws.push(w); s.on('framesent', () => { w.sent += 1; }); s.on('framereceived', () => { w.got += 1; }); s.on('close', () => { w.closed = true; }); });

const view = () => page.evaluate(() => {
  const s = document.querySelector('#wq [data-screen], [data-screen]');
  const main = document.querySelector('[data-main]') || document.querySelector('.wqs-main');
  const pill = document.querySelector('.wqra-pill');
  const mk = document.querySelector('[data-mk]');
  const on = document.querySelector('.wqra-w.wqra-on');
  const vis = (e) => !!e && e.offsetParent !== null;
  return {
    screen: s ? s.getAttribute('data-screen') : null, hash: location.hash,
    main: main ? main.textContent.trim() : null, mainCls: main ? main.className : '',
    alt: (document.querySelector('[data-tap="alt"]') || {}).textContent || null,
    pill: pill && Number(pill.style.opacity || 0) > 0 ? pill.style.transform : (on ? 'w' + on.getAttribute('data-i') : null),
    mk: mk && mk.style.opacity === '1' ? `${mk.style.left},${mk.style.top}` : null,
    lr: [...document.querySelectorAll('.lr-w')].map((e) => (/lr-(read|heard|skipped|current|ahead)/.exec(e.className) || [0, '?'])[1][0]).join(''),
    extra: ((document.querySelector('[data-extra]') || {}).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    line: ((document.querySelector('[data-lrl]') || {}).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    text: (s ? s.innerText : document.body.innerText).replace(/\s+/g, ' ').trim().slice(0, 220),
    fitsMain: main ? (() => { const b = main.getBoundingClientRect(); return b.bottom <= innerHeight + 1 && b.top >= 0 && vis(main); })() : null,
    online: navigator.onLine,
  };
}).catch((e) => ({ err: String(e).slice(0, 120) }));
const media = () => page.evaluate(() => (window.__cbMedia || []).map((m) => ({ ...m }))).catch(() => []);
const tap = async (sel, ms = 6000) => { try { await page.locator(sel).first().click({ timeout: ms }); return true; } catch (e) { return false; } };
const until = async (fn, ms, step = 150) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(step); } return null; };

async function api(pathname) {
  return page.evaluate(async (u) => { try { const r = await fetch(u, { credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store' }); return { s: r.status, local: r.headers.get('x-cb-local'), j: await r.json().catch(() => null) }; } catch (e) { return { s: 0, err: String(e) }; } }, pathname);
}

const out = { mode, base: BASE, at: new Date().toISOString(), books: [] };
try {
  if (!offline) fs.rmSync(FLAG, { force: true });
  await page.goto(`${BASE}/h/${token}`, { waitUntil: 'load', timeout: 60000 }).catch((e) => say('home: ' + e.message.split('\n')[0]));
  await sleep(2500);
  // A first visit names no child until this browser has its device mark (the page writes it): one more load then does.
  const readBoot = () => page.evaluate(() => { try { return JSON.parse(document.getElementById('boot').textContent); } catch (e) { return null; } });
  let boot = await readBoot();
  for (let i = 0; i < 2 && !(boot && boot.kid) && !offline; i += 1) { await page.reload({ waitUntil: 'load' }).catch(() => {}); await sleep(2500); boot = await readBoot(); }
  const kid = boot && boot.kid;
  const lang = LANG || (boot && boot.lang) || 'en';
  if (offline) { fs.writeFileSync(FLAG, ''); await ctx.setOffline(true); await sleep(300); }
  say(`# stories ${mode} — ${BASE} — child ${kid ? 'found' : 'NOT FOUND'} — lang ${lang}${GRADE ? ', grade ' + GRADE : ''} — navigator.onLine=${await page.evaluate(() => navigator.onLine)}${offline ? ', server OFFLINE switch on' : ''}`);

  // The shelf, as the child's own page asks for it (the grade and language chips are this query).
  const shelfUrl = `/api/wq/stories/shelf/h/${token}?kid=${kid || ''}${GRADE ? '&g=' + GRADE : ''}&l=${lang}`;
  const shelf = await api(shelfUrl);
  const all = (shelf.j && shelf.j.books) || [];
  say(`shelf: ${shelf.s}${shelf.local ? ' (from this device)' : ''} — ${all.length} books`);
  let picks = BOOKS === 'all' ? all : /^[0-9]+$/.test(BOOKS) ? all.slice(0, Number(BOOKS)) : BOOKS.split(',').map((id) => all.find((b) => b.id === id) || { id, title: id });
  await page.evaluate(([g, l]) => { try { localStorage.setItem('wq_st_gl', (g || '') + ',' + l); } catch (e) { /* off */ } }, [GRADE, lang]);

  for (const bk of picks) {
    const B = { id: bk.id, title: bk.title, grade: bk.grade, lang: bk.lang, pages: [], questions: [], done: null, problems: [] };
    out.books.push(B);
    const n0 = net.length;
    // open it from the shelf, by its cover, as a child does
    await page.goto(`${BASE}/h/${token}#stories`, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    const card = `[data-tap="book"][data-id="${bk.id}"]`;
    const onShelf = await until(async () => (await page.locator(card).count()) > 0, 12000);
    if (onShelf) await tap(card); else { B.problems.push('not on the drawn shelf: opened by its address'); await page.evaluate((id) => { location.hash = '#story/' + id; }, bk.id); }
    const opened = await until(async () => { const v = await view(); return v.screen === 'story-page' || v.screen === 'stories-retry' || v.screen === 'stories-off' ? v : null; }, 20000);
    if (!opened || opened.screen !== 'story-page') { B.problems.push(`book did not open: ${opened ? opened.screen + ' — ' + opened.text : 'no screen in 20 s'}`); await shot(page, `${tag}-${bk.id.slice(0, 8)}-noopen`); continue; }
    const data = (await api(`/api/wq/stories/book/${bk.id}/h/${token}?kid=${kid || ''}`)).j || {};
    const P = data.pages || [];
    B.title = data.title || B.title; B.lang = data.lang; B.grade = data.grade; B.total_pages = P.length; B.flags = { lr3: data.lr3, steady: data.steady, read_fb: data.read_fb };

    for (let i = 0; i < P.length; i += 1) {
      const p = P[i];
      const full = !PAGES || i < PAGES;
      const R = { n: p.n, words: (p.words || []).length, picture: !!p.is_picture, audio: !!p.audio };
      B.pages.push(R);
      const at = await until(async () => { const v = await view(); return v.screen === 'story-page' && new RegExp(`/p${i + 1}$`).test(v.hash || '') ? v : (v.screen === 'story-page' && i === 0 ? v : null); }, 8000);
      if (!at) { R.problem = 'page not shown'; B.problems.push(`p${p.n}: not shown`); break; }
      R.fits = at.fitsMain;
      if (full && LISTEN && p.audio) {
        // Jugnu reads: "Listen" is the main button, or "Hear it first" under "Your turn" (grades 3-5)
        const m0 = (await media()).length;
        // the main button holds its old meaning for 0.6 s after a page turn (a late tap never lands on the new one)
        const v0 = (await until(async () => { const x = await view(); return x.mainCls && !/wqs-lk/.test(x.mainCls) ? x : null; }, 3000)) || (await view());
        if (/(^| )wqs-listen( |$)/.test(v0.mainCls)) await tap('[data-main]'); else await tap('[data-tap="alt"]');
        const seen = new Set(); let endedView = null; const t0 = Date.now();
        const limit = (p.audio.ms || 4000) * 2.2 + 12000;
        while (Date.now() - t0 < limit) {
          const v = await view();
          if (v.pill) seen.add('p' + v.pill); if (v.mk) seen.add('m' + v.mk);
          if (v.line) R.net_line = v.line;
          if (/listened|yourTurn|next/.test(v.mainCls) && !/wqs-pause/.test(v.mainCls) && Date.now() - t0 > 600 && !/wqs-lk/.test(v.mainCls)) { const md = (await media()).slice(m0); if (md.some((x) => x.ended) || Date.now() - t0 > 1500) { endedView = v; break; } }
          await sleep(90);
        }
        const md = (await media()).filter((x) => /\/a\d+-|\.ogg$|\.mp3$/.test(x.src) && x.plays > 0).slice(-1)[0] || null;
        R.listen = { played: !!(md && md.ok === true), ended: !!(md && md.ended > 0), heard_s: md ? Math.round(md.max * 100) / 100 : 0, clip_s: Math.round((p.audio.ms || 0) / 10) / 100, muted: md ? !!md.muted : null, marks: seen.size, src: md ? md.src : null, err: md ? md.err || (md.ok !== true ? md.ok : null) : 'no sound asked for' };
        // a page whose word times are not trusted ("low") lights the printed line being read, not the word
        const lines = (p.lines || []).length || 1;
        const need = p.quality === 'low' ? Math.min(2, lines) : Math.min(2, R.words);
        R.listen.quality = p.quality || 'word'; R.listen.lines = lines;
        R.listen.ok = R.listen.played && (R.listen.ended || !!endedView) && !R.listen.muted && R.listen.heard_s >= R.listen.clip_s * 0.85;
        R.listen.light_ok = seen.size >= need;
        if (!R.listen.ok) B.problems.push(`p${p.n}: voice ${JSON.stringify(R.listen)}`);
        else if (!R.listen.light_ok) B.problems.push(`p${p.n}: voice played but the word light moved ${seen.size} time(s) for ${R.words} words`);
        if (!endedView) await sleep(300);
      }
      if (full && TURN !== 'none' && p.audio && R.words > 0 && data.lr3) {
        // Your turn: the main button once the page was heard, else the second button
        const k0 = net.length, w0 = ws.length;
        await page.evaluate((u) => { window.__cbSpeech = u; }, p.audio.url);
        let v = (await until(async () => { const x = await view(); return x.mainCls && !/wqs-lk/.test(x.mainCls) ? x : null; }, 3000)) || (await view());
        const viaMain = /(^| )wqs-yourTurn( |$)/.test(v.mainCls);
        if (viaMain) await tap('[data-main]'); else if (v.alt) await tap('[data-tap="alt"]');
        v = await until(async () => { const x = await view(); return x.screen === 'story-mic' || x.screen === 'story-read' ? x : null; }, 6000);
        if (!v) { R.turn = { ok: false, why: 'Your turn did not open: ' + JSON.stringify(await view()).slice(0, 200) }; B.problems.push(`p${p.n}: ${R.turn.why}`); }
        else {
          if (v.screen === 'story-mic') await tap('.lr-go');
          const reading = await until(async () => { const x = await view(); return x.screen === 'story-read' ? x : (x.screen === 'story-page' ? x : null); }, 10000);
          let peak = ''; const t0 = Date.now(); let res = null; let tappedDone = false;
          const limit = (p.audio.ms || 4000) + 26000;
          while (reading && Date.now() - t0 < limit) {
            const x = await view();
            if (x.screen === 'story-read') {
              if (x.lr && (x.lr.match(/[rh]/g) || []).length >= (peak.match(/[rh]/g) || []).length) peak = x.lr;
              // a child who has finished reading and sees no page turn taps "I'm done"
              if (!tappedDone && Date.now() - t0 > (p.audio.ms || 4000) + 9000) { tappedDone = true; await tap('[data-screen="story-read"] .wqs-done'); }
            } else if (x.screen === 'story-page') { res = x; break; }
            await sleep(200);
          }
          await sleep(500);
          const after = res ? await view() : null;
          const ev = net.slice(k0).filter((e) => e.kind === 'event' && e.event === 'story_page_read').slice(-1)[0] || null;
          const keys = net.slice(k0).filter((e) => e.kind === 'key');
          const sock = ws.slice(w0);
          R.turn = { via: viaMain ? 'main' : 'second button', key: keys.map((k) => k.status + (k.local ? ' local' : '')).join(',') || 'none', socket: sock.map((s) => `${s.sent} sent/${s.got} got`).join(',') || 'none', lit: peak, done_tap: tappedDone, said: after ? after.extra : null,
            event: ev ? { status: ev.status, local: ev.local, ...ev.data } : null };
          R.turn.ok = !!(after && ev && ev.status === 200 && (offline ? true : ev.data && ev.data.words_read > 0));
          if (!R.turn.ok) B.problems.push(`p${p.n}: Your turn ${JSON.stringify(R.turn).slice(0, 400)}`);
        }
      }
      if (i === 0) await shot(page, `${tag}-${bk.id.slice(0, 8)}-p1`);
      // on: the page's own Next arrow (after the last page it opens the questions, or the done screen)
      if (!(await tap('[data-tap="next"]', 4000))) { await tap('[data-main]', 3000); }
      await sleep(350);
    }

    // The questions: a first pick, the look-back page after a wrong one, a second pick; then the done screen.
    let v = await until(async () => { const x = await view(); return /story-questions|story-done/.test(x.screen || '') ? x : null; }, 15000);
    if (!v) { B.problems.push('after the last page: neither questions nor the done screen — ' + JSON.stringify(await view()).slice(0, 200)); }
    else if (v.screen === 'story-questions' && !QUESTIONS) B.questions_skipped = true;
    else {
      const qn = (data.questions || []).length;
      for (let q = 0; q < qn && v && v.screen !== 'story-done'; q += 1) {
        const Q = { n: q + 1, picks: [], look_back: false };
        B.questions.push(Q);
        const k0 = net.length;
        const hear = await tap('[data-tap="say"]', 1500);   // "Hear it": the question read aloud
        Q.heard = hear;
        await sleep(hear ? 900 : 100);
        for (let t = 0; t < 2; t += 1) {
          const opt = page.locator('[data-tap="ans"]:not(.wqs-dim)');
          if (!(await opt.count())) break;
          const pick = 0;   // the first option still open (a wrong first pick is dimmed)
          await opt.nth(pick).click({ timeout: 4000 }).catch(() => {});
          Q.picks.push(pick);
          const nx = await until(async () => {
            const x = await view();
            if (x.screen === 'story-look') return x;
            if (x.screen === 'story-done') return x;
            if (x.screen === 'story-wait') return x;   // the last answer was right: the done screen is on its way
            // the next question's dot is lit (a page being redrawn has no dots for a moment: that is not "the next one")
            if (x.screen === 'story-questions') { const dots = await page.evaluate(() => [...document.querySelectorAll('.wqs-dots i')].findIndex((e) => e.className === 'wqs-now')); if (dots > q) return x; if (/It was|جواب یہ ہے/.test(x.text)) return x; }
            return null;
          }, 9000);
          if (!nx) { Q.problem = 'no answer to the tap'; break; }
          if (nx.screen === 'story-look') { Q.look_back = true; await sleep(400); await tap('[data-tap="lret"]'); await sleep(400); continue; }
          if (/It was|جواب یہ ہے/.test(nx.text) && nx.screen === 'story-questions') { Q.shown = true; await tap('[data-tap="qnext"]'); await sleep(300); }
          break;
        }
        Q.answers = net.slice(k0).filter((e) => e.event === 'story_answer').map((e) => `${e.status}${e.local ? ' local' : ''} ${e.res.replace(/"ok":true,?/, '')}`);
        v = await view();
        if (Q.problem) { B.problems.push(`question ${Q.n}: ${Q.problem}`); break; }
      }
      v = await until(async () => { const x = await view(); return x.screen === 'story-done' ? x : null; }, 15000);
      if (!v) B.problems.push('the done screen did not come — ' + JSON.stringify(await view()).slice(0, 200));
      else { B.done = v.text.slice(0, 160); await shot(page, `${tag}-${bk.id.slice(0, 8)}-done`); }
    }
    B.events = net.slice(n0).filter((e) => e.kind === 'event' && e.event !== 'story_answer').map((e) => `${e.event}${e.page ? ' p' + e.page : ''}: ${e.status}${e.local ? ' (kept on this device)' : ''}`);
    B.failed = net.slice(n0).filter((e) => e.kind === 'failed' || (e.kind === 'event' && e.status !== 200)).length;
    const L = B.pages.filter((r) => r.listen), T = B.pages.filter((r) => r.turn);
    say(`\n## ${B.title} (grade ${B.grade}, ${B.lang}) — ${B.total_pages} pages`);
    if (L.length) say(`   Jugnu reads: ${L.filter((r) => r.listen.ok).length}/${L.length} pages played to the end; words lit on ${L.filter((r) => r.listen.light_ok).length}/${L.length}`);
    if (T.length) say(`   Your turn: ${T.filter((r) => r.turn.ok).length}/${T.length} pages answered — ${T.map((r) => `p${r.n} ${r.turn.event ? (r.turn.event.words_read != null ? r.turn.event.words_read + '/' + r.turn.event.words_total : 'saved') : 'no result'}${r.turn.event && r.turn.event.local ? ' (kept)' : ''}`).join(', ')}`);
    if (T.length) say(`   said after reading: ${[...new Set(T.map((r) => r.turn.said).filter(Boolean))].slice(0, 3).join(' | ')}`);
    if (B.questions.length) say(`   questions: ${B.questions.length} — ${B.questions.map((q) => `q${q.n} picks ${q.picks.join('>')}${q.look_back ? ' look-back' : ''}${q.shown ? ' shown' : ''} [${q.answers.join('; ')}]`).join(' · ')}`);
    say(`   done screen: ${B.done || 'NO'}`);
    say(`   to the server: ${B.events.join(' · ') || 'nothing'}`);
    if (B.problems.length) say(`   PROBLEMS:\n     - ${B.problems.join('\n     - ')}`);
  }

  if (offline && RECONNECT) {
    const before = await page.evaluate(() => new Promise((ok) => { const sw = navigator.serviceWorker && navigator.serviceWorker.controller; if (!sw) return ok(null); const ch = new MessageChannel(); const t = setTimeout(() => ok(null), 4000); ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); }; sw.postMessage({ type: 'stories' }, [ch.port2]); }));
    say(`\n# waiting on this device (offline): ${JSON.stringify(before)}`);
    fs.rmSync(FLAG, { force: true });
    await ctx.setOffline(false);
    const t0 = Date.now();
    await page.goto(`${BASE}/h/${token}`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    const sent = await until(async () => {
      const s = await page.evaluate(() => new Promise((ok) => { const sw = navigator.serviceWorker && navigator.serviceWorker.controller; if (!sw) return ok(null); const ch = new MessageChannel(); const t = setTimeout(() => ok(null), 4000); ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); }; sw.postMessage({ type: 'stories' }, [ch.port2]); })).catch(() => null);
      return s && s.waiting === 0 ? s : null;
    }, 600000, 2000);
    say(`# back online: ${sent ? 'everything sent in ' + Math.round((Date.now() - t0) / 1000) + ' s — ' + JSON.stringify(sent) : 'NOT all sent after 10 min'}`);
    out.reconnect = { before, after: sent, s: Math.round((Date.now() - t0) / 1000) };
    const sh = await api(shelfUrl);
    const done = ((sh.j && sh.j.books) || []).filter((b) => b.done).map((b) => b.title);
    say(`# the server's shelf now marks as read: ${done.join(', ') || 'none'}`);
    out.reconnect.done = done;
  }
} finally {
  if (offline && !RECONNECT) { /* left offline on purpose: the caller reconnects */ }
  const bad = log.filter((l) => /pageerror/.test(l)).slice(-8);
  if (bad.length) say(`\n# page errors\n${bad.join('\n')}`);
  const tot = out.books.reduce((a, b) => { a.books += 1; a.bad += b.problems.length ? 1 : 0; return a; }, { books: 0, bad: 0 });
  say(`\n# ${tot.books} book(s), ${tot.books - tot.bad} with no problem`);
  const jf = flag('json', null);
  if (jf && jf !== true) fs.writeFileSync(jf, JSON.stringify(out, null, 1));
  await ctx.close();
}
