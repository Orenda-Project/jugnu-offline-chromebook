/* Get ready: every storybook a child can reach from the Stories door (bd-fc5mgd.13.1).
 *
 * The Stories door shows the child's own grade, and its grade and language buttons open every other shelf: "All
 * grades", each grade 1-5, English and Urdu. So every one of those shelves is saved, and every book on them: the
 * book itself (its pages' words and the voice's word times), every page's picture, every page's voice, the questions'
 * voices and pictures. The child's own grade goes first (both languages), so a Get ready that is cut short still
 * leaves that grade whole. Then the files the reader itself is made of, and each book's answers, so a question can be
 * checked with no network (see the answers note in server.mjs).
 *
 * It checks its own work: after each batch it asks the offline worker which files are still not kept and fetches
 * those again (a busy server answers "slow down" for a minute), and it says at the end how many are saved and how
 * many are not. Files go at a steady pace (about 900 a minute): Jugnu allows a class behind one address 1,200.
 */
// The microphone is asked for now, while the person who tapped Get ready is still at the Chromebook: Chrome's own
// "allow the microphone?" then never meets a child, who would have 8 seconds to answer it before "Your turn" gives up.
var CB_STORIES_MIC = (function () {
  'use strict';
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve('this browser has none');
    return Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); return 'allowed'; }, function (e) { return 'NOT allowed (' + ((e && e.name) || 'refused') + '): Your turn will only listen'; }),
      new Promise(function (ok) { setTimeout(function () { ok('nobody answered Chrome\'s question: open a story and tap Your turn once to allow it'); }, 90000); }),
    ]);
  } catch (e) { return Promise.resolve('this browser has none'); }
}());

