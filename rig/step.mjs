// Walk a page by a list of taps, printing what is on screen after each one (to learn a flow before scripting it).
//   node step.mjs <path> [--offline-after-warm] [--keep] tap1 tap2 ...
// A tap is the visible text of a button (first match), "#id" for an element id, "type:<text>" to type into the focused
// field, "wait:<ms>", or "warm" (hand the worker what has loaded so far).
import { launch, shot, controlled, keptCount, state, BASE } from './cb.mjs';

const args = process.argv.slice(2);
const target = args.shift();
const offline = args.includes('--offline');
const keep = args.includes('--keep');
const taps = args.filter((a) => !a.startsWith('--'));
const tag = (process.env.CB_TAG || 'step') + (offline ? '-off' : '-on');

const { ctx, page, log } = await launch({ fresh: !keep });
try {
  if (offline) await ctx.setOffline(true);
  await page.goto(BASE + target, { waitUntil: offline ? 'load' : 'networkidle' }).catch((e) => console.log('goto', e.message));
  if (!offline) await controlled(page);
  await page.waitForTimeout(1200);
  let i = 0;
  const show = async (label) => {
    const s = await state(page);
    console.log(`\n#${i} ${label} — screen=${s.screen} url=${s.url}\n  text: ${s.text.slice(0, 300)}\n  buttons: ${s.buttons.map((b) => b.t || b.id).filter(Boolean).join(' | ')}`);
    await shot(page, `${tag}-${String(i).padStart(2, '0')}`);
    i += 1;
  };
  await show('open');
  for (const t of taps) {
    if (t === 'warm') { console.log('warm', JSON.stringify(await page.evaluate(() => window.__cbWarm && window.__cbWarm()))); continue; }
    if (t.startsWith('wait:')) { await page.waitForTimeout(Number(t.slice(5))); continue; }
    if (t.startsWith('type:')) {
      await page.locator('input:visible, textarea:visible').first().click({ timeout: 4000 }).catch(() => {});
      await page.keyboard.type(t.slice(5), { delay: 30 });
      await page.waitForTimeout(400);
      await show(`typed ${t.slice(5)}`);
      continue;
    }
    if (t === 'offline') { await ctx.setOffline(true); console.log('-- network OFF'); continue; }
    if (t === 'online') { await ctx.setOffline(false); console.log('-- network ON'); continue; }
    const loc = t.startsWith('#') ? page.locator(t) : page.getByRole('button', { name: t, exact: false }).or(page.getByText(t, { exact: true }));
    try {
      await loc.first().click({ timeout: 6000 });
    } catch (e) {
      console.log(`  ! could not tap "${t}": ${e.message.split('\n')[0]}`);
    }
    await page.waitForTimeout(1500);
    await show(`tap ${t}`);
  }
  console.log('\nkept files:', await keptCount(page).catch(() => '?'));
} finally {
  console.log('--- console/errors (last 25) ---\n' + log.slice(-25).join('\n'));
  await ctx.close();
}
