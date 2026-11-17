// A picked child's own home (HOME_PER_CHILD=1): what works, and what happens for a child Jugnu does not know.
//   Server: ROSTER_FILE=<a test class list> HOME_PER_CHILD=1 … node server.mjs   (P=… ROSTER_FILE=… HOME_PER_CHILD=1 sh rig/serve.sh)
//   CB_BASE=http://localhost:8813 DEVICE_KEY=… node rig/perchild-check.mjs <class of a child Jugnu knows> <class of one it does not>
// The test class list must hold, in the first class, a child whose id IS a student in the Jugnu database behind the
// pilot, and in the second a child whose id is not (any made-up id). No real child's name is needed or printed.
import { launch, shot, BASE, controlled } from './cb.mjs';
import { decode } from '../hub-sign.mjs';

const KEY = process.env.DEVICE_KEY;
const [known, unknown] = process.argv.slice(2);
if (!KEY || !known || !unknown) { console.error('usage: DEVICE_KEY=… node rig/perchild-check.mjs <class with a known child> <class with an unknown child>'); process.exit(1); }
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const { ctx, page, log } = await launch({ fresh: process.argv.includes('--fresh') });
const ask = (msg) => page.evaluate((m) => new Promise((ok) => { const ch = new MessageChannel(); const t = setTimeout(() => ok(null), 9000); ch.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); }; navigator.serviceWorker.controller.postMessage(m, [ch.port2]); }), msg);
const pick = async (grade) => {
  await page.goto(`${BASE}/who`, { waitUntil: 'load' });
  await page.click(`[data-g="${grade}"]`);
  if (await page.locator('[data-s]').count()) await page.locator('[data-s]').first().click();
  await page.locator('.tile.name').first().click();
  await page.waitForURL(/\/cb\?picked=1/, { timeout: 15000 });
  return page.evaluate(() => JSON.parse(localStorage.getItem('cb-child')).student_id);
};
const home = async () => {
  await page.goto(`${BASE}/cb/home`, { waitUntil: 'load' }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('a.wq-door').length === 3, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return page.evaluate(() => ({ token: (location.pathname.match(/^\/h\/([^/?#]+)/) || [])[1] || null, doors: document.querySelectorAll('a.wq-door').length, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80) }));
};
try {
  const status = await fetch(`${BASE}/__cb/home/status?key=${encodeURIComponent(KEY)}`).then((r) => r.json());
  check('the server signs a home per child', status.signing && status.per_child, JSON.stringify(status));
  await page.goto(`${BASE}/cb?key=${encodeURIComponent(KEY)}&stay=1&videos=none`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.register('/__cb/sw.js', { scope: '/' }));
  await controlled(page);
  const dev = await ask({ type: 'home', key: KEY, device: 'rig-perchild', fresh: true });
  const deviceIds = decode(dev.hub).ids;
  check('this Chromebook has its own home', dev && dev.live, `${deviceIds.length} child`);

  // a child Jugnu knows
  const a = await pick(known);
  let h = await home();
  const st = await ask({ type: 'home', key: KEY, who: a });
  check('a picked child Jugnu knows: a home is signed for that child', st && st.who && decode(st.who).ids[0] === a, st && st.who ? 'the link names the picked child and nobody else: ' + (decode(st.who).ids.length === 1) : 'no link for the child');
  check('…and /cb/home opens it', h.doors === 3 && h.token && decode(h.token).ids[0] === a, h.text);
  await shot(page, 'perchild-known');

  // a child Jugnu does not know
  const b = await pick(unknown);
  h = await home();
  check('a picked child Jugnu does NOT know: /cb/home ends on this Chromebook\'s home, open', h.doors === 3 && h.token && String(decode(h.token).ids) === String(deviceIds) && b !== deviceIds[0], h.text);
  const st2 = await ask({ type: 'home', key: KEY, who: b });
  check('…and that child\'s empty home is not asked for again', st2 && !st2.who, st2 ? `who: ${st2.who ? 'still held' : 'none'}` : '');
  await shot(page, 'perchild-unknown');
} catch (e) {
  check('the run finished', false, String(e && e.message || e).split('\n')[0]);
} finally {
  const bad = results.filter((x) => !x.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (bad.length) console.log(log.filter((l) => /pageerror/.test(l)).slice(-6).join('\n'));
  await ctx.close();
  process.exit(bad.length ? 1 : 0);
}
