/* Get-ready step: lesson videos (lane/home, bd-fc5mgd.13.3).
 *
 * Behind the Videos door each lesson is a video (3-15 MB, a signed link on another site, good for 6 hours) followed by
 * its quiz. For every class ticked on the start page this saves, lesson by lesson:
 *   - the door's own lists (subjects, then each subject's lessons), in English and Urdu
 *   - the lesson, the way Jugnu gives it to this child. A lesson the list names no page for is started (POST
 *     /api/wq/videos/start, what a child's first tap does) and Jugnu answers one of two things:
 *       {code, k}  a child with a class code: the lesson's page (/q/<code>?k=…&via=videos), which carries the quiz
 *       {watch}    a child with none: the video alone, played in the home itself
 *   - the video itself, whole, through this site (so it can be played and scrubbed from the saved copy)
 *   - the lesson's picture, and with a page the voice clips of its quiz
 *   - a record of the lesson on the drive (the worker's /__cb/watch/<vid>): where its video is, its picture, its
 *     name. The record is what "saved" means: next time a lesson is whole when its record, its video and (with a
 *     page) its page and clips are all on the drive, whatever today's list says. And with no network the worker
 *     plays a saved lesson from it whichever way the list points (pilot-sw.js: A LESSON AS A VIDEO ALONE).
 *     Which of the two a child gets changes: Jugnu looks at the child's 18 newest quiz codes, and the lesson pages
 *     read here push the class quiz out of that view (18 Nov 2026: Classes 1 to 4 came as pages, Class 5 as videos).
 * A class is saved only if this Chromebook has room for all of it (it says how much is needed and how much there is).
 * It runs after "Ready" is said (late), carries on where it stopped, and never saves a lesson twice.
 *
 * Its check (Check this Chromebook) opens every saved lesson's video from the saved copy with a real player. */
