// "Who's playing?" on the physical Chromebook against a deployed service (no tunnel):
//   1. setup link (/cb?key=…) and Get ready
//   2. online: class > section > search > pick a child; the quiz starts as that child
//   3. offline (browser offline over CDP, page and offline worker): class > section > "I'm not on the list" > a new
//      name > Add me; the whole quiz played offline. Before reconnecting, check the child is NOT yet on the server
//      (the added list, and the database when DATABASE_URL is set): that is the proof it was offline.
//   4. online again: the added child, and their finished quiz, arrive.
//   CB_ORIGIN=https://<service> DEVICE_KEY=… [DATABASE_URL=…] node device/device-who.mjs "<new name>"
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect, SHOTS } from './device.mjs';

const ORIGIN = process.env.CB_ORIGIN;
const KEY = process.env.DEVICE_KEY;
const name = process.argv[2] || 'Device Newkid';
if (!ORIGIN || !KEY) { console.error('set CB_ORIGIN and DEVICE_KEY'); process.exit(1); }
const say = (t) => console.log(t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function db(sql) {
  if (!process.env.DATABASE_URL) return '(no DATABASE_URL)';
  return execFileSync('psql', [process.env.DATABASE_URL, '-X', '-q', '-A', '-F', ' | ', '-t', '-c', sql], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' } }).trim();
}
const inDb = (n) => db(`select status||' '||correct_answers||'/'||total_questions_answered||' answers:'||(select count(*) from quiz_answers a where a.session_id=s.id) from quiz_sessions s where student_name='${n.replace(/'/g, "''")}' order by created_at desc limit 1;`);
async function addedOnServer(n) {
  const r = await fetch(`${ORIGIN}/__cb/added?key=${encodeURIComponent(KEY)}`); const rows = await r.json();
  return Array.isArray(rows) && rows.some((x) => x && x.name === n);
}

const browser = await connect();
const offlineSessions = [];
async function setOffline(on) {
  for (const t of browser.targets().filter((x) => x.url().startsWith(ORIGIN) && (x.type() === 'page' || x.type() === 'service_worker'))) {
    try {
      const s = await t.createCDPSession();
      await s.send('Network.enable');
      await s.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      offlineSessions.push(s);
    } catch (e) { /* gone */ }
  }
}
const screen = (page) => page.evaluate(() => { const w = document.getElementById('wq'); return { m: w ? w.getAttribute('data-m') : null, text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').replace(/NIETE FOR STUDENTS /, '').slice(0, 100) }; }).catch(() => ({ m: null, text: '' }));
// A real mouse click, scrolled into view first (a 1366x633 page puts lower buttons below the fold).
async function click(page, sel) { await page.waitForSelector(sel, { timeout: 15000 }); await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await sleep(300); const b = await page.$(sel); const r = await b.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await sleep(900); }
async function playQuiz(page) {
  let last = null;
  for (let step = 0; step < 60; step += 1) {
    const s = await screen(page);
    last = s;
    if (/^M9(-pending)?$|^M10/.test(s.m || '')) return s;
    const tapped = await page.evaluate((st) => {
      const vis = (b) => b && b.offsetParent !== null && !b.disabled;
      const go = [...document.querySelectorAll('button')].find((b) => vis(b) && /^\s*(Check|Next|Done|Continue|Go on|Fix it with Jugnu|See my)/i.test(b.innerText || ''));
      if (go) { go.click(); return 'go'; }
      const opts = [...document.querySelectorAll('button.wq-opt')].filter(vis);
      if (opts.length) { opts[st % opts.length].click(); return 'answer'; }
      return null;
    }, step);
    await sleep(tapped ? 1300 : 1500);
  }
  return last;
}

try {
  const page = await browser.newPage();
  await page.bringToFront();
  await page.goto(`${ORIGIN}/cb?key=${encodeURIComponent(KEY)}`, { waitUntil: 'networkidle2', timeout: 60000 });
  if (!process.env.SKIP_READY) await click(page, '#ready'); // SKIP_READY=1: this Chromebook already ran Get ready
  for (let i = 0; i < 240 && !process.env.SKIP_READY; i += 1) {
    const ph = await page.evaluate(() => document.getElementById('phase').textContent).catch(() => '');
    if (/Ready\./.test(ph)) break;
    await sleep(5000);
  }
  say(`Get ready on the Chromebook: ${await page.evaluate(() => document.getElementById('log').textContent.trim().split('\n').join(' | '))}`);

  // Online: a child from the class list.
  await page.goto(`${ORIGIN}/who`, { waitUntil: 'networkidle2' });
  await click(page, '[data-g="3"]'); await click(page, '[data-s="A"]');
  await page.type('#q', 'a', { delay: 60 }); await sleep(500);
  const picked = await page.$eval('#list button', (b) => b.innerText.split('\n')[0].trim());
  await click(page, '#list button');
  await page.waitForFunction(() => /\/cb/.test(location.pathname), { timeout: 10000 });
  say(`online pick: ${picked} → ${await page.$eval('#child', (e) => e.innerText)}`);
  await page.goto(`${ORIGIN}/q/PZLFTR`, { waitUntil: 'networkidle2' });
  for (let i = 0; i < 20 && (await screen(page)).m !== 'M6'; i += 1) await sleep(1000);
  say(`quiz online as ${picked}: ${(await screen(page)).text.slice(0, 70)}`);
  await page.screenshot({ path: path.join(SHOTS, 'who-device-online.png') });
  await sleep(3000);

  // Offline: a child who is not on the list adds themselves, then plays the whole quiz.
  await setOffline(true);
  say(`OFFLINE (browser says online: ${await page.evaluate(() => navigator.onLine)})`);
  await page.goto(`${ORIGIN}/who`, { waitUntil: 'load' }).catch(() => {});
  await setOffline(true); await sleep(1500);
  await click(page, '[data-g="2"]'); await click(page, '[data-s="B"]');
  await click(page, '#notme');
  await page.waitForSelector('#nm', { timeout: 10000 });
  await page.type('#nm', name, { delay: 50 }); await click(page, '#go');
  if (await page.$('#no')) await click(page, '#no');
  await page.waitForFunction(() => /\/cb/.test(location.pathname), { timeout: 10000 });
  say(`offline add me: ${await page.$eval('#child', (e) => e.innerText)}`);
  await page.screenshot({ path: path.join(SHOTS, 'who-device-added.png') });
  await page.goto(`${ORIGIN}/q/PZLFTR`, { waitUntil: 'load' }).catch(() => {});
  await setOffline(true);
  const end = await playQuiz(page);
  say(`quiz offline as ${name}: ${end.m} — ${end.text.slice(0, 90)}`);
  await page.screenshot({ path: path.join(SHOTS, 'who-device-offline-end.png') });
  say(`while offline: on the server's added list: ${await addedOnServer(name)} | in the database: ${inDb(name) || 'no'}`);

  // Online again.
  await setOffline(false);
  for (const s of offlineSessions.splice(0)) await s.detach().catch(() => {});
  await page.goto(`${ORIGIN}/cb`, { waitUntil: 'networkidle2' });
  let row = '';
  for (let i = 0; i < 24; i += 1) { row = inDb(name); if (/^completed/.test(row) && await addedOnServer(name)) break; await sleep(5000); }
  say(`after reconnect: on the server's added list: ${await addedOnServer(name)} | in the database: ${row || 'no'}`);
} finally {
  await browser.disconnect();
}