(window.CB_READY = window.CB_READY || []).push({
  name: 'storybooks: every grade, English and Urdu',
  /* Check this Chromebook, the storybooks' part: asked with the worker reaching no network at all. Every shelf, every
   * book and every file a book names must be on the drive; the answers must be there; one book of each grade and
   * language is opened in the reader, and one voice of each language in a real player. */
  check: function (t) {
    'use strict';
    var hub = t.hub(), kid = t.kid(), rows = [];
    var row = function (name, ok, why) { rows.push({ group: 'Stories', name: name, ok: !!ok, why: ok ? '' : (why || 'not on this Chromebook') }); };
    var each = function (list, fn) { return list.reduce(function (p, x, i) { return p.then(function () { return fn(x, i); }); }, Promise.resolve()); };
    var json = function (u) { return t.read(u).then(function (x) { try { return x ? JSON.parse(x) : null; } catch (e) { return null; } }); };
    var shelves = [], books = {}, order = [];
    ['en', 'ur'].forEach(function (l) { ['', 'all', '1', '2', '3', '4', '5'].forEach(function (g) { shelves.push([g, l]); }); });
    var got = 0;
    return each(shelves, function (x) {
      t.say('storybook shelves…');
      return json('/api/wq/stories/shelf/h/' + hub + '?kid=' + kid + (x[0] ? '&g=' + x[0] : '') + '&l=' + x[1]).then(function (d) {
        if (!d || !d.books) return;
        got += 1;
        d.books.forEach(function (b) { if (!books[b.id]) { books[b.id] = { id: b.id, title: b.title, grade: b.grade, lang: b.lang }; order.push(b.id); } });
      });
    }).then(function () {
      row('shelves: ' + got + ' of ' + shelves.length + ' (my grade, All grades, grades 1-5; English and Urdu), ' + order.length + ' books', got === shelves.length && order.length > 0, (shelves.length - got) + ' shelves are not saved');
      var by = { en: { books: 0, pages: 0, files: 0, missing: 0, unread: 0, eg: '' }, ur: { books: 0, pages: 0, files: 0, missing: 0, unread: 0, eg: '' } };
      var q = 0;
      return each(order, function (id, n) {
        t.say('storybook ' + (n + 1) + ' of ' + order.length + '…');
        var c = by[books[id].lang === 'ur' ? 'ur' : 'en'];
        return json('/api/wq/stories/book/' + id + '/h/' + hub + '?kid=' + kid).then(function (b) {
          if (!b || !b.pages) { c.unread += 1; c.eg = c.eg || books[id].title; return null; }
          c.books += 1; c.pages += b.pages.length; books[id].data = b;
          if ((b.questions || []).length) q += 1;
          var files = [], add = function (u) { if (typeof u === 'string' && /^\/s\//.test(u) && files.indexOf(u) < 0) files.push(u); };
          add(b.cover);
          b.pages.forEach(function (p) { add(p.image && p.image.url); add(p.text_band && p.text_band.url); add(p.audio && p.audio.url); });
          add(b.questions_sprite && b.questions_sprite.url);
          (b.questions || []).forEach(function (x) { add(x.audio && x.audio.q); ((x.audio && x.audio.o) || []).forEach(add); (x.options || []).forEach(function (o) { if (o && o.img) add(/\//.test(o.img) ? o.img : '/s/' + b.id + '/' + o.img); }); });
          c.files += files.length;
          return t.have(files.map(t.abs)).then(function (have) {
            (have || files.map(function () { return false; })).forEach(function (ok, i) { if (!ok) { c.missing += 1; c.eg = c.eg || (books[id].title + ': ' + files[i].split('/').pop()); } });
          });
        });
      }).then(function () {
        [['en', 'English'], ['ur', 'Urdu']].forEach(function (l) {
          var c = by[l[0]];
          row(l[1] + ': ' + c.books + ' books, ' + c.pages + ' pages, ' + c.files + ' pictures and voices', c.books > 0 && !c.missing && !c.unread,
            (c.unread ? c.unread + ' books are not saved; ' : '') + (c.missing ? c.missing + ' files are not saved; ' : '') + (c.eg ? 'e.g. ' + c.eg : 'no book saved'));
        });
        return ctxAsk({ type: 'stories' }).then(function (st) {
          row('questions can be checked with no network: answers for ' + ((st && st.answers_for) || 0) + ' of ' + q + ' books', st && st.answers_for >= q, 'press Get ready again with the Wi-Fi on');
        });
      }).then(function () {
        // one book of each grade and language, opened in the reader from the saved copy alone; its first voice in a player
        var pick = {}, list = [];
        order.forEach(function (id) { var b = books[id], k = b.lang + b.grade; if (b.data && !pick[k]) { pick[k] = 1; list.push(b); } });
        return each(list, function (b, n) {
          t.say('opening a story of each grade and language: ' + (n + 1) + ' of ' + list.length + '…');
          return t.open('Story (grade ' + b.grade + ', ' + (b.lang === 'ur' ? 'Urdu' : 'English') + '): ' + b.title, '/cb/home#story/' + b.id,
            { see: '.wqs .wqs-stage img, .wqs .wqra-pic', settle: 2200, not: /could not open|did not load|not saved on this device|نہیں کھل سکی/i }).then(function (r) { r.group = 'Stories'; rows.push(r); })
            .then(function () {
              var p = (b.data.pages || []).filter(function (x) { return x.audio; })[0];
              return p && (b.grade === 1 || b.grade === 5) ? t.media('Voice (grade ' + b.grade + ', ' + (b.lang === 'ur' ? 'Urdu' : 'English') + '): ' + b.title, p.audio.url, 'audio').then(function (r) { r.group = 'Stories'; rows.push(r); }) : null;
            });
        });
      });
    }).then(function () { return rows; });
    function ctxAsk(msg) {
      return new Promise(function (ok) {
        var sw = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!sw) return ok(null);
        var ch = new MessageChannel(), timer = setTimeout(function () { ok(null); }, 8000);
        ch.port1.onmessage = function (e) { clearTimeout(timer); ok(e.data); };
        sw.postMessage(msg, [ch.port2]);
      });
    }
  },
  run: function (ctx) {
    'use strict';
    var hub = ctx.hub, kid = ctx.kid || '';
    CB_STORIES_MIC.then(function (m) { ctx.log('microphone for Your turn: ' + m); });
    var sleep = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
    var getJson = function (u) { return fetch(u, { credentials: 'same-origin', headers: { accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }); };
    var READER = ['wq-stories.js', 'wq-stories.css', 'wq-stories-q.js', 'wq-stories-d.js', 'wq-stories-w.js', 'wq-readalong.js', 'wq-read-live.js', 'wq-liveread.js', 'wq-liveread.css',
      'wq-moment.js', 'wq-moment.css', 'wq-pace.js', 'wq-pace.css', 'wq-finish-card.js', 'wq-finish-card.css', 'jugnu/thinking.webp', 'jugnu/hello.webp', 'jugnu/celebrate.webp', 'jugnu/correct.webp'];
    var BATCH = 120, BATCH_MS = 8000;

    /** Save these files; → how many of them are still not kept after four more tries. */
    function save(urls, say) {
      var left = urls.slice(), tries = 0;
      var round = function () {
        var i = 0;
        var next = function () {
          if (i >= left.length) return Promise.resolve();
          var part = left.slice(i, i + BATCH), t0 = Date.now();
          i += BATCH;
          // the pace is for files really fetched: a batch already on this Chromebook costs no wait
          return ctx.warm(part, { each: function () {} }).then(function (r) { if (say) say(Math.min(i, left.length), left.length); return sleep(Math.max(0, BATCH_MS * ((r && r.warmed) || 0) / BATCH - (Date.now() - t0))); }).then(next);
        };
        return next().then(function () { return ctx.ask({ type: 'stories-missing', urls: left }, 90000); }).then(function (m) {
          left = m && m.missing ? m.missing : left;
          if (!left.length || (tries += 1) > 4) return left;
          ctx.log('storybooks: ' + left.length + ' files not saved yet, trying again in ' + [5, 15, 30, 60][tries - 1] + ' s');
          return sleep([5, 15, 30, 60][tries - 1] * 1000).then(round);
        });
      };
      return round();
    }
    function filesOf(b) {
      var out = [], add = function (u) { if (typeof u === 'string' && /^\/s\//.test(u) && out.indexOf(u) < 0) out.push(u); };
      add(b.cover);
      (b.pages || []).forEach(function (p) { add(p.image && p.image.url); add(p.text_band && p.text_band.url); add(p.audio && p.audio.url); });
      add(b.questions_sprite && b.questions_sprite.url);
      (b.questions || []).forEach(function (q) {
        add(q.audio && q.audio.q); ((q.audio && q.audio.o) || []).forEach(add);
        (q.options || []).forEach(function (o) { if (o && o.img) add(/\//.test(o.img) ? o.img : '/s/' + b.id + '/' + o.img); });
      });
      return out;
    }
    /** The questions as this device sees them, as a short mark: answers learned for other questions are not used. */
    function mark(b) {
      var t = JSON.stringify((b.questions || []).map(function (q) { return [q.n, q.q, (q.options || []).map(function (o) { return typeof o === 'string' ? o : o && o.t; })]; })), h = 5381, i;
      for (i = 0; i < t.length; i += 1) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
      return h.toString(36);
    }
    /** Which option answers each question: one tap asked of the server, a second only after a miss (it then says). */
    function learn(b) {
      var a = {}, o = {};
      var ask = function (n, d) {
        return fetch('/api/wq/stories/event/h/' + hub, { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ kid: kid, book_id: b.id, event: 'story_answer', data: Object.assign({ n: n }, d) }) })
          .then(function (r) { return r.ok && r.headers.get('x-cb-local') !== '1' ? r.json() : null; }, function () { return null; }).then(function (j) { return sleep(450).then(function () { return j; }); });
      };
      return (b.questions || []).reduce(function (p, q) {
        return p.then(function () {
          var k = (q.options || []).length;
          o[q.n] = k;
          if (k < 2) return null;
          return ask(q.n, { i: 0 }).then(function (r) {
            if (!r || r.right == null) return null;
            if (r.right) { a[q.n] = 0; return null; }
            if (k === 2) { a[q.n] = 1; return null; }
            return ask(q.n, { i: 1, try: 2, first: 0 }).then(function (r2) {
              if (!r2 || r2.right == null) return null;
              if (r2.right) a[q.n] = 1; else if (r2.show != null) a[q.n] = Number(r2.show);
              return null;
            });
          });
        });
      }, Promise.resolve()).then(function () { return { v: mark(b), a: a, o: o, whole: Object.keys(a).length === (b.questions || []).filter(function (q) { return (q.options || []).length >= 2; }).length }; });
    }

    var books = {}, order = [], shelves = 0, t0 = Date.now(), own = null;
    return Promise.resolve().then(function () {
      if (navigator.storage && navigator.storage.persist) return navigator.storage.persist().catch(function () { return false; });
      return false;
    }).then(function () {
      // the child's id on this Chromebook, when the Games door did not give it: the home page carries it
      if (kid) return null;
      return fetch('/h/' + hub, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (t) { kid = (/"kid":"([0-9a-f]{8,32})"/.exec(t) || [])[1] || ''; }, function () {});
    }).then(function () {
      if (!kid) throw new Error('no child on this home link (has it expired, or is it bound to another device?)');
      // every shelf the door can show: my grade, then All grades and each grade, English and Urdu
      var asks = [];
      ['en', 'ur'].forEach(function (l) { ['', 'all', '1', '2', '3', '4', '5'].forEach(function (g) { asks.push([g, l]); }); });
      return asks.reduce(function (p, x) {
        return p.then(function () {
          return getJson('/api/wq/stories/shelf/h/' + hub + '?kid=' + kid + (x[0] ? '&g=' + x[0] : '') + '&l=' + x[1]).then(function (d) {
            if (!d || !d.books) return null;
            shelves += 1;
            if (!x[0] && own == null) own = Number(d.grade) || null;
            d.books.forEach(function (b) { if (!books[b.id]) { books[b.id] = { id: b.id, grade: b.grade, lang: b.lang, mine: !x[0] }; order.push(b.id); } else if (!x[0]) books[b.id].mine = true; });
            return sleep(120);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      if (!order.length) throw new Error('no storybooks on the shelf');
      order.sort(function (a, b) { return (books[b].mine ? 1 : 0) - (books[a].mine ? 1 : 0) || Math.abs(books[a].grade - own) - Math.abs(books[b].grade - own); });
      var en = order.filter(function (id) { return books[id].lang !== 'ur'; }).length;
      ctx.log('storybooks: ' + shelves + ' shelves, ' + order.length + ' books (' + en + ' English, ' + (order.length - en) + ' Urdu)' + (own ? '; grade ' + own + ' first' : ''));
      return save(READER.map(function (f) { return ctx.abs('/wq/' + f); }));
    }).then(function () {
      // each book: its pages and words, then every picture and voice it names
      var files = [], pages = 0, got = 0;
      return order.reduce(function (p, id, n) {
        return p.then(function () {
          ctx.setPct(Math.round(10 * (n + 1) / order.length), 'reading book ' + (n + 1) + ' of ' + order.length + '…');
          return getJson('/api/wq/stories/book/' + id + '/h/' + hub + '?kid=' + kid).then(function (b) {
            if (!b || !b.pages) { books[id].failed = true; return null; }
            got += 1; pages += b.pages.length; books[id].data = b;
            filesOf(b).forEach(function (u) { files.push(ctx.abs(u)); });
            return sleep(150);
          });
        });
      }, Promise.resolve()).then(function () {
        ctx.log('storybooks: ' + got + ' of ' + order.length + ' books read, ' + pages + ' pages, ' + files.length + ' pictures and voices to save');
        return save(files, function (done, of) { ctx.setPct(10 + Math.round(75 * done / of), done + ' of ' + of + ' pictures and voices…'); }).then(function (left) { return { files: files.length, left: left.length, got: got, pages: pages }; });
      });
    }).then(function (sum) {
      // the answers, so a question is checked with no network: from this service if another Chromebook left them, else asked
      var have = 0, asked = 0, part = 0;
      return getJson('/__cb/stories/answers?key=' + encodeURIComponent(ctx.key || '')).then(function (known) {
        known = (known && known.books) || {};
        return order.reduce(function (p, id, n) {
          return p.then(function () {
            var b = books[id].data;
            if (!b || !(b.questions || []).length) return null;
            var k = known[id], keep = function (x) { return ctx.ask({ type: 'stories-answers', book: id, v: x.v, a: x.a, o: x.o }, 5000); };
            if (k && k.v === mark(b)) { have += 1; return keep(k); }
            ctx.setPct(85 + Math.round(15 * (n + 1) / order.length), 'answers, book ' + (n + 1) + ' of ' + order.length + '…');
            return learn(b).then(function (x) {
              if (!Object.keys(x.a).length) return null;
              asked += 1; if (!x.whole) part += 1;
              return keep(x).then(function () {
                if (!x.whole) return null;
                return fetch('/__cb/stories/answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: ctx.key || '', book: id, v: x.v, a: x.a, o: x.o }) }).catch(function () {});
              });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        return Promise.resolve(navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : {}).then(function (est) {
          var line = 'storybooks: ' + (sum.files - sum.left) + ' of ' + sum.files + ' pictures and voices saved for ' + sum.got + ' books (' + sum.pages + ' pages)' +
            (sum.left ? ' — ' + sum.left + ' NOT saved: tap Get ready again' : '') + '; answers for ' + (have + asked) + ' books' + (part ? ' (' + part + ' in part)' : '') +
            '; ' + Math.round((Date.now() - t0) / 1000) + ' s' + (est && est.usage ? '; ' + Math.round(est.usage / 1e6) + ' MB on this Chromebook' : '');
          ctx.log(line);
          try { localStorage.setItem('cb-stories-ready', JSON.stringify({ at: new Date().toISOString(), books: sum.got, of: order.length, files: sum.files, missing: sum.left, answers: have + asked })); } catch (e) { /* storage off */ }
          try { fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stories_ready: { books: sum.got, of: order.length, pages: sum.pages, files: sum.files, missing: sum.left, answers: have + asked, answers_asked: asked, s: Math.round((Date.now() - t0) / 1000), mb: est && est.usage ? Math.round(est.usage / 1e6) : null } }) }).catch(function () {}); } catch (e) { /* no report */ }
        });
      });
    });
  },
});
