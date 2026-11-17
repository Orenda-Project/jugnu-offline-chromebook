/* Storybooks with no network (bd-fc5mgd.13.1): the storybook part of the offline worker. pilot-sw.js loads this file
 * (importScripts) and asks it first about every request and message: CB_STORIES.fetch(e), CB_STORIES.message(e).
 *
 *   the shelf, a book        GET /api/wq/stories/shelf/h/<link>, /book/<id>/h/<link>: network first (4 s). Each good
 *                            answer is kept under a name that does not hold the child's home link, so a book saved
 *                            under one link opens under the next one (links last 7 days) and for another child.
 *                            No network, a server error or a link the server refuses: the kept copy; a kept shelf
 *                            shows this child's finished books from what this device saw.
 *   a story step             POST /api/wq/stories/event/h/<link>: sent when it can be. With no network (or no answer
 *                            in 4 s, or a refused link) it is written to this device (IndexedDB cb-stories, store ev)
 *                            and answered here, so the reader goes on; stories.js sends the kept steps, oldest first,
 *                            when the network is back. A step of a book that still has kept steps waits behind them.
 *   a reading saved here     a "page read" that carries x-cb-recs (stories.js: Your turn recorded on the device) is
 *                            never sent as it is: it waits with its recording until Jugnu's speech service has heard it.
 *   a question's answer      checked on the server; with no network, from the answers this device was given by
 *                            Get ready (store ans), with the server's own rule for a second try.
 *   the speech key           POST /api/wq/lr/key is never kept or replayed (a key opens one stream, once).
 */
