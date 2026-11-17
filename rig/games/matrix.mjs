// Every game, for many children at once: each child in its own Chrome profile (its own home link), all played the
// way one child would, and one table at the end.
//
//   CB_PRIVATE=<folder: students.json + hub-<key>.txt> node rig/games/matrix.mjs online  <G1.en,G2.ur,…> [options]
//   CB_PRIVATE=…                                        node rig/games/matrix.mjs offline <G1.en.b,…>      [options]
//
// online   Jugnu's big flight (Numbers, English, Urdu islands, then the Big flight) and every Challenge game behind
//          the Games door, through the pilot with the network on.
// offline  "Get ready for offline" for every child (network on), then the server's OFFLINE switch AND every browser
//          offline, then the same games; then the network comes back and the script only watches: what each device
//          sends by itself, and what is still waiting. (One switch for the whole server, so the phases are in step.)
// options  --parts=maths,english,urdu,tower   --only=flight|challenge   --parallel=5   --ready-parallel=3   --max=14 (min/part)
// Writes logs/matrix/<key>-<mode>.{txt,json}. Profiles: logs/profiles/<key> (kept between runs; never wiped).
import fs from 'node:fs';
import path from 'node:path';
import { launch, children, ROOT, BASE, FLAG } from './lib.mjs';
import { openMap, startPart, playPart, backToMap } from './flight.mjs';
import { playGame, doorRows } from './challenge.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const [mode, list] = args.filter((a) => !a.startsWith('--'));
const all = children();
const keys = (list || '').split(',').filter((k) => all[k]);
if (!/^(online|offline)$/.test(mode || '') || !keys.length) { console.error('usage: matrix.mjs online|offline <child,child,…>'); process.exit(1); }
const PARTS = String(flag('parts', 'maths,english,urdu,tower')).split(',');
const ONLY = flag('only', '');
const OUT = path.join(ROOT, 'logs', 'matrix');
fs.mkdirSync(OUT, { recursive: true });
const pool = async (items, n, fn) => { const q = items.slice(); const w = async () => { for (;;) { const it = q.shift(); if (it === undefined) return; await fn(it).catch((e) => console.log(`  [${it.key}] stopped: ${String(e.message || e).split('\n')[0]}`)); } }; await Promise.all(Array.from({ length: Math.min(n, items.length) }, w)); };

const kids = [];
for (const key of keys) {
  const k = { key, ...all[key], lines: [], out: { key, grade: all[key].grade, lang: all[key].lang, mode, flight: [], challenge: [] } };
  k.say = (s) => { k.lines.push(s); };
  const l = await launch({ wav: path.join(ROOT, 'logs/speech', `${k.lang}.wav`), profile: path.join(ROOT, 'logs', 'profiles', key) });
  Object.assign(k, l);
  kids.push(k);
}
const save = (k) => {
  fs.writeFileSync(path.join(OUT, `${k.key}-${mode}.txt`), k.lines.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, `${k.key}-${mode}.json`), JSON.stringify(k.out, null, 1));
};

