// Does "Check this Chromebook" find what is missing? Three saved things are removed from the drive on purpose (a
// lesson's video, a storybook's first page picture, the Games door's list), the check is run, and it must name each.
// Then Get ready is pressed again and must put them back.
//   CB_BASE=http://localhost:8813 DEVICE_KEY=… node rig/check-finds.mjs      (after Get ready, with one class's videos)
import { launch, BASE, controlled } from './cb.mjs';

const { ctx, page, log } = await launch({ fresh: false });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const runCheck = async () => {
  await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
  await page.click('#test');
  await page.waitForSelector('#test-result', { timeout: 900000 });
  return page.evaluate(() => ({ head: document.getElementById('test-result').innerText, lines: [...document.querySelectorAll('#test-out li')].map((li) => li.innerText) }));
};
try {
  await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
  await controlled(page);
  const gone = await page.evaluate(async () => {
    const c = await caches.open('cb-pilot-v1');
    const keys = await c.keys();
    const pick = (rx) => keys.find((k) => rx.test(k.url));
    // (lesson videos are in the media cache; one an earlier version saved may still be in the main one)
    const m = await caches.open('cb-media-v1');
    const mvideo = (await m.keys()).find((k) => /_web\.mp4$/.test(k.url));
    if (mvideo) await m.delete(mvideo);
    // (the Games list the door itself asks for: the home child's own, with no class named. Get ready also keeps the
    //  lists of the other classes, which the door only asks for when a child taps another class)
    const video = pick(/_web\.mp4$/), pic = pick(/\/s\/[0-9a-f-]{36}\/p01-[0-9a-f]+\.webp$/), games = pick(/\/api\/wq\/doors\/h\/[^?]+\?kid=[0-9a-f]*&d=games&l=en$/);
    const out = [];
    if (mvideo) out.push(mvideo.url.split('/').slice(-2).join('/'));
    for (const k of [mvideo ? null : video, pic, games]) if (k) { await c.delete(k); out.push(k.url.replace(location.origin, '').split('?')[0].split('/').slice(-2).join('/') + (k === games ? ' (the Games list)' : '')); }
    return out;
  });
  check('three saved things were removed from the drive', gone.length === 3, gone.join(' | '));
  const r = await runCheck();
  console.log('      the check says: ' + r.head.replace(/\s+/g, ' ').slice(0, 110));
  r.lines.forEach((l) => console.log('        · ' + l.replace(/\s+/g, ' ').slice(0, 150)));
  check('the check names the lesson whose video is gone', r.lines.some((l) => /the video (not on this Chromebook|did not open)/.test(l)));
  // (the storybooks' own check, ready/stories.js, names the book and the file; without that step the start page's "Story:" line does)
  check('the check names the storybook whose page is gone', r.lines.some((l) => (/^Story: /.test(l) && /missing|did not open/.test(l)) || /books?,.*not saved; e\.g\. .*p01-/.test(l)), (r.lines.find((l) => /not saved; e\.g\./.test(l)) || '').replace(/\s+/g, ' ').slice(0, 120));
  check('the check names the Games door', r.lines.some((l) => /^Games door/.test(l)));
  check('the files count names what is not on the drive', r.lines.some((l) => /files: .*not on this Chromebook/.test(l) || /not on this Chromebook/.test(l)));
  // Get ready again puts them back
  await page.click('#ready');
  await page.waitForFunction(() => /^(Ready\.|Not ready|Stopped)/.test(document.getElementById('phase').textContent) && !/Still saving/.test(document.getElementById('phase').textContent) && document.getElementById('ready').disabled === false, null, { timeout: 900000, polling: 2000 });
  const phase = await page.evaluate(() => document.getElementById('phase').textContent);
  check('Get ready again finishes', /^Ready\./.test(phase) && !/Not finished/.test(phase), phase.slice(0, 90));
  const again = await runCheck();
  check('after Get ready again the check is clean', /^All \d+ opened/.test(again.head), again.head.replace(/\s+/g, ' ').slice(0, 90));
} catch (e) {
  check('the run finished', false, String(e && e.message || e).split('\n')[0]);
} finally {
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) console.log(log.filter((l) => /pageerror/.test(l)).slice(-6).join('\n'));
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
}
