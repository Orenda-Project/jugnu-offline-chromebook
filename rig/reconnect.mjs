// The network comes back: reopen the quiz on the same device and see whether what was saved offline is sent.
//   node reconnect.mjs <code>
import { launch, shot, state, BASE } from './cb.mjs';
const code = process.argv[2] || 'PZLFTR';
const { ctx, page } = await launch({ fresh: false });
const held = () => page.evaluate((c) => { try { const o = JSON.parse(localStorage.getItem('wq_s_' + c) || '{}'); return { answers: Object.keys(o.answers || {}).length, unsent: (o.queue || []).length, pending: !!o.pending }; } catch { return null; } }, code);
try {
  await page.goto(`${BASE}/q/${code}`, { waitUntil: 'networkidle' });
  console.log('on reopen:', JSON.stringify(await held()), (await state(page)).screen);
  await page.waitForTimeout(25000);
  const s = await state(page);
  console.log('after 25 s online:', JSON.stringify(await held()), s.screen, '|', s.text.replace(/NIETE FOR STUDENTS /, '').slice(0, 160));
  await shot(page, `reconnect-${code}`);
} finally { await ctx.close(); }
