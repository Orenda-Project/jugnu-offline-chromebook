// On the physical Chromebook (over its own Chrome): open the test page in a new tab, press "Get ready for offline",
// wait for "Ready", and report what was saved. The tab is left open on the Chromebook's screen.
//   node device-ready.mjs <hub token> [tunnel origin]
import fs from 'node:fs';
import path from 'node:path';
import { connect, SHOTS } from './device.mjs';

const [hub, origin = ((process.env.CB_ORIGIN || fs.readFileSync(new URL('../logs/tunnel.log', import.meta.url), 'utf8')).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) || [])[0]] = process.argv.slice(2);
const browser = await connect();
const t0 = Date.now();
try {
  const page = await browser.newPage();
  await page.bringToFront();
  await page.goto(`${origin}/cb?hub=${hub}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.click('#ready');
  await page.waitForFunction(() => /Ready\./.test(document.getElementById('phase').textContent) || /stopped/.test(document.getElementById('log').textContent), { timeout: 900000, polling: 2000 });
  const r = await page.evaluate(() => ({
    phase: document.getElementById('phase').textContent, kept: document.getElementById('kept').textContent,
    log: document.getElementById('log').textContent.trim().split('\n'), links: [...document.querySelectorAll('#links a')].map((a) => a.firstChild.textContent + ' ' + a.getAttribute('href').slice(0, 30)),
    storage: null,
  }));
  r.storage = await page.evaluate(async () => { const e = await navigator.storage.estimate(); const p = await navigator.storage.persist(); return { used_mb: Math.round(e.usage / 1e6), quota_gb: Math.round(e.quota / 1e8) / 10, persisted: p }; });
  await page.screenshot({ path: path.join(SHOTS, 'signed-in-ready.png') });
  console.log(`Get ready on the Chromebook: ${Math.round((Date.now() - t0) / 1000)} s — ${r.phase}\nfiles saved: ${r.kept}\n${r.log.join('\n')}\nlinks: ${r.links.join(' | ')}\nstorage: ${JSON.stringify(r.storage)}`);
} finally {
  await browser.disconnect();
}
