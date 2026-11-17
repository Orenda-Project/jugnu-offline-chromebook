// The child home never goes stale: proof on a Chromebook-shaped Chrome against a running pilot server.
//   CB_BASE=http://localhost:8813 DEVICE_KEY=… HUB_SIGNING_KEY=… node rig/home-check.mjs [--expiry]
// (HUB_SIGNING_KEY: the same one the server has; it is used here only to make links that are already expired, or
//  locked to another device, so nobody waits 7 days. ./cb-config.json names the home's child.)
//
// 1. set up: the worker gets this Chromebook's key and asks the server for a fresh home; /cb/home opens it
// 2. online, an EXPIRED link (a bookmark, a saved page): sent to a fresh one, the home opens
// 3. online, the Chromebook's own link runs out: /cb/home opens a newly signed one
// 4. NO NETWORK (the server drops every connection AND the browser is offline), the stored link expired:
//    /cb/home, the expired link itself and a link never seen on this device all open the saved home; Stories opens
// 5. back online: the home opens with a link that is good
// 6. a link locked to another device: a new one is signed and the home opens by itself
//
// --expiry: against a server run with HOME_TTL_S=40 (every home it signs runs out in 40 s). The Chromebook is set up,
// then left until EVERYTHING it holds has expired (the stored link and the link inside every saved page), the way a
// Chromebook comes back after a holiday. Then: no network -> the saved home and Stories open; back online -> a fresh
// link, never "This link has expired".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { launch, shot, BASE, controlled } from './cb.mjs';
import { signer, decode } from '../hub-sign.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = path.join(ROOT, 'OFFLINE');
const KEY = process.env.DEVICE_KEY;
const cfg = JSON.parse(process.env.CB_CONFIG || fs.readFileSync(path.join(ROOT, 'cb-config.json'), 'utf8'));
const S = signer(process.env.HUB_SIGNING_KEY, cfg.hub);
if (!KEY || !S.ok) { console.error('set DEVICE_KEY and HUB_SIGNING_KEY (the server\'s own)', S.why || ''); process.exit(1); }
const ref = decode(cfg.hub);
const mint = (ttlS) => S.sign({ ids: ref.ids, lang: ref.l, ttlS, nonce: crypto.randomBytes(4).toString('hex') }).token;
const expired = () => S.sign({ ids: ref.ids, lang: ref.l, ttlS: 60, nonce: crypto.randomBytes(4).toString('hex'), now: Date.now() - 3600e3 }).token;