async function flight(k, off) {
  const map = await openMap(k.page, k).catch((e) => ({ err: e.message.split('\n')[0] }));
  if (map.err) { k.say(`MAP did not open: ${map.err}`); k.out.flight.push({ part: 'map', ok: false, why: map.err }); return; }
  k.say(`map: lang=${map.lang} dir=${map.dir} — ${map.islands.map((i) => `${i.k}${i.done ? '✓' : ''}`).join(' ')}`);
  k.out.map = { lang: map.lang, dir: map.dir };
  for (const part of PARTS) {
    // the child's voice for this part's story: the English island's story, read by the Mac's voice; the Big flight's
    // English story; Urdu parts get real Urdu speech (of another text: the Mac has no Urdu voice)
    const voice = part === 'english' ? 'en-story2.wav' : part === 'urdu' ? 'ur.wav' : part === 'tower' ? 'en.wav' : null;
    if (voice && k.mic && fs.existsSync(path.join(ROOT, 'logs/speech', voice))) fs.copyFileSync(path.join(ROOT, 'logs/speech', voice), k.mic);
    const st = await startPart(k.page, part);
    if (!st.started) { k.say(`${part}: did not start — ${st.text}`); k.out.flight.push({ part, ok: false, why: 'did not start: ' + st.text.slice(0, 120) }); continue; }
    const sid = (st.url.match(/[?&]s=([0-9a-f-]+)/) || [])[1];
    k.say(`# ${part}: ${st.stones.length} stones (session ${sid})`);
    const r = await playPart(k.page, { lang: k.lang, say: k.say, maxMs: Number(flag('max', 14)) * 60000, tag: `mx-${k.key}-${part}${off ? '-off' : ''}`, shots: false });
    const back = await backToMap(k.page, { waitMs: 30000 });
    // with no network the stories of the part are scored on the device, on the map's card (games-read.js): the child
    // stays on the card while Jugnu listens, and so does the rig
    let device = null;
    if (off && back.back && r.results.some((x) => /\.story2?$/.test(x.task))) {
      device = await k.page.waitForFunction(() => window.__cbFlightReadDone || null, null, { timeout: 200000, polling: 1000 }).then((h) => h.jsonValue(), () => 'not scored within 200 s');
      const boxes = await k.page.evaluate(() => [...document.querySelectorAll('[data-cb-read]')].map((b) => ({ state: b.getAttribute('data-cb-read'), stars: b.getAttribute('data-stars'), lit: b.querySelectorAll('[data-read="1"]').length, words: b.querySelectorAll('[data-read]').length, wpm: /per minute|a minute|فی منٹ/.test(b.innerText) }))).catch(() => []);
      k.say(`       scored on the device: ${JSON.stringify(device)} · on the card: ${JSON.stringify(boxes)}`);
      device = { done: device, boxes };
    }
    const cut = r.layout.filter((x) => x.cut && x.cut.length).map((x) => `${x.at.replace('sae-screen.', '')} [${x.cut.join(', ')}]`);
    const scrolls = Object.values(r.scrolls || {}).reduce((a, n) => a + n, 0);
    const row = { part, session: sid, stones: st.stones.length, ended: r.results.length, results: r.results, sounds: `${r.media.played}/${r.media.tried}`, sound_failures: r.media.failed, cut, scrolls, anomalies: r.anomalies,
      back: back.back, card: !!back.card, card_rows: back.rows || [], device, end: r.endDom || null, end_series: r.endSeries || [], end_parts: r.endParts || [], seconds: Math.round(r.ms / 1000), ok: !r.anomalies.length && back.back && r.results.length === st.stones.length };
    k.out.flight.push(row);
    k.say(`  ${row.ok ? 'OK  ' : 'FAIL'} ${part}: ${row.ended}/${row.stones} stones ended · sounds ${row.sounds}${r.media.failed.length ? ' FAILED ' + r.media.failed.slice(0, 3).join(', ') : ''} · cut ${cut.length} · scrolls ${scrolls} · back ${back.back ? (back.card ? 'card' : 'map, no card') : 'NO'} · ${row.seconds} s${r.anomalies.length ? ' · ' + r.anomalies.join(' | ') : ''}`);
    if (r.endSeries && r.endSeries.length) k.say(`       last screen as it arrives [ms, page px, button bottom, screen bottom]: ${r.endSeries.slice(0, 12).map((x) => x.join('/')).join('  ')}`);
    if (r.endDom) k.say(`       last screen: page ${r.endDom.doc}px in a ${r.endDom.win}px window, "Go back" at ${r.endDom.button ? r.endDom.button[0] + '-' + r.endDom.button[1] : '?'}px, zoom ${r.endDom.zoom || 'none'}`);
    k.say(`       ${r.results.map((x) => `${x.task}=${x.stop}${x.correct != null ? `(${x.correct}/${x.attempted})` : ''}${x.audio ? '[' + x.audio + ']' : ''}`).join(' ')}`);
    save(k);
    if (!back.back) break;
    await k.page.locator('[data-tap="map"]').last().click({ timeout: 5000 }).catch(() => {});
    await k.page.waitForTimeout(600);
  }
}

