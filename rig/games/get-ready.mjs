// "Get ready for offline" on the rig for one test child (the rig's own child, so the Chromebook's link stays unopened).
//   CB_PRIVATE=<private games-lane folder> node rig/games/get-ready.mjs <G1.en> [--fresh-worker]
// Prints the start page's log, how many files are kept, how long it took, and the games step's own count of what is
// NOT on the device. Never wipes the profile (a child home link binds to the first profile that opens it).
import { launch, shot, children, BASE } from './lib.mjs';

const who = process.argv[2];
const kid = children()[who];
if (!kid) { console.error('no such child: ' + who); process.exit(1); }
const { ctx, page, log } = await launch();
const t0 = Date.now();
try {
  // the device key first (its own visit: the start page drops the rest of the address when it takes a key)
  if (process.env.CB_DEVICE_KEY) await page.goto(`${BASE}/cb?key=${encodeURIComponent(process.env.CB_DEVICE_KEY)}`, { waitUntil: 'load', timeout: 60000 });
  await page.goto(`${BASE}/cb?hub=${kid.token}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.click('#ready', { timeout: 5000 }).catch(() => {}); // a stopped Get ready carries on by itself
  // the first run reloads once, when the worker takes charge, and goes on by itself
  await page.waitForFunction(() => { const p = document.getElementById('phase'); const l = document.getElementById('log'); return (p && /Ready\./.test(p.textContent)) || (l && /stopped:/.test(l.textContent)); }, null, { timeout: 25 * 60 * 1000, polling: 1000 });
  const out = await page.evaluate(async () => ({
    phase: document.getElementById('phase').textContent, log: document.getElementById('log').textContent.trim().split('\n'),
    kept: (await (await caches.open('cb-pilot-v1')).keys()).length, caches: await caches.keys(),
    regs: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope.replace(location.origin, '')),
    games: localStorage.getItem('cb-games-ready'), usage: navigator.storage && navigator.storage.estimate ? Math.round((await navigator.storage.estimate()).usage / 1e6) : null,
  }));
  console.log(`get ready for ${who}: ${Math.round((Date.now() - t0) / 1000)} s — ${out.phase}`);
  console.log('  ' + out.log.join('\n  '));
  console.log(`  files kept: ${out.kept} · ${out.usage} MB · caches: ${out.caches.join(', ')} · workers: ${out.regs.join(', ')}`);
  console.log(`  games step: ${out.games}`);
  await shot(page, `ready-${who}`);
} finally {
  const bad = log.filter((l) => /pageerror/.test(l));
  if (bad.length) console.log('-- page errors:\n' + [...new Set(bad)].slice(-8).join('\n'));
  await ctx.close();
}
