// "Your turn" on one page through Chrome's own fake microphone, in the two cases a school's Wi-Fi makes:
//   offline   the network is off before the child taps (the server's OFFLINE switch and the browser)
//   drop      the read starts online with live words, and the network is cut 2.5 s into the read
// then the network comes back. It prints what the page showed while the child read, what it said after, what was
// kept on the device, and what reached the server once the saved reading had been heard.
//   say -v Samantha -o p.aiff "<the page's words>" && afconvert -f WAVE -d LEI16@16000 p.aiff p.wav   (macOS; add
//   1.5 s of silence before and 6 s after, e.g. with ffmpeg, so the words fall inside the read)
//   CB_SPEECH=p.wav CB_BASE=http://localhost:8811 node rig/stories-turn.mjs <hub token> <book id> <page number> offline|drop
// The wav is the child: its words, a part of them, or silence (then nothing is saved and Jugnu's own
// "let's read it together" answers). CB_OFFLINE_FLAG: the server's switch when it is not ./OFFLINE.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, shot, BASE } from './cb.mjs';
const [token, book, pageN, mode] = process.argv.slice(2);
const FLAG = process.env.CB_OFFLINE_FLAG || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'OFFLINE');
if (!token || !book || !/^(offline|drop)$/.test(mode || '')) { console.error('usage: CB_SPEECH=<wav> node rig/stories-turn.mjs <hub token> <book id> <page number> offline|drop'); process.exit(1); }
const { ctx, page, log } = await launch({ fresh: false, autoplay: false, height: 633 });
const net = [];
page.on('response', async (r) => { const u = r.url(); if (/\/api\/wq\/(stories\/event|lr)/.test(u)) { let b = ''; try { b = (await r.text()).replace(/"api_key":"[^"]+"/, '"api_key":"<hidden>"').slice(0, 200); } catch (e) {} let q = {}; try { q = JSON.parse(r.request().postData() || '{}'); } catch (e) {} net.push(`${r.status()}${r.headers()['x-cb-local'] ? ' (this device)' : ''} ${/lr\/key/.test(u) ? 'speech key' : q.event + ' ' + JSON.stringify(q.data || {})} → ${b}`); } });
page.on('websocket', (ws) => { net.push('speech stream opened'); ws.on('close', () => net.push('speech stream closed')); });
const snap = () => page.evaluate(() => {
  const scr = document.querySelector('[data-screen]');
  return { screen: scr && scr.getAttribute('data-screen'), online: navigator.onLine,
    words: [...document.querySelectorAll('.lr-w')].map((e) => (/lr-(read|heard|skipped|current|ahead)/.exec(e.className) || [0, '?'])[1][0]).join(''),
    nudge: [...document.querySelectorAll('.lr-nudge')].filter((e) => e.style.display !== 'none').map((e) => e.textContent).join(' / '),
    near: (document.querySelector('[data-near]') || {}).hidden === false ? (document.querySelector('[data-near]') || {}).innerText : '',
    extra: ((document.querySelector('[data-extra]') || {}).innerText || '').replace(/\s+/g, ' ') };
});
const off = async () => { fs.writeFileSync(FLAG, ''); await ctx.setOffline(true); };
const on = async () => { fs.rmSync(FLAG, { force: true }); await ctx.setOffline(false); };
const sw = (msg) => page.evaluate((m) => new Promise((ok) => { const c = navigator.serviceWorker.controller; if (!c) return ok(null); const ch = new MessageChannel(); const t = setTimeout(() => ok(null), 4000); ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); }; c.postMessage(m, [ch.port2]); }), msg).catch(() => null);
try {
  await on();
  await page.goto(`${BASE}/h/${token}#story/${book}/p${pageN}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(4000);
  if (mode === 'offline') { await off(); console.log('network OFF before the tap'); }
  const alt = page.locator('[data-tap="alt"]');
  if (await alt.count()) await alt.first().click(); else await page.locator('[data-main]').click();
  await page.waitForTimeout(1200);
  await page.locator('.lr-go').click({ timeout: 6000 }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const s = await snap();
    if (i % 2 === 1 || s.screen !== 'story-read') console.log(`t+${(i + 1) / 2}s`, JSON.stringify(s));
    if (mode === 'drop' && i === 4) { await off(); console.log('network CUT mid-read'); }
    if (i === 6) await shot(page, `stories-turn-${mode}-reading`);
    if (s.screen === 'story-read' && i === 26) { console.log('tap "I\'m done"'); await page.locator('[data-screen="story-read"] .wqs-done').click().catch(() => {}); }
    if (s.screen === 'story-page' && i > 3) break;
  }
  await page.waitForTimeout(800);
  await shot(page, `stories-turn-${mode}-after`);
  console.log('AFTER', JSON.stringify(await snap()));
  console.log('on this device:', JSON.stringify(await sw({ type: 'stories' })));
  await on(); console.log('network ON');
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(2000); const s = await sw({ type: 'stories' }); if (s && s.waiting === 0) { console.log(`all sent ${Math.round((Date.now() - t0) / 1000)} s after the network came back:`, JSON.stringify(s)); break; } }
} finally {
  fs.rmSync(FLAG, { force: true });
  console.log('--- requests\n' + net.join('\n'));
  console.log('--- errors\n' + log.filter((l) => /pageerror/.test(l)).slice(-5).join('\n'));
  await ctx.close();
}
