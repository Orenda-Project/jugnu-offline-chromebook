// Play the Challenge page's games behind one child's Games door, online or truly offline.
//   CB_PRIVATE=<private games-lane folder> node rig/games/play-challenge.mjs <G2.en> [numbers,missing,bigger,read,passage,listen] [--offline] [--trace]
//        [--keys]  type numbers on the keyboard (digits, Backspace, Enter) instead of clicking the on-screen keys
// Default: every game the door lists (not the big flight, which is rig/games/play-flight.mjs, nor the video quizzes).
import path from 'node:path';
import { launch, offline, children, ROOT } from './lib.mjs';
import { playGame, doorRows } from './challenge.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const [who, only] = args.filter((a) => !a.startsWith('--'));
const kid = children()[who];
if (!kid) { console.error('no such child: ' + who); process.exit(1); }
const off = !!flag('offline', false);
const { ctx, page, log } = await launch({ wav: path.join(ROOT, 'logs/speech', `${kid.lang}.wav`) });
const say = (s) => console.log(s);
let bad = 0;
try {
  if (off) await offline(ctx, true);
  say(`## ${who} (Grade ${kid.grade}, ${kid.lang}) ${off ? 'OFFLINE (server drops every connection + browser offline)' : 'online'}`);
  const rows = (await doorRows(page, kid).catch((e) => { say('Games door did not open: ' + e.message.split('\n')[0]); return []; }))
    .filter((r) => r.href && /^\/c\//.test(r.href)).filter((r) => !only || only.split(',').some((k) => r.item === k || r.kind === k || (r.item || '').indexOf(k) >= 0));
  if (!rows.length) { say('no Challenge games found behind the Games door'); bad += 1; }
  for (const r of rows) {
    const name = `${r.name} [${r.kind}:${r.item}]`;
    const g = await playGame(page, { href: r.href, lang: kid.lang, say, trace: !!flag('trace', false), keys: !!flag('keys', false), tag: `ch-${who}-${String(r.item).replace(/\W/g, '_')}${off ? '-off' : ''}`, maxMs: Number(flag('max', 6)) * 60000 });
    say(`${g.ended && !g.anomalies.length ? 'OK  ' : 'FAIL'} ${name}: ${g.screens.join(' > ')}`);
    say(`     end: ${g.ended ? `"${(g.endText || '').slice(0, 110)}"` : 'not reached'} · lang=${g.last && g.last.lang} dir=${g.last && g.last.dir} · sounds ${g.media.played}/${g.media.tried}${g.media.failed.length ? ' FAILED ' + g.media.failed.join(', ') : ''} · ${Math.round(g.ms / 1000)} s`);
    say(`     sent: ${g.posts.join('  ') || 'nothing'} · cut off by the page: ${g.cut.length ? g.cut.join(' ; ') : 'nothing'}${g.scrolls ? ' · scrolls needed: ' + g.scrolls : ''}`);
    if (!g.ended || g.anomalies.length) bad += 1;
  }
} finally {
  const errs = log.filter((l) => !/favicon|\/api\/wq\/e\b/.test(l));
  say(`\n-- page errors / failed requests / 4xx-5xx (${errs.length}):\n${[...new Set(errs)].slice(-14).join('\n')}`);
  if (off) await offline(ctx, false);
  await ctx.close();
  process.exitCode = bad ? 1 : 0;
}
