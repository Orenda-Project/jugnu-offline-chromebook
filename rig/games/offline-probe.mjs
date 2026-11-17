// What a device really has for Jugnu's big flight once the network is off — facts, read from the page itself:
// which worker owns /sa/play.html, whether Jugnu will speak with its recorded clips (or the device's own voice, or
// refuse to start), whether a part started offline has a run the server can ever receive, and whether the engine's
// way back to the sea map answers. Works against any build of the pilot (CB_BASE), on any profile (CB_PROFILE).
//
//   CB_BASE=… CB_PROFILE=<dir> CB_OFFLINE_FLAG=<that server's OFFLINE file> \
//     node rig/games/offline-probe.mjs <home token> [--ready] [--part=maths] [--lang=en]
// --ready: first run "Get ready for offline" on this profile (online), then go offline and probe.
import fs from 'node:fs';
import path from 'node:path';
import { launch, BASE, ROOT } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const token = args.find((a) => !a.startsWith('--'));
const part = flag('part', 'maths');
const FLAG = process.env.CB_OFFLINE_FLAG || path.join(ROOT, 'OFFLINE');
const { ctx, page, log } = await launch({ profile: process.env.CB_PROFILE || path.join(ROOT, '.chrome-profile') });
const say = (s) => console.log(s);
try {
  fs.rmSync(FLAG, { force: true });
  if (flag('ready', false)) {
    const t0 = Date.now();
    if (process.env.CB_DEVICE_KEY) await page.goto(`${BASE}/cb?key=${encodeURIComponent(process.env.CB_DEVICE_KEY)}`, { waitUntil: 'load', timeout: 60000 });
    await page.goto(`${BASE}/cb?hub=${token}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.click('#ready');
    await page.waitForFunction(() => { const p = document.getElementById('phase'); const l = document.getElementById('log'); return (p && /Ready\./.test(p.textContent)) || (l && /stopped:/.test(l.textContent)); }, null, { timeout: 25 * 60 * 1000, polling: 1000 });
    const r = await page.evaluate(async () => ({ log: document.getElementById('log').textContent.trim().split('\n'), kept: (await (await caches.open('cb-pilot-v1')).keys()).map((k) => k.url) }));
    const n = (rx) => r.kept.filter((u) => rx.test(u)).length;
    say(`get ready: ${Math.round((Date.now() - t0) / 1000)} s; kept ${r.kept.length} files — battery files ${n(/\/sa\/batteries\//)}, battery clips ${n(/\/sa\/v\d\/.*\.mp3/)}, battery pictures ${n(/\/sa\/img\//)}, engine files ${n(/\/sa\/[^/]+\.(js|css|html)/)}`);
    say('  ' + r.log.join('\n  '));
  }
  // ---- the network goes: the server drops every connection AND the browser is offline ----
  fs.writeFileSync(FLAG, '');
  await ctx.setOffline(true);
  say('\nOFFLINE now.');
  await page.goto(`${BASE}/h/${token}`, { waitUntil: 'load', timeout: 30000 }).catch((e) => say('home: ' + e.message.split('\n')[0]));
  await page.waitForTimeout(2500);
  for (const t of ['Skip', 'چھوڑیں']) await page.getByText(t, { exact: true }).first().click({ timeout: 600 }).catch(() => {});
  await page.locator('a.wq-door[href="#games"]').first().click({ timeout: 8000 }).catch(() => say('no Games door on the home'));
  const row = page.locator('a.wq-drow[data-item="bigtest"]').first();
  if (!(await row.count().catch(() => 0))) { say(`the big flight is not behind the Games door offline: ${await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200))}`); }
  else {
    await row.click();
    await page.waitForSelector('.sg-map', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    say(`sea map: ${await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 120))}`);
    await page.locator(`.sg-isl[data-k="${part}"]`).first().click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForSelector('[data-tap="run"], .sg-note', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    say(`island intro: ${await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160))}`);
    await page.locator('[data-tap="run"]').first().click({ timeout: 8000 }).catch(() => say('no Start on the island'));
    await page.waitForURL(/\/sa\/play\.html/, { timeout: 20000 }).catch(() => {});
    const t0 = Date.now();
    // the engine's own readiness answer (its device_ready event): at once when the worker answers its "prepare";
    // with a worker that does not, each ask runs out after 60 s, so wait past that
    await page.evaluate(() => { try { localStorage.removeItem('sa:voice'); } catch (e) { /* as it is */ } }).catch(() => {});
    await page.waitForFunction(() => { try { return !!localStorage.getItem('sa:voice') && !!window.__sae; } catch (e) { return false; } }, null, { timeout: 170000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const f = await page.evaluate(async () => {
      const q = new URLSearchParams(location.search);
      const sid = q.get('s');
      const regs = (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope.replace(location.origin, ''));
      const ctl = navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL.replace(location.origin, '') : null;
      const back = q.get('back');
      let head = null;
      try { const r = await fetch(back, { method: 'HEAD', cache: 'no-store' }); head = r.status; } catch (e) { head = 'failed: ' + e.message; }
      let ready = null;
      try { const st = await window.SAE.store.open(); const ev = await st.events(sid); const d = (ev || []).find((e) => e.type === 'device_ready'); ready = d ? d.value : null; } catch (e) { ready = 'unread: ' + e.message; }
      return { url: location.pathname, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200), regs, controller: ctl, voice: localStorage.getItem('sa:voice'), device_ready: ready,
        run_token: (localStorage.getItem('sg.st.' + sid) || '').slice(0, 8) || null, session: sid, head_of_map: head, refused: !!document.querySelector('.sae-refused'), boot: !!document.querySelector('[data-cb-badge]') };
    }).catch((e) => ({ err: String(e).slice(0, 200) }));
    say(`\nthe child's page after ${Math.round((Date.now() - t0) / 1000)} s:`);
    say(`  page: ${f.url} — "${f.text}"`);
    say(`  workers on this device: ${JSON.stringify(f.regs)}; this page's worker: ${f.controller}`);
    say(`  Jugnu's voice: ${f.voice} (clips = recorded clips; tts = the device's own voice; none = refuses to start) — ${JSON.stringify(f.device_ready)}${f.refused ? ' — REFUSED to start' : ''}`);
    say(`  this part's run: session ${String(f.session).slice(0, 13)}…, run token kept: ${f.run_token ? f.run_token + '…' : 'NONE (nothing from this part can ever be sent)'}`);
    say(`  the engine's way back to the sea map (HEAD): ${f.head_of_map}`);
    say(`  pilot badge/boot script on the page: ${f.boot}`);
  }
} finally {
  const bad = [...new Set(log.filter((l) => /pageerror/.test(l)))].slice(-6);
  if (bad.length) say('-- page errors:\n' + bad.join('\n'));
  fs.rmSync(FLAG, { force: true });
  await ctx.close();
}
