// "Protected from clean-up": when does Chrome give this site persistent storage, and does the start page show it?
//   CB_BASE=http://127.0.0.1:8813 node rig/persist-check.mjs
// Chrome clears a site's saved files when the drive runs low unless the site holds persistent storage. Chrome gives
// it without asking (chrome/browser/storage/persistent_storage_permission_context.cc) to a site that is
//   - installed as an app (only an https site counts), or
//   - one of the profile's "important" sites: bookmarked (when the profile has 5 bookmarks or fewer), or much used
//     (site engagement 15 or more; at most 15 points can be earned in a day),
// and never in a Guest or clear-on-exit session, never inside another site's frame.
// This runs the real thing on this machine's Chrome (156, the Chromebook's version) with three fresh profiles:
//   1. new: not protected; the start page says so and offers Install (Chrome finds the page installable)
//   2. bookmarked (the profile's only bookmark is the start page): protected at the first open, and a Jugnu page
//      opened first (boot.js) asks too
//   3. used: opened and tapped until Chrome counts it as much used: protected, and the start page says so
// The address must be an IP or a real name (127.0.0.1, not "localhost": Chrome files a site under its registerable
// domain, and "localhost" has none).
// NOT shown here: the installed-app route. It needs https and a real install (a shelf icon on this machine); it is
// for the Chromebook (README).
//
// This script opens its own browser: rig/cb.mjs grants the microphone through the debugging port, and a permission
// granted that way makes Chrome refuse every other one, persistent storage included (so every other rig run says
// "not yet protected", whatever the site does).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pw from 'playwright-core';

import { UA, SHOTS } from './cb.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.CB_BASE || 'http://127.0.0.1:8813';
if (/\/\/localhost[:/]/.test(BASE)) { console.error('use an IP or a real name (CB_BASE=http://127.0.0.1:8813), not localhost'); process.exit(1); }
const QUIZ = JSON.parse(process.env.CB_CONFIG || fs.readFileSync(path.join(ROOT, 'cb-config.json'), 'utf8')).quizzes[0];
const profile = path.join(ROOT, '.chrome-profile-persist');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const open = () => pw.chromium.launchPersistentContext(profile, { channel: 'chrome', headless: !process.env.CB_HEADED, viewport: { width: 1366, height: 633 }, userAgent: UA, locale: 'en-PK' });
const START = `${BASE}/cb?stay=1&videos=none`;
const held = (page) => page.evaluate(() => navigator.storage.persisted());
const card = (page) => page.evaluate(() => {
  const say = document.getElementById('keep-say'); const b = document.getElementById('install');
  return { say: say ? say.textContent.replace(/\s+/g, ' ').trim() : null, install: !!b && !b.classList.contains('hidden') && b.offsetParent !== null, head: document.getElementById('space').textContent };
});
const settle = async (page) => { await page.waitForFunction(() => { const s = document.getElementById('keep-say'); return s && s.textContent.trim().length > 0; }, null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1200); };
const engagement = async (ctx) => {
  const p = await ctx.newPage();
  await p.goto('chrome://site-engagement/').catch(() => {});
  await p.waitForFunction(() => { const app = document.querySelector('site-engagement-app'); const root = app && app.shadowRoot ? app.shadowRoot : document; return root.querySelectorAll('tr').length > 1; }, null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);
  const rows = await p.evaluate(() => { const app = document.querySelector('site-engagement-app'); const root = app && app.shadowRoot ? app.shadowRoot : document; return [...root.querySelectorAll('tr')].slice(1).map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.querySelector('input') ? td.querySelector('input').value : td.innerText.trim()))); }).catch(() => []);
  await p.close();
  const row = rows.find((r) => r[0] && r[0].startsWith(BASE));
  return row ? Math.max(0, ...row.slice(1).map(Number).filter((n) => Number.isFinite(n))) : 0; // base, bonus, total (and a cell with no number)
};
const reports = (since) => fs.readFileSync(path.join(ROOT, 'logs', 'requests.jsonl'), 'utf8').trim().split('\n').slice(-3000).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((r) => r.t > since && r.m === 'REPORT' && r.report && r.report.protect).map((r) => r.report.protect);
const bookmarkOnly = () => {
  const now = String((Date.now() + 11644473600000) * 1000);
  const folder = (id, name, guid, children) => ({ children, date_added: now, date_last_used: '0', date_modified: now, guid, id: String(id), name, type: 'folder' });
  fs.writeFileSync(path.join(profile, 'Default', 'Bookmarks'), JSON.stringify({ checksum: '', roots: {
    bookmark_bar: folder(1, 'Bookmarks bar', '0bc5d13f-2cba-5d74-951f-3f233fe6c908', [{ date_added: now, date_last_used: '0', guid: '6d0b0a45-7d2c-4c33-9d2e-0a1c1b9d7e11', id: '5', name: 'Jugnu', type: 'url', url: `${BASE}/cb` }]),
    other: folder(2, 'Other bookmarks', '82b081ec-3dd3-529c-8475-ab6c344590dd', []), synced: folder(3, 'Mobile bookmarks', '4cf2e351-0e85-532b-bb37-df045d8f8d0f', []) }, version: 1 }));
};

