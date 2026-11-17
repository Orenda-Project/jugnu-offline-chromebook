// "Is there room for the whole class?" on a class whose list carries no sizes, for real: what Chrome lets this site
// keep is cut down (its own quota override for the site), a class is ticked, Get ready is pressed.
// The override cuts the REAL allowance and leaves navigator.storage.estimate() saying "10 GB free", which is what a
// Chromebook's drive filling up looks like to a page: the estimate never moves.
//   CB_BASE=http://localhost:8813 DEVICE_KEY=… node rig/videos-room-check.mjs <class> [room in MB, default 400]
// Run on a profile that already ran Get ready (rig/ready-check.mjs). The class must not be saved here yet.
// Expect: the videos step measures the class, says what it needs and what there is, and saves none of its videos.
import { launch, shot, BASE, controlled } from './cb.mjs';

const KEY = process.env.DEVICE_KEY;
const [grade, roomArg] = process.argv.slice(2);
const ROOM = (Number(roomArg) || 400) * 1e6;
if (!KEY || !grade) { console.error('usage: DEVICE_KEY=… node rig/videos-room-check.mjs <class> [room MB]'); process.exit(1); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const { ctx, page, log } = await launch({ fresh: false });
const cdp = await ctx.newCDPSession(page);
const videos = () => page.evaluate(async () => (await (await caches.open('cb-pilot-v1')).keys()).filter((k) => /\.mp4$/.test(new URL(k.url).pathname)).length);
try {
  await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}&stay=1&videos=${encodeURIComponent(grade)}`, { waitUntil: 'load' });
  check('the offline worker is in charge', await controlled(page));
  const before = await videos();
  const listed = await page.evaluate(async (g) => {
    // what Jugnu's own list says about this class's sizes (through the saved home's child)
    const hub = localStorage.getItem('cb-hub'), kid = localStorage.getItem('cb-kid');
    const get = (q) => fetch(`/api/wq/lib/h/${hub}?kid=${kid}&l=en&g=${encodeURIComponent(g)}${q}`).then((r) => r.json());
    const subjects = (await get('')).subjects || []; let n = 0, withSize = 0;
    for (const s of subjects) for (const c of (await get('&s=' + encodeURIComponent(s.key))).chapters || []) for (const v of c.videos || []) { n += 1; if (v.mb) withSize += 1; }
    return { n, withSize };
  }, grade);
  // (not a pass or fail: the list's sizes come and go; either way the step must measure for itself)
  console.log(`      Jugnu's list for Class ${grade} today: ${listed.n} lessons, ${listed.withSize} with a size`);
  const used = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(BASE).origin, quotaSize: Math.round(used + ROOM) });
  await page.reload({ waitUntil: 'load' }); // the start page asks how much Chrome allows when it opens
  await page.waitForFunction(() => /Chrome allows/.test(document.getElementById('space').textContent), null, { timeout: 15000 }).catch(() => {});
  const est = await page.evaluate(async () => { const e = await navigator.storage.estimate(); return Math.round((e.quota - e.usage) / 1e6); });
  const head = await page.evaluate(() => document.getElementById('space').textContent);
  const shown = /Chrome allows ([\d.]+) (MB|GB) more/.exec(head);
  const shownMb = shown ? Number(shown[1]) * (shown[2] === 'GB' ? 1000 : 1) : -1;
  // (Chrome hands room out in blocks of 128 MiB, so what the page can find out is the room rounded down to a block)
  check(`Chrome now allows this site at most ${Math.round(ROOM / 1e6)} MB more, while its estimate still says ${est} MB are free`, est > 9000 && shownMb <= ROOM / 1e6 && shownMb > ROOM / 1e6 - 140, `the start page: "${head}"`);
  await page.click('#ready');
  await page.waitForFunction(() => { const li = document.querySelector('#steps li[data-step="x-lesson-videos"]'); return li && (li.className === 'bad' || li.className === 'ok') && !document.getElementById('ready').disabled; }, null, { timeout: 900000, polling: 2000 });
  const row = await page.evaluate(() => { const li = document.querySelector('#steps li[data-step="x-lesson-videos"]'); return { cls: li.className, text: li.textContent.replace(/\s+/g, ' ').trim(), log: document.getElementById('log').textContent.trim().split('\n').filter((l) => /lesson videos/.test(l)), phase: document.getElementById('phase').textContent, tick: [...document.querySelectorAll('#vids label')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()) }; });
  const need = /Class \S+ needs ([\d.]+) (MB|GB), this Chromebook has room for ([\d.]+) (MB|GB)/.exec(row.text);
  check('the videos step refuses the class and says what it needs and what there is', row.cls === 'bad' && !!need, row.text.slice(0, 150));
  const needMb = need ? Number(need[1]) * (need[2] === 'GB' ? 1000 : 1) : 0;
  check('…the need is the class\'s real size, not 0', needMb > ROOM / 1e6 + 300, need ? `${need[1]} ${need[2]} needed` : '');
  check('…none of its videos was fetched', (await videos()) === before, `${before} videos on the drive before and after`);
  check('…Get ready still says Ready for everything else, and names what did not finish', /^Ready\./.test(row.phase) && /Not finished: lesson videos/.test(row.phase), row.phase.slice(0, 140));
  check('…and the start page lists the class with its measured size', row.tick.some((t) => new RegExp(`^Class ${grade} \\d+ lessons, (about )?[\\d.]+ (MB|GB)`).test(t)), row.tick.find((t) => t.startsWith(`Class ${grade} `)) || '');
  console.log('      log: ' + row.log.join(' | ').slice(0, 300));
  await page.evaluate(() => document.getElementById('step1').scrollIntoView());
  await shot(page, `videos-no-room-class-${grade}`);
} catch (e) {
  check('the run finished', false, String(e && e.message || e).split('\n')[0]);
} finally {
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(BASE).origin }).catch(() => {});
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) console.log(log.filter((l) => /pageerror/.test(l)).slice(-6).join('\n'));
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
}
