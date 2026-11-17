/* Storybooks on a Chromebook with no network, the page's part (bd-fc5mgd.13.1). Added to every page by boot.js
 * (and by the start page). Nothing in Jugnu's own files is changed; this file stands beside them.
 *
 * 1. "Your turn" when Jugnu's speech service cannot be reached (no network, no key in 4 s, or the live words stop
 *    mid-read): the child's reading is RECORDED ON THIS DEVICE and scored later. Jugnu's own reading screen is used
 *    as it is (WQLiveRead.mount); beside it this file keeps its own small recording of the microphone (opus, 32 kbit/s,
 *    about 4 KB a second). When the read ends, the page goes on as a page that was read, its line says "Saved! Jugnu
 *    will listen when the internet is back", and the page's "page read" step is tagged (x-cb-recs) so the offline
 *    worker keeps it on the device instead of sending numbers nobody has heard yet. A read with no voice in it at all
 *    is not saved: Jugnu's own "let's read it together" answers it.
 *    Where the scorer that runs on this Chromebook can score it (speech/jugnu-speech.js: English and Urdu passages), it
 *    does, at once: "Listening…", the words it heard light up, and the page answers with words and stars, never a
 *    speed. The recording is still kept and heard again online: the speech service's count is the one the server gets.
 * 2. Back online: each saved reading is played to Jugnu's speech service exactly as a live read is (a one-read key
 *    from /api/wq/lr/key, the same stream, Jugnu's own word matcher WQLiveRead.matcher), the page's real numbers
 *    replace the provisional ones, and every kept story step is sent to the server, oldest first, per child and book.
 *    A recording leaves this device only for the speech service, and is deleted once it has been heard.
 *
 * Shared with sw-stories.js: IndexedDB cb-stories (ev = steps waiting, rec = readings waiting).
 */
