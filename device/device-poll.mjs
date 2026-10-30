// Read the test page's progress on the Chromebook every few seconds until it says Ready (short calls only).
import path from 'node:path';
import { connect, SHOTS } from './device.mjs';
const browser = await connect();
try {
  let page = null;
  for (let i = 0; i < 240; i += 1) {
    page = page || (await browser.pages()).find((p) => /\/cb\?hub=/.test(p.url()));
    if (!page) { console.log('no test page tab'); break; }
    const r = await page.evaluate(() => ({ phase: document.getElementById('phase').textContent, kept: document.getElementById('kept').textContent, log: document.getElementById('log').textContent.trim().split('\n').slice(-6) })).catch((e) => ({ err: e.message.slice(0, 80) }));
    if (r.err) { console.log('busy:', r.err); await new Promise((ok) => setTimeout(ok, 5000)); continue; }
    if (/Ready\.|stopped/.test(r.phase + r.log.join(' '))) {
      const st = await page.evaluate(async () => { const e = await navigator.storage.estimate(); const p = await navigator.storage.persist(); return { used_mb: Math.round(e.usage / 1e6), quota_gb: Math.round(e.quota / 1e8) / 10, persisted: p }; });
      await page.screenshot({ path: path.join(SHOTS, 'signed-in-ready.png') });
      console.log(`${r.phase}\nfiles saved: ${r.kept}\n${r.log.join('\n')}\nstorage: ${JSON.stringify(st)}`);
      break;
    }
    if (i % 6 === 0) console.log(`… ${r.phase} (${r.kept} files)`);
    await new Promise((ok) => setTimeout(ok, 5000));
  }
} finally { await browser.disconnect(); }
