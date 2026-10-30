// "Who's playing?" end to end on the Chromebook-shaped rig, against a server started with a roster and DEVICE_KEY:
//   1. fresh device: setup link (/cb?key=…), Get ready (saves the class lists too)
//   2. online: class > section > search > pick a name; the quiz starts as that child without asking
//   3. network truly off (the server's OFFLINE switch + browser offline): class > section > "I'm not on the list"
//      > type a new name > Add me; the quiz starts offline as that child
//   4. back online: the picks, the added child and the quiz reach the server
//   CB_BASE=http://localhost:8794 node rig/who-check.mjs <device key> "<new child name>"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, shot, state, BASE } from './cb.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLAG = path.join(ROOT, 'OFFLINE');
const [key, newName = 'Testkid Zed'] = process.argv.slice(2);
const say = (t) => console.log(t);
const { ctx, page, log } = await launch({ fresh: true });
const tapText = async (t, exact = false) => { await page.getByText(t, { exact }).first().click({ timeout: 6000 }); await page.waitForTimeout(700); };
const quizToQuestion = async (code) => {
  await page.goto(`${BASE}/q/${code}`, { waitUntil: 'load' }).catch(() => {});
  for (let i = 0; i < 30; i += 1) { const s = await state(page); if (s.screen === 'M6') return s; await page.waitForTimeout(1000); }
  return state(page);
};
try {
  fs.rmSync(FLAG, { force: true });
  await page.goto(`${BASE}/cb?key=${encodeURIComponent(key)}`, { waitUntil: 'networkidle' });
  await page.click('#ready');
  await page.waitForFunction(() => /Ready\./.test(document.getElementById('phase').textContent), null, { timeout: 420000 });
  say(`Get ready: ${await page.evaluate(() => document.getElementById('log').textContent.trim().split('\n').join(' | '))}`);

  // Online: pick a child from the roster.
  await page.goto(`${BASE}/who`, { waitUntil: 'networkidle' });
  await page.click('[data-g="3"]'); await page.waitForTimeout(500); await page.click('[data-s="A"]'); await page.waitForTimeout(700);
  await page.fill('#q', 'a'); await page.waitForTimeout(400);
  const picked = (await page.locator('#list button').first().innerText()).split('\n')[0].trim();
  await page.locator('#list button').first().click();
  await page.waitForURL(/\/cb/, { timeout: 8000 });
  say(`online pick: ${picked} → ${await page.locator('#child').innerText()}`);
  await shot(page, 'who-1-picked');
  let s = await quizToQuestion('PZLFTR');
  say(`quiz online: screen=${s.screen} — ${s.text.replace(/NIETE FOR STUDENTS /, '').slice(0, 80)}`);
  await shot(page, 'who-2-quiz-online');

  // Offline: a child not on the list adds themselves.
  fs.writeFileSync(FLAG, ''); await ctx.setOffline(true);
  await page.goto(`${BASE}/who`, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.click('[data-g="2"]'); await page.waitForTimeout(500); await page.click('[data-s="B"]'); await page.waitForTimeout(700);
  await tapText("I'm not on the list");
  await page.fill('#nm', newName); await page.click('#go'); await page.waitForTimeout(800);
  if (await page.locator('#no').count()) await page.click('#no');
  await page.waitForURL(/\/cb/, { timeout: 8000 });
  say(`offline add me: ${await page.locator('#child').innerText()}`);
  s = await quizToQuestion('PZLFTR');
  say(`quiz offline: screen=${s.screen} — ${s.text.replace(/NIETE FOR STUDENTS /, '').slice(0, 80)}`);
  await shot(page, 'who-3-quiz-offline');

  // Back online.
  fs.rmSync(FLAG, { force: true }); await ctx.setOffline(false);
  await page.goto(`${BASE}/cb`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(12000);
  const logs = path.join(ROOT, 'logs');
  const rows = (f) => (fs.existsSync(path.join(logs, f)) ? fs.readFileSync(path.join(logs, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  say(`server, who played: ${rows('identity.jsonl').map((r) => `${r.event}:${r.name}${r.code ? '@' + r.code : ''}`).join(', ')}`);
  say(`server, added children: ${rows('added.jsonl').map((r) => `${r.name} (class ${r.grade}-${r.section})`).join(', ')}`);
} finally {
  fs.rmSync(FLAG, { force: true });
  const errs = log.filter((l) => /pageerror/.test(l));
  if (errs.length) say('page errors:\n' + errs.slice(-5).join('\n'));
  await ctx.close();
}