(function () {
  'use strict';
  if (window.__cbStories) return;
  var LOCAL_KEY = 'cb-saved-on-this-device';
  var KEY_WAIT_MS = 4000;
  var QUIET_MS = 6000;        // Your turn with no live words: this long with no voice after some reading ends the read
  var ECHO_QUIET_MS = 1500;   // "Read it together": one sentence, said back
  var COPY = {
    en: { reading: 'Read it aloud! Jugnu is saving your reading.', saved: 'Saved! Jugnu will listen when the internet is back.', checking: 'Listening…' },
    ur: { reading: 'اونچی آواز میں پڑھیں! جگنو آپ کی پڑھائی محفوظ کر رہا ہے۔', saved: 'آپ کی پڑھائی محفوظ ہو گئی! انٹرنیٹ آتے ہی جگنو اسے سنے گا۔', checking: 'آپ کی آواز سنی جا رہی ہے…' },
  };
  var LIT_MS = 900;           // the words Jugnu heard stay lit this long before the page answers the read
  var noop = function () {};
  function report(o) { try { fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stories: o }) }).catch(noop); } catch (e) { /* no network: nothing to say */ } }

  // ---- this device's story store (the same database sw-stories.js opens) ----
  function db() {
    return new Promise(function (ok, no) {
      var r = indexedDB.open('cb-stories', 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        if (!d.objectStoreNames.contains('ev')) d.createObjectStore('ev', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('rec')) d.createObjectStore('rec', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('done')) d.createObjectStore('done', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('ans')) d.createObjectStore('ans', { keyPath: 'book' });
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
  var all = function (s) { return tx(s, 'readonly', function (st) { return st.getAll(); }).then(function (l) { return l || []; }); };
  var getOne = function (s, k) { return tx(s, 'readonly', function (st) { return st.get(k); }); };
  var putOne = function (s, v) { return tx(s, 'readwrite', function (st) { st.put(v); return null; }); };
  var del = function (s, k) { return tx(s, 'readwrite', function (st) { st.delete(k); return null; }); };
  function uid() { return Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(8)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  // ---- 1. Your turn, recorded on this device ----
  var waiting = {};     // 'book:page' → ids of the readings saved since that page's last "page read" step
  var savedPages = {};  // 'book:page' → 1: this page's read is waiting to be heard (its line says so)
  var armed = null;     // the page screen drawn for the last saved read (when the address carries no page number)

  /** Jugnu's file sets window[name]: fn(it) runs as soon as it does (or at once when it is already there). */
  function hook(name, fn) {
    if (window[name]) { try { fn(window[name]); } catch (e) { /* Jugnu's own stays */ } return; }
    var v;
    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: true, get: function () { return v; }, set: function (x) { v = x; try { fn(x); } catch (e) { /* Jugnu's own stays */ } } });
    } catch (e) {
      var t = setInterval(function () { if (window[name]) { clearInterval(t); try { fn(window[name]); } catch (x) { /* stays */ } } }, 300);
    }
  }
  // A "key" that opens no stream: the live reader runs as always, its words go nowhere, the read ends on "I'm done".
  // A real stream is watched: when it was opened, and when words last came back on it (see "deaf" below).
  var live = null;      // the read on screen
  hook('WQLive', function (W) {
    var open0 = W.open;
    W.open = function (o) {
      if (o && o.api_key === LOCAL_KEY) return { send: noop, finish: function (cb) { cb(); }, state: function () { return 'open'; } };
      var S = live;
      if (!S || !o) return open0.apply(this, arguments);
      S.liveAt = Date.now();
      return open0.call(this, Object.assign({}, o, { onTokens: function (t) { S.tokAt = Date.now(); return o.onTokens && o.onTokens(t); } }));
    };
  });
  var DEAF_MS = 3500;   // a voice in the room this long with no word back from an open stream: the stream is not listening

  function recorder(stream) {
    var R = { chunks: [], mime: 'audio/webm', at: Date.now(), mr: null };
    try {
      var MR = window.MediaRecorder;
      var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].filter(function (t) { return MR.isTypeSupported && MR.isTypeSupported(t); })[0];
      R.mr = new MR(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
      R.mime = R.mr.mimeType || type || R.mime;
      R.mr.ondataavailable = function (e) { if (e.data && e.data.size) R.chunks.push(e.data); };
      R.mr.start(1000);
    } catch (e) { R.mr = null; }
    /** The whole recording as one file (null when nothing could be recorded). */
    R.stop = function () {
      return new Promise(function (ok) {
        var done = false, give = function () { if (done) return; done = true; ok(R.chunks.length ? new Blob(R.chunks, { type: R.mime }) : null); };
        if (!R.mr || R.mr.state === 'inactive') return give();
        R.mr.addEventListener('stop', function () { setTimeout(give, 0); });
        setTimeout(give, 1500);
        try { R.mr.stop(); } catch (e) { give(); }
      });
    };
    return R;
  }

  /** The room's ear: is there a voice? (the microphone's level ten times a second; the reading battery's own level:
   *  a voice is above twice the room's quietest, within [0.02, 0.06]). E.ok: the ear works; E.voice: tenths of a second
   *  at a voice's level, counted one by one (a child who reads word by word, with gaps, is still a voice); E.first /
   *  E.last: when. It errs towards "a voice": a noisy room saved and later scored as no words costs nothing, a child's
   *  reading taken for silence would be lost. No ear (a suspended audio context) is "not known", never silence. */
  function ear(stream, onTick) {
    var E = { ok: false, voice: 0, first: 0, last: 0, stop: noop };
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = new AC(), an = ctx.createAnalyser();
      an.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(an);
      var buf = new Uint8Array(an.fftSize), floor = 1, run = 0;
      var t = setInterval(function () {
        if (ctx.state && ctx.state !== 'running') { try { ctx.resume().catch(noop); } catch (e) { /* no ear */ } return; }
        an.getByteTimeDomainData(buf);
        var sum = 0, i, v;
        for (i = 0; i < buf.length; i += 1) { v = (buf[i] - 128) / 128; sum += v * v; }
        var rms = Math.sqrt(sum / buf.length), now = Date.now();
        E.ok = true;
        floor = Math.min(floor, rms);
        if (rms > Math.max(0.02, Math.min(0.06, 2 * floor))) { run += 1; E.voice += 1; if (run >= 2) { E.last = now; if (!E.first) E.first = now; } } else run = 0;
        if (onTick) onTick(E, now);
      }, 100);
      E.stop = function () { clearInterval(t); try { ctx.close().catch(noop); } catch (e) { /* closed */ } };
    } catch (e) { /* no ear on this device: the child ends the read with "I'm done" */ }
    return E;
  }

  // The scorer that runs on this Chromebook (speech/jugnu-speech.js, saved by Get ready): asked for when the reader
  // is, so it is there by the first Your turn. Not there (not saved, an old Get ready): the read is saved for later.
  var speech = null;
  function loadSpeech() {
    if (!speech) {
      speech = (window.JugnuMatch ? Promise.resolve() : script('/__cb/speech/match.js'))
        .then(function () { return window.JugnuSpeech ? null : script('/__cb/speech/jugnu-speech.js'); })
        .then(function () { return window.JugnuSpeech || null; }, function () { return null; });
    }
    return speech;
  }
  function onDevice(L) { var J = window.JugnuSpeech; try { return !!(J && J.can && J.can(L, 'passage') === 'device'); } catch (e) { return false; } }
  // its model is 0.3-0.5 GB of memory: given back when the child leaves the book
  window.addEventListener('hashchange', function () { if (!/^#story\//.test(String(location.hash || '')) && window.JugnuSpeech && window.JugnuSpeech.release) { try { window.JugnuSpeech.release(); } catch (e) { /* none loaded */ } } });

  hook('WQLiveRead', function (LR) {
    loadSpeech();
    var mount0 = LR.mount;
    LR.mount = function (el, o) {
      var scr = el && el.closest ? el.closest('[data-screen]') : null;
      var kind = scr ? scr.getAttribute('data-screen') : '';
      if (!o || !o.stream || typeof o.getKey !== 'function' || (kind !== 'story-read' && kind !== 'story-echo')) return mount0.apply(this, arguments);
      var turn = kind === 'story-read';          // Your turn (kept and scored later); the echo is only said back
      var L = o.lang === 'ur' ? 'ur' : 'en', n = (o.words || []).length;
      var S = { local: navigator.onLine === false, over: false };
      var rec = turn ? recorder(o.stream) : null;
      var handle = null;
      live = S;
      var E = ear(o.stream, function (e, now) {
        if (S.over || !handle || !e.first) return;
        // a stream that went deaf mid-read (the Wi-Fi dropped, the socket still looks open): the child is reading and
        // no word comes back. The read goes on, saved on this Chromebook, where it would have been lost as "0 words".
        if (!S.local) { if (S.liveAt && e.last - Math.max(S.liveAt, S.tokAt || 0) >= DEAF_MS) goLocal(); return; }
        // no live words to end the read: a quiet after some reading does (as the live reader's own quiet rule)
        if (now - e.last >= (turn ? QUIET_MS : ECHO_QUIET_MS) && now - e.first >= (turn ? n * 300 : 600)) handle.stop('quiet');
      });
      var dropped = function () { if (!S.over) goLocal(); };
      window.addEventListener('offline', dropped);
      // the scorer's model takes about 10 s to load on a Chromebook: it loads while the child reads, not after
      function warmScorer() { if (turn && onDevice(L)) { try { window.JugnuSpeech.prepare([L]).catch(noop); } catch (e) { /* loads at the first score */ } } }
      function goLocal() {
        if (S.local) return;
        S.local = true;
        warmScorer();
        var nd = el.querySelector('.lr-nudge');
        if (nd && turn && !onDevice(L)) { nd.style.display = 'none'; var p = document.createElement('p'); p.className = 'lr-nudge'; p.setAttribute('data-cb-nudge', ''); p.textContent = COPY[L].reading; nd.parentNode.insertBefore(p, nd); }
      }
      var o2 = Object.assign({}, o);
      if (S.local) warmScorer();
      // a read that can only be saved says so while the child reads; one scored on this Chromebook keeps Jugnu's own line
      if (S.local && turn && !onDevice(L)) o2.copy = Object.assign({}, o.copy, { readNow: COPY[L].reading, keepGoing: COPY[L].reading });
      o2.getKey = function () {
        var local = { api_key: LOCAL_KEY, ws: 'wss://saved.invalid/', model: 'none', lang: L };
        if (S.local) return Promise.resolve(local);
        return new Promise(function (ok) {
          var done = false, give = function (k) { if (!done) { done = true; ok(k); } };
          setTimeout(function () { if (!done) { goLocal(); give(local); } }, KEY_WAIT_MS);
          Promise.resolve().then(function () { return o.getKey(); }).then(function (k) {
            // a real key, or Jugnu's own "enough for today" (its kind line stands); anything else: saved on this device
            if (k && ((typeof k.ws === 'string' && k.api_key) || k.error === 'enough_for_today')) return give(k);
            if (!done) goLocal();
            give(local);
          }, function () { if (!done) goLocal(); give(local); });
        });
      };
      // the live words stopped mid-read (the stream dropped): the read goes on, this device's recording has all of it
      o2.onFallback = function (why) { if (why === 'key' || why === 'rest') { if (o.onFallback) o.onFallback(why); } else goLocal(); };
      o2.onResult = function (r) {
        r = r || {};
        S.over = true; E.stop(); window.removeEventListener('offline', dropped);
        var heard = E.ok ? E.voice >= 4 : null;      // 0.4 s at a voice's level in all; null = this device has no ear
        if (!(turn && rec && rec.mr && (S.local || r.live === false) && heard !== false)) {
          if (rec) rec.stop();
          return o.onResult ? o.onResult(r) : undefined;
        }
        var id = uid(), key = String(o.id || ''), bp = /^(.*):(\d+)$/.exec(key) || [0, key, 0];   // o.id: '<book>:<page number>'
        var row = { id: id, at: Date.now(), book: bp[1], page: Number(bp[2]), lang: L, repeat: o.repeat === true, n: n, ended: r.ended || 'done_tap',
          dur: Date.now() - rec.at, mime: rec.mime, words: (o.words || []).map(function (w, j) { var x = { t: String(w.t == null ? w : w.t), i: typeof w.i === 'number' ? w.i : j }; if (w.alt) x.alt = w.alt; return x; }), blob: null, tries: 0,
          // what this read adds to the page's own numbers until the speech service has heard it (taken out again then)
          prov: { read: n, skipped: 0, ms: Math.max(0, Math.round(r.ms || 0)), idx: [], device: null } };
        var blob = rec.stop().then(function (b) { row.blob = b; return putOne('rec', row).then(function () { return b; }); });
        blob.catch(function (e) { report({ problem: 'recording_not_saved', why: String(e && e.message || e).slice(0, 80) }); });
        /** The page goes on. dv: this Chromebook's own score of the read, or null (the read is only saved). Either way
         *  the numbers are provisional: the recording stays, and the speech service's count is the one the server gets. */
        var done = false;
        var give = function (dv) {
          if (done || S.gone) return;
          done = true;
          var marks = [], j, read = n, skipped = 0;
          if (dv) {
            read = 0;
            for (j = 0; j < n; j += 1) {
              var st = (dv.words[j] || {}).state;
              marks.push(st === 'read' ? 'read' : st === 'skipped' ? 'skipped' : 'ahead');
              if (st === 'read') read += 1; else if (st === 'skipped') { skipped += 1; row.prov.idx.push(row.words[j].i); }
            }
            // lit words and stars, never a speed: the page is given no reading time to make one from
            row.prov = { read: read, skipped: skipped, ms: 0, idx: row.prov.idx, device: dv.engine || 'device' };
          } else { for (j = 0; j < n; j += 1) marks.push('read'); savedPages[key] = 1; }
          (waiting[key] = waiting[key] || []).push(id);
          putOne('rec', row).then(function () { sync(); }, noop);
          var pr = Object.assign({}, r, { words_total: n, words_read: read, correct: read, skipped: skipped, marks: marks, ms: row.prov.ms, live: true });
          delete pr.absorbed;
          if (o.onResult) o.onResult(pr);
          var root = document.getElementById('wq');
          armed = !dv && root ? root.querySelector('[data-screen="story-page"]') : armed;
          note();
        };
        if (!onDevice(L)) return give(null);
        // scored on this Chromebook: "Listening…" while the model hears the recording, then the words it heard light up
        var nd = el.querySelector('[data-cb-nudge]') || el.querySelector('.lr-nudge');
        if (nd) nd.textContent = COPY[L].checking;
        var btn = el.closest ? (el.closest('[data-screen]') || document).querySelector('.wqs-done') : null;
        if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
        var cap = setTimeout(function () { give(null); }, Math.max(25000, 1.6 * row.dur + 20000));
        blob.then(function (b) {
          if (!b) throw new Error('no recording');
          return window.JugnuSpeech.score(b, row.words.map(function (w) { return w.t; }).join(' '), L, { kind: 'passage', seconds: Math.max(0.5, row.dur / 1000), id: 'cb-' + id });
        }).then(function (dv) {
          clearTimeout(cap);
          if (done) return;
          if (!dv || dv.pending || !dv.words || dv.words.length !== n) {
            // not scored here (no model on this device, or it failed): the scorer kept its own copy of the recording, ours is enough
            if (dv && dv.pending && dv.id && window.JugnuSpeech.later) window.JugnuSpeech.later.take(dv.id).catch(noop);
            return give(null);
          }
          var spans = el.querySelectorAll('.lr-w');
          for (var j = 0; j < spans.length && j < n; j += 1) spans[j].className = 'lr-w ' + (/lr-box/.test(spans[j].className) ? 'lr-box ' : '') + 'lr-' + (dv.words[j].state === 'read' ? 'read' : dv.words[j].state === 'skipped' ? 'skipped' : 'ahead');
          setTimeout(function () { give(dv); }, LIT_MS);
        }, function () { clearTimeout(cap); give(null); });
      };
      handle = mount0.call(this, el, o2);
      return {
        stop: function (why) { return handle.stop(why); },
        destroy: function () { S.over = true; S.gone = true; E.stop(); window.removeEventListener('offline', dropped); if (rec) rec.stop(); return handle.destroy(); },
        // a voice in the room counts as "Jugnu can hear you" while no live words can light
        view: function () { var v = handle.view(); return S.local && v && E.voice >= 3 && !(v.heard > 0) ? Object.assign({}, v, { heard: 1 }) : v; },
      };
    };
  });

  // The page's own "page read" step for a saved read is tagged with its recordings, so the worker keeps it here.
  var fetch0 = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (init && init.method === 'POST' && typeof init.body === 'string' && /\/api\/wq\/stories\/event\/h\//.test(url)) {
        var b = JSON.parse(init.body);
        var k = b && b.event === 'story_page_read' ? b.book_id + ':' + b.page_n : null, ids = k && waiting[k];
        if (ids && ids.length) {
          delete waiting[k];
          var hd = new Headers(init.headers || {});
          hd.set('x-cb-recs', ids.join(','));
          init = Object.assign({}, init, { headers: hd });
        }
      }
    } catch (e) { /* sent as it is */ }
    return fetch0.call(this, input, init);
  };

  /** The line under a page whose read is saved here: never praise for words nobody has heard yet. */
  function note() {
    var root = document.getElementById('wq');
    var scr = root && root.querySelector('[data-screen="story-page"]');
    var h = /^#story\/([A-Za-z0-9_-]+)(?:\/p(\d+))?/.exec(String(location.hash || ''));
    if (!scr || !h) return;
    if (h[2] ? !savedPages[h[1] + ':' + h[2]] : scr !== armed) return;
    var ex = scr.querySelector('[data-extra]');
    var fb = ex && !ex.querySelector('[data-cb-saved]') && ex.querySelector('[data-rf], .wqs-well');
    if (!fb) return;
    var L = scr.getAttribute('lang') === 'ur' ? 'ur' : 'en', p = document.createElement('p');
    p.className = 'wqs-well'; p.setAttribute('data-cb-saved', ''); p.setAttribute('role', 'status'); p.lang = L; p.dir = L === 'ur' ? 'rtl' : 'ltr';
    p.textContent = COPY[L].saved;
    fb.parentNode.replaceChild(p, fb);
    [].slice.call(ex.querySelectorAll('[data-tap="rfagain"], [data-tap="rfhear"], [data-tap="echo"]')).forEach(function (x) { x.parentNode.removeChild(x); });
  }
  function watch() {
    var root = document.getElementById('wq');
    if (!root || !window.MutationObserver) return;
    new MutationObserver(function () { note(); }).observe(root, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  // ---- 2. Back online: hear the saved readings, send the kept steps ----
  function script(src) {
    return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { no(new Error('no ' + src)); }; document.head.appendChild(s); });
  }
  function scorer() {
    var p = Promise.resolve();
    if (!window.WQLive) p = p.then(function () { return script('/wq/wq-read-live.js'); });
    return p.then(function () { return window.WQLiveRead ? null : script('/wq/wq-liveread.js'); }).then(function () {
      if (!window.WQLive || !window.WQLiveRead || !window.WQLiveRead.matcher) throw new Error('no scorer');
      return window.WQLiveRead;
    });
  }
  function post(url, body, extra) {
    return fetch0.call(window, url, { method: 'POST', credentials: 'same-origin', headers: Object.assign({ accept: 'application/json', 'content-type': 'application/json' }, extra || {}), body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, ok: r.ok, local: r.headers.get('x-cb-local') === '1', body: j || {} }; }, function () { return { status: r.status, ok: r.ok, body: {} }; }); },
        function () { return { status: 0, ok: false, body: {} }; });
  }
  var tokenOf = function (url) { return (/\/h\/([^/?#]+)/.exec(url) || [])[1] || ''; };

  /** One saved reading, heard: the same stream a live read opens, fed the recording. → {read, total, skipped, idx, absorbed, ms, ended} */
  function hear(LR, key, row) {
    return new Promise(function (ok, no) {
      var m = LR.matcher(row.words.map(function (w) { return w.t; }), row.lang, row.words, { repeat: row.repeat === true });
      var v = m.view(), first = null, last = null, sock, over = false, sentAll = false;
      var end = function (err) {
        if (over) return; over = true;
        clearTimeout(limit);
        try { sock.close(); } catch (e) { /* closed */ }
        if (err) return no(err);
        v = m.end();
        // as the live reader would have ended it: on the last word, or on the quiet after most of the words
        var ended = v.lastHeard ? 'last_word' : (v.total > 0 && v.heard / v.total >= 0.8 ? 'quiet' : (row.ended === 'last_word' ? 'done_tap' : row.ended));
        var idx = [];
        v.states.forEach(function (s, j) { if (s === 'skipped') idx.push(row.words[j].i); });
        ok({ read: v.heard, total: v.total, skipped: v.skipped, idx: idx, absorbed: v.absorbed || 0, ended: ended, ms: LR.spanMs(first, last, ended, row.dur) });
      };
      var limit = setTimeout(function () { end(new Error('speech_timeout')); }, 80000);
      try { sock = new WebSocket(key.ws); } catch (e) { clearTimeout(limit); return no(new Error('speech_socket')); }
      sock.onopen = function () {
        sock.send(JSON.stringify({ api_key: key.api_key, model: key.model, audio_format: 'auto', language_hints: [key.lang || row.lang], language_hints_strict: true }));
        row.blob.arrayBuffer().then(function (buf) {
          // the recording in small pieces, about eight times as fast as it was read; never ahead of what the network takes
          var at = 0, STEP = 4096;
          (function more() {
            if (over) return;
            if (sock.bufferedAmount > 65536) return setTimeout(more, 50);
            if (at >= buf.byteLength) { try { sock.send(''); sentAll = true; } catch (e) { end(new Error('speech_closed')); } return; }
            try { sock.send(buf.slice(at, at + STEP)); } catch (e) { return end(new Error('speech_closed')); }
            at += STEP;
            setTimeout(more, 120);
          }());
        }, function () { end(new Error('recording_unreadable')); });
      };
      sock.onmessage = function (e) {
        var d = null; try { d = JSON.parse(e.data); } catch (x) { return; }
        if (!d) return;
        if (d.error_code) return end(new Error('speech_' + String(d.error_code).replace(/[^0-9a-z_]/gi, '').slice(0, 12)));
        if (d.tokens && d.tokens.length) {
          var before = v.heard;
          v = m.push(d.tokens);
          if (v.heard > before) d.tokens.forEach(function (tk) {
            if (!tk || !String(tk.text || '').trim()) return;
            if (typeof tk.start_ms === 'number' && (first == null || tk.start_ms < first)) first = tk.start_ms;
            if (typeof tk.end_ms === 'number' && !(tk.end_ms <= (last || 0))) last = tk.end_ms;
          });
        }
        if (d.finished) end();
      };
      sock.onerror = function () { end(new Error('speech_error')); };
      // closed after the whole recording went and words came back: the stream's own end
      sock.onclose = function () { end(sentAll && v.any ? null : new Error('speech_closed')); };
    });
  }

  /** A saved "page read" with its real numbers. → {body} | {wait: why} | {drop: why} */
  function scored(ev) {
    return Promise.all(ev.recs.map(function (id) { return getOne('rec', id); })).then(function (rows) {
      if (rows.some(function (r) { return !r || !r.blob; })) {
        // its recording is still being written (a moment), or was lost with a closed page
        return Date.now() - ev.at < 120000 ? { wait: 'recording' } : { drop: 'recording_lost' };
      }
      return scorer().then(function (LR) {
        var d = Object.assign({}, ev.body.data || {}), out = [];
        d.skipped_words = (d.skipped_words || []).slice();
        return rows.reduce(function (p, row) {
          return p.then(function (stop) {
            if (stop) return stop;
            var ask = function (st) { return post('/api/wq/lr/key', { st: st, kid: ev.kid, book: ev.book, page: ev.page, lang: row.lang }); };
            var hub = null; try { hub = localStorage.getItem('cb-hub'); } catch (e) { /* none */ }
            return ask(tokenOf(ev.url)).then(function (k) {
              // the link this was read under is no longer taken: this Chromebook's present home link, once
              return (k.status === 401 || k.status === 403 || k.status === 410) && hub && hub !== tokenOf(ev.url) ? ask(hub) : k;
            }).then(function (k) {
              if (!k.ok || !k.body.api_key || !/^wss:\/\//.test(String(k.body.ws || ''))) {
                var why = k.body.error === 'enough_for_today' ? 'rest' : k.status === 401 || k.status === 403 || k.status === 410 ? 'link' : k.status === 404 ? 'not_here' : 'offline';
                return { wait: why, status: k.status };
              }
              return hear(LR, k.body, row).then(function (s) {
                // this read's provisional part (every word, or this Chromebook's own score) comes out, the speech service's goes in
                var pv = row.prov || { read: row.n, skipped: 0, ms: row.ms_prov || 0, idx: [] };
                d.words_read = Math.max(0, (Number(d.words_read) || 0) - pv.read + s.read);
                d.skipped = Math.max(0, (Number(d.skipped) || 0) - pv.skipped + s.skipped);
                d.ms = Math.max(0, (Number(d.ms) || 0) - pv.ms + s.ms);
                d.skipped_words = d.skipped_words.filter(function (i) { return pv.idx.indexOf(i) < 0; }).concat(s.idx);
                if (s.absorbed) d.absorbed = (Number(d.absorbed) || 0) + s.absorbed;
                d.ended = s.ended;
                out.push(Object.assign({ read: s.read, total: s.total, ms: s.ms, kb: Math.round(row.blob.size / 1024), lag_s: Math.round((Date.now() - row.at) / 1000) }, pv.device ? { on_device: pv.read, engine: pv.device } : {}));
                return null;
              }, function (e) {
                row.tries = (row.tries || 0) + 1;
                return putOne('rec', row).then(function () { return row.tries >= 5 ? { drop: String(e && e.message || e).slice(0, 40) } : { wait: 'speech', why: String(e && e.message || e).slice(0, 40) }; });
              });
            });
          });
        }, Promise.resolve(null)).then(function (stop) {
          if (stop) return stop;
          d.skipped_words.sort(function (a, b) { return a - b; });
          return { body: Object.assign({}, ev.body, { data: d }), heard: out };
        });
      }, function () { return { wait: 'scorer' }; });
    });
  }

  function drain() {
    var sent = 0, heard = [], dropped = [], held = {}, stopAll = null, said = [];
    return all('ev').then(function (list) {
      list.sort(function (a, b) { return a.id - b.id; });
      return list.reduce(function (p, ev) {
        return p.then(function () {
          var k = ev.kid + '|' + ev.book;
          if (stopAll || held[k]) return null;
          // Jugnu's "enough readings for today" (a child's 40 pages, or the whole service's day): asked again in half an hour, not every sync
          var rest = 0; try { rest = Number(localStorage.getItem('cb-stories-rest')) || 0; } catch (e) { /* none */ }
          var ready = !ev.recs ? Promise.resolve({ body: ev.body }) : Date.now() < rest ? Promise.resolve({ wait: 'rest' }) : scored(ev).then(function (x) {
            if (x.wait === 'rest') { try { localStorage.setItem('cb-stories-rest', String(Date.now() + 30 * 60000)); } catch (e) { /* asked again next time */ } }
            return x;
          });
          return ready.then(function (s) {
            var gone = function () { return del('ev', ev.id).then(function () { return Promise.all((ev.recs || []).map(function (id) { return del('rec', id); })); }); };
            if (s.drop) { dropped.push({ event: ev.event, book: ev.book, page: ev.page, why: s.drop }); return gone(); }
            if (s.wait) { held[k] = s.wait; if (s.wait === 'offline') stopAll = 'offline'; return null; }
            var hub = null; try { hub = localStorage.getItem('cb-hub'); } catch (e) { /* none */ }
            var send = function (url) { return post(url, s.body, { 'x-cb-sync': '1' }); };
            return send(ev.url).then(function (r) {
              // a link the server no longer takes: this Chromebook's present home link, once
              if ((r.status === 401 || r.status === 403 || r.status === 410) && hub && tokenOf(ev.url) !== hub) return send(ev.url.replace(/\/h\/[^/?#]+/, '/h/' + hub));
              return r;
            }).then(function (r) {
              if (r.ok) {
                sent += 1;
                if (s.heard) heard.push({ book: ev.book, page: ev.page, read: s.body.data.words_read, total: s.body.data.words_total, ms: s.body.data.ms, parts: s.heard });
                // what the server made of the book once its steps were in (its own count of the child's reading)
                if (ev.event === 'story_done' || ev.event === 'story_questions_done') said.push({ event: ev.event, book: ev.book, server: r.body });
                // a steady pace: Jugnu takes 200 story steps a minute from one child's link
                return gone().then(function () { return new Promise(function (ok) { setTimeout(ok, 350); }); });
              }
              if (r.status === 400 || r.status === 404) { dropped.push({ event: ev.event, book: ev.book, page: ev.page, why: 'server_' + r.status + '_' + String(r.body.error || '') }); return gone(); }
              held[k] = 'server_' + r.status;
              if (!r.status || r.status >= 500 || r.status === 429) stopAll = held[k];
              return null;
            });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      var waits = Object.keys(held).map(function (k) { return held[k]; });
      if (sent || dropped.length || waits.length) report({ sent: sent, heard: heard, server_said: said, dropped: dropped, waiting_on: waits.filter(function (w, i) { return waits.indexOf(w) === i; }) });
      // recordings no step names any more (a page left before its step was made): gone after a day
      return Promise.all([all('rec'), all('ev')]).then(function (x) {
        var named = {}; x[1].forEach(function (e) { (e.recs || []).forEach(function (id) { named[id] = 1; }); });
        return Promise.all(x[0].filter(function (r) { return !named[r.id] && Date.now() - r.at > 86400000; }).map(function (r) { return del('rec', r.id); }));
      });
    }).then(function () { last = { at: Date.now(), sent: sent, heard: heard.length, dropped: dropped.length, held: held }; paint(); return last; });
  }

  var running = null, last = null;
  function sync() {
    if (running || navigator.onLine === false) return running || Promise.resolve(null);
    var go = function () { return drain().catch(function (e) { report({ problem: 'sync', why: String(e && e.message || e).slice(0, 80) }); return null; }); };
    // one page at a time sends (two open pages never send the same step twice)
    running = (navigator.locks && navigator.locks.request ? navigator.locks.request('cb-stories-sync', { ifAvailable: true }, function (lock) { return lock ? go() : null; }) : go())
      .then(function (r) { running = null; return r; }, function () { running = null; return null; });
    return running;
  }
  function status() {
    return Promise.all([all('ev'), all('rec')]).then(function (x) { return { waiting: x[0].length, readings: x[0].filter(function (e) { return e.recs; }).length, recordings: x[1].length, last: last }; }, function () { return null; });
  }
  /** The start page's "waiting to send" card says what stories wait, beside the quizzes. */
  function paint() {
    var box = document.getElementById('outbox');
    if (!box) return;
    status().then(function (s) {
      if (!s) return;
      var el = document.getElementById('cb-stories-out');
      if (!s.waiting && !(last && last.sent) && !el) return;
      if (!el) { el = document.createElement('div'); el.id = 'cb-stories-out'; el.className = 'state'; el.style.marginTop = '6px'; box.parentNode.insertBefore(el, box.nextSibling); }
      var card = document.getElementById('step3'); if (card) card.classList.remove('hidden');
      el.textContent = s.waiting
        ? '⏳ Stories: ' + s.readings + ' reading' + (s.readings === 1 ? '' : 's') + ' waiting for Jugnu to listen, ' + (s.waiting - s.readings) + ' other step' + (s.waiting - s.readings === 1 ? '' : 's') + ' waiting to send'
        : '✓ Stories: everything sent';
    });
  }

  window.__cbStories = { sync: sync, status: status };
  window.addEventListener('online', function () { setTimeout(sync, 1500); });
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'cb-stories-sync') setTimeout(sync, 800); });
  setTimeout(sync, 2500);
  setInterval(function () { status().then(function (s) { if (s && s.waiting) sync(); paint(); }); }, 30000);
  setTimeout(paint, 1200);
}());