'use strict';
(function () {
  var CACHE = 'cb-pilot-v1';   // the one kept-files cache (pilot-sw.js KEEP)
  var WAIT_MS = 4000;
  var SHELF_RX = /^\/api\/wq\/stories\/shelf\/h\/([^/]+)$/;
  var BOOK_RX = /^\/api\/wq\/stories\/book\/([0-9a-f-]{36})\/h\/([^/]+)$/;
  var EVENT_RX = /^\/api\/wq\/stories\/event\/h\/([^/]+)$/;
  var KEY_PATH = '/api/wq/lr/key';
  var REFUSED = { 401: 1, 403: 1, 410: 1, 429: 1 };   // the link, not the story: the kept copy still stands

  function own(path) { return new URL(path, self.location.origin).toString(); }
  function json(body, status) {
    return new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-CB-Local': '1' } });
  }
  function cache() { return caches.open(CACHE); }
  function put(key, res) { return cache().then(function (c) { return c.put(key, res); }).catch(function () {}); }
  function get(key) { return cache().then(function (c) { return c.match(key); }).catch(function () { return undefined; }); }
  /** The same address (or body) with this Chromebook's live home link in place of an old one (block HOME of the
   *  worker, self.cbHome): a link lasts 7 days, the worker renews it. Without that block, the text as it is. */
  function live(text) {
    try { return self.cbHome && self.cbHome.live ? self.cbHome.live(text).then(function (t) { return t || text; }, function () { return text; }) : Promise.resolve(text); } catch (e) { return Promise.resolve(text); }
  }
  /** "Check this Chromebook" (block READY) is running: nothing is sent and nothing is queued. */
  function testing() { try { return typeof savedOnly === 'function' && savedOnly(); } catch (e) { return false; } }
  /** The network's answer, or null after WAIT_MS or when there is no network (the request is dropped then). */
  function net(req, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || WAIT_MS);
    return fetch(req, ctl ? { signal: ctl.signal } : undefined).then(function (res) { clearTimeout(t); return res; }, function () { clearTimeout(t); return null; });
  }

  // ---- what this device keeps about stories (shared with stories.js, which opens the same database) ----
  function db() {
    return new Promise(function (ok, no) {
      var r = indexedDB.open('cb-stories', 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('ev')) d.createObjectStore('ev', { keyPath: 'id', autoIncrement: true });   // story steps waiting to be sent
        if (!d.objectStoreNames.contains('rec')) d.createObjectStore('rec', { keyPath: 'id' });                      // readings waiting to be heard
        if (!d.objectStoreNames.contains('done')) d.createObjectStore('done', { keyPath: 'k' });                     // child|book finished here
        if (!d.objectStoreNames.contains('ans')) d.createObjectStore('ans', { keyPath: 'book' });                    // a book's answers, from Get ready
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
    });
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, no) {
        var t = d.transaction(store, mode), out = fn(t.objectStore(store));
        t.oncomplete = function () { ok(out && out.result !== undefined ? out.result : out); };
        t.onerror = t.onabort = function () { no(t.error); };
      });
    });
  }
  var all = function (store) { return tx(store, 'readonly', function (s) { return s.getAll(); }).then(function (l) { return l || []; }, function () { return []; }); };

  // ---- the shelf and the books ----
  function shelfKey(u, kid) {
    return own('/__cb/stories/shelf?g=' + encodeURIComponent(u.searchParams.get('g') || 'own') + '&l=' + (u.searchParams.get('l') === 'ur' ? 'ur' : 'en') + '&kid=' + encodeURIComponent(kid || ''));
  }
  function bookKey(id) { return own('/__cb/stories/book/' + id); }
  function doneBy(kid) {
    return all('done').then(function (l) { var o = {}; l.forEach(function (x) { if (x.k.indexOf(kid + '|') === 0) o[x.k.slice(kid.length + 1)] = 1; }); return o; });
  }
  /** A kept shelf for this child: their own copy as the server last gave it, else another child's with nothing ticked
   *  (for "my grade", the whole library before another child's grade); either way the books this child finished on
   *  this device are ticked. */
  function keptShelf(u) {
    var kid = u.searchParams.get('kid') || '';
    var all1 = new URL(u.toString()); all1.searchParams.set('g', 'all');
    var tries = u.searchParams.get('g') ? [[u, kid], [u, '']] : [[u, kid], [all1, kid], [all1, ''], [u, '']];
    var find = function (n) {
      if (n >= tries.length) return Promise.resolve(null);
      return get(shelfKey(tries[n][0], tries[n][1])).then(function (hit) { return hit ? { res: hit, mine: !!tries[n][1] && tries[n][1] === kid } : find(n + 1); });
    };
    return find(0).then(function (k) {
      if (!k) return null;
      return Promise.all([k.res.json(), doneBy(kid)]).then(function (x) {
        var d = x[0], done = x[1];
        (d.books || []).forEach(function (b) { b.done = (k.mine && !!b.done) || !!done[b.id]; if (!k.mine) b.from_teacher = false; });
        return json(d);
      });
    }).catch(function () { return null; });
  }
  function content(req, u, key, kept, also) {
    return live(req.url).then(function (url) {
      return net(url === req.url ? req.clone() : new Request(url, { headers: req.headers, credentials: 'same-origin' }));
    }).then(function (res) {
      if (res && res.status === 200) {
        var a = res.clone(), b = also ? res.clone() : null;
        put(key, a); if (b) put(also, b);
        return res;
      }
      // a miss the server means (a book taken down, stories switched off) is the answer; anything else, the kept copy
      if (res && res.status < 500 && !REFUSED[res.status]) return res;
      return kept().then(function (hit) { return hit || res || json({ error: 'offline', offline: true }, 503); });
    });
  }

  // ---- story steps ----
  function hasWaiting(kid, book) {
    return all('ev').then(function (l) { return l.some(function (x) { return x.kid === kid && x.book === book; }); });
  }
  function nudge() {
    return self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) { c.postMessage({ type: 'cb-stories-sync' }); }); }).catch(function () {});
  }
  function keepStep(i) {
    return tx('ev', 'readwrite', function (s) { s.add({ at: Date.now(), url: i.url, kid: i.kid, book: i.book, page: i.page, event: i.event, body: i.body, recs: i.recs || null }); return null; }).then(nudge);
  }
  function markDone(i) {
    return i.event === 'story_done' && i.kid && i.book ? tx('done', 'readwrite', function (s) { s.put({ k: i.kid + '|' + i.book, at: Date.now() }); return null; }).catch(function () {}) : Promise.resolve();
  }
  /** Effort stars as the server counts them (listened, read aloud, answered), from this child's steps still on this device. */
  function effort(i) {
    return all('ev').then(function (l) {
      var mine = l.filter(function (x) { return x.kid === i.kid && x.book === i.book; });
      var listened = mine.some(function (x) { return x.event === 'story_page_listened'; });
      var read = mine.some(function (x) { return x.event === 'story_page_read' && (x.recs || (x.body.data && x.body.data.words_read > 0)); });
      return (listened ? 1 : 0) + (read ? 1 : 0) + 1;
    });
  }
  /** One tap on an answer, judged as Jugnu's server judges it (web-quiz-stories.js event(), story_answer): right or
   *  not; the answer itself only after a second miss, and a second try needs a first one (another option, also wrong).
   *  k: the book's saved answers {a: {question: option}, o: {question: how many options}}; d: the tap {n, i, try, first}.
   *  A question this device has no answer for: {ok: true} alone (the reader goes on; the server counts the picks later). */
  function judge(k, d) {
    d = d || {};
    var n = Number(d.n), pick = Number(d.i != null ? d.i : d.pick);
    if (!k || !k.a || k.a[n] == null) return { ok: true };
    var ans = Number(k.a[n]), right = pick === ans, first = d.first == null ? null : Number(d.first), opts = Number((k.o || {})[n]) || 0;
    var second = Number(d.try) === 2 && first !== null && first < opts && first !== pick && first !== ans;
    return Object.assign({ ok: true, right: right }, !right && second ? { show: ans } : {});
  }
  function checkAnswer(i) {
    return tx('ans', 'readonly', function (s) { return s.get(i.book); }).then(function (k) { return json(judge(k, i.body.data)); }, function () { return json({ ok: true }); });
  }
  function answerHere(i) {
    if (i.event === 'story_answer') return checkAnswer(i);
    if (i.event === 'story_questions_done') return effort(i).then(function (stars) { return json({ ok: true, stars: stars }); }, function () { return json({ ok: true }); });
    if (i.event === 'story_done') return Promise.resolve(json({ ok: true, sticker: false }));
    return Promise.resolve(json({ ok: true }));
  }
  function keepAndAnswer(i) {
    // a tap on an answer keeps no row on the server either: it is answered, never queued
    if (i.event === 'story_answer') return answerHere(i);
    return keepStep(i).then(function () { return markDone(i); }).then(function () { return answerHere(i); });
  }
  function step(req, u) {
    return req.clone().text().then(function (t) {
      // the step goes to the server under this Chromebook's live home link (a kept step may be days old)
      return live(req.url).then(function (url) { return [t, url === req.url ? req : new Request(url, { method: 'POST', headers: req.headers, body: t, credentials: 'same-origin' })]; });
    }).then(function (x) {
      var t = x[0], out = x[1];
      if (req.headers.get('x-cb-sync')) return fetch(out);   // stories.js sending a kept step
      var body = {}; try { body = JSON.parse(t || '{}') || {}; } catch (e) { body = {}; }
      var i = { url: new URL(out.url).pathname, kid: String(body.kid || ''), book: String(body.book_id || ''), page: body.page_n == null ? null : Number(body.page_n), event: String(body.event || ''), body: body,
        recs: (req.headers.get('x-cb-recs') || '').split(',').filter(Boolean) };
      if (!i.recs.length) i.recs = null;
      if (testing()) return answerHere(i);                   // the self-test: answered, never kept, never sent
      if (i.recs) return keepAndAnswer(i);                  // a reading saved on this device waits for its score
      var send = function () {
        return net(out.clone()).then(function (res) {
          if (res && res.ok) { markDone(i); return res; }
          if (res && res.status < 500 && !REFUSED[res.status]) return res;   // the server's own no (a bad step): the reader's to handle
          return keepAndAnswer(i);
        });
      };
      if (i.event === 'story_answer') return send();
      return hasWaiting(i.kid, i.book).then(function (w) { return w ? keepAndAnswer(i) : send(); }, send);
    });
  }
  function speechKey(req) {
    if (testing()) return Promise.resolve(json({ error: 'offline', offline: true, selftest: true }, 503));
    // the key is asked under the live home link (the body names the link: a saved reading may be days old)
    return req.clone().text().then(live).then(function (t) {
      return net(new Request(req.url, { method: 'POST', headers: req.headers, body: t, credentials: 'same-origin' }));
    }).then(function (res) { return res || json({ error: 'offline', offline: true }, 503); });
  }

  function status() {
    return Promise.all([all('ev'), all('rec'), all('done'), all('ans')]).then(function (x) {
      return { waiting: x[0].length, readings: x[0].filter(function (e) { return e.recs; }).length, recordings: x[1].length, finished_here: x[2].length, answers_for: x[3].length,
        oldest_s: x[0].length ? Math.round((Date.now() - x[0][0].at) / 1000) : 0 };
    });
  }

  self.CB_STORIES = {
    /** True when this request is a storybook's and has been answered here. */
    fetch: function (e) {
      var req = e.request, u = new URL(req.url), p = u.pathname, m;
      if (u.origin !== self.location.origin) return false;
      if (req.method === 'GET') {
        if (SHELF_RX.test(p)) {
          var kid = u.searchParams.get('kid') || '';
          e.respondWith(content(req, u, shelfKey(u, kid), function () { return keptShelf(u); }, shelfKey(u, '')));
          return true;
        }
        if ((m = BOOK_RX.exec(p))) {
          var bk = bookKey(m[1]);
          e.respondWith(content(req, u, bk, function () { return get(bk).then(function (hit) { return hit ? hit.json().then(json) : null; }); }));
          return true;
        }
        return false;
      }
      if (req.method !== 'POST') return false;
      if (EVENT_RX.test(p)) { e.respondWith(step(req, u)); return true; }
      if (p === KEY_PATH) { e.respondWith(speechKey(req)); return true; }
      return false;
    },
    /** True when this message is about stories. {type:'stories'} → what waits on this device. */
    message: function (e) {
      var d = e.data || {}, port = e.ports && e.ports[0];
      if (d.type === 'stories') {
        e.waitUntil(status().then(function (s) { if (port) port.postMessage(s); }, function () { if (port) port.postMessage(null); }));
        return true;
      }
      // {type:'stories-answers', book, v, a, o}: a book's answers, from Get ready
      if (d.type === 'stories-answers' && /^[0-9a-f-]{36}$/.test(String(d.book || ''))) {
        e.waitUntil(tx('ans', 'readwrite', function (s) { s.put({ book: d.book, v: d.v, a: d.a || {}, o: d.o || {} }); return null; })
          .then(function () { if (port) port.postMessage({ ok: true }); }, function () { if (port) port.postMessage(null); }));
        return true;
      }
      // {type:'stories-missing', urls}: which of these files are not kept yet (Get ready checks its own work)
      if (d.type === 'stories-missing') {
        // one read of the kept list (a look-up per file is far slower for thousands of files)
        e.waitUntil(cache().then(function (c) { return c.keys(); }).then(function (keys) {
          var have = {};
          keys.forEach(function (r) { have[r.url] = 1; });
          return (d.urls || []).filter(function (u) { return !have[u]; });
        }).then(function (l) { if (port) port.postMessage({ missing: l }); }, function () { if (port) port.postMessage(null); }));
        return true;
      }
      return false;
    },
    status: status,
    _judge: judge,   // for test/stories-rules.test.mjs
  };
}());