async function challenge(k, off) {
  const rows = (await doorRows(k.page, k).catch((e) => { k.say('Games door did not open: ' + e.message.split('\n')[0]); return []; })).filter((r) => r.href && /^\/c\//.test(r.href));
  if (!rows.length) k.out.challenge.push({ name: '(none found behind the Games door)', ok: false });
  const want = flag('games', '');   // --games=bigger,missing: only these (by the row's item)
  for (const r of rows.filter((x) => !want || String(want).split(',').some((g) => String(x.item).indexOf(g) >= 0))) {
    const g = await playGame(k.page, { href: r.href, lang: k.lang, say: k.say, mic: k.mic, tag: `mx-${k.key}-${String(r.item).replace(/\W/g, '_')}${off ? '-off' : ''}`, maxMs: 6 * 60000 });
    // a reading with no network: its feedback is made on the device, under the page's own card
    let device = null;
    if (off && g.screens.some((x) => /^read-(live|rec)/.test(String(x)))) {
      const res = await k.page.waitForFunction(() => window.__cbReadResult || null, null, { timeout: 200000, polling: 1000 }).then((h) => h.jsonValue(), () => 'not scored within 200 s');
      const boxes = await k.page.evaluate(() => [...document.querySelectorAll('[data-cb-read]')].map((b) => ({ state: b.getAttribute('data-cb-read'), stars: b.getAttribute('data-stars'), lit: b.querySelectorAll('[data-read="1"]').length, words: b.querySelectorAll('[data-read]').length, wpm: /per minute|a minute|فی منٹ/.test(b.innerText) }))).catch(() => []);
      device = { result: res, boxes };
      k.say(`       scored on the device: ${JSON.stringify(res)} · on the card: ${JSON.stringify(boxes)}`);
    }
    const row = { name: r.name, kind: r.kind, item: r.item, ended: g.ended, device, end: (g.endText || '').slice(0, 100), screens: g.screens, posts: g.posts, sounds: `${g.media.played}/${g.media.tried}`, sound_failures: g.media.failed, cut: g.cut, scrolls: g.scrolls,
      anomalies: g.anomalies, spoke: g.spoke || null, lang: g.last && g.last.lang, dir: g.last && g.last.dir, seconds: Math.round(g.ms / 1000), ok: g.ended && !g.anomalies.length };
    k.out.challenge.push(row);
    k.say(`  ${row.ok ? 'OK  ' : 'FAIL'} ${r.name} [${r.kind}:${r.item}]: ${g.screens.join('>')} · sent ${g.posts.join(' ') || 'nothing'} · sounds ${row.sounds} · cut ${g.cut.length}${g.anomalies.length ? ' · ' + g.anomalies.join(' | ') : ''}`);
    save(k);
  }
}

async function getReady(k) {
  const t0 = Date.now();
  // the device key first (its own visit: the start page drops the rest of the address when it takes a key)
  if (process.env.CB_DEVICE_KEY) await k.page.goto(`${BASE}/cb?key=${encodeURIComponent(process.env.CB_DEVICE_KEY)}`, { waitUntil: 'load', timeout: 60000 });
  await k.page.goto(`${BASE}/cb?hub=${k.token}`, { waitUntil: 'load', timeout: 60000 });
  await k.page.waitForTimeout(1500);
  // a Get ready that was stopped part-way carries on by itself when the page opens (its button is then off)
  // --again: "Start again from the beginning" (every step runs, what is saved is skipped), else Get ready / Carry on
  if (flag('again', false) && await k.page.locator('#again:visible').count()) await k.page.click('#again', { timeout: 5000 }).catch(() => {});
  else await k.page.click('#ready', { timeout: 5000 }).catch(() => {});
  await k.page.waitForFunction(() => { const p = document.getElementById('phase'); const l = document.getElementById('log'); return (p && /Ready\./.test(p.textContent)) || (l && /stopped:/.test(l.textContent)); }, null, { timeout: 30 * 60 * 1000, polling: 1000 });
  const r = await k.page.evaluate(async () => ({ log: document.getElementById('log').textContent.trim().split('\n'), kept: (await (await caches.open('cb-pilot-v1')).keys()).length, games: localStorage.getItem('cb-games-ready'),
    usage: navigator.storage && navigator.storage.estimate ? Math.round((await navigator.storage.estimate()).usage / 1e6) : null, regs: (await navigator.serviceWorker.getRegistrations()).map((x) => x.scope.replace(location.origin, '')) }));
  // the pilot's own page files are read again (a Get ready pressed a second time skips a step it finished before, and
  // the device would then play the copies of the first time with no network)
  await k.page.evaluate(() => Promise.all(['/__cb/boot.js', '/__cb/games-read.js', '/__cb/cb-fit.css', '/sa/play.html'].map((u) => fetch(u, { cache: 'reload' }).then((x) => x.text(), () => null)))).catch(() => {});
  k.out.ready = { seconds: Math.round((Date.now() - t0) / 1000), kept: r.kept, mb: r.usage, workers: r.regs, games: r.games ? JSON.parse(r.games) : null, log: r.log };
  k.say(`get ready: ${k.out.ready.seconds} s, ${r.kept} files, ${r.usage} MB, workers ${r.regs.join(',')} — ${r.log.filter((x) => /big flight|number and story|Listen|stopped/.test(x)).join(' · ')}`);
  save(k);
}

async function reconnect(k) {
  // nobody presses anything: the child's home is simply open when the network comes back
  await k.page.goto(`${BASE}/h/${k.token}`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  const t0 = Date.now();
  let left = null;
  for (;;) {
    left = await k.page.evaluate(async () => {
      const ask = (msg) => new Promise((ok) => { const sw = navigator.serviceWorker.controller; if (!sw) return ok(null); const ch = new MessageChannel(); const t = setTimeout(() => ok(null), 4000); ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); }; sw.postMessage(msg, [ch.port2]); });
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'report' });
      if (window.__cbDrain) window.__cbDrain();
      return { outbox: await ask({ type: 'games-outbox' }), drained: window.__cbDrained || null };
    }).catch(() => null);
    const waiting = left && left.outbox ? left.outbox.filter((x) => x.state === 'waiting').length : -1;
    const sessions = left && left.drained ? left.drained.sessions || [] : null;
    const pending = sessions ? sessions.filter((s) => s.state !== 'synced').length : -1;
    if ((waiting === 0 && pending === 0) || Date.now() - t0 > 240000) break;
    await k.page.waitForTimeout(5000);
  }
  k.out.reconnect = { seconds: Math.round((Date.now() - t0) / 1000), outbox: left && left.outbox, drained: left && left.drained };
  k.say(`reconnect: after ${k.out.reconnect.seconds} s — worker outbox ${JSON.stringify(left && left.outbox)} · engine runs ${JSON.stringify(left && left.drained && left.drained.sessions)}`);
  save(k);
}

