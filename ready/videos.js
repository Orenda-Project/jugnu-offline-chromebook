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
  var MEDIA = /https?:\/\/[^"'\s\\<>]+?\.(mp4|webm|m4v|mov|mp3|m4a|ogg|opus|wav|webp|png|jpe?g)(?:\?[^"'\s\\<>]*)?/g;
  var lsJson = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  var mb = function (n) { return n >= 1000 ? (n / 1000).toFixed(1) + ' GB' : Math.round(n) + ' MB'; };
  var libUrl = function (hub, kid, lang, grade, own, subject) {
    // exactly the address the Videos door asks for (wq-doors.js libUrl): a saved copy is found by its exact address
    return '/api/wq/lib/h/' + encodeURIComponent(hub) + '?kid=' + encodeURIComponent(kid || '') + '&l=' + lang + (String(grade) !== String(own) ? '&g=' + encodeURIComponent(grade) : '') + (subject ? '&s=' + encodeURIComponent(subject) : '');
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

  async function run(ctx) {
    var json = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('the list did not load (' + r.status + ')'); return r.json(); }); };
    if (!ctx.kid) throw new Error('no child id: the child home did not open');
    var top = await json(libUrl(ctx.hub, ctx.kid, 'en', '', ''));
    var own = String(top.grade);
    var grades = (top.grades || []).map(function (x) { return String(x.g); });
    ctx.note('cb-home-grade', own);
    if (!lsJson('cb-video-all', []).length) ctx.note('cb-video-all', grades); // no class list on this Chromebook: every grade can be ticked
    var want = ctx.videoGrades().map(String).filter(function (g) { return grades.indexOf(g) >= 0; });
    if (!want.length) return 'no class ticked';
    var sizes = lsJson('cb-video-sizes', {}), summary = lsJson('cb-videos', {}), problems = [];

    for (var gi = 0; gi < want.length; gi += 1) {
      var g = want[gi];
      var label = 'Class ' + g;
      ctx.setPct(null, label + ': reading the lists…');
      // 1. the lists
      var subjects = ((await json(libUrl(ctx.hub, ctx.kid, 'en', g, own))).subjects || []).map(function (s) { return s.key; });
      var lessons = [];
      for (var si = 0; si < subjects.length; si += 1) lessons = lessons.concat(lessonsOf(await json(libUrl(ctx.hub, ctx.kid, 'en', g, own, subjects[si])), subjects[si]));
      var total = lessons.reduce(function (a, v) { return a + v.mb; }, 0);
      sizes[g] = { n: lessons.length, mb: Math.round(total) };
      ctx.note('cb-video-sizes', sizes);
      // 2. a page for each lesson that has none yet (a child's first tap makes it; here it is made ahead)
      var bare = lessons.filter(function (v) { return !v.code; });
      for (var bi = 0; bi < bare.length; bi += 1) {
        ctx.setPct(null, label + ': preparing lesson pages, ' + (bi + 1) + ' of ' + bare.length);
        var made = await fetch('/api/wq/videos/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hub: ctx.hub, kid: ctx.kid, vid: bare[bi].vid }) }).then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; });
        if (made.code && made.k) { bare[bi].code = made.code; bare[bi].k = made.k; }
      }
      // 3. the lists as the door will ask for them, both languages, saved afresh (they now name every lesson's page)
      var lists = [];
      LANGS.forEach(function (l) { lists.push(libUrl(ctx.hub, ctx.kid, l, g, own)); subjects.forEach(function (s) { lists.push(libUrl(ctx.hub, ctx.kid, l, g, own, s)); }); });
      var pics = [];
      lessons.forEach(function (v) { [v.thumb, v.poster, v.art].forEach(function (u) { if (u && pics.indexOf(u) < 0) pics.push(u); }); });
      var quiet = { each: function () {} };
      var r0 = await ctx.warm(lists.map(ctx.abs), { fresh: true, each: quiet.each });
      var rp = await ctx.warm(pics.map(ctx.abs), { readable: true, each: quiet.each });
      // 4. what is already here, checked against the drive (not only this step's own record): a saved lesson whose
      //    page, video or a clip has gone from the drive is saved again
      var have = lsJson('cb-videos-' + g, []);
      for (var hi = 0; hi < lessons.length; hi += 1) {
        var hv = lessons[hi], at = have.indexOf(hv.vid);
        if (at < 0) continue;
        var whole = false;
        if (hv.code && hv.k) {
          var keptPage = await ctx.ask({ type: 'kept-text', url: ctx.abs(pageUrl(hv)) }, 15000);
          var km = keptPage ? mediaOf(keptPage) : null;
          if (km && km.video.length) {
            var there = await ctx.ask({ type: 'have', urls: km.video.concat(km.clips) }, 30000);
            whole = Array.isArray(there) && there.every(Boolean);
          }
        }
        if (!whole) have.splice(at, 1);
      }
      localStorage.setItem('cb-videos-' + g, JSON.stringify(have));
      // room for the whole class?
      var left = lessons.filter(function (v) { return have.indexOf(v.vid) < 0; });
      var need = left.reduce(function (a, v) { return a + v.mb; }, 0) * 1e6 * 1.08 + RESERVE; // the quiz clips and pages add a few percent
      var sp = await ctx.space();
      if (left.length && sp.free != null && need > sp.free) {
        problems.push(label + ' needs ' + mb(need / 1e6) + ', this Chromebook has room for ' + mb(sp.free / 1e6));
        summary[g] = { n: lessons.length, saved: have.length, mb: Math.round(total), why: 'no room' };
        ctx.note('cb-videos', summary);
        continue;
      }
      // 5. lesson by lesson (three at a time): its page, its video, its pictures, its quiz clips
      var doneMb = lessons.reduce(function (a, v) { return a + (have.indexOf(v.vid) >= 0 ? v.mb : 0); }, 0);
      var next = 0, stopped = false;
      var page = function (v) { return fetch(pageUrl(v)).then(function (r) { return r.ok ? r.text() : ''; }, function () { return ''; }); };
      var one = async function (v) {
        if (!v.code || !v.k) return false;
        var html = await page(v);
        if (!html) { await ctx.waitOnline(); html = await page(v); } // the Wi-Fi dropped: wait for it, then once more
        var m = mediaOf(html);
        if (!html || !m.video.length) return false;
        var r1 = await ctx.warm([ctx.abs(pageUrl(v))].concat(m.pics), { readable: true, each: quiet.each });
        // the video and its ~90 small quiz clips side by side (the clips are many and tiny: six at a time)
        var both = await Promise.all([ctx.warm(m.video, { readable: true, lanes: 1, each: quiet.each }), ctx.warm(m.clips, { readable: true, lanes: 6, batch: 30, each: quiet.each })]);
        return !r1.failed.length && !both[0].failed.length && !both[0].gone.length && !both[1].failed.length;
      };
      var lane = async function () {
        while (next < lessons.length && !stopped) {
          var v = lessons[next]; next += 1;
          if (have.indexOf(v.vid) >= 0) continue;
          var ok = await one(v);
          if (ctx.isFull()) { stopped = true; break; }
          if (ok) {
            have.push(v.vid); doneMb += v.mb;
            localStorage.setItem('cb-videos-' + g, JSON.stringify(have));
            summary[g] = { n: lessons.length, saved: have.length, mb: Math.round(total) };
            if (have.length % 5 === 0) ctx.note('cb-videos', summary);
          }
          ctx.setPct(100 * (gi + (total ? doneMb / total : have.length / lessons.length)) / want.length, label + ': ' + have.length + ' of ' + lessons.length + ' lessons (' + mb(doneMb) + ' of ' + mb(total) + ')');
        }
      };
      ctx.setPct(100 * gi / want.length, label + ': ' + have.length + ' of ' + lessons.length + ' lessons (' + mb(doneMb) + ' of ' + mb(total) + ')');
      await Promise.all([lane(), lane(), lane()]);
      if (ctx.isFull()) problems.push(label + ': the drive filled up after ' + have.length + ' lessons');
      summary[g] = { n: lessons.length, saved: have.length, mb: Math.round(total) };
      ctx.note('cb-videos', summary);
      if (have.length < lessons.length && !ctx.isFull()) problems.push(label + ': ' + (lessons.length - have.length) + ' of ' + lessons.length + ' lessons not saved yet');
      ctx.log('lesson videos, ' + label + ': ' + have.length + ' of ' + lessons.length + ' lessons on this Chromebook (' + mb(total) + ')');
    }
    if (problems.length) throw new Error(problems.join('; '));
    return want.map(function (g) { return 'Class ' + g + ': ' + summary[g].saved + ' lessons, ' + mb(summary[g].mb); }).join('; ');
  }

  /* Check this Chromebook: every saved lesson, from the saved copy alone. Its page must be there, its video must open
   * in a real player (its length is read), and its quiz clips must be on the drive. */
  async function check(t) {
    var rows = [], hub = t.hub(), kid = t.kid(), own = t.ls('cb-home-grade') || '';
    var summary = t.lsJson('cb-videos', {});
    var gs = Object.keys(summary).filter(function (g) { return summary[g] && summary[g].saved; });
    if (!hub || !gs.length) return [];
    for (var gi = 0; gi < gs.length; gi += 1) {
      var g = gs[gi], group = 'Lesson videos, Class ' + g;
      var top = await t.read(libUrl(hub, kid, 'en', g, own));
      if (!top) { rows.push({ group: group, name: 'the list of subjects', ok: false, why: 'not saved' }); continue; }
      var subjects = (JSON.parse(top).subjects || []).map(function (s) { return s.key; });
      var lessons = [];
      for (var si = 0; si < subjects.length; si += 1) {
        var body = await t.read(libUrl(hub, kid, 'en', g, own, subjects[si]));
        if (!body) { rows.push({ group: group, name: subjects[si] + ' lessons list', ok: false, why: 'not saved' }); continue; }
        lessons = lessons.concat(lessonsOf(JSON.parse(body), subjects[si]));
        if (!(await t.read(libUrl(hub, kid, 'ur', g, own, subjects[si])))) rows.push({ group: group, name: subjects[si] + ' lessons list (Urdu)', ok: false, why: 'not saved' });
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
