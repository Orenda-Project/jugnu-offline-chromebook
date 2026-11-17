// Play parts of Jugnu's big flight for one test child, online or truly offline, and say what happened.
//   CB_PRIVATE=<private games-lane folder> node rig/games/play-flight.mjs <G1.en> <maths,english,urdu,tower> [--offline] [--trace]
//        [--speak=9000] [--wrong=0] [--max=25]   (minutes per part)
// --offline: the home, the map and the part are opened with the server's OFFLINE switch on AND the browser offline
// (Get ready must have run on this profile). Prints one line per stone, the sounds, the layout and the part's card.
import path from 'node:path';
import { launch, offline, children, ROOT } from './lib.mjs';
import { openMap, startPart, playPart, backToMap } from './flight.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const [who, partsArg = 'maths'] = args.filter((a) => !a.startsWith('--'));
const kid = children()[who];
if (!kid) { console.error('no such child: ' + who); process.exit(1); }
const off = !!flag('offline', false);
const { ctx, page, log } = await launch({ wav: path.join(ROOT, 'logs/speech', `${kid.lang}.wav`) });
const say = (s) => console.log(s);
let failed = false;
try {
  if (off) await offline(ctx, true);
  say(`## ${who} (Grade ${kid.grade}, ${kid.lang}) ${off ? 'OFFLINE (server drops every connection + browser offline)' : 'online'}`);
  let map = await openMap(page, kid).catch((e) => ({ err: e.message.split('\n')[0] }));
  if (map.err) { say(`MAP did not open: ${map.err} — ${await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '')}`); failed = true; }
  else say(`map: lang=${map.lang} dir=${map.dir} — ${map.islands.map((i) => `${i.k}${i.done ? '✓' : ''}${i.next ? '*' : ''}`).join(' ')} — "${map.say}"`);
  for (const part of failed ? [] : partsArg.split(',')) {
    const st = await startPart(page, part);
    if (!st.started) { say(`${part}: did not start — ${st.text}`); failed = true; continue; }
    say(`\n# ${part}: ${st.stones.length} stones — ${st.url.slice(0, 110)}`);
    const r = await playPart(page, { lang: kid.lang, say, trace: !!flag('trace', false), speakMs: Number(flag('speak', 9000)), wrongFirst: Number(flag('wrong', 0)), maxMs: Number(flag('max', 25)) * 60000, tag: `fl-${who}-${part}${off ? '-off' : ''}` });
    say(`  results: ${r.results.map((x) => `${x.task.replace(/^(ma|en|ur)\./, '$1.')}=${x.stop}${x.correct != null ? `(${x.correct}/${x.attempted})` : ''}${x.audio ? '[' + x.audio + ']' : ''}`).join('  ')}`);
    say(`  sounds: ${r.media.played}/${r.media.tried} played${r.media.failed.length ? ' — FAILED: ' + r.media.failed.join(', ') : ''}`);
    say(`  time: ${Math.round(r.ms / 1000)} s · sync dot: ${r.sync} · tallest screen ${Math.max(...r.layout.map((l) => l.sh))}px in a ${r.layout[0] ? r.layout[0].h : '?'}px page · anomalies: ${r.anomalies.length ? r.anomalies.join(' | ') : 'none'}`);
    if (r.anomalies.length) failed = true;
    const back = await backToMap(page, { waitMs: off ? 20000 : 30000 });
    say(`  back to the map: ${back.back ? (back.card ? 'card shown — ' + back.rows.join(' ; ') : 'map shown, NO card — ' + back.text.slice(0, 120)) : 'NO — stayed on: ' + back.text}`);
    if (!back.back) { failed = true; break; }
    await page.locator('[data-tap="map"]').last().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
} finally {
  const bad = log.filter((l) => !/favicon|\/api\/wq\/e\b/.test(l));
  say(`\n-- page errors / failed requests / 4xx-5xx (${bad.length}):\n${[...new Set(bad)].slice(-18).join('\n')}`);
  if (off) await offline(ctx, false);
  await ctx.close();
  process.exitCode = failed ? 1 : 0;
}
