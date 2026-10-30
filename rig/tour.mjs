// One child's tour of everything on Jugnu's home, as on a Chromebook: a storybook (listen, turn pages), a lesson
// video (does it play), the number game and the reading game ("Jugnu's big flight").
//   node tour.mjs <hub token> [online|offline]
// offline = the pilot server's OFFLINE switch must already be on (every connection dropped); this script then also
// sets the browser offline, so the page sees navigator.onLine === false as a child's Chromebook would.
// Per experience it prints: the screen reached, what text shows, and every sound/video the page tried to play with
// whether it played. Screenshots go to shots/tour-<mode>-*.png.
import { launch, shot, state, BASE } from './cb.mjs';

const [token, mode = 'online'] = process.argv.slice(2);
const offline = mode === 'offline';
const { ctx, page, log } = await launch({ fresh: false });
await ctx.addInitScript(() => {
  const rec = (window.__cbMedia = []);
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const r = { src: String(this.currentSrc || this.src || '').split('?')[0].slice(-70), tag: this.tagName, ok: null };
    rec.push(r);
    const p = orig.apply(this, arguments);
    if (p && p.then) p.then(() => { r.ok = true; }, (e) => { r.ok = e && e.name; });
    return p;
  };
});
if (offline) await ctx.setOffline(true);

const rows = [];
async function media() {
  return page.evaluate(() => (window.__cbMedia || []).map((m) => `${m.tag === 'VIDEO' ? 'video' : 'audio'} ${m.ok === true ? 'played' : 'FAILED(' + m.ok + ')'} ${m.src}`)).catch(() => []);
}
async function videoProgress() {
  return page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ t: Math.round(v.currentTime * 10) / 10, ready: v.readyState, err: v.error && v.error.code, src: String(v.currentSrc || '').split('?')[0].slice(-50) }))).catch(() => []);
}
async function tapText(t, opts = {}) {
  try { await page.getByText(t, { exact: !!opts.exact }).first().click({ timeout: 5000 }); await page.waitForTimeout(opts.wait || 1500); return true; } catch { return false; }
}
async function home() {
  await page.goto(`${BASE}/h/${token}`, { waitUntil: offline ? 'load' : 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  await tapText('Skip', { exact: true, wait: 500 });
  await tapText('Not now', { exact: true, wait: 500 });
}
async function record(name, extra) {
  const s = await state(page);
  const file = await shot(page, `tour-${mode}-${name}`);
  rows.push({ name, screen: s.screen, url: s.url.slice(0, 40), text: s.text.replace(/NIETE FOR STUDENTS /, '').slice(0, 150), media: await media(), ...extra, shot: file.split('/').pop() });
  if (!offline) await page.evaluate(() => window.__cbWarm && window.__cbWarm()).catch(() => {});
}

try {
  // 1. Storybook: open the first book, listen, turn two pages.
  await home();
  await record('home');
  await tapText('Stories', { exact: true });
  await page.getByRole('button', { name: 'I need a cook' }).or(page.getByText('I need a cook', { exact: true })).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);
  for (let p = 0; p < 3; p += 1) {
    await tapText('Listen', { exact: true, wait: 4000 });
    if (p < 2) await page.getByRole('button', { name: 'Next page' }).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  await record('story');

  // 2. Lesson video: the Videos door's first video, then let it play.
  await home();
  await tapText('Videos', { exact: true });
  await page.getByRole('button', { name: /Describing Words Like Big/ }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(9000);
  await page.locator('video').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const v = document.querySelector('video'); if (v && v.paused) v.play().catch(() => {}); }).catch(() => {});
  await page.waitForTimeout(10000);
  await record('video', { video: await videoProgress() });

  // 3. Number game.
  await home();
  await tapText('Games', { exact: true });
  await page.locator('#wq a.wq-row').filter({ hasText: 'Numbers with Jugnu' }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(7000);
  await tapText('Find the number', { wait: 5000 });
  for (const t of ["Let's go", 'Start', 'Play', 'Begin', 'Ready', 'Next']) if (await tapText(t, { exact: true, wait: 3000 })) break;
  for (let i = 0; i < 3; i += 1) { await page.locator('#wq button:visible, button:visible').filter({ hasText: /^\s*\d+\s*$/ }).first().click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(1500); }
  await record('numbers');

  // 4. Reading game: Jugnu's big flight (the reading battery, /sa-game/).
  await home();
  await tapText('Games', { exact: true });
  await page.locator('#wq a.wq-row').filter({ hasText: "Jugnu's big flight" }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(9000);
  await tapText('English Island', { wait: 6000 });
  for (const t of ["Let's go", 'Start', 'Play', 'Begin', 'Ready', 'Next', 'Yes']) if (await tapText(t, { exact: true, wait: 3000 })) break;
  await page.waitForTimeout(3000);
  await record('flight');
} finally {
  for (const r of rows) {
    console.log(`\n== ${r.name}: screen=${r.screen} url=${r.url}\n   text: ${r.text}`);
    if (r.video) console.log('   video elements:', JSON.stringify(r.video));
    const played = r.media.filter((m) => / played /.test(m)).length;
    console.log(`   sounds/videos tried: ${r.media.length}, played: ${played}${r.media.length - played ? ' — not played: ' + r.media.filter((m) => !/ played /.test(m)).slice(0, 4).join(' ; ') : ''}`);
    console.log(`   shot: ${r.shot}`);
  }
  console.log('\n--- page errors ---\n' + log.filter((l) => /pageerror/.test(l)).slice(-8).join('\n'));
  await ctx.close();
}
