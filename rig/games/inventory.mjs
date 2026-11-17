// Every game a child can reach from the home's Games door, per grade and home language.
//   CB_PRIVATE=<private games-lane folder> node rig/games/inventory.mjs [G1.en G3.ur ...]   (default: all ten)
// For each child: the home, the Games door's rows as drawn (section, name, kind, where it goes), then the same with
// the door's grade picker on "All grades" (a child can open another grade's games). Writes logs/games-inventory.json.
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, children, fit, BASE, ROOT } from './lib.mjs';

const kids = children();
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(kids);
const { ctx, page, log } = await launch();
const scrub = (s) => String(s || '').replace(/[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{16,}/g, '<hub>').replace(/kid=[0-9a-f]{16}/g, 'kid=<chip>');

const rows = () => page.evaluate(() => {
  const out = [];
  const scr = document.querySelector('section.wq-droom') || document.getElementById('wq') || document.body;
  let sec = '';
  for (const el of scr.querySelectorAll('h3.wq-dsec, .wq-drow, .wq-dempty, .wq-dskel')) {
    if (el.matches('h3.wq-dsec')) { sec = el.innerText.trim(); continue; }
    if (el.matches('.wq-dskel')) { out.push({ section: sec, loading: true }); continue; }
    if (el.matches('.wq-dempty')) { out.push({ section: sec, empty: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) }); continue; }
    out.push({ section: sec, name: (el.querySelector('b') || el).innerText.replace(/\s+/g, ' ').trim(), sub: (el.querySelector('small') || {}).innerText || '',
      kind: el.getAttribute('data-kind'), item: el.getAttribute('data-item'), tap: el.getAttribute('data-tap'), href: el.getAttribute('href') || null });
  }
  return { screen: scr.getAttribute && scr.getAttribute('data-m'), dir: scr.getAttribute && scr.getAttribute('dir'), picker: (document.querySelector('.wq-vgl') || {}).innerText || null, rows: out };
});

// a run for some children adds to what earlier runs found
const OUT = path.join(ROOT, 'logs', 'games-inventory.json');
const result = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
try {
  for (const k of want) {
    const kid = kids[k];
    if (!kid) { console.log(`(no such child ${k})`); continue; }
    const r = (result[k] = { grade: kid.grade, lang: kid.lang });
    await page.goto(`${BASE}/h/${kid.token}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => { r.gotoErr = e.message.split('\n')[0]; });
    await page.waitForTimeout(2500);
    // the first-open welcome layer and the reminder ask, as a child would dismiss them
    for (const t of ['Skip', 'چھوڑیں', 'Not now', 'ابھی نہیں']) await page.getByText(t, { exact: true }).first().click({ timeout: 800 }).catch(() => {});
    r.home = await page.evaluate(() => ({ text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200), lang: document.documentElement.lang, dir: document.documentElement.dir,
      doors: [...document.querySelectorAll('a.wq-door')].map((a) => a.getAttribute('href')), next: (document.querySelector('[data-next], .wq-next') || {}).innerText || null }));
    r.homeFit = await fit(page);
    await shot(page, `inv-${k}-home`);
    const door = page.locator('a.wq-door[href="#games"]').first();
    if (!(await door.count())) { r.noGamesDoor = true; console.log(`${k}: no Games door — ${r.home.text.slice(0, 120)}`); continue; }
    await door.click();
    await page.waitForFunction(() => document.querySelector('section.wq-droom') && !document.querySelector('.wq-dskel'), null, { timeout: 20000 }).catch(() => { r.rowsTimedOut = true; });
    await page.waitForTimeout(800);
    r.own = await rows();
    r.ownFit = await fit(page);
    await shot(page, `inv-${k}-games`);
    // the grade picker: All grades
    const pick = page.locator('.wq-vgl').first();
    if (await pick.count()) {
      await pick.click().catch(() => {});
      await page.locator('.wq-gpick .wq-chip[data-item="all"]').first().click({ timeout: 4000 }).catch(() => { r.noAllChip = true; });
      await page.waitForFunction(() => document.querySelector('section.wq-droom') && !document.querySelector('.wq-dskel'), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      r.all = await rows();
      await shot(page, `inv-${k}-games-all`);
      // back to the child's own grade, so the next visit starts where a child's would
      await page.locator('.wq-vgl').first().click().catch(() => {});
      await page.locator(`.wq-gpick .wq-chip[data-item="${kid.grade}"]`).first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    const line = (x) => `${x.section} › ${x.name || x.empty || '(loading)'} [${x.kind || ''}${x.item ? ':' + x.item : ''}] ${scrub(x.href || (x.tap ? 'tap:' + x.tap : ''))}`;
    console.log(`\n== ${k} (Grade ${kid.grade}, ${kid.lang}) home lang=${r.home.lang} dir=${r.home.dir} doors=${r.home.doors.join(',')} picker=${r.own.picker}`);
    for (const x of r.own.rows) console.log('   ' + line(x));
    if (r.all) { console.log(`   -- All grades (${r.all.picker}) adds:`); const have = new Set(r.own.rows.map(line)); for (const x of r.all.rows) if (!have.has(line(x))) console.log('   + ' + line(x)); }
  }
} finally {
  for (const k of Object.keys(result)) for (const part of ['own', 'all']) if (result[k][part]) result[k][part].rows.forEach((x) => { if (x.href) x.href = scrub(x.href); });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  const bad = log.filter((l) => !/favicon/.test(l));
  console.log(`\n-- page errors / failed / 4xx-5xx (${bad.length})\n` + bad.slice(-25).map(scrub).join('\n'));
  await ctx.close();
}
