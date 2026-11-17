// "The pilot was deployed since this Chromebook last opened it": the worker file has changed, and someone presses
// Get ready. Chrome fetches the new worker when Get ready registers it; the new one takes over a second or two
// later, and a request the outgoing worker has not answered by then is never answered. Before the fix the hidden
// frame of the "Child home" step stayed blank ("the child home did not open") in 4 runs of 7.
//   CB_BASE=http://localhost:8843 DEVICE_KEY=… node rig/handover-check.mjs [rounds, default 5]
// The server must have been started by rig/serve.sh (it adds logs/sw-stamp.txt to the worker file as a comment: that
// is how this rig "deploys"). Run it on a profile that has already run Get ready.
// Each round: a new stamp, a clean Get-ready record, the start page, Get ready pressed.
// Expect each round: a newer worker took over, and the Child home step found the home's doors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, BASE } from './cb.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = path.join(ROOT, 'logs', 'sw-stamp.txt');
const KEY = process.env.DEVICE_KEY;
const ROUNDS = Number(process.argv[2]) || 5;
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
  for (let n = 1; n <= ROUNDS; n += 1) {
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
