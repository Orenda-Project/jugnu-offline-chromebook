// "The pilot was deployed since this Chromebook last opened it": the worker file has changed, and someone presses
// Get ready. Chrome fetches the new worker when Get ready registers it; the new one takes over a second or two
// later, and a page asked for in the moment of the takeover is never answered (Chrome hands it to a fresh copy of
// the outgoing worker and ends that copy when the new worker is in charge). Before the fix the hidden frame of the
// "Child home" step stayed blank ("the child home did not open") in 4 runs of 7.
//   CB_BASE=http://localhost:8843 DEVICE_KEY=… node rig/handover-check.mjs [rounds, default 5]
//   CB_BASE=…                     DEVICE_KEY=… node rig/handover-check.mjs --tap [rounds, default 12] [ms after the outgoing worker falls idle, default 150]
// The server must have been started by rig/serve.sh (it adds logs/sw-stamp.txt to the worker file as a comment: that
// is how this rig "deploys"). Run it on a profile that has already run Get ready.
// Each round: a new stamp, a clean Get-ready record, the start page, Get ready pressed.
// Expect each round: a newer worker took over, and the Child home step found the home's doors.
// --tap: the same moment for a child. Each round: a new stamp, the child home opened (that is when Chrome finds the
// new worker). The outgoing worker is kept busy (asked to look up files it already has) until the new one is
// installed; Chrome takes over the moment the outgoing one falls idle, and just then the page is sent to a quiz, as
// a tap does. Expect: every round opens the quiz; the rig says which ones the page had to make again (boot.js:
// moveGuard). Without the guard a move in that moment is never answered: the page stays on the home.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, BASE } from './cb.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = path.join(ROOT, 'logs', 'sw-stamp.txt');
const KEY = process.env.DEVICE_KEY;
const TAP = process.argv.includes('--tap');
const nums = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const ROUNDS = nums[0] || (TAP ? 12 : 5);
const DELAY = nums[1] === undefined ? 150 : nums[1];
const QUIZ = JSON.parse(process.env.CB_CONFIG || fs.readFileSync(path.join(ROOT, 'cb-config.json'), 'utf8')).quizzes[0];
if (!KEY) { console.error('set DEVICE_KEY'); process.exit(1); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const { ctx, page } = await launch({ fresh: false });
let appeared = null; let t0 = 0;
ctx.on('serviceworker', () => { if (appeared === null) appeared = Date.now() - t0; });
let before = null;
try {
  await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
  before = await page.evaluate(() => localStorage.getItem('cb-run'));
  check('this profile has run Get ready before, and the offline worker is in charge', !!before && await page.evaluate(() => !!navigator.serviceWorker.controller));
  let again = 0;
  for (let n = 1; TAP && n <= ROUNDS; n += 1) {
    fs.writeFileSync(STAMP, `deploy ${n} ${Date.now()}`);
    appeared = null; t0 = Date.now();
    // (the rig's own way to the home is not what is tested: tried again if it falls in a takeover itself)
    for (let tries = 0; tries < 3; tries += 1) if (await page.goto(`${BASE}/cb/home`, { waitUntil: 'load', timeout: 12000 }).then(() => true, () => false)) break;
    // the outgoing worker is kept busy until the new one is installed and waiting, then let go; the tap follows
    const t1 = await page.evaluate(([q, delay]) => new Promise((ok) => {
      try { sessionStorage.removeItem('cb-move-again'); } catch (e) {}
      const sw = navigator.serviceWorker.controller;
      const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin) && !/\/api\/|\/__cb\//.test(u));
      const busy = () => new Promise((done) => { const ch = new MessageChannel(); ch.port1.onmessage = done; setTimeout(done, 5000); sw.postMessage({ type: 'have', urls: urls.concat(urls, urls, urls) }, [ch.port2]); });
      const waiting = () => navigator.serviceWorker.getRegistration('/').then((r) => !!(r && r.waiting));
      const t0 = Date.now();
      const loop = () => busy().then(waiting).then((w) => { if (!w && Date.now() - t0 < 10000) return loop(); setTimeout(() => { ok(Date.now()); location.href = '/q/' + q + '?tap=' + Date.now(); }, delay); });
      loop();
    }), [QUIZ, DELAY]).catch(() => Date.now());
    const opened = await page.waitForURL(/\/q\//, { timeout: 15000, waitUntil: 'commit' }).then(() => true, () => false);
    const took = ((Date.now() - t1) / 1000).toFixed(1);
    const redone = opened ? await page.evaluate(() => { try { return Number(sessionStorage.getItem('cb-move-again')) || 0; } catch (e) { return 0; } }).catch(() => 0) : 0;
    again += redone ? 1 : 0;
    // the takeover is over before the next round begins (one deploy at a time)
    if (opened) await page.waitForFunction(() => navigator.serviceWorker.getRegistration('/').then((r) => !!r && !r.installing && !r.waiting && !!r.active && r.active.state === 'activated'), null, { timeout: 15000, polling: 200 }).catch(() => {});
    await page.waitForTimeout(1500);
    check(`round ${n}: a tap ${DELAY} ms after the outgoing worker fell idle (a newer one waiting) opens the quiz`, opened, opened ? `in ${took} s${redone ? ': the first try was cut off, the page went again' : ''}` : `the page stayed on the home for 15 s (new worker seen ${appeared === null ? 'never' : (appeared / 1000).toFixed(1) + ' s after the home began to load'})`);
    await page.goto('about:blank');
  }
  if (TAP) console.log(`      ${again} of ${ROUNDS} taps were cut off by the takeover and made again by the page`);
  for (let n = 1; !TAP && n <= ROUNDS; n += 1) {
    fs.writeFileSync(STAMP, `deploy ${n} ${Date.now()}`);
    const served = await (await fetch(`${BASE}/__cb/sw.js`)).text();
    if (!served.trimEnd().endsWith(fs.readFileSync(STAMP, 'utf8'))) throw new Error('the server does not add logs/sw-stamp.txt to the worker file: start it with rig/serve.sh');
    await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.removeItem('cb-run'));
    await page.goto('about:blank');
    await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}&stay=1`, { waitUntil: 'load' });
    appeared = null; t0 = Date.now();
    await page.click('#ready');
    const row = await page.waitForFunction(() => { const li = document.querySelector('#steps li[data-step="doors"]'); return li && (li.className === 'ok' || li.className === 'bad') ? { cls: li.className, text: li.textContent.replace(/\s+/g, ' ').trim() } : null; }, null, { timeout: 120000, polling: 500 }).then((h) => h.jsonValue()).catch(() => ({ cls: 'none', text: 'the step did not finish in two minutes' }));
    const took = ((Date.now() - t0) / 1000).toFixed(1);
    const said = await page.evaluate(() => document.getElementById('log').textContent.split('\n').filter((l) => /newer version/.test(l)).slice(-1)[0] || '');
    check(`round ${n}: a newer worker took over while Get ready was starting`, appeared !== null, appeared !== null ? `it appeared ${(appeared / 1000).toFixed(1)} s after the press${said ? '; the page: "' + said.trim() + '"' : '; the page did not wait for it'}` : 'no new worker appeared');
    check(`round ${n}: the Child home step opened the home`, row.cls === 'ok', `${row.text.slice(0, 90)} (${took} s)`);
    await page.goto('about:blank'); // leave the run where it is; the next round starts clean
  }
} catch (e) {
  check('the run finished', false, String(e && e.message || e).split('\n')[0]);
} finally {
  fs.rmSync(STAMP, { force: true });
  // the profile's own Get-ready record, as it was
  if (before) { await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' }).catch(() => {}); await page.evaluate((v) => localStorage.setItem('cb-run', v), before).catch(() => {}); }
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
}
