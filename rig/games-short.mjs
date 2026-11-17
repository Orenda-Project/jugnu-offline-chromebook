// A short check of the games lane's parts on a profile of the caller's choosing, online or truly offline: one part of
// the big flight and one or more Challenge games, played by the games lane's own rig code (rig/games/flight.mjs,
// challenge.mjs). Those rigs use one fixed profile and that lane's private test children; this one takes any profile
// and any home link, so the same play can be shown on a Chromebook that never ran Get ready (online: straight from
// the internet) and on one that did (offline: from the drive).
//   CB_BASE=http://localhost:8843 CB_PROFILE=.chrome-profile-online node rig/games-short.mjs <hub token | own> [flight part, default maths] [games, default missing (Grade 1: numbers)] [--offline] [--lang ur]
//     own        this profile's own saved home (what Get ready kept: localStorage cb-hub)
//     --offline  the server's OFFLINE switch on AND the browser offline (Get ready must have run on this profile)
//     --no-flight / --no-games   only the other half
// Speech for the read-aloud items: logs/speech/<lang>.wav (rig/games/make-speech.sh).
import path from 'node:path';

import { launch, offline, ROOT, BASE } from './games/lib.mjs';
import { openMap, startPart, playPart, backToMap } from './games/flight.mjs';
import { playGame, doorRows } from './games/challenge.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const plain = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--lang'));
const [tokenArg, part = 'maths', games = 'missing'] = plain;
if (!tokenArg) { console.error('usage: node rig/games-short.mjs <hub token | own> [flight part] [games] [--offline] [--lang ur]'); process.exit(1); }
const off = !!flag('offline', false);
const lang = String(flag('lang', 'en'));
const profile = path.resolve(ROOT, process.env.CB_PROFILE || '.chrome-profile');
const say = (s) => console.log(s);
const hide = (s) => String(s).replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{16,}/g, '<hub>');
const { ctx, page, log, mic } = await launch({ wav: path.join(ROOT, 'logs/speech', `${lang}.wav`), profile });
let bad = 0;
try {
  let token = tokenArg;
  if (token === 'own') {
    await page.goto(`${BASE}/cb/app.webmanifest`, { waitUntil: 'load' });
    token = await page.evaluate(() => localStorage.getItem('cb-hub'));
    if (!token) throw new Error('this profile has no saved home (run Get ready on it first)');
  }
  const kid = { token, lang };
  if (off) await offline(ctx, true);
  say(`## games, short — ${BASE} — profile ${path.basename(profile)} — ${off ? 'OFFLINE (server drops every connection + browser offline)' : 'online'}`);

  // the big flight: the map, one part played to its card, back to the map
  const map = flag('no-flight', false) ? { skip: true } : await openMap(page, kid).catch((e) => ({ err: e.message.split('\n')[0] }));
  if (map.skip) say('(the big flight: not asked for)');
  else if (map.err) { say(`FAIL the big flight's map did not open: ${map.err}`); bad += 1; }
  else {
    say(`map: ${map.islands.map((i) => `${i.k}${i.done ? '✓' : ''}${i.next ? '*' : ''}`).join(' ')} — "${map.say}"`);
    const st = await startPart(page, part);
    if (!st.started) { say(`FAIL ${part}: did not start — ${hide(st.text)}`); bad += 1; }
    else {
      const r = await playPart(page, { lang, say, speakMs: 9000, wrongFirst: 0, maxMs: 12 * 60000, tag: `short-${part}${off ? '-off' : ''}` });
      const back = await backToMap(page, { waitMs: off ? 20000 : 30000 });
      const ok = !r.anomalies.length && !r.media.failed.length && back.back;
      say(`${ok ? 'OK  ' : 'FAIL'} big flight, ${part}: ${st.stones.length} stones — ${r.results.map((x) => `${x.task}=${x.stop}`).join(' ')} · sounds ${r.media.played}/${r.media.tried}${r.media.failed.length ? ' FAILED ' + r.media.failed.join(', ') : ''} · ${Math.round(r.ms / 1000)} s · back to the map: ${back.back ? (back.card ? 'card shown' : 'map shown') : 'NO'}${r.anomalies.length ? ' · ' + r.anomalies.join(' | ') : ''}`);
      if (!ok) bad += 1;
    }
  }

  // the Challenge games behind the Games door
  const rows = flag('no-games', false) ? [] : (await doorRows(page, kid).catch((e) => { say('FAIL the Games door did not open: ' + e.message.split('\n')[0]); bad += 1; return []; }))
    .filter((r) => r.href && /^\/c\//.test(r.href));
  if (!flag('no-games', false)) say(`Games door: ${rows.length} Challenge games listed`);
  const want = rows.filter((r) => games.split(',').some((k) => r.item === k || r.kind === k || (r.item || '').indexOf(k) >= 0));
  if (!want.length && !flag('no-games', false)) { say(`FAIL none of "${games}" is behind the Games door (${rows.map((r) => r.item).join(', ')})`); bad += 1; }
  for (const r of want) {
    const g = await playGame(page, { href: r.href, lang, say, mic, tag: `short-${String(r.item).replace(/\W/g, '_')}${off ? '-off' : ''}`, maxMs: 6 * 60000 });
    const ok = g.ended && !g.anomalies.length && !g.media.failed.length;
    say(`${ok ? 'OK  ' : 'FAIL'} ${r.name} [${r.kind}:${r.item}]: ${g.screens.join(' > ')} · end: ${g.ended ? `"${(g.endText || '').slice(0, 90)}"` : 'not reached'} · sounds ${g.media.played}/${g.media.tried}${g.media.failed.length ? ' FAILED ' + g.media.failed.join(', ') : ''} · sent: ${g.posts.map((p) => (typeof p === 'string' ? p : `${p.p}:${p.status}${p.local ? '(kept on the device)' : ''}`)).join(' ') || 'nothing'} · ${Math.round(g.ms / 1000)} s`);
    if (!ok) bad += 1;
  }
} catch (e) {
  say('FAIL ' + hide(String(e && e.message || e).split('\n')[0])); bad += 1;
} finally {
  const errs = [...new Set(log.filter((l) => !/favicon|\/api\/wq\/e\b/.test(l)).map(hide))];
  say(`\n-- page errors / failed requests / 4xx-5xx (${errs.length}):\n${errs.slice(-10).join('\n')}`);
  if (off) await offline(ctx, false);
  await ctx.close();
  say(`\n${bad ? bad + ' problem(s)' : 'no problem'}`);
  process.exit(bad ? 1 : 0);
}
