/* Get-ready step: lesson videos (lane/home, bd-fc5mgd.13.3).
 *
 * Behind the Videos door each lesson is a video (3-15 MB, a signed link on another site, good for 6 hours) followed by
 * its quiz. For every class ticked on the start page this saves, lesson by lesson:
 *   - the door's own lists (subjects, then each subject's lessons), in English and Urdu
 *   - the lesson's page (/q/<code>?k=…&via=videos), which carries the quiz; a lesson that has no page yet gets one
 *     (POST /api/wq/videos/start, what a child's first tap does)
 *   - the video itself, whole, through this site (so it can be played and scrubbed from the saved copy)
 *   - the lesson's picture and the voice clips of its quiz
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
      (c.videos || []).forEach(function (v) { out.push({ vid: v.vid, title: v.title || '', mb: v.mb || 0, code: v.code || null, k: v.k || null, thumb: v.thumb || null, poster: v.poster || null, art: c.art || null, subject: subject }); });
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
    var json = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('the list did not load (' + r.status + ')'); return r.json(); }); };
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
      // 2. a page for each lesson that has none yet (a child's first tap makes it; here it is made ahead)
      var bare = lessons.filter(function (v) { return !v.code; });
      for (var bi = 0; bi < bare.length; bi += 1) {
        ctx.setPct(null, label + ': preparing lesson pages, ' + (bi + 1) + ' of ' + bare.length);
        var made = await fetch('/api/wq/videos/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hub: ctx.hub, kid: ctx.kid, vid: bare[bi].vid }) }).then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; });
        if (made.code && made.k) { bare[bi].code = made.code; bare[bi].k = made.k; }
      }
      // 3. the lists as the door will ask for them, both languages, saved afresh (they now name every lesson's page)
      var lists = [];
      (g === own ? [g, null] : [g]).forEach(function (as) {
        LANGS.forEach(function (l) { lists.push(libUrl(ctx.hub, ctx.kid, l, as)); subjects.forEach(function (s) { lists.push(libUrl(ctx.hub, ctx.kid, l, as, s)); }); });
      });
      var pics = [];
      lessons.forEach(function (v) { [v.thumb, v.poster, v.art].forEach(function (u) { if (u && pics.indexOf(u) < 0) pics.push(u); }); });
      await ctx.warm(lists.map(ctx.abs), { fresh: true, each: quiet.each });
      await ctx.warm(pics.map(ctx.abs), { readable: true, each: quiet.each });
      // 4. MEASURE, lesson by lesson (six at a time): its page, the video it names, and that video's real length: the
      //    file on the drive when it is kept, else its length on the server, asked for with one byte (the worker's
      //    `size`). A lesson this step saved before is checked against the drive here too: if its page, its video or
      //    a clip has gone, it is saved again.
      var have = lsJson('cb-videos-' + g, []), measured = 0;
      await pool(lessons, 6, async function (v) {
        var at = have.indexOf(v.vid), was = at >= 0;
        v.bytes = null; v.onDrive = false; v.clipBytes = 0; v.m = null;
        if (v.code && v.k) {
          var html = was ? await ctx.ask({ type: 'kept-text', url: ctx.abs(pageUrl(v)) }, 15000) : null;
          if (!html) { html = await page(v); if (!html) { await ctx.waitOnline(); html = await page(v); } }
          var m = html ? mediaOf(html) : null;
          if (m && m.video.length) {
            v.m = m;
            var sz = await ctx.ask({ type: 'size', urls: m.video.slice(0, 1).concat(was ? m.clips : []) }, 90000);
            if (Array.isArray(sz) && sz[0]) { v.bytes = sz[0].bytes; v.onDrive = !!sz[0].kept; }
            if (was && Array.isArray(sz) && sz.every(function (x) { return x && x.kept; })) v.clipBytes = sum(sz.slice(1), function (x) { return x.bytes; });
            else if (was) was = false;
          } else was = false;
        } else was = false;
        if (!was && at >= 0) have.splice(have.indexOf(v.vid), 1);
        measured += 1;
        if (measured % 6 === 0 || measured === lessons.length) ctx.setPct(null, label + ': measuring lessons, ' + measured + ' of ' + lessons.length);
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
      // 5. room for the whole class? What is still to fetch: each video not on the drive at its real length, about
      //    1.3 MB a lesson for its quiz voices and page (measured: 1.05 MB), and a reserve that is never used.
      //    The browser itself is asked whether that many bytes fit (ctx.fits): what navigator.storage.estimate()
      //    calls free is "10 GB" on every Chromebook, whatever its drive holds. Only a browser that cannot be asked is
      //    judged by the estimate.
      var left = lessons.filter(function (v) { return have.indexOf(v.vid) < 0; });
      var need = sum(left, function (v) { return v.onDrive ? 0 : v.bytes; }) + CLIPS * left.length + RESERVE;
      var sp = await ctx.space();
      var fit = left.length && typeof ctx.fits === 'function' ? await ctx.fits(need) : null;
      var room = sp.room != null ? sp.room : sp.free;
      if (left.length && (fit === false || (fit == null && sp.free != null && need > sp.free))) {
        // Not started: nothing of a class that does not fit is fetched. The next class may be smaller and fit.
        problems.push(name + ' needs ' + mb(need / 1e6) + ', this Chromebook has room for ' + mb(room / 1e6));
        record('no room'); ctx.note('cb-videos', summary);
        ctx.log('lesson videos, ' + name + ': not saved: it needs ' + mb(need / 1e6) + ' (' + left.length + ' lessons, ' + mb(sum(left, function (v) { return v.bytes; }) / 1e6) + ' of video) and this Chromebook has room for ' + mb(room / 1e6));
        continue;
      }
      // 6. lesson by lesson (three at a time): its page, its video, its pictures, its quiz clips
      var stopped = false;
      var saveOne = async function (v, m) {
        var r1 = await ctx.warm([ctx.abs(pageUrl(v))].concat(m.pics), { readable: true, each: quiet.each });
        // the video and its ~90 small quiz clips side by side (the clips are many and tiny: six at a time)
        var both = await Promise.all([ctx.warm(m.video, { readable: true, lanes: 1, each: quiet.each }), ctx.warm(m.clips, { readable: true, lanes: 6, batch: 30, each: quiet.each })]);
        return !r1.failed.length && !both[0].failed.length && !both[0].gone.length && !both[1].failed.length;
      };
      var one = async function (v) {
        if (!v.code || !v.k || !v.m) return false;
        var ok = await saveOne(v, v.m);
        if (!ok && !ctx.isFull()) {
          // its links may have run out since they were read (they last 6 hours): the page again, fresh links, once
          await ctx.waitOnline();
          var html = await page(v), m = html ? mediaOf(html) : null;
          if (m && m.video.length) { v.m = m; ok = await saveOne(v, m); }
        }
        if (!ok) return false;
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
        lessons.forEach(function (v) { if (v.m) gone = gone.concat([ctx.abs(pageUrl(v))], v.m.video, v.m.clips); });
        if (typeof ctx.forget === 'function') await ctx.forget(gone);
        have = [];
        localStorage.setItem('cb-videos-' + g, '[]');
        record('no room'); ctx.note('cb-videos', summary);
        problems.push(name + ': the drive filled up; nothing of ' + name + ' is kept');
        ctx.log('lesson videos, ' + name + ': the drive filled up while saving it; what was saved of it has been taken off again');
        break;
      }
      record(); ctx.note('cb-videos', summary);
      if (have.length < lessons.length) problems.push(name + ': ' + (lessons.length - have.length) + ' of ' + lessons.length + ' lessons not saved yet');
      var fetchedNow = left.filter(function (v) { return have.indexOf(v.vid) >= 0; }).length;
      var mins = Math.round((Date.now() - began) / 6000) / 10;
      ctx.log('lesson videos, ' + name + ': ' + have.length + ' of ' + lessons.length + ' lessons on this Chromebook (' + mb(summary[g].mb) + ' of video, ' + mb(summary[g].clips_mb) + ' of quiz voices)' +
        (fetchedNow ? '; ' + fetchedNow + ' saved now in ' + mins + ' min' : '; all were here already'));
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
        if (!v.code || !v.k) { rows.push({ group: group, name: name, ok: false, why: 'no lesson page was made' }); continue; }
        var html = await t.read(pageUrl(v));
        if (!html) { rows.push({ group: group, name: name, ok: false, why: 'its page is not saved' }); continue; }
        var m = mediaOf(html);
        if (!m.video.length) { rows.push({ group: group, name: name, ok: false, why: 'its page names no video' }); continue; }
        var played = await t.media(name, m.video[0], 'video');
        var clips = m.clips.length ? await t.have(m.clips) : [];
        var gone = (clips || []).filter(function (x) { return !x; }).length;
        rows.push({ group: group, name: name, ok: played.ok && !gone, why: !played.ok ? 'the video ' + (played.why || 'did not open') : gone ? gone + ' of ' + m.clips.length + ' quiz clips missing' : '' });
      }
    }
    return rows;
  }

  (window.CB_READY = window.CB_READY || []).push({ name: 'lesson videos', late: true, resumes: true, run: run, check: check });
}());
