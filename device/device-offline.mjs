// The offline test on the physical Chromebook without touching its Wi-Fi (so this Mac keeps control):
//   - the pilot server drops every connection (pilot/OFFLINE): the Chromebook's only source of Jugnu is gone
//   - the Chromebook's browser is set offline over CDP, page AND offline worker (navigator.onLine = false)
// Then a new child plays the class quiz to the end; storybook and both games are opened; the network comes back and
// the script waits for the child's answers to reach the sandbox database.
//   node device-offline.mjs <hub token> <child name>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect, SHOTS } from './device.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLAG = path.join(HERE, '..', 'OFFLINE'); // the server's switch
const [hub, name = 'Offline Child'] = process.argv.slice(2);
const ORIGIN = process.env.CB_ORIGIN || (fs.readFileSync(path.join(HERE, '..', 'logs/tunnel.log'), 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) || [])[0];
const trail = [];
const say = (t) => { trail.push(t); console.log(t); };

// Optional: DATABASE_URL (read-only use) of the environment the portal writes to, to check the child's results arrive.
function db(sql) {
  const url = process.env.DATABASE_URL;
  if (!url) return '(DATABASE_URL not set: database check skipped)';
  return execFileSync('psql', [url, '-X', '-q', '-A', '-F', ' | ', '-t', '-c', sql], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' } }).trim();
}
const inDb = () => db(`select status, correct_answers||'/'||total_questions_answered, (select count(*) from quiz_answers a where a.session_id=s.id) from quiz_sessions s where student_name='${name.replace(/'/g, "''")}' order by created_at desc limit 1;`);

const browser = await connect();
const offlineTargets = [];
async function setOffline(on) {
  const targets = browser.targets().filter((t) => (t.type() === 'service_worker' && t.url().startsWith(ORIGIN)) || (t.type() === 'page' && t.url().startsWith(ORIGIN)));
  for (const t of targets) {
    try {
      const s = await t.createCDPSession();
      await s.send('Network.enable');
      await s.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      if (on) offlineTargets.push(s); else await s.detach().catch(() => {});
    } catch (e) { /* a target that went away */ }
  }
  if (!on) for (const s of offlineTargets.splice(0)) { await s.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {}); }
  return targets.map((t) => t.type()).join(',');
}
const screen = (page) => page.evaluate(() => { const w = document.getElementById('wq'); return { m: w ? w.getAttribute('data-m') : null, text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').replace(/NIETE FOR STUDENTS /, '').slice(0, 110) }; });
let n = 0;
async function mark(page, what) { const s = await screen(page); n += 1; await page.screenshot({ path: path.join(SHOTS, `offline-${String(n).padStart(2, '0')}.png`) }).catch(() => {}); say(`${String(n).padStart(2)}. ${what} → ${s.m || '-'}: ${s.text}`); return s; }
async function tap(page, sel, text, index = 0) {
  const box = await page.evaluate((s, t, i) => {
    const rx = t ? new RegExp(t, 'i') : null;
    const all = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null && !e.disabled && (!rx || rx.test(e.innerText || '')));
    const el = all.length ? all[i % all.length] : null; if (!el) return null;
    el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, text || null, index);
  if (!box) return false;
  await page.mouse.click(box.x, box.y); await new Promise((r) => setTimeout(r, 1500)); return true;
}

try {
  let page = (await browser.pages()).find((p) => p.url().startsWith(ORIGIN)) || (await browser.newPage());
  await page.bringToFront();
  // Online first: open the quiz once so the Chromebook takes the newest offline worker.
  await page.goto(`${ORIGIN}/q/PZLFTR`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); if (r) await r.update(); });
  await new Promise((r) => setTimeout(r, 4000));
  say(`before: "${name}" in the database: ${inDb() || 'no'}`);

  fs.writeFileSync(FLAG, '');
  say(`OFFLINE: pilot server dropping every connection; browser offline for: ${await setOffline(true)}`);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => /^wq_s_/.test(k)).forEach((k) => localStorage.removeItem(k)));
  await page.reload({ waitUntil: 'load', timeout: 30000 }).catch((e) => say('reload: ' + e.message.split('\n')[0]));
  await setOffline(true);
  say(`browser says online: ${await page.evaluate(() => navigator.onLine)}`);
  await new Promise((r) => setTimeout(r, 2000));
  await mark(page, 'open the quiz (no network)');

  let named = 0;
  for (let step = 0; step < 50; step += 1) {
    const s = await screen(page);
    if (/^M9(-pending)?$|^M10/.test(s.m || '') && step > 3) { await mark(page, 'end of the quiz'); break; }
    if (s.m === 'M4-who-v2') {
      if (await tap(page, 'button, [role=button]', "My name isn't here")) { await mark(page, "My name isn't here"); continue; }
      if (await tap(page, 'button.wq-go', '^\\s*Play')) { await mark(page, 'Play'); continue; }
    }
    if (s.m === 'M4-name') {
      if (named >= 2) { say('  ! stuck on the name screen'); break; }
      named += 1;
      await tap(page, 'input'); await page.keyboard.type(name, { delay: 40 }); await tap(page, 'button', '^\\s*Start');
      await mark(page, `type "${name}", Start`); continue;
    }
    const go = '^\\s*(Check|Next|Done|Continue|Go on|Fix it with Jugnu|See my|Finish)';
    if (/^(M6|M9-fix)$/.test(s.m || '')) {
      const hasGo = await page.evaluate((w) => [...document.querySelectorAll('button')].some((b) => b.offsetParent && !b.disabled && new RegExp(w, 'i').test(b.innerText || '')), go);
      if (!hasGo && await tap(page, 'button.wq-opt', null, step % 3)) { await mark(page, 'answer'); continue; }
    }
    if (await tap(page, 'button', go)) { await mark(page, 'next'); continue; }
    await mark(page, 'nothing to tap'); break;
  }
  const held = await page.evaluate(() => { try { const o = JSON.parse(localStorage.getItem('wq_s_PZLFTR') || '{}'); return { answers: Object.keys(o.answers || {}).length, pending: !!o.pending, local_session: /^cblocal\./.test(o.st || '') }; } catch { return null; } });
  say(`held on the Chromebook: ${JSON.stringify(held)}`);
  say(`while offline, "${name}" in the database: ${inDb() || 'no'}`);

  // The rest of the child's world, still offline: a storybook, the number game, the reading game.
  for (const [label, url, wait] of [['child home', `/h/${hub}`, 5000], ['number game', null, 7000], ['reading game', null, 9000]]) {
    if (url) { await page.goto(ORIGIN + url, { waitUntil: 'load', timeout: 30000 }).catch(() => {}); await setOffline(true); await new Promise((r) => setTimeout(r, wait)); await tap(page, '#wq button, button', 'Skip'); await mark(page, `${label} (no network)`); continue; }
    const href = await page.evaluate((k) => { const a = [...document.querySelectorAll('a[href]')].map((x) => x.getAttribute('href')).find((h) => k === 'number game' ? /^\/c\//.test(h) : /^\/sa-game\//.test(h)); return a || null; }, label);
    if (!href) {
      await tap(page, 'a.wq-door', 'Games'); await new Promise((r) => setTimeout(r, 2500));
    }
    const h2 = href || await page.evaluate((k) => [...document.querySelectorAll('a[href]')].map((x) => x.getAttribute('href')).find((h) => k === 'number game' ? /^\/c\//.test(h) : /^\/sa-game\//.test(h)) || null, label);
    if (!h2) { say(`  ! no link for the ${label}`); continue; }
    await page.goto(ORIGIN + h2, { waitUntil: 'load', timeout: 30000 }).catch(() => {}); await setOffline(true);
    await new Promise((r) => setTimeout(r, wait));
    if (label === 'number game') await tap(page, 'button, a, [role=button]', 'Find the number');
    await new Promise((r) => setTimeout(r, 3000));
    await mark(page, `${label} (no network)`);
    await page.goto(`${ORIGIN}/h/${hub}`, { waitUntil: 'load', timeout: 30000 }).catch(() => {}); await setOffline(true); await new Promise((r) => setTimeout(r, 3000));
  }
  await page.goto(`${ORIGIN}/h/${hub}`, { waitUntil: 'load', timeout: 30000 }).catch(() => {}); await setOffline(true); await new Promise((r) => setTimeout(r, 4000));
  await tap(page, 'a.wq-door', 'Stories'); await new Promise((r) => setTimeout(r, 2500));
  await tap(page, 'button, a, [role=button]', 'I need a cook'); await new Promise((r) => setTimeout(r, 3000));
  await tap(page, 'button', '^\\s*Listen'); await new Promise((r) => setTimeout(r, 4000));
  const played = await page.evaluate(() => [...document.querySelectorAll('audio')].map((a) => ({ t: Math.round(a.currentTime * 10) / 10, err: a.error && a.error.code })));
  await mark(page, `storybook "I need a cook", Listen (no network) — audio: ${JSON.stringify(played)}`);
} finally {
  fs.rmSync(FLAG, { force: true });
  say(`ONLINE again: pilot server serving; browser online for: ${await setOffline(false).catch(() => '?')}`);
  try {
    const page = (await browser.pages()).find((p) => p.url().startsWith(ORIGIN));
    if (page) { await page.goto(`${ORIGIN}/q/PZLFTR`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}); }
    for (let i = 0; i < 24; i += 1) {
      const row = inDb();
      if (/^completed/.test(row)) { say(`after reconnect (${(i + 1) * 5} s): "${name}" in the database: ${row}`); break; }
      if (i === 23) say(`after reconnect (120 s): "${name}" in the database: ${row || 'no'}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (page) await mark(page, 'after reconnect');
  } catch (e) { say('after reconnect: ' + e.message.split('\n')[0]); }
  fs.writeFileSync(path.join(SHOTS, 'offline-trail.txt'), trail.join('\n') + '\n');
  await browser.disconnect();
}