(function () {
  'use strict';
  var LANGS = ['en', 'ur'];
  var RESERVE = 300e6; // left free on the drive whatever happens
  var CLIPS = 1.3e6;   // a lesson's ~90 quiz voice clips and its page: 1.05 MB a lesson measured on Class 2, with a margin
  // Which classes, when no teacher has chosen (operator, 18 Nov 2026): every Chromebook keeps the lesson videos of
  // Classes 1 to 5, about 4.6 GB, saved after everything else. A teacher can untick a class on the start page.
  var DEFAULT = ['1', '2', '3', '4', '5'];
  var MEDIA = /https?:\/\/[^"'\s\\<>]+?\.(mp4|webm|m4v|mov|mp3|m4a|ogg|opus|wav|webp|png|jpe?g)(?:\?[^"'\s\\<>]*)?/g;
  var lsJson = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  var mb = function (n) { return n >= 1000 ? (n / 1000).toFixed(1) + ' GB' : Math.round(n) + ' MB'; };
  var libUrl = function (hub, kid, lang, grade, subject) {
    // exactly the address the Videos door asks for (wq-doors.js libUrl): a saved copy is found by its exact address.
    // `grade` null: the home child's own class, which the door asks for with no "g". Which class that is can change
    // (Jugnu works it out from what the child last did), so every class is ALSO saved under its own "g=<class>", and
    // Who's playing? always sets the door to the picked child's class by name.
    return '/api/wq/lib/h/' + encodeURIComponent(hub) + '?kid=' + encodeURIComponent(kid || '') + '&l=' + lang + (grade == null ? '' : '&g=' + encodeURIComponent(grade)) + (subject ? '&s=' + encodeURIComponent(subject) : '');
  };
  var pageUrl = function (v) { return '/q/' + encodeURIComponent(v.code) + '?k=' + encodeURIComponent(v.k) + '&via=videos'; };
  /** The media a lesson's page names: its video, its pictures, its clips (addresses as the page wrote them). */
  function mediaOf(html) {
    var out = { video: [], clips: [], pics: [] }, seen = {}, m;
    var t = String(html).replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/\\\//g, '/');
    MEDIA.lastIndex = 0;
    while ((m = MEDIA.exec(t))) {
      var u = m[0], path = u.split('?')[0];
      if (seen[path]) continue;
      seen[path] = 1;
      if (/^(mp4|webm|m4v|mov)$/.test(m[1])) out.video.push(u); else if (/^(mp3|m4a|ogg|opus|wav)$/.test(m[1])) out.clips.push(u); else out.pics.push(u);
    }
    return out;
  }
  function lessonsOf(list, subject) {
    var out = [];
    ((list && list.chapters) || []).forEach(function (c) {
      (c.videos || []).forEach(function (v) { out.push({ vid: v.vid, title: v.title || '', secs: v.secs || 0, mb: v.mb || 0, code: v.code || null, k: v.k || null, thumb: v.thumb || null, poster: v.poster || null, art: c.art || null, subject: subject }); });
    });
    return out;
  }

  /** Run fn over the items, n at a time. */
  function pool(items, n, fn) {
    var at = 0;
    var lane = async function () { while (at < items.length) { var i = at; at += 1; await fn(items[i], i); } };
    var lanes = [];
    for (var k = 0; k < n; k += 1) lanes.push(lane());
    return Promise.all(lanes);
  }

  async function run(ctx) {
    // (a list is read without being kept: a class's lists go on the drive when the class is on the drive, see 7)
    var json = function (u) { return fetch(u, { headers: { 'X-CB-Keep': 'no' } }).then(function (r) { if (!r.ok) throw new Error('the list did not load (' + r.status + ')'); return r.json(); }); };
    var sum = function (xs, f) { return xs.reduce(function (a, x) { return a + (f(x) || 0); }, 0); };
    if (!ctx.kid) throw new Error('no child id: the child home did not open');
    var top = await json(libUrl(ctx.hub, ctx.kid, 'en', null));
    var own = String(top.grade);
    var grades = (top.grades || []).map(function (x) { return String(x.g); });
    ctx.note('cb-home-grade', own);
    ctx.note('cb-video-all', grades); // every class Jugnu has lessons for can be ticked on the start page
    // Every class's lesson count, for the ticks on the start page. Its size is written only once it has been
    // MEASURED (below): Jugnu's lists carry a size just for lessons it happened to look at lately, so a class can
    // come with none at all, and a size that is not there must never be shown, or counted, as 0.
    var sizes = lsJson('cb-video-sizes', {}), summary = lsJson('cb-videos', {}), problems = [];
    (top.grades || []).forEach(function (x) { var g = String(x.g), had = sizes[g]; sizes[g] = had && had.measured ? { n: x.n, mb: had.mb, measured: true } : { n: x.n }; });
    ctx.note('cb-video-sizes', sizes);
    var chosen = ctx.videoGrades(); // null: no teacher has chosen
    var want = (chosen == null ? DEFAULT : chosen.map(String)).filter(function (g) { return grades.indexOf(g) >= 0; });
    if (!want.length) return 'no class ticked';
    var quiet = { each: function () {} };
    // A lesson's page read only to find its video is not kept (X-CB-Keep: no): a page is kept WITH its video, so a
    // class that turns out not to fit leaves no pages behind, and no saved page ever stands without its video.
    var page = function (v) { return fetch(pageUrl(v), { headers: { 'X-CB-Keep': 'no' } }).then(function (r) { return r.ok ? r.text() : ''; }, function () { return ''; }); };

    for (var gi = 0; gi < want.length; gi += 1) {
      var g = want[gi];
      var began = Date.now();
      var name = 'Class ' + g;
      var label = name + (want.length > 1 ? ' (' + (gi + 1) + ' of ' + want.length + ')' : '');
      ctx.setPct(null, label + ': reading the lists…');
      // 1. the lists
      var subjects = ((await json(libUrl(ctx.hub, ctx.kid, 'en', g))).subjects || []).map(function (s) { return s.key; });
      var lessons = [];
      for (var si = 0; si < subjects.length; si += 1) lessons = lessons.concat(lessonsOf(await json(libUrl(ctx.hub, ctx.kid, 'en', g, subjects[si])), subjects[si]));
      // 2. the lists as the door will ask for them, both languages, and the lessons' pictures: named here, saved in
      //    7, once every lesson of the class is on the drive
      var lists = [];
      (g === own ? [g, null] : [g]).forEach(function (as) {
        LANGS.forEach(function (l) { lists.push(libUrl(ctx.hub, ctx.kid, l, as)); subjects.forEach(function (s) { lists.push(libUrl(ctx.hub, ctx.kid, l, as, s)); }); });
      });
      var pics = [];
      lessons.forEach(function (v) { [v.thumb, v.poster, v.art].forEach(function (u) { if (u && pics.indexOf(u) < 0) pics.push(u); }); });
      // 3. WHAT IS HERE ALREADY (six at a time). A lesson is whole when its record is on the drive, the video the
      //    record names is on the drive, and, for a lesson with a page, the page and every quiz clip it names are
      //    too. Today's list is not asked: it names a page or not as Jugnu sees the child today.
      var measured = 0;
      var recUrl = function (vid) { return ctx.abs('/__cb/watch/' + encodeURIComponent(vid)); };
      var tick = function (what) { measured += 1; if (measured % 6 === 0 || measured === lessons.length) ctx.setPct(null, label + ': ' + what + ', ' + measured + ' of ' + lessons.length); };
      await pool(lessons, 6, async function (v) {
        v.bytes = null; v.onDrive = false; v.clipBytes = 0; v.m = null; v.whole = false; v.files = [];
        var txt = await ctx.ask({ type: 'kept-text', url: recUrl(v.vid) }, 15000);
        var rec = null; try { rec = txt ? JSON.parse(txt) : null; } catch (e) { rec = null; }
        if (rec && rec.url) {
          var clips = [], html = rec.page ? await ctx.ask({ type: 'kept-text', url: ctx.abs(rec.page) }, 15000) : null;
          if (rec.page && html) clips = mediaOf(html).clips;
          if (!rec.page || html) {
            var here = await ctx.ask({ type: 'size', urls: [rec.url].concat(clips) }, 90000);
            if (Array.isArray(here) && here.length && here.every(function (x) { return x && x.kept; })) {
              v.whole = true; v.onDrive = true; v.bytes = here[0].bytes; v.clipBytes = sum(here.slice(1), function (x) { return x.bytes; });
              v.files = [rec.url].concat(clips, rec.page ? [ctx.abs(rec.page)] : [], [recUrl(v.vid)]);
            }
          }
        }
        tick('looking at what is saved');
      });
      var have = lessons.filter(function (v) { return v.whole; }).map(function (v) { return v.vid; });
      var rest = lessons.filter(function (v) { return !v.whole; });
      // 4. the rest. A lesson the list names no page for is started, as a child's first tap does (a lesson that is
      //    whole is never started again: Jugnu counts a start as the child watching).
      var startLesson = function (v) {
        return fetch('/api/wq/videos/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hub: ctx.hub, kid: ctx.kid, vid: v.vid }) })
          .then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; }).then(function (j) { return j || {}; });
      };
      var watchMedia = function (w) { return { video: [w.url], clips: [], pics: w.poster ? [w.poster] : [] }; };
      var bare = rest.filter(function (v) { return !v.code; });
      for (var bi = 0; bi < bare.length; bi += 1) {
        ctx.setPct(null, label + ': preparing lessons, ' + (bi + 1) + ' of ' + bare.length);
        var made = await startLesson(bare[bi]);
        if (made.code && made.k) { bare[bi].code = made.code; bare[bi].k = made.k; } else if (made.watch && made.watch.url) bare[bi].watch = made.watch;
      }
      // 5. MEASURE each of them (six at a time): the video it names (on its page, or in the start's answer) and that
      //    video's real length: the file on the drive when it is there, else its length on the server, asked for
      //    with one byte (the worker's `size`).
      measured = have.length;
      await pool(rest, 6, async function (v) {
        var m = null;
        if (v.code && v.k) {
          var html = await page(v);
          if (!html) { await ctx.waitOnline(); html = await page(v); }
          m = html ? mediaOf(html) : null;
          if (m && !m.video.length) m = null;
        } else if (v.watch) m = watchMedia(v.watch);
        if (m) {
          v.m = m;
          var sz = await ctx.ask({ type: 'size', urls: m.video.slice(0, 1) }, 90000);
          if (Array.isArray(sz) && sz[0]) { v.bytes = sz[0].bytes; v.onDrive = !!sz[0].kept; }
        }
        tick('measuring lessons');
      });
      localStorage.setItem('cb-videos-' + g, JSON.stringify(have));
      // A length that could not be read (the server did not answer): the list's own size if it has one, else the
      // average of the lessons that were read. Said plainly, never passed off as measured.
      var known = lessons.filter(function (v) { return v.bytes != null; });
      var unread = lessons.length - known.length;
      var avg = known.length ? sum(known, function (v) { return v.bytes; }) / known.length : 12e6;
      lessons.forEach(function (v) { if (v.bytes == null) v.bytes = v.mb ? v.mb * 1e6 : avg; });
      var total = sum(lessons, function (v) { return v.bytes; });
      sizes[g] = unread ? { n: lessons.length, mb: Math.round(total / 1e6) } : { n: lessons.length, mb: Math.round(total / 1e6), measured: true };
      ctx.note('cb-video-sizes', sizes);
      if (unread) ctx.log('lesson videos, ' + name + ': the length of ' + unread + ' of ' + lessons.length + ' videos could not be read; their size is an estimate');
      var keptOf = function () { return { video: sum(lessons, function (v) { return have.indexOf(v.vid) >= 0 ? v.bytes : 0; }), clips: sum(lessons, function (v) { return have.indexOf(v.vid) >= 0 ? v.clipBytes : 0; }) }; };
      var record = function (why) {
        var k = keptOf();
        summary[g] = { n: lessons.length, saved: have.length, mb: Math.round(k.video / 1e6), clips_mb: Math.round(k.clips / 1e6), of_mb: Math.round(total / 1e6) };
        if (why) summary[g].why = why;
      };
      // 6. room for the whole class? What is still to fetch: each video not on the drive at its real length, about
      //    1.3 MB a lesson for its quiz voices and page (measured: 1.05 MB), and a reserve that is never used.
      //    (A lesson whose video is on the drive already, saved by this step as it was before, costs nothing.)
      //    The browser itself is asked whether that many bytes fit (ctx.fits): what navigator.storage.estimate()
      //    calls free is "10 GB" on every Chromebook, whatever its drive holds. Only a browser that cannot be asked is
      //    judged by the estimate.
      var left = lessons.filter(function (v) { return have.indexOf(v.vid) < 0; });
      var toFetch = left.filter(function (v) { return !v.onDrive; });
      var need = toFetch.length ? sum(toFetch, function (v) { return v.bytes; }) + CLIPS * toFetch.length + RESERVE : 0;
      var sp = await ctx.space();
      var fit = toFetch.length && typeof ctx.fits === 'function' ? await ctx.fits(need) : null;
      var room = sp.room != null ? sp.room : sp.free;
      if (toFetch.length && (fit === false || (fit == null && sp.free != null && need > sp.free))) {
        // Not started: nothing of a class that does not fit is fetched. The next class may be smaller and fit.
        problems.push(name + ' needs ' + mb(need / 1e6) + ', this Chromebook has room for ' + mb(room / 1e6));
        record('no room'); ctx.note('cb-videos', summary);
        ctx.log('lesson videos, ' + name + ': not saved: it needs ' + mb(need / 1e6) + ' (' + left.length + ' lessons, ' + mb(sum(left, function (v) { return v.bytes; }) / 1e6) + ' of video) and this Chromebook has room for ' + mb(room / 1e6));
        continue;
      }
      // 7. lesson by lesson (three at a time): its page (when it has one), its video, its pictures, its quiz clips,
      //    and last its record: a lesson with a record on the drive is a lesson that is whole
      var stopped = false;
      var lasting = function (u) { return u && /^https?:/.test(u) ? u.split('?')[0] : u || null; }; // (a signed link runs out in hours)
      var recOf = function (v) {
        var w = v.watch || {};
        var rec = { vid: v.vid, url: lasting(v.m.video[0]), poster: lasting(w.poster || v.poster || v.thumb), secs: w.secs || v.secs || 0, title: w.title || v.title || '', lang: w.lang || 'en', after: false };
        if (w.title_ur) rec.title_ur = w.title_ur;
        if (v.code && v.k) rec.page = pageUrl(v);
        return rec;
      };
      var saveOne = async function (v, m) {
        var first = (v.code && v.k ? [ctx.abs(pageUrl(v))] : []).concat(m.pics);
        var r1 = first.length ? await ctx.warm(first, { readable: true, each: quiet.each }) : { failed: [] };
        // the video and its ~90 small quiz clips side by side (the clips are many and tiny: six at a time)
        var both = await Promise.all([ctx.warm(m.video, { readable: true, lanes: 1, each: quiet.each }), m.clips.length ? ctx.warm(m.clips, { readable: true, lanes: 6, batch: 30, each: quiet.each }) : { failed: [] }]);
        if (r1.failed.length || both[0].failed.length || (both[0].gone || []).length || both[1].failed.length) return false;
        return (await ctx.ask({ type: 'watch-keep', recs: [recOf(v)] }, 15000)) === 1;
      };
      var one = async function (v) {
        if (!v.m) return false;
        var ok = await saveOne(v, v.m);
        if (!ok && !ctx.isFull()) {
          // its links may have run out since they were read (they last 6 hours): fresh links, once
          await ctx.waitOnline();
          var m = null;
          if (v.code && v.k) { var html = await page(v); m = html ? mediaOf(html) : null; if (m && !m.video.length) m = null; }
          else { var again = await startLesson(v); if (again.watch && again.watch.url) { v.watch = again.watch; m = watchMedia(again.watch); } }
          if (m) { v.m = m; ok = await saveOne(v, m); }
        }
        if (!ok) return false;
        v.files = v.m.video.concat(v.m.clips, v.code && v.k ? [ctx.abs(pageUrl(v))] : [], [recUrl(v.vid)]);
        // what is now on the drive, read back from the drive
        var sz = await ctx.ask({ type: 'size', urls: v.m.video.slice(0, 1).concat(v.m.clips) }, 90000);
        if (!Array.isArray(sz) || !sz[0] || !sz[0].kept) return false;
        v.bytes = sz[0].bytes; v.clipBytes = sum(sz.slice(1), function (x) { return x && x.kept ? x.bytes : 0; });
        return true;
      };
      var said = function () { var k = keptOf(); ctx.setPct(100 * (gi + (total ? k.video / total : have.length / Math.max(1, lessons.length))) / want.length, label + ': ' + have.length + ' of ' + lessons.length + ' lessons (' + mb(k.video / 1e6) + ' of ' + mb(total / 1e6) + ')'); };
      said();
      await pool(left, 3, async function (v) {
        if (stopped) return;
        var ok = await one(v);
        if (ctx.isFull()) { stopped = true; return; }
        if (ok) {
          have.push(v.vid);
          localStorage.setItem('cb-videos-' + g, JSON.stringify(have));
          record();
          if (have.length % 5 === 0) ctx.note('cb-videos', summary);
        }
        said();
      });
      if (ctx.isFull()) {
        // The drive itself refused a write, though the browser had said the class would fit (a page cannot see how
        // full the drive is). A class is kept whole or not at all: what was kept of this one is taken off again, and
        // no further class is started.
        var gone = [];
        lessons.forEach(function (v) { gone = gone.concat(v.files || []); if (v.m) gone = gone.concat(v.m.video, v.m.clips, v.code && v.k ? [ctx.abs(pageUrl(v))] : [], [recUrl(v.vid)]); });
        if (typeof ctx.forget === 'function') await ctx.forget(gone);
        have = [];
        localStorage.setItem('cb-videos-' + g, '[]');
        record('no room'); ctx.note('cb-videos', summary);
        problems.push(name + ': the drive filled up; nothing of ' + name + ' is kept');
        ctx.log('lesson videos, ' + name + ': the drive filled up while saving it; what was saved of it has been taken off again');
        break;
      }
      // 8. the class is whole: its lists (saved afresh) and pictures go on the drive, so the Videos door shows it with
      //    no network. A class that is not whole leaves no list of lessons that would not play.
      if (have.length === lessons.length) {
        await ctx.warm(lists.map(ctx.abs), { fresh: true, each: quiet.each });
        await ctx.warm(pics.map(ctx.abs), { readable: true, each: quiet.each });
      }
      record(); ctx.note('cb-videos', summary);
      if (have.length < lessons.length) problems.push(name + ': ' + (lessons.length - have.length) + ' of ' + lessons.length + ' lessons not saved yet');
      var fetchedNow = left.filter(function (v) { return have.indexOf(v.vid) >= 0; }).length;
      var mins = Math.round((Date.now() - began) / 6000) / 10;
      ctx.log('lesson videos, ' + name + ': ' + have.length + ' of ' + lessons.length + ' lessons on this Chromebook (' + mb(summary[g].mb) + ' of video, ' + mb(summary[g].clips_mb) + ' of quiz voices)' +
        (fetchedNow ? '; ' + fetchedNow + ' saved now in ' + mins + ' min' : have.length === lessons.length ? '; all were here already' : ''));
    }
    if (problems.length) throw new Error(problems.join('; '));
    return want.map(function (g) { return 'Class ' + g + ': ' + summary[g].saved + ' lessons, ' + mb(summary[g].mb); }).join('; ');
  }

  /* Check this Chromebook: every saved lesson, from the saved copy alone. Its page must be there, its video must open
   * in a real player (its length is read), and its quiz clips must be on the drive. */
  async function check(t) {
    var rows = [], hub = t.hub(), kid = t.kid();
    var summary = t.lsJson('cb-videos', {});
    var gs = Object.keys(summary).filter(function (g) { return summary[g] && summary[g].saved; });
    if (!hub || !gs.length) return [];
    for (var gi = 0; gi < gs.length; gi += 1) {
      var g = gs[gi], group = 'Lesson videos, Class ' + g;
      var top = await t.read(libUrl(hub, kid, 'en', g));
      if (!top) { rows.push({ group: group, name: 'the list of subjects', ok: false, why: 'not saved' }); continue; }
      var subjects = (JSON.parse(top).subjects || []).map(function (s) { return s.key; });
      var lessons = [];
      for (var si = 0; si < subjects.length; si += 1) {
        var body = await t.read(libUrl(hub, kid, 'en', g, subjects[si]));
        if (!body) { rows.push({ group: group, name: subjects[si] + ' lessons list', ok: false, why: 'not saved' }); continue; }
        lessons = lessons.concat(lessonsOf(JSON.parse(body), subjects[si]));
        if (!(await t.read(libUrl(hub, kid, 'ur', g, subjects[si])))) rows.push({ group: group, name: subjects[si] + ' lessons list (Urdu)', ok: false, why: 'not saved' });
      }
      for (var i = 0; i < lessons.length; i += 1) {
        var v = lessons[i], name = v.subject + ': ' + v.title;
        t.say(group + ': lesson ' + (i + 1) + ' of ' + lessons.length + '…');
        // the lesson's record on the drive says where its video is, and whether it has a page (with its quiz)
        var txt = await t.read('/__cb/watch/' + encodeURIComponent(v.vid)), rec = null;
        try { rec = txt ? JSON.parse(txt) : null; } catch (e) { rec = null; }
        if (!rec || !rec.url) { rows.push({ group: group, name: name, ok: false, why: 'not saved (no record of it on this Chromebook)' }); continue; }
        var m = { clips: [] };
        if (rec.page) {
          var html = await t.read(rec.page);
          if (!html) { rows.push({ group: group, name: name, ok: false, why: 'its page is not saved' }); continue; }
          m = mediaOf(html);
        }
        var played = await t.media(name, rec.url, 'video');
        var clips = m.clips.length ? await t.have(m.clips) : [];
        var gone = (clips || []).filter(function (x) { return !x; }).length;
        rows.push({ group: group, name: name, ok: played.ok && !gone, why: !played.ok ? 'the video ' + (played.why || 'did not open') : gone ? gone + ' of ' + m.clips.length + ' quiz clips missing' : '' });
      }
    }
    return rows;
  }

  (window.CB_READY = window.CB_READY || []).push({ name: 'lesson videos', late: true, resumes: true, run: run, check: check });
}());
