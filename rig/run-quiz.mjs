// Play one class quiz from the link to the result, as a child on a Chromebook.
//   node run-quiz.mjs <code> <child name> [--offline] [--keep]
//     --keep     reuse this device's profile (what an earlier run saved stays on the device)
//     --offline  the network is off from the first tap
// Prints the screens the child passed through, the answers the page still holds unsent, and the misses the
// pilot worker counted (what was asked for but not on the device).
import { launch, shot, controlled, keptCount, state, BASE } from './cb.mjs';

const [code = 'PZLFTR', name = 'Cb Pilot'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const offline = process.argv.includes('--offline');
const keep = process.argv.includes('--keep');
const tag = `quiz-${code}-${offline ? 'off' : 'on'}`;

const { ctx, page, log } = await launch({ fresh: !keep });
const trail = [];
const mark = async (what) => {
  const s = await state(page);
  trail.push(`${what} → ${s.screen || '(no screen)'}: ${s.text.replace(/NIETE FOR STUDENTS /, '').slice(0, 110)}`);
  await shot(page, `${tag}-${String(trail.length).padStart(2, '0')}`);
  return s;
};
const tap = async (loc, label) => {
  try { await loc.first().click({ timeout: 5000 }); } catch (e) { trail.push(`  ! ${label}: ${e.message.split('\n')[0]}`); return false; }
  await page.waitForTimeout(1400);
  return true;
};

try {
  if (offline) await ctx.setOffline(true);
  await page.goto(`${BASE}/q/${code}`, { waitUntil: offline ? 'load' : 'networkidle' }).catch((e) => trail.push(`goto: ${e.message}`));
  if (!offline) { await controlled(page); await page.evaluate(() => window.__cbWarm && window.__cbWarm()); }
  if (process.argv.includes('--new-child')) {
    // A second child on the same Chromebook: forget the last child's quiz session, keep what the worker saved.
    const dropped = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^wq_s_/.test(k)).map((k) => { localStorage.removeItem(k); return k; }));
    trail.push(`new child on this device: forgot ${dropped.join(', ') || 'nothing'}`);
    await page.reload({ waitUntil: 'load' }).catch((e) => trail.push(`reload: ${e.message}`));
  }
  await page.waitForTimeout(1000);
  await mark('open');
  await tap(page.getByRole('button', { name: 'Play' }), 'Play') && await mark('Play');
  if (await page.locator('input:visible').count()) {
    await page.locator('input:visible').first().fill(name);
    await tap(page.getByRole('button', { name: 'Start' }), 'Start') && await mark('Start');
  }
  let named = 0;
  for (let step = 0; step < 40; step += 1) {
    const opt = page.locator('button.wq-opt:visible:not([disabled])');
    const screenNow = await page.locator('#wq').getAttribute('data-m').catch(() => null);
    if (screenNow === 'M4-name') {
      if (named >= 2) { trail.push('  ! stuck on the name screen after 2 tries'); break; }
      named += 1;
      await page.locator('input:visible').first().fill(name);
      await tap(page.getByRole('button', { name: 'Start' }), 'Start');
      await mark(`name "${name}" + Start`);
      continue;
    }
    if (screenNow === 'M4-who-v2' && await page.getByText("My name isn't here").count()) {
      await tap(page.getByText("My name isn't here"), 'not here');
      await mark('My name isn\'t here');
      continue;
    }
    const goNow = page.locator('button:visible:not([disabled])').filter({ hasText: /^\s*(Check|Next|Done|Continue|See my|Finish)/i });
    if (/^(M6|M9-fix)$/.test(screenNow || '') && await opt.count() && !(await goNow.count())) {
      await tap(opt.nth(step % 3), 'answer');
      await mark(`answer ${['A', 'B', 'C'][step % 3]}`);
      continue;
    }
    const go = (await goNow.count()) ? goNow : page.locator('button.wq-go:visible, button.wq-btn:visible').filter({ hasNotText: /back|share|again/i });
    if (await go.count()) {
      const label = ((await go.first().innerText()) || '').trim().slice(0, 30);
      await tap(go, label);
      const s = await mark(`tap "${label}"`);
      if (/star|score|well done|shabash|result/i.test(s.text) && !(await page.locator('button.wq-opt:visible').count())) {
        if (!(await page.locator('button.wq-go:visible').count())) break;
      }
      continue;
    }
    break;
  }
  const held = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      if (/queue|"answers"/.test(v)) {
        try { const o = JSON.parse(v); out[k] = { queue: (o.queue || []).length, answers: Object.keys(o.answers || {}).length, pending: !!o.pending }; } catch { out[k] = v.length + ' chars'; }
      }
    }
    return out;
  });
  console.log(`\n${tag} — ${name}\n` + trail.map((t, i) => `${String(i + 1).padStart(2)}. ${t}`).join('\n'));
  console.log('\nheld on the device (localStorage):', JSON.stringify(held));
  console.log('files kept by the worker:', await keptCount(page).catch(() => '?'));
} finally {
  console.log('--- console/errors (last 20) ---\n' + log.filter((l) => !/\/api\/wq\/e /.test(l)).slice(-20).join('\n'));
  await ctx.close();
}
