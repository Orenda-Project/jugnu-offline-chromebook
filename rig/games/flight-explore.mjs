// Learn the big flight's screens: open one part for one child and print, at each new phase/task, what the runner says
// and which controls are on screen. A generic policy keeps it moving (right answers where the runner names them).
//   CB_PRIVATE=… node rig/games/flight-explore.mjs G1.en maths [maxSeconds]
import { launch, shot, children, media, ROOT, BASE } from './lib.mjs';
import path from 'node:path';

const [who = 'G1.en', part = 'maths', maxS = '240'] = process.argv.slice(2);
const kid = children()[who];
const { ctx, page, log } = await launch({ wav: path.join(ROOT, 'logs/speech', `${kid.lang}.wav`) });
const say = (s) => console.log(s);
const snap = () => page.evaluate(() => {
  const root = document.getElementById('sae-root');
  const e = window.__sae;
  let v = null;
  try { v = e && e.runner ? e.runner.view() : null; } catch (x) { v = { err: String(x) }; }
  const vis = (b) => b.offsetParent !== null;
  const btns = [...document.querySelectorAll('button, [role=button], a.sg-btn, .sa-tile, .sa-bubble')].filter(vis).slice(0, 40).map((b) => {
    const r = b.getBoundingClientRect();
    return { cls: String(b.className).replace(/\s+/g, '.').slice(0, 50), t: (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 24), dis: !!b.disabled,
      d: Object.assign({}, b.dataset), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
  });
  const t = v && v.task;
  return {
    url: location.pathname, phase: root ? (root.firstElementChild && root.firstElementChild.getAttribute('data-phase')) || root.getAttribute('data-phase') : null,
    v: v ? { phase: v.phase, ti: v.task_index, n: v.tasks, task: t ? { id: t.id, mode: t.mode, kind: t.kind, lim: t.time_limit_s, items: (t.items || []).length, practice: (t.practice || []).length } : null,
      item: v.item ? JSON.stringify(v.item).slice(0, 220) : null, ii: v.item_index, practice: v.practice ? JSON.stringify(v.practice).slice(0, 220) : null, left: v.time_left_ms, cell: v.cell, offer_next: v.offer_next } : null,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160), btns, scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  };
}).catch((e) => ({ err: String(e).slice(0, 100) }));

try {
  await page.goto(`${BASE}/h/${kid.token}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  for (const t of ['Skip', 'چھوڑیں']) await page.getByText(t, { exact: true }).first().click({ timeout: 800 }).catch(() => {});
  await page.locator('a.wq-door[href="#games"]').first().click();
  await page.locator('a.wq-drow[data-item="bigtest"]').first().click({ timeout: 20000 });
  await page.waitForSelector('.sg-map', { timeout: 30000 });
  await page.waitForTimeout(1500);
  say('MAP: ' + JSON.stringify(await snap()).slice(0, 900));
  await shot(page, `flight-${who}-map`);
  await page.locator(`.sg-isl[data-k="${part}"], .sg-tower[data-k="${part}"]`).first().click();
  await page.waitForTimeout(2500);
  say('INTRO: ' + JSON.stringify(await snap()).slice(0, 1200));
  await shot(page, `flight-${who}-${part}-intro`);
  await page.locator('[data-tap="run"]').first().click({ timeout: 15000 });
  await page.waitForURL(/\/sa\/play\.html/, { timeout: 30000 });
  say('PLAY URL: ' + page.url().replace(/[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{16,}/, '<hub>').replace(/kid=[0-9a-f]{16}/, 'kid=<chip>'));
  let last = '';
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < Number(maxS) * 1000) {
    const s = await snap();
    const key = s.v ? `${s.v.phase}|${s.v.task && s.v.task.id}|${s.v.ii}|${(s.btns || []).map((b) => b.cls + (b.dis ? '!' : '')).join(',').slice(0, 200)}` : `url:${s.url}`;
    if (key !== last) {
      last = key; n += 1;
      say(`\n#${n} +${Math.round((Date.now() - t0) / 1000)}s ${JSON.stringify(s.v)}\n   text: ${s.text}\n   btns: ${(s.btns || []).map((b) => `${b.cls}${b.dis ? '(off)' : ''}[${b.t}]${Object.keys(b.d).length ? JSON.stringify(b.d) : ''}@${b.box.join(',')}`).join('  ')}`);
      if (n <= 60) await shot(page, `flight-${who}-${part}-${String(n).padStart(3, '0')}`);
    }
    if (!/\/sa\/play\.html/.test(s.url || '')) { say('LEFT play page: ' + s.url); break; }
    // generic policy: an enabled primary, else nothing (the first pass only learns the screens)
    const prim = page.locator('.sae-primary:not([disabled]), .sae-btn:not([disabled])').first();
    if (await prim.count()) await prim.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  say('\nMEDIA: ' + JSON.stringify(await media(page)).slice(0, 1500));
} finally {
  say('\nLOG: ' + log.slice(-20).join('\n'));
  await ctx.close();
}
