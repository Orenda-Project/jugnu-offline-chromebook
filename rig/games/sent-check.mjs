// The network is back: open the child's home and only watch. Prints what the device sent by itself (the battery
// engine's runs through the hidden drain frame, the Challenge results through the worker) and what is still waiting.
//   CB_PRIVATE=<private games-lane folder> node rig/games/sent-check.mjs <G1.en> [--wait=180] [--profile=<dir>]
import path from 'node:path';
import { launch, children, BASE, ROOT } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const who = args.find((a) => !a.startsWith('--'));
const kid = children()[who];
const { ctx, page } = await launch({ profile: flag('profile', path.join(ROOT, '.chrome-profile')) });
try {
  const before = [];
  page.on('request', (r) => { if (/\/api\/(sa-game\/s|wq\/ch)\//.test(r.url()) && r.method() !== 'GET') before.push(`${new URL(r.url()).pathname.replace(/^\/api\//, '')}`); });
  await page.goto(`${BASE}/h/${kid.token}`, { waitUntil: 'load', timeout: 60000 });
  const t0 = Date.now();
  let left = null;
  for (;;) {
    left = await page.evaluate(async () => {
      const ask = (msg) => new Promise((ok) => { const sw = navigator.serviceWorker.controller; if (!sw) return ok(null); const ch = new MessageChannel(); const t = setTimeout(() => ok(null), 4000); ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); }; sw.postMessage(msg, [ch.port2]); });
      return { outbox: await ask({ type: 'games-outbox' }), drained: window.__cbDrained || null };
    }).catch(() => null);
    const waiting = left && left.outbox ? left.outbox.filter((x) => x.state === 'waiting').length : -1;
    const sessions = left && left.drained ? left.drained.sessions || [] : null;
    if ((waiting === 0 && sessions && sessions.every((s) => s.state === 'synced')) || Date.now() - t0 > Number(flag('wait', 180)) * 1000) break;
    await page.waitForTimeout(3000);
  }
  console.log(`${who}: ${Math.round((Date.now() - t0) / 1000)} s after the home opened (nothing was pressed)`);
  console.log(`  battery engine runs sent by the drain frame: ${JSON.stringify(left && left.drained)}`);
  console.log(`  still in the worker's outbox: ${JSON.stringify(left && left.outbox)}`);
  const count = {}; for (const p of before) count[p] = (count[p] || 0) + 1;
  console.log(`  calls the device made by itself: ${JSON.stringify(count)}`);
} finally { await ctx.close(); }
