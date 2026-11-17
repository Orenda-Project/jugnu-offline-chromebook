// A Chromebook that holds an OLD pilot's saved files must run the NEW pilot's code with no network, after one online
// page load or one press of Get ready. This plays that on one fresh Chrome profile against three generations of the
// pilot's server on one port (so one origin, one set of saved files):
//
//   old   a checkout of an older pilot (the real Chromebook got ready on 30 October)
//   now   this worktree
//   next  a copy of this worktree with a later release (one pilot file changed)
//
//   CB_PRIVATE_ROOT=<private folder> node rig/games/release-check.mjs --old=<dir> --next=<dir> [--port=8822]
//
// For each generation it prints, per pilot file: the copy saved on the device, what the server serves now, and what
// the page gets with NO network (the server's OFFLINE switch on AND the browser offline). Exit 1 when a saved copy or
// an offline answer is not the release's own. No child link is opened: nothing here is bound to a child.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import pw from 'playwright-core';
import { ROOT, UA } from './lib.mjs';

const { chromium } = pw;
const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const PORT = Number(flag('port', 8822));
const BASE = `http://localhost:${PORT}`;
const P = process.env.CB_PRIVATE_ROOT;
const OLD = flag('old'); const NEXT = flag('next');
if (!P || !OLD || !NEXT) { console.error('CB_PRIVATE_ROOT, --old=<dir> and --next=<dir> are needed'); process.exit(2); }
const OFF = path.join(ROOT, 'logs', `OFFLINE-${PORT}`);
const KEY = fs.readFileSync(path.join(P, 'device-key.txt'), 'utf8').trim();
const say = (s) => console.log(s);
const sha = (buf) => createHash('sha256').update(Buffer.from(buf)).digest('hex').slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
async function start(dir, name) {
  if (server) { server.kill('SIGTERM'); await sleep(800); }
  fs.rmSync(OFF, { force: true });
  const env = { ...process.env, UPSTREAM: 'https://portal-sandbox.up.railway.app', PORT: String(PORT), DEVICE_KEY: KEY, OFFLINE_FLAG: OFF,
    CB_CONFIG: fs.readFileSync(path.join(ROOT, 'cb-config.json'), 'utf8'), ROSTER_FILE: path.join(P, 'roster-ims-no4-g92.json') };
  const out = fs.openSync(path.join(ROOT, 'logs', `server-${PORT}.out`), 'a');
  server = spawn('node', ['server.mjs'], { cwd: dir, env, stdio: ['ignore', out, out] });
  for (let i = 0; i < 40; i += 1) { try { const r = await fetch(`${BASE}/hello`); if (r.ok) break; } catch (e) { /* not up yet */ } await sleep(250); }
  const rel = await fetch(`${BASE}/__cb/release`).then((r) => (r.ok ? r.text() : null), () => null).then((t) => { try { const j = JSON.parse(t); return j && j.stamp ? j : null; } catch (e) { return null; } });
  say(`\n## ${name}: server from ${path.basename(dir)} — release ${rel ? rel.stamp + ' (' + rel.files.length + ' files)' : 'none (this pilot has no release stamp)'}`);
  return rel;
}
const served = async (paths) => { const o = {}; for (const p of paths) o[p] = await fetch(BASE + p).then(async (r) => (r.ok ? sha(await r.arrayBuffer()) : `http ${r.status}`), () => 'down'); return o; };
const kept = (page, paths) => page.evaluate(async (list) => {
  const c = await caches.open('cb-pilot-v1'); const out = {};
  const hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  for (const p of list) { const r = await c.match(new URL(p, location.origin).toString()); out[p] = r ? await hex(await r.arrayBuffer()) : null; }
  const rk = await c.match(new URL('/__cb/release-kept', location.origin).toString());
  out.__release = rk ? (await rk.json()).stamp : null;
  out.__worker = navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL.replace(location.origin, '') : null;
  return out;
}, paths);
const offlineGets = (page, paths) => page.evaluate(async (list) => {
  const out = {};
  const hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  for (const p of list) out[p] = await fetch(p, { cache: 'no-store' }).then(async (r) => (r.ok ? hex(await r.arrayBuffer()) : `http ${r.status}`), () => 'failed');
  return out;
}, paths);
const short = (p) => p.replace('/__cb/', '');

