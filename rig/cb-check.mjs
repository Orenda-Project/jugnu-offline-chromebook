// The Chromebook test page, end to end on the Chromebook-shaped rig: fresh device -> "Get ready for offline" ->
// network truly off -> open every link on the page and see what each shows.
//   node cb-check.mjs <hub token for the rig's own child>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, shot, state, BASE } from './cb.mjs';

const hub = process.argv[2];
const FLAG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'OFFLINE'); // the server's switch
const { ctx, page, log } = await launch({ fresh: true });
const t0 = Date.now();
try {
  fs.rmSync(FLAG, { force: true });
  await page.goto(`${BASE}/cb?hub=${hub}`, { waitUntil: 'networkidle' });
  await page.click('#ready');
  await page.waitForFunction(() => /Ready\./.test(document.getElementById('phase').textContent) || /stopped/.test(document.getElementById('log').textContent), null, { timeout: 420000 });
  const ready = await page.evaluate(() => ({ phase: document.getElementById('phase').textContent, kept: document.getElementById('kept').textContent, log: document.getElementById('log').textContent.trim().split('\n'), links: [...document.querySelectorAll('#links a')].map((a) => ({ t: a.firstChild.textContent, h: a.getAttribute('href') })) }));
  console.log(`get ready: ${Math.round((Date.now() - t0) / 1000)} s — ${ready.phase}\n  files kept: ${ready.kept}\n  ${ready.log.join('\n  ')}`);
  await shot(page, 'cb-ready');

  fs.writeFileSync(FLAG, '');
  await ctx.setOffline(true);
  for (const l of ready.links) {
    await page.goto(BASE + l.h, { waitUntil: 'load', timeout: 30000 }).catch((e) => console.log('  goto', l.t, e.message.split('\n')[0]));
    await page.waitForTimeout(5000);
    const s = await state(page);
    await shot(page, `cb-offline-${l.t.replace(/[^a-z]+/gi, '-').toLowerCase()}`);
    console.log(`OFFLINE ${l.t}: screen=${s.screen} — ${s.text.replace(/NIETE FOR STUDENTS /, '').slice(0, 120)}`);
  }
} finally {
  fs.rmSync(FLAG, { force: true });
  console.log('--- page errors ---\n' + log.filter((l) => /pageerror/.test(l)).slice(-6).join('\n'));
  await ctx.close();
}
