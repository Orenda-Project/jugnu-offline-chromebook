// Push the Home fix to the Chromebook from a background tab: update the worker, give it this device's child home,
// check that Home answers it (as for a quiz started on the device), then close the tab.
import fs from 'node:fs';
import { connect } from './device.mjs';
const hub = process.argv[2];
const ORIGIN = process.env.CB_ORIGIN || (fs.readFileSync(new URL('../logs/tunnel.log', import.meta.url), 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) || [])[0];
const browser = await connect();
try {
  const page = await browser.newPage();
  await page.goto(`${ORIGIN}/q/PZLFTR`, { waitUntil: 'networkidle2', timeout: 60000 });
  const r = await page.evaluate(async (h) => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (reg) await reg.update();
    await new Promise((ok) => setTimeout(ok, 3000));
    localStorage.setItem('cb-hub', h);
    (navigator.serviceWorker.controller || (reg && reg.active)).postMessage({ type: 'hub', hub: h });
    await new Promise((ok) => setTimeout(ok, 1000));
    const res = await fetch('/api/wq/hubdoor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ st: 'cblocal.0000000000000000', home: 1 }) });
    return { worker: reg && reg.active && reg.active.scriptURL.split('/').pop(), hubdoor: res.status, href_is_this_home: ((await res.json()).href || '') === '/h/' + h };
  }, hub);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((ok) => setTimeout(ok, 2500));
  r.home_button_on_quiz_page = await page.evaluate(() => !!document.querySelector('[data-cb-home]'));
  console.log(JSON.stringify(r));
  await page.close();
} finally { await browser.disconnect(); }
