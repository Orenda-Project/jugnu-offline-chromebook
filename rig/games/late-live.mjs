// A late result against the live sandbox, through the pilot, for one test child: does Jugnu take a number game's
// result for the run it was played in when that run's token has lapsed?
//
//   CB_PRIVATE=<folder: students.json + hub-<key>.txt> INTERNAL_API_KEY=<the sandbox's key> CB_TOKEN_MODULE=<web-quiz-token.js>
//     node rig/games/late-live.mjs serve <child> [bigger,missing]     the games are asked for (a run each) and noted
//     node rig/games/late-live.mjs send  <child> [--wrong=1]          each noted run gets its result, LATE: with a
//                                                                     token for that same run whose life ended 3 h ago
//
// A token cannot be made older by waiting less than two hours, so the lapsed one is signed here with the same code
// and key Jugnu signs with (as tools/sign-hub.mjs does for a home link): the same run, the same child, the same game,
// an expiry in the past. The runs are noted in <CB_PRIVATE>/late-live-<child>.json (never in this repo). Everything
// is asked from the child's own Chrome profile, as the child's page asks it.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, children, BASE, ROOT } from './lib.mjs';

const [phase, who, gamesArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const kid = children()[who];
if (!kid || !/^(serve|send)$/.test(phase || '')) { console.error('usage: late-live.mjs serve|send <child> [games]'); process.exit(2); }
const NOTE = path.join(process.env.CB_PRIVATE, `late-live-${who}.json`);
const say = (s) => console.log(s);
const payloadOf = (ct) => JSON.parse(Buffer.from(ct.split('.')[0], 'base64url').toString('utf8'));

const { ctx, page } = await launch({ profile: path.join(ROOT, 'logs', 'profiles', who) });
try {
  if (process.env.CB_DEVICE_KEY) await page.goto(`${BASE}/cb?key=${encodeURIComponent(process.env.CB_DEVICE_KEY)}`, { waitUntil: 'load', timeout: 60000 });
  await page.goto(`${BASE}/h/${kid.token}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('a.wq-door[href="#games"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  for (const t of ['Skip', 'چھوڑیں']) await page.getByText(t, { exact: true }).first().click({ timeout: 600 }).catch(() => {});
  await page.locator('a.wq-door[href="#games"]').first().click();
  await page.waitForSelector('a.wq-drow', { timeout: 25000 });
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a.wq-drow')].map((a) => a.getAttribute('href') || ''));
  const own = hrefs.map((h) => /^\/c\/([^?#]+)\?(?:.*&)?kid=([0-9a-f]{16})/.exec(h)).find(Boolean);
  if (!own) throw new Error('no game link with this child\'s id behind the Games door');
  const [, tok, chip] = own;
  const ask = (pathAndQuery, body) => page.evaluate(async ([u, b]) => {
    const r = await fetch(u, b ? { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(b) } : { headers: { accept: 'application/json' }, cache: 'no-store' });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    return { status: r.status, json: j, text: j ? '' : t.slice(0, 120) };
  }, [pathAndQuery, body || null]);

  if (phase === 'serve') {
    const out = {};
    for (const ex of (gamesArg || 'bigger,missing').split(',')) {
      const r = await ask(`/api/wq/ch/${tok}/${ex}?lang=${kid.lang}&kid=${chip}`);
      if (r.status !== 200 || !r.json || !r.json.ct) { say(`${ex}: not served (${r.status} ${JSON.stringify(r.json || r.text).slice(0, 160)})`); continue; }
      const p = payloadOf(r.json.ct);
      out[ex] = { run: p.r, sid: p.sid, exp: p.exp, served_at: new Date().toISOString(), items: r.json.items, mode: r.json.mode || null };
      say(`${ex}: served — run ${p.r.slice(0, 8)}, ${r.json.items.length} questions, mode ${r.json.mode || '?'}, token good until ${new Date(p.exp * 1000).toISOString()}`);
    }
    fs.writeFileSync(NOTE, JSON.stringify(out, null, 1), { mode: 0o600 });
  } else {
    const T = createRequire(import.meta.url)(path.resolve(process.env.CB_TOKEN_MODULE));
    const note = JSON.parse(fs.readFileSync(NOTE, 'utf8'));
    const wrong = Number(flag('wrong', 1));
    for (const ex of Object.keys(note)) {
      const n = note[ex];
      // the same run's token, three hours past its life
      const lapsed = T.sign({ k: 'c', sid: n.sid, ex, r: n.run, exp: Math.floor(Date.now() / 1000) - 3 * 3600 });
      const right = (it) => (ex === 'bigger' ? Math.max(it.a, it.b) : it.answer);
      const given = n.items.map((it, i) => (ex === 'bigger'
        ? { i, pick: i < wrong ? Math.min(it.a, it.b) : right(it), ms: 2400 }
        : { i, value: String(i < wrong ? Number(right(it)) + 1 : right(it)), ms: 3000, first_key_ms: 1200, keys: String(right(it)).length }));
      const body = { ct: lapsed, ms: 30000, lang: kid.lang, helped: false, ...(ex === 'bigger' ? { taps: given } : { answers: given }) };
      const plain = await ask('/api/wq/ch/result', body);
      say(`${ex} run ${n.run.slice(0, 8)}: lapsed token, NOT saying it is late -> ${plain.status} ${JSON.stringify(plain.json || plain.text).slice(0, 140)}`);
      const late = await ask('/api/wq/ch/result', { ...body, late: { at: Date.parse(n.served_at) + 60000 } });
      say(`${ex} run ${n.run.slice(0, 8)}: lapsed token, saying it is late        -> ${late.status} ${JSON.stringify(late.json || late.text).slice(0, 200)}`);
      const again = await ask('/api/wq/ch/result', { ...body, late: { at: Date.parse(n.served_at) + 60000 } });
      say(`${ex} run ${n.run.slice(0, 8)}: the same late result sent again            -> ${again.status} ${JSON.stringify(again.json || again.text).slice(0, 100)}`);
    }
  }
} finally {
  await ctx.close();
}