try {
  // 1. a new profile
  fs.rmSync(profile, { recursive: true, force: true });
  let ctx = await open();
  let page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(START, { waitUntil: 'load' }); await settle(page);
  console.log(`Chrome ${ctx.browser() ? ctx.browser().version() : await page.evaluate(() => (navigator.userAgentData ? (navigator.userAgentData.brands.find((b) => /Google Chrome/.test(b.brand)) || {}).version : '?'))}, ${BASE}`);
  let c = await card(page);
  check('new profile: Chrome does not protect the site', (await held(page)) === false);
  check('new profile: the start page says "Not protected yet" and what could be lost', /^Not protected yet\./.test(c.say || ''), (c.say || 'no line on the page').slice(0, 110));
  const cdp = await ctx.newCDPSession(page);
  const errs = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors;
  const man = await cdp.send('Page.getAppManifest');
  check('Chrome finds the start page installable (its own check: no installability errors)', errs.length === 0 && (man.errors || []).length === 0 && /\/cb\/app\.webmanifest$/.test(man.url || ''), errs.length ? JSON.stringify(errs) : man.url.replace(BASE, ''));
  check('…so the page offers "Install Jugnu on this Chromebook"', c.install === true);
  await ctx.close();

  // 2. the profile's only bookmark is the start page
  fs.rmSync(profile, { recursive: true, force: true });
  ctx = await open(); await ctx.close();
  bookmarkOnly();
  ctx = await open();
  page = ctx.pages()[0] || await ctx.newPage();
  const mark = new Date().toISOString();
  await page.goto(`${BASE}/q/${QUIZ}`, { waitUntil: 'load' }); // a Jugnu page first: boot.js is what asks here
  await page.waitForFunction(() => navigator.storage.persisted(), null, { timeout: 12000 }).catch(() => {});
  check('bookmarked: a Jugnu page (boot.js) asks, and Chrome protects the site at once', (await held(page)) === true, `site engagement ${await engagement(ctx)}`);
  await page.goto(START, { waitUntil: 'load' }); await settle(page);
  c = await card(page);
  check('bookmarked: the start page says "Protected", with no install button pushed', /^Protected\./.test(c.say || '') && c.install === false && !/not yet protected/.test(c.head), (c.say || '').slice(0, 100));
  await page.waitForTimeout(1500);
  const sent = reports(mark);
  check('bookmarked: the server is told this Chromebook is protected', sent.some((r) => r.persisted === true), JSON.stringify(sent.slice(-1)[0] || null));
  await page.screenshot({ path: path.join(SHOTS, 'persist-protected.png') });
  await ctx.close();

  // 3. used until Chrome counts it as much used
  fs.rmSync(profile, { recursive: true, force: true });
  ctx = await open();
  page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(START, { waitUntil: 'load' }); await settle(page);
  check('used: not protected at the first open', (await held(page)) === false);
  await page.screenshot({ path: path.join(SHOTS, 'persist-not-yet.png') });
  let opens = 1;
  for (; opens < 20; opens += 1) {
    await page.goto(`${START}&n=${opens}`, { waitUntil: 'load' });
    await page.mouse.click(300, 30); await page.keyboard.press('Tab');
    await page.waitForTimeout(600);
    if (await held(page)) break;
  }
  const score = await engagement(ctx);
  await settle(page);
  c = await card(page);
  check('used: after enough opens and taps Chrome protects the site by itself', (await held(page)) === true && score >= 15, `${opens + 1} opens, site engagement ${score} (Chrome's line is 15; at most 15 a day)`);
  check('used: the start page then says "Protected"', /^Protected\./.test(c.say || ''), (c.say || '').slice(0, 100));
  await ctx.close();
} catch (e) {
  check('the run finished', false, String(e && e.message || e).split('\n')[0]);
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
}