const profile = path.join(ROOT, 'logs', 'profiles', `release-check-${Date.now()}`);
const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: !process.env.CB_HEADED, viewport: { width: 1366, height: 633 }, userAgent: UA, locale: 'en-PK' });
const page = ctx.pages()[0] || await ctx.newPage();
let bad = 0;
try {
  // ---- the old pilot: what a Chromebook that got ready then holds ----
  await start(OLD, 'old');
  await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1000);
  // the old pilot's own Get ready (no child picked: its worker, its start pages and the files every child needs)
  await page.click('#ready', { timeout: 5000 });
  const t0 = Date.now();
  await page.waitForFunction(() => { const b = document.getElementById('ready'); const t = document.body.innerText; return /Ready\b|ready for offline\.|All set|stopped/i.test((document.getElementById('phase') || {}).textContent || '') || (b && !b.disabled && /saved|kept/i.test(t)); }, null, { timeout: 6 * 60 * 1000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const oldSeen = await page.evaluate(() => ({ phase: (document.getElementById('phase') || {}).textContent || '', log: ((document.getElementById('log') || {}).textContent || '').trim().split('\n').slice(-4).join(' | ').slice(0, 300), kept: 0 })).catch(() => ({ phase: '?', log: '' }));
  const oldPaths = ['/__cb/boot.js', '/cb', '/hello', '/who'];
  const oldKept = await kept(page, oldPaths);
  const oldServed = await served(oldPaths);
  say(`  the old pilot's Get ready: ${Math.round((Date.now() - t0) / 1000)} s — "${oldSeen.phase}" ${oldSeen.log ? '(' + oldSeen.log + ')' : ''}`);
  say(`  the device now holds (old pilot's own bytes): ${oldPaths.map((p) => `${short(p)}=${oldKept[p] || 'not kept'}${oldKept[p] && oldKept[p] === oldServed[p] ? '' : oldKept[p] ? ' (server ' + oldServed[p] + ')' : ''}`).join('  ')} · release noted: ${oldKept.__release || 'none'} · worker: ${oldKept.__worker}`);
  if (!oldKept['/__cb/boot.js'] || !oldKept.__worker) { say('  the old pilot kept nothing on this profile: there is no old copy to replace'); bad += 1; }

  // called with the page still showing the generation before (same origin): what the device holds before this one
  const check = async (name, rel, { press = false } = {}) => {
    const paths = rel.files;
    const before = await kept(page, paths);
    await page.goto(`${BASE}/cb`, { waitUntil: 'load', timeout: 60000 });
    let after = null; let waited = 0;
    const settle = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { after = await kept(page, paths); if (after.__release === rel.stamp) break; await page.waitForTimeout(500); } waited += Date.now() - t0; };
    if (!press) await settle(30000);
    else {
      await settle(6000);
      say(`  six seconds after the page loaded, nothing pressed: release noted on the device = ${after.__release} (${after.__release === rel.stamp ? 'already the new one' : 'still the earlier one'})`);
      if (after.__release !== rel.stamp) {
        await page.click('#ready', { timeout: 5000 });
        say('  Get ready pressed');
        await settle(40000);
      }
    }
    const srv = await served(paths);
    const rows = paths.map((p) => ({ p, was: before[p], kept: after[p], served: srv[p] }));
    const wrong = rows.filter((r) => r.kept !== r.served);
    const changed = rows.filter((r) => r.was !== r.kept);
    say(`  ${name}: release noted on the device = ${after.__release} (server ${rel.stamp}) after ${Math.round(waited / 1000)} s · saved copies replaced: ${changed.length} of ${rows.length} · saved copy = what the server serves: ${rows.length - wrong.length} of ${rows.length}`);
    for (const r of rows) say(`     ${short(r.p).padEnd(28)} before ${String(r.was || 'not kept').padEnd(12)} now ${String(r.kept).padEnd(12)} server ${r.served}${r.kept !== r.served ? '   <-- NOT the release' : ''}`);
    if (after.__release !== rel.stamp || wrong.length) bad += 1;
    // with NO network: the server drops every connection AND the browser is offline
    fs.writeFileSync(OFF, 'release-check');
    await ctx.setOffline(true);
    const dead = await fetch(`${BASE}/hello`).then((r) => `answered ${r.status}`, () => 'no answer');
    const off = await offlineGets(page, paths);
    const offWrong = paths.filter((p) => off[p] !== srv[p]);
    const nav = await page.goto(`${BASE}/cb`, { waitUntil: 'load', timeout: 20000 }).then((r) => (r ? r.status() : 0), (e) => 'failed: ' + e.message.split('\n')[0]);
    const hasButton = await page.locator('#ready').count().catch(() => 0);
    say(`  ${name}, NO network (server: ${dead}; browser offline): ${paths.length - offWrong.length} of ${paths.length} files come from the device as this release's own${offWrong.length ? ' — NOT: ' + offWrong.map((p) => `${short(p)}=${off[p]}`).join(', ') : ''} · the start page opens: ${nav} with its button: ${hasButton ? 'yes' : 'no'}`);
    if (offWrong.length || !hasButton) bad += 1;
    await ctx.setOffline(false);
    fs.rmSync(OFF, { force: true });
    await page.waitForTimeout(500);
    // back on a page of this origin (one that asks for nothing), for the next generation's "before"
    await page.goto(`${BASE}/hello`, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  };

  // ---- this release: one page load with a network, nothing pressed ----
  const rel = await start(ROOT, 'now');
  await check('one online page load, nothing pressed', rel);

  // ---- a later release: Get ready pressed again (its finished steps are skipped) ----
  const rel2 = await start(NEXT, 'next');
  if (rel2.stamp === rel.stamp) { say('  the two releases have the same stamp: the copy was not changed'); bad += 1; }
  await check('a later release, Get ready pressed again', rel2, { press: true });
} finally {
  await ctx.close();
  if (server) server.kill('SIGTERM');
  fs.rmSync(OFF, { force: true });
}
say(`\n${bad ? 'FAILED: ' + bad + ' check(s)' : 'ok: after each release the device holds, and with no network serves, that release\'s own files'}`);
process.exit(bad ? 1 : 0);
