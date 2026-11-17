// What a child can reach from Jugnu's v3 home, through the pilot, and what breaks: the home, each door (Stories,
// Games, Videos), the first item behind each, with the page's errors, failed requests and every sound it tried to play.
//   CB_BASE=https://<pilot service> node rig/probe-home.mjs <hub token> [online|offline]
// offline: the browser is set offline after the home has loaded once (a true offline run needs the server's
// OFFLINE switch too; see README). Screenshots go to shots/probe-<mode>-*.png.
import { launch, shot, BASE } from './cb.mjs';

const [token, mode = 'online'] = process.argv.slice(2);
const { ctx, page, log } = await launch({ fresh: mode === 'online' });
await ctx.addInitScript(() => {
  const rec = (window.__cbMedia = []);
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const r = { src: String(this.currentSrc || this.src || '').split('?')[0].slice(-80), ok: null };
    rec.push(r);
    const p = orig.apply(this, arguments);
    if (p && p.then) p.then(() => { r.ok = true; }, (e) => { r.ok = e && e.name; });
    return p;
  };
});
const say = (t) => console.log(t);
const seen = () => page.evaluate(() => {
  const vis = (e) => e.offsetParent !== null;
  const taps = [...document.querySelectorAll('button, a, [role=button], [data-door], [data-book]')].filter(vis)
    .map((e) => (e.getAttribute('data-door') ? `[door=${e.getAttribute('data-door')}] ` : '') + (e.innerText || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean);
  return { url: location.pathname + location.hash, text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 220), taps: [...new Set(taps)].slice(0, 30), media: (window.__cbMedia || []).slice(-6) };
}).catch((e) => ({ err: String(e) }));
const report = async (label) => { await page.waitForTimeout(2500); const s = await seen(); say(`\n## ${label}\n${JSON.stringify(s, null, 1)}`); await shot(page, `probe-${mode}-${label}`); };
const tap = async (re) => {
  const loc = page.locator('button, a, [role=button], [data-door]').filter({ hasText: re }).first();
  if (!(await loc.count())) { say(`(no tap matching ${re})`); return false; }
  await loc.click({ timeout: 8000 }).catch((e) => say(`(tap ${re} failed: ${e.message.split('\n')[0]})`));
  return true;
};

try {
  await page.goto(`${BASE}/h/${token}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await report('home');
  if (mode === 'offline') { await ctx.setOffline(true); await page.reload({ waitUntil: 'load' }).catch(() => {}); await report('home-offline'); }
  for (const door of [/stories|کہانی/i, /games|کھیل/i, /videos|ویڈیو/i]) {
    await page.goto(`${BASE}/h/${token}`, { waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(2000);
    if (!(await tap(door))) continue;
    await report(`door-${door.source.split('|')[0]}`);
  }
} finally {
  const bad = log.filter((l) => /pageerror|\[error\]|failed/.test(l)).slice(-40);
  say(`\n## errors and failed requests (${bad.length})\n${bad.join('\n')}`);
  await ctx.close();
}
