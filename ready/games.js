/* Get ready, games lane (bd-fc5mgd.13.2): every learning game a child can reach, kept on this Chromebook.
 *
 *   Jugnu's big flight   the reading and number battery as a game (Urdu Island, English Island, Numbers Island, the
 *                        Big flight). All six batteries (Grade 1, Grades 2-3, Grades 4-5, each in English and Urdu),
 *                        every clip and picture they name (as Jugnu's own engine lists them, sa-offline.js), the
 *                        clips' word timings, the engine's files, the sea map in both languages.
 *   Jugnu's Challenge    the number games and "a story with Jugnu" behind the Games door (Numbers with Jugnu, Number
 *                        warm-up, Which is bigger?, Read along, Read aloud, Listen): each game's page, its exercise
 *                        and the clips it names, for this child's grade and, through the door's grade picker, the
 *                        other grades' number games.
 *
 * cb.html's own step keeps only the Grade 1 battery and the number game's first list; this step is the whole set.
 * It ends by asking the worker which files are NOT on the device, and says so: "ready" is a count, not a hope. */
(window.CB_READY = window.CB_READY || []).push({
  name: 'the learning games',
  run: async (ctx) => {
    const { hub, kid, log, warm, frame, abs, ask, setPct } = ctx;
    const text = (u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : ''), () => '');
    const uniq = (l) => [...new Set(l.filter(Boolean))];
    const inChunks = async (urls, size, each) => { for (let i = 0; i < urls.length; i += size) await each(urls.slice(i, i + size), i); };
    const notKept = async (urls) => {
      let missing = [];
      await inChunks(urls, 300, async (c) => { const r = await ask({ type: 'check', urls: c }, 60000); missing = missing.concat(r && r.missing ? r.missing : c); });
      return missing;
    };
    const keep = async (urls, label, from, to) => {
      await inChunks(urls, 120, async (c, i) => {
        setPct(from + (to - from) * (i / Math.max(1, urls.length)), `Saving ${label} (${i} of ${urls.length})…`);
        const r = await warm(c);
        if (r && r.failed && r.failed.length) log(`${label}: ${r.failed.length} could not be saved (e.g. ${String(r.failed[0]).split('?')[0].split('/').slice(-3).join('/')})`);
      });
    };

    // ---- 0. one offline worker: Jugnu's own battery worker (scope /sa/) and its copies go ----
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.filter((r) => /\/sa\/$/.test(r.scope)).map((r) => r.unregister()));
      const names = await caches.keys();
      await Promise.all(names.filter((n) => /^sa-(core|session)-/.test(n)).map((n) => caches.delete(n)));
    } catch (e) { /* the stand-in at /sa/sw.js removes it on its next start */ }

    // ---- 1. Jugnu's big flight ----
    const ENGINE = ['play.html', 'sa-core.js', 'sa-store.js', 'sa-voice.js', 'sa-ui.js', 'sa-sync.js', 'sa-rec.js', 'sa-engine.js', 'sa-mic.js', 'sa-offline.js', 'sa-page.js',
      'sa.css', 'sink-coach.js', 'sink-game.js', 'skin-game.css', 'skin-game.js'].map((f) => abs('/sa/' + f));
    const ART = ['celebrate', 'correct', 'hello', 'idle', 'notyet', 'sleep', 'thinking'].flatMap((m) => [abs(`/wq/jugnu_${m}.webp`), abs(`/wq/jugnu/${m}.webp`)]);
    const KIT = ['/wq/wq-juice.js', '/wq/wq-juice.css', '/__cb/boot.js', '/__cb/sa-drain', '/__cb/cb-fit.css', '/__cb/games-read.js'].map(abs);
    // the engine and the pilot's own files are read again on every Get ready (a kept copy from before an update would
    // otherwise be what plays with no network); Jugnu's pictures only when they are not kept yet
    const core = ENGINE.concat(KIT);
    const got = await ask({ type: 'prepare', urls: core, fresh: core }, 120000);
    if (!got || !got.ok) log(`big flight: ${got ? got.missing.length : core.length} engine files could not be read again`);
    await warm(ART);
    // the engine's own list of what a battery can play and show (never a list of our own that could drift from it)
    if (!(window.SAE && window.SAE.offline)) await new Promise((ok) => { const s = document.createElement('script'); s.src = '/sa/sa-offline.js'; s.onload = s.onerror = ok; document.head.appendChild(s); });
    const O = window.SAE && window.SAE.offline;
    const FORMS = ['G1', 'G23', 'G45'].flatMap((g) => ['en', 'ur'].map((l) => ({ form: `sa.game.${g}.${l}`, lang: l, url: abs(`/sa/batteries/sa.game.${g}.${l}.json`), alt: abs(`/sa-game/b/game.${g}/${l}`) })));
    let files = [];
    let read = 0;
    for (const f of FORMS) {
      const t = await text(f.url);
      let b = null;
      try { b = JSON.parse(t); } catch (e) { b = null; }
      if (!b || !Array.isArray(b.tasks)) { log(`big flight: ${f.form} could not be read`); continue; }
      read += 1;
      const clips = O ? O.urls(b, f.lang, '/') : (t.match(/"(sa\/[^"]+?\.mp3)"/g) || []).map((x) => '/' + x.slice(1, -1));
      const pics = O ? O.images(b, f.lang) : [];
      files = files.concat([f.url, f.alt], clips.map(abs), pics.map(abs));
      f.clips = clips.length;
    }
    files = uniq(files);
    const timings = O ? uniq(O.timingUrls(files)) : [];
    await keep(files, "Jugnu's big flight", 95, 97);
    // the clips' word timings, best effort and quietly: only some clips have one, the battery does not say which, so
    // these go to the worker's own "keep these" (a 404 there is not a file Get ready meant to save)
    await inChunks(timings, 200, async (c) => { await ask({ type: 'prepare', urls: c }, 180000); });
    const missing = await notKept(files);
    if (missing.length) { await warm(missing); }
    const still = missing.length ? await notKept(missing) : [];
    log(`big flight: ${read} of ${FORMS.length} batteries, ${files.length} clips and pictures, ${still.length} not saved${still.length ? ' (' + still.slice(0, 3).map((u) => u.split('/').slice(-2).join('/')).join(', ') + '…)' : ''}`);
    // the sea map, in both languages (the worker keeps it per child and language)
    if (kid) for (const l of ['en', 'ur']) await frame(`/sa-game/${hub}?kid=${kid}&lang=${l}`, 3500);

    // ---- 2. Jugnu's Challenge: every game behind the Games door, this grade and the others ----
    // the home's language, as the Games door's own links carry it
    const L = (((ctx.games || []).join(' ').match(/[?&]lang=(en|ur)/) || [])[1]) || 'en';
    const media = (t) => uniq((t.match(/(https?:\/\/[^"'\s\\]+?\.(?:mp3|ogg|opus|webp|png|jpg)(?:\?[^"'\s\\]*)?|\/(?:wq|sa|s)\/[^"'\s\\]+?\.(?:mp3|ogg|opus|webp|png|jpg|json))/g) || []).map((x) => x.replace(/\\u0026/g, '&').replace(/\\\//g, '/')));
    let pages = [];
    let api = [];
    for (const g of ['', 'all']) {
      const rows = await text(`/api/wq/doors/h/${hub}?kid=${kid || ''}&d=games&l=${L}${g ? '&g=' + g : ''}`);
      let j = null;
      try { j = JSON.parse(rows); } catch (e) { j = null; }
      for (const r of (j && j.games) || []) {
        if (r.kind === 'bigtest') continue;
        // another grade's game carries its own link (a practice play); this child's own games are on the child's page
        const base = r.href ? r.href.split('#')[0] : `/c/${hub}?kid=${kid || ''}&lang=${L}&home=1`;
        const tok = (base.match(/^\/c\/([^?]+)/) || [])[1];
        if (!tok) continue;
        const q = base.indexOf('?') >= 0 ? base.slice(base.indexOf('?')) : '';
        const kq = `?lang=${L}` + ((q.match(/[?&]kid=([0-9a-f]+)/) || [])[1] ? '&kid=' + q.match(/[?&]kid=([0-9a-f]+)/)[1] : '');
        if (r.kind === 'numbers' || r.kind === 'read') { pages.push(base); api.push(`/api/wq/ch/${tok}${kq}`); if (r.stop) api.push(`/api/wq/ch/${tok}/${r.stop}${kq}`); }
        if ((r.kind === 'passage' || r.kind === 'listen') && r.id) {
          pages.push(`${base}&room=story&pid=${encodeURIComponent(r.id)}${r.kind === 'listen' ? '&ex=listen' : ''}`);
          api.push(`/api/wq/ch/${tok}/${r.kind === 'listen' ? 'listen' : 'read'}${kq}&room=story&pid=${encodeURIComponent(r.id)}`);
        }
      }
    }
    pages = uniq(pages); api = uniq(api);
    // a Grade 1 child's one stop is not named in the door's rows
    if (kid && !api.some((u) => /\/(numbers|missing|bigger)\?/.test(u))) api.push(`/api/wq/ch/${hub}/numbers?lang=${L}&kid=${kid}`);
    setPct(98, `Saving the number and story games (${pages.length})…`);
    for (const p of pages) await frame(p, 3000);
    // an exercise already kept is not asked for again: every ask is a serve on the server (a second serve of the
    // Grade 1 dots is a practice run, and the first one's record is then never played)
    const fresh = await notKept(api.map(abs));
    let named = [];
    for (const u of api) named = named.concat(media(fresh.indexOf(abs(u)) >= 0 ? await text(u) : await fetch(u).then((r) => r.text(), () => '')));
    named = uniq(named).map(abs);
    await keep(named, 'the games\' voices', 98, 99);
    await warm(['/wq/wq-g1.js', '/wq/wq-trail.js', '/wq/wq-challenge.js', '/wq/wq-read-live.js', '/wq/wq-liveread.js', '/wq/wq-liveread.css', '/wq/wq-readalong.js', '/wq/wq-pace.js', '/wq/wq-pace.css', '/wq/wq-moment.js', '/wq/wq-moment.css'].map(abs));
    const gone = await notKept(named);
    log(`number and story games: ${pages.length} pages, ${api.length} exercises, ${named.length} clips and pictures, ${gone.length} not saved`);
    try { localStorage.setItem('cb-games-ready', JSON.stringify({ at: new Date().toISOString(), batteries: read, flight_files: files.length, flight_missing: still.length, ch_pages: pages.length, ch_files: named.length, ch_missing: gone.length })); } catch (e) { /* a note only */ }
  },
});
