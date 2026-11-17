// Get ready, end to end, on a Chromebook-shaped Chrome: every step with its real numbers, the lesson videos of the
// classes named, an interruption half-way (the page is closed and opened again), then "Check this Chromebook".
//   CB_BASE=http://localhost:8813 DEVICE_KEY=… node rig/ready-check.mjs [--videos 2] [--interrupt] [--keep]
//                                                                       [--check] [--check-offline] [--skip-ready]
// --videos: the classes whose lesson videos to save (none | all | 1,2); --keep: use the profile as it is (no fresh start)
// --check: then press "Check that everything opens without Wi-Fi"; --check-offline: the same with the network truly
// off (the server drops every connection and the browser is offline); --skip-ready: only the check (with --keep)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, shot, BASE } from './cb.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = path.join(ROOT, 'OFFLINE');

const KEY = process.env.DEVICE_KEY;
if (!KEY) { console.error('set DEVICE_KEY'); process.exit(1); }
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const videos = arg('videos', 'none');
const { ctx, page, log } = await launch({ fresh: !has('keep') });
const say = (t) => console.log(t);
const snap = () => page.evaluate(() => ({
  phase: document.getElementById('phase').textContent, kept: document.getElementById('kept').textContent, space: document.getElementById('space').textContent,
  steps: [...document.querySelectorAll('#steps li')].map((li) => `${li.className === 'ok' ? '✓' : li.className === 'bad' ? '!' : li.className === 'run' ? '…' : ' '} ${li.textContent.trim()}`),
  log: document.getElementById('log').textContent.trim().split('\n'),
})).catch(() => null);
const settled = (s) => s && /^(Ready\.|Not ready|Stopped)/.test(s.phase) && !/Still saving/.test(s.phase) && !s.steps.some((x) => x.startsWith('…'));

try {
  const t0 = Date.now();
  await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}&videos=${encodeURIComponent(videos)}${has('skip-ready') ? '&stay=1' : ''}`, { waitUntil: 'load' });
  // (a run that was cut short carries on by itself when the page opens: the button is then already "pressed")
  if (!has('skip-ready') && await page.evaluate(() => !document.getElementById('ready').disabled)) await page.click('#ready');
  else if (!has('skip-ready')) say('      Get ready carried on by itself (the last run was cut short)');
  let interrupted = !has('interrupt');
  let last = '';
  for (; !has('skip-ready');) {
    await page.waitForTimeout(5000);
    const s = await snap();
    if (!s) continue;
    const now = (s.steps.find((x) => x.startsWith('…')) || s.phase).slice(0, 110);
    if (now !== last) { say(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s  ${now}`); last = now; }
    if (!interrupted && s.steps.filter((x) => x.startsWith('✓')).length >= 2) {
      interrupted = true;
      say('      — the page is closed in the middle of Get ready, and opened again —');
      await page.goto('about:blank'); await page.waitForTimeout(1500);
      await page.goto(`${BASE}/cb`, { waitUntil: 'load' });
      await page.waitForTimeout(2500);
      const back = await snap();
      say(`      after reopening: ${back.phase.slice(0, 90)} | done so far: ${back.steps.filter((x) => x.startsWith('✓')).length} steps | log: ${back.log.slice(-1)[0]}`);
    }
    if (settled(s)) break;
    if (Date.now() - t0 > 3600e3) { say('gave up after an hour'); break; }
  }
  const s = await snap();
  say(`\nGet ready: ${Math.round((Date.now() - t0) / 1000)} s — ${s.phase}\nfiles: ${s.kept} · ${s.space}\n${s.steps.join('\n')}\n-- log --\n${s.log.join('\n')}`);
  await shot(page, 'ready-done');

  for (const mode of [has('check') ? 'online' : null, has('check-offline') ? 'offline' : null].filter(Boolean)) {
    let mark = null;
    if (mode === 'offline') { fs.writeFileSync(OFFLINE, ''); await ctx.setOffline(true); await page.waitForTimeout(2500); mark = new Date().toISOString(); }
    const c0 = Date.now();
    await page.click('#test');
    let lastNow = '';
    for (;;) {
      await page.waitForTimeout(3000);
      const now = await page.evaluate(() => document.getElementById('test-now').textContent);
      if (now && now !== lastNow && (Date.now() - c0) % 15000 < 3100) { say(`      checking ${now}`); lastNow = now; }
      if (await page.evaluate(() => !!document.getElementById('test-result') || /The check stopped/.test(document.getElementById('test-out').textContent))) break;
      if (Date.now() - c0 > 1800e3) break;
    }
    const out = await page.evaluate(() => document.getElementById('test-out').innerText);
    say(`\nCheck this Chromebook (${mode === 'offline' ? 'network truly off' : 'Wi-Fi on, worker reaching no network'}), ${Math.round((Date.now() - c0) / 1000)} s:\n${out}`);
    await page.evaluate(() => document.getElementById('check').scrollIntoView());
    await shot(page, 'ready-check-' + mode);
    if (mode === 'offline') {
      const rows = fs.readFileSync(path.join(ROOT, 'logs', 'requests.jsonl'), 'utf8').trim().split('\n').slice(-5000).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((r) => r.t > mark);
      say(`server while offline: ${rows.filter((r) => r.dropped).length} connections dropped, ${rows.filter((r) => !r.dropped).length} answered`);
      fs.rmSync(OFFLINE, { force: true }); await ctx.setOffline(false);
    }
  }
} finally {
  fs.rmSync(OFFLINE, { force: true });
  const bad = log.filter((l) => /pageerror/.test(l)).slice(-8);
  if (bad.length) say('\npage errors:\n' + bad.join('\n'));
  await ctx.close();
}