const EXPIRY = process.argv.includes('--expiry');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const tokenOf = (url) => (new URL(url).pathname.match(/^\/h\/([^/?#]+)/) || [])[1] || null;
const daysLeft = (t) => { const p = decode(t); return p ? (p.exp - Date.now() / 1000) / 86400 : -1; };
const secsLeft = (t) => Math.round(daysLeft(t) * 86400);

fs.rmSync(OFFLINE, { force: true });
const { ctx, page, log } = await launch({ fresh: true });
const ask = (msg) => page.evaluate((m) => new Promise((ok) => {
  const ch = new MessageChannel(); const t = setTimeout(() => ok(null), 9000);
  ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); };
  navigator.serviceWorker.controller.postMessage(m, [ch.port2]);
}), msg);
const tell = (msg) => page.evaluate((m) => { navigator.serviceWorker.controller.postMessage(m); }, msg);
/** What the home shows: the three doors (an open home), or the words of a closed one. */
const home = async (waitMs = 9000) => {
  await page.waitForSelector('a.wq-door, .wq-closed, h1', { timeout: waitMs }).catch(() => {});
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({
    path: location.pathname, token: (location.pathname.match(/^\/h\/([^/?#]+)/) || [])[1] || null,
    doors: [...document.querySelectorAll('a.wq-door')].map((a) => a.getAttribute('href')),
    text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 160),
    online: navigator.onLine,
  }));
};
const open = async (p) => { await page.goto(BASE + p, { waitUntil: 'load', timeout: 30000 }).catch((e) => console.log('  (goto: ' + e.message.split('\n')[0] + ')')); return home(); };
const opened = (h) => h.doors.length === 3 && !/expired|another player/i.test(h.text);
const serverLog = () => fs.readFileSync(path.join(ROOT, 'logs', 'requests.jsonl'), 'utf8').trim().split('\n').slice(-4000).map((l) => { try { return JSON.parse(l); } catch { return {}; } });

const goOffline = async () => { fs.writeFileSync(OFFLINE, ''); await ctx.setOffline(true); await page.waitForTimeout(2500); return new Date().toISOString(); };
const goOnline = async () => { fs.rmSync(OFFLINE, { force: true }); await ctx.setOffline(false); await page.waitForTimeout(21000); }; // the worker does not ask again within 20 s of a failed ask
const storiesOpen = async () => {
  await page.click('a.wq-door[href="#stories"]').catch(() => {});
  await page.waitForTimeout(3000);
  return page.evaluate(() => ({ hash: location.hash, rows: document.querySelectorAll('[data-book], .wq-row, .wqs-book, .wq-vt, .wqs li').length, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 140) }));
};
const nothingReached = (mark) => { const rows = serverLog().filter((r) => r.t > mark); const got = rows.filter((r) => !r.dropped); check('NO NETWORK: nothing reached the server', got.length === 0, `${rows.length - got.length} connections dropped, ${got.length} answered`); };

async function expiryRun() {
  await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.register('/__cb/sw.js', { scope: '/' }));
  check('the offline worker is in charge', await controlled(page));
  const first = await ask({ type: 'home', key: KEY, device: 'rig-expiry', fresh: true });
  const ttl = first && first.hub ? secsLeft(first.hub) : 0;
  check('this server signs short homes (HOME_TTL_S <= 90)', first && first.live && ttl > 5 && ttl <= 90, `${ttl} s`);
  let h = await open('/cb/home');
  check('/cb/home opens the home (3 doors)', opened(h), h.text.slice(0, 60));
  for (const d of ['stories', 'games', 'videos']) { await page.click(`a.wq-door[href="#${d}"]`).catch(() => {}); await page.waitForTimeout(2500); }
  h = await open('/cb/home'); // the copy that stays on the device
  const savedWith = h.token;
  const mark = await goOffline(); // offline first, so nothing renews while it waits
  const held = await ask({ type: 'home' });
  const wait = Math.max(0, secsLeft(savedWith), held && held.hub ? secsLeft(held.hub) : 0) + 4;
  console.log(`      … leaving the Chromebook for ${wait} s, until every link it holds has run out`);
  await page.waitForTimeout(wait * 1000);
  const st = await ask({ type: 'home' });
  check('every link on the device has run out', st && st.hub && secsLeft(st.hub) < 0 && secsLeft(savedWith) < 0 && !st.live, `stored link ${st && st.hub ? secsLeft(st.hub) : '?'} s, saved page's link ${secsLeft(savedWith)} s`);
  h = await open('/cb/home');
  check('NO NETWORK, everything expired: /cb/home opens the saved home', opened(h) && h.online === false && secsLeft(h.token) < 0, `${h.doors.length} doors; the page's link ran out ${-secsLeft(h.token)} s ago`);
  await shot(page, 'home-expiry-offline');
  const shelf = await storiesOpen();
  check('NO NETWORK, everything expired: the Stories door opens', shelf.hash === '#stories' && shelf.rows > 0 && !/could not open|did not load/i.test(shelf.text), `${shelf.rows} rows: ${shelf.text.slice(0, 60)}`);
  await shot(page, 'home-expiry-offline-stories');
  nothingReached(mark);
  await goOnline();
  h = await open('/cb/home');
  check('back online: a fresh link, and the home opens (never "This link has expired")', opened(h) && secsLeft(h.token) > 0 && h.token !== savedWith, `${secsLeft(h.token)} s left`);
  h = await open('/h/' + savedWith);
  check('back online: the old saved link itself is sent to a live one', opened(h) && h.token !== savedWith && secsLeft(h.token) > 0, `${secsLeft(h.token)} s left`);
  await shot(page, 'home-expiry-back-online');
}

try {
  if (EXPIRY) { await expiryRun(); throw { done: true }; }
  // 1. set up
  await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.register('/__cb/sw.js', { scope: '/' }));
  check('the offline worker is in charge', await controlled(page));
  const first = await ask({ type: 'home', key: KEY, device: 'rig-home', fresh: true });
  check('the server signs this Chromebook a fresh home', first && first.hub && first.live && daysLeft(first.hub) > 6.9, first ? `${daysLeft(first.hub).toFixed(2)} days` : 'no answer');
  let h = await open('/cb/home');
  check('/cb/home opens the home (3 doors)', opened(h) && h.token === first.hub, h.text.slice(0, 70));
  await shot(page, 'home-1-fresh');
  // save what a child sees behind each door, as Get ready does
  for (const d of ['stories', 'games', 'videos']) { await page.click(`a.wq-door[href="#${d}"]`).catch(() => {}); await page.waitForTimeout(2500); }
  await open('/cb/home');

  // 2. online, an expired link
  const old = expired();
  check('the test link is expired', daysLeft(old) < 0, `${(daysLeft(old) * 24).toFixed(1)} h`);
  h = await open('/h/' + old);
  check('online: an EXPIRED link is sent to a fresh one and the home opens', opened(h) && h.token !== old && daysLeft(h.token) > 6, `${h.token ? daysLeft(h.token).toFixed(2) + ' days left' : h.text.slice(0, 80)}`);
  await shot(page, 'home-2-expired-online');

  // 3. online, the Chromebook's own link runs out
  await tell({ type: 'hub', hub: mint(4) });
  await page.waitForTimeout(5500);
  h = await open('/cb/home');
  check('online: this Chromebook\'s link ran out; /cb/home opens a newly signed one', opened(h) && daysLeft(h.token) > 6.9, `${h.token ? daysLeft(h.token).toFixed(2) + ' days left' : h.text.slice(0, 80)}`);
  const liveBefore = h.token;

  // 4. no network at all, and the stored link expired
  const dead = expired();
  await page.goto(`${BASE}/hello`, { waitUntil: 'load' }); // no open home page: one would hand the worker its newer link back
  await tell({ type: 'hub', hub: dead });
  const mark = await goOffline();
  const st = await ask({ type: 'home' });
  check('(setup) the stored link is expired and none can be signed', st && st.hub === dead && !st.live, st ? `left ${st.left} s` : '');
  h = await open('/cb/home');
  check('NO NETWORK, stored link expired: /cb/home opens the saved home', opened(h) && h.online === false, `${h.doors.length} doors`);
  await shot(page, 'home-4-offline-expired');
  const shelf = await storiesOpen();
  check('NO NETWORK: the Stories door opens from the saved copy', shelf.hash === '#stories' && shelf.rows > 0 && !/could not open|did not load/i.test(shelf.text), `${shelf.rows} rows: ${shelf.text.slice(0, 70)}`);
  await shot(page, 'home-4-offline-stories');
  h = await open('/h/' + expired());
  check('NO NETWORK: a different expired link opens the saved home too', opened(h), h.text.slice(0, 60));
  nothingReached(mark);

  // 5. back online
  await goOnline();
  h = await open('/cb/home');
  check('back online: the home opens with a link that is good', opened(h) && daysLeft(h.token) > 6.9 && h.token !== dead, `${h.token ? daysLeft(h.token).toFixed(2) + ' days left' : h.text.slice(0, 80)}`);

  // 6. a link locked to another device
  const taken = mint(7 * 86400);
  const other = crypto.randomBytes(16).toString('base64url');
  const bind = await fetch(`${BASE}/api/wq/hub/${taken}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `wq_dv=${other}` }, body: JSON.stringify({ device_ref: other }) }).then((r) => r.json());
  check('(setup) another device opened a link first', bind && Array.isArray(bind.kids) && bind.kids.length > 0 && !bind.locked);
  await tell({ type: 'hub', hub: taken });
  await page.waitForTimeout(400);
  await page.goto(`${BASE}/h/${taken}`, { waitUntil: 'load' }).catch(() => {});
  await page.waitForFunction((t) => !location.pathname.includes(t) && document.querySelectorAll('a.wq-door').length === 3, taken, { timeout: 25000 }).catch(() => {});
  h = await home();
  check('a link locked to another device: a new one is signed and the home opens by itself', opened(h) && h.token !== taken, h.text.slice(0, 70));
  await shot(page, 'home-6-locked-recovered');
} catch (e) {
  if (!e || !e.done) { check('the run finished', false, String(e && e.message || e).split('\n')[0]); }
} finally {
  fs.rmSync(OFFLINE, { force: true });
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) console.log(log.filter((l) => /pageerror|\[error\]/.test(l)).slice(-12).join('\n'));
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
}