const both = async (k, off) => { if (ONLY !== 'challenge') await flight(k, off); if (ONLY !== 'flight') await challenge(k, off); };
const P = Number(flag('parallel', 5));
try {
  fs.rmSync(FLAG, { force: true });
  if (mode === 'online') await pool(kids, P, (k) => both(k, false));
  else {
    console.log(`get ready for ${kids.length} children…`);
    await pool(kids, Number(flag('ready-parallel', 3)), getReady);
    fs.writeFileSync(FLAG, '');
    await Promise.all(kids.map((k) => k.ctx.setOffline(true)));
    console.log('OFFLINE: the server drops every connection and every browser is offline');
    await pool(kids, P, (k) => both(k, true));
    fs.rmSync(FLAG, { force: true });
    await Promise.all(kids.map((k) => k.ctx.setOffline(false)));
    console.log('the network is back: watching what each device sends by itself');
    await pool(kids, P, reconnect);
  }
} finally {
  fs.rmSync(FLAG, { force: true });
  for (const k of kids) {
    const errs = [...new Set(k.log.filter((l) => !/favicon|\/api\/wq\/e\b/.test(l)))];
    k.out.page_errors = errs.filter((l) => /pageerror/.test(l)).slice(-10);
    k.out.http_errors = errs.filter((l) => /\[http /.test(l)).slice(-15);
    k.say(`-- page errors ${k.out.page_errors.length}; 4xx/5xx ${k.out.http_errors.length}: ${k.out.http_errors.slice(-6).join(' ; ')}`);
    save(k);
    const f = k.out.flight, c = k.out.challenge;
    console.log(`${k.key.padEnd(9)} G${k.grade} ${k.lang} ${mode}: flight ${f.filter((x) => x.ok).length}/${f.length} parts ok [${f.map((x) => `${x.part}:${x.ok ? 'ok' : 'FAIL'}`).join(' ')}] · challenge ${c.filter((x) => x.ok).length}/${c.length} ok [${c.map((x) => `${x.item}:${x.ok ? 'ok' : 'FAIL'}`).join(' ')}]${k.out.reconnect ? ' · left waiting: ' + ((k.out.reconnect.outbox || []).filter((x) => x.state !== 'sent').length) : ''}`);
    await k.ctx.close().catch(() => {});
  }
}
