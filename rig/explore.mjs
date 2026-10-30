// Step 1: open a quiz online, look at it; then reload with the network off and look again.
//   node explore.mjs [code]
import { launch, shot, controlled, keptCount, state, BASE } from './cb.mjs';

const code = process.argv[2] || 'PZLFTR';
const { ctx, page, log } = await launch({ fresh: true });
try {
  await page.goto(`${BASE}/q/${code}`, { waitUntil: 'networkidle' });
  const ctl = await controlled(page);
  await page.waitForTimeout(1500);
  console.log('warm:', JSON.stringify(await page.evaluate(() => window.__cbWarm && window.__cbWarm())));
  console.log('online: controlled by pilot worker =', ctl, ' kept files =', await keptCount(page));
  console.log(JSON.stringify(await state(page), null, 1));
  console.log('shot', await shot(page, `explore-${code}-1-online`));

  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch((e) => console.log('reload error', e.message));
  await page.waitForTimeout(2500);
  console.log('offline reload:', JSON.stringify(await state(page), null, 1));
  console.log('shot', await shot(page, `explore-${code}-2-offline`));
} finally {
  console.log('--- console/errors ---\n' + log.slice(-40).join('\n'));
  await ctx.close();
}
