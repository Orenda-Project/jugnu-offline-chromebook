// A server that cannot sign a home (no HUB_SIGNING_KEY): does a Chromebook whose link has expired still open its home?
//   Server run WITHOUT the key; a profile that already ran Get ready.   CB_BASE=… DEVICE_KEY=… HUB_SIGNING_KEY=… node rig/nokey-check.mjs
// (HUB_SIGNING_KEY here only makes the expired link for the test; the server must not have it.)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { launch, BASE, controlled } from './cb.mjs';
import { signer, decode } from '../hub-sign.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.DEVICE_KEY;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'cb-config.json'), 'utf8'));
const S = signer(process.env.HUB_SIGNING_KEY, cfg.hub);
const ref = decode(cfg.hub);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const { ctx, page } = await launch({ fresh: false });
try {
  const status = await fetch(`${BASE}/__cb/home/status?key=${encodeURIComponent(KEY)}`).then((r) => r.json());
  check('this server cannot sign a home', status.signing === false, `why: ${status.why}`);
  await page.goto(`${BASE}/hello`, { waitUntil: 'load' });
  check('the offline worker is in charge', await controlled(page));
  const dead = S.sign({ ids: ref.ids, lang: ref.l, ttlS: 60, nonce: crypto.randomBytes(4).toString('hex'), now: Date.now() - 3600e3 }).token;
  await page.evaluate((m) => navigator.serviceWorker.controller.postMessage(m), { type: 'hub', hub: dead, key: KEY });
  await page.waitForTimeout(500);
  await page.goto(`${BASE}/cb/home`, { waitUntil: 'load' }).catch(() => {});
  await page.waitForSelector('a.wq-door', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const h = await page.evaluate(() => ({ doors: document.querySelectorAll('a.wq-door').length, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 90) }));
  check('ONLINE, the link expired, no fresh one to be had: the saved home still opens', h.doors === 3 && !/expired|another player/i.test(h.text), h.text);
  await page.click('a.wq-door[href="#stories"]').catch(() => {});
  await page.waitForTimeout(3000);
  const st = await page.evaluate(() => ({ m: document.getElementById('wq').getAttribute('data-m'), books: document.querySelectorAll('.wqs-book').length }));
  check('…and the Stories door opens', st.m === 'H3-stories' && st.books > 0, `${st.books} books`);
} catch (e) { check('the run finished', false, String(e && e.message || e).split('\n')[0]); } finally {
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
}
