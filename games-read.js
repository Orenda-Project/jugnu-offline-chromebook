/* Pilot (games lane, bd-fc5mgd.13.2): a reading done with NO NETWORK gets its feedback from the scorer on this
 * Chromebook (speech/jugnu-speech.js). Loaded by boot.js on the Challenge page (/c/…) and on the big flight's sea map
 * (/sa-game/…); not part of Jugnu. The rule (the speech lane's measurements):
 *
 *   online                          Jugnu's own scorer, untouched: this file does nothing
 *   no network, a passage           scored here as feedback at once: the words Jugnu heard are lit, and one to three
 *                                   stars. Never words a minute, never a count: the device under-credits, and the
 *                                   server's score is the one that counts. The recording is kept and sent for
 *                                   scoring when the network is back (the offline worker's outbox, the engine's own
 *                                   upload queue).
 *   letter sounds, Urdu word lists  not scored here at all (JugnuSpeech.can says 'later'): recorded now, scored later
 *
 * The Challenge page: the page PUTs a reading's recording to /__cb/ch-audio/<id> only when the offline worker took
 * the upload (no network); that PUT is the moment. The passage is the one the page was served (ch/<home>/read).
 * The big flight: after a part, on the sea map's card, the stories read aloud in that part are scored from the
 * recordings the battery engine keeps on the device; the result is also written into the task's own result
 * (device_read: correct, total, confidence, engine), so it reaches the server with the run. The battery's screens
 * themselves are not changed: they show a child no score, by design. */
(function () {
  'use strict';
  if (window.__cbGamesRead) return;
  window.__cbGamesRead = true;
  var D = document;
  var UR = D.documentElement.lang === 'ur';
  var T = UR
    ? { wait: 'جگنو آپ کی پڑھائی سن رہا ہے…', heard: 'جگنو نے یہ الفاظ سنے', later: 'انٹرنیٹ آنے پر جگنو دوبارہ سنے گا۔' }
    : { wait: 'Jugnu is listening to your reading…', heard: 'Jugnu heard these words', later: 'Jugnu will listen again when the internet is back.' };

  function script(src) {
    return new Promise(function (ok, no) {
      if (D.querySelector('script[src="' + src + '"]')) { ok(); return; }
      var s = D.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { no(new Error('not on this device: ' + src)); }; D.head.appendChild(s);
    });
  }
  function scorer() {
    if (window.JugnuSpeech) return Promise.resolve(window.JugnuSpeech);
    return script('/__cb/speech/match.js').then(function () { return script('/__cb/speech/jugnu-speech.js'); }).then(function () { return window.JugnuSpeech || null; });
  }
  /** One to three stars: one for reading, two from half the words, three from nine in ten. */
  function stars(r) { var share = r.total ? r.correct / r.total : 0; return 1 + (share >= 0.5 ? 1 : 0) + (share >= 0.9 ? 1 : 0); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /** The feedback box: "listening…", then the passage with the heard words lit and the stars. */
  function box(host, lang) {
    var el = D.createElement('div');
    el.setAttribute('data-cb-read', 'wait');
    el.setAttribute('dir', lang === 'ur' ? 'rtl' : 'ltr');
    el.setAttribute('lang', lang);
    el.style.cssText = 'margin:12px auto;max-width:520px;padding:12px 16px;border-radius:18px;background:#fff;border:2px solid #EADBC2;color:#1f2937;text-align:center;font:600 17px/1.6 system-ui,sans-serif' + (lang === 'ur' ? ';font-family:"WQ Nastaliq","SAE Nastaliq","Noto Nastaliq Urdu",system-ui,sans-serif;line-height:2.2' : '');
    el.innerHTML = '<p style="margin:0">' + esc(T.wait) + '</p>';
    (host || D.body).appendChild(el);
    return {
      el: el,
      show: function (r) {
        el.setAttribute('data-cb-read', 'scored');
        el.setAttribute('data-stars', String(stars(r)));
        var n = stars(r);
        el.innerHTML = '<p style="margin:0 0 4px">' + esc(T.heard) + '</p>'
          + '<p style="margin:0;font-weight:500;text-align:start">' + r.words.map(function (w) { return '<span data-read="' + (w.read ? 1 : 0) + '" style="padding:0 2px;border-radius:6px;' + (w.read ? 'background:#BBF7D0' : 'color:#6b7280') + '">' + esc(w.text) + '</span>'; }).join(' ') + '</p>'
          + '<p style="margin:6px 0 0;font-size:28px;letter-spacing:4px;color:#F2A516" aria-label="' + n + '">' + '★★★'.slice(0, n) + '<span style="color:#e5e7eb">' + '★★★'.slice(n) + '</span></p>'
          + '<p style="margin:2px 0 0;font-size:13px;font-weight:500;color:#6b7280">' + esc(T.later) + '</p>';
      },
      gone: function () { if (el.parentNode) el.parentNode.removeChild(el); },
    };
  }

  /** Score one reading on the device → the result, or null when it is one for the online scorer only. */
  function score(blob, text, lang, kind) {
    return scorer().then(function (S) {
      if (!S || S.can(lang, kind || 'passage') !== 'device') return null;
      return S.score(blob, text, lang, { kind: kind || 'passage' }).then(function (r) { return r && !r.pending && r.words && r.words.length ? r : null; });
    }).then(null, function () { return null; });
  }
  window.__cbReadScore = score; // for the rig

  // ---------------- Jugnu's Challenge: Read aloud, Read along ----------------
  if (/^\/c\//.test(location.pathname)) {
    var served = null; // the passage the page was last served
    var real = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var out = real.apply(this, arguments);
      try {
        if (/\/api\/wq\/ch\/[^/]+\/read(\?|$)/.test(url) && (!init || !init.method || init.method === 'GET')) {
          out.then(function (res) { return res.clone().json(); }).then(function (j) {
            if (j && j.story && j.story.text) served = { text: j.story.text, lang: j.lang === 'ur' ? 'ur' : 'en' };
          }, function () {});
        }
        // the recording went to this device, not to the server: there is no network, so the feedback is made here
        if (init && init.method === 'PUT' && /\/__cb\/ch-audio\//.test(url) && init.body) {
          var body = init.body;
          keptServe().then(function (s) { if (s) feedback(body, s); });
        }
      } catch (e) { /* the page's own call is never held up */ }
      return out;
    };
    /** The passage of this page: the one seen being served, else the kept serve of this page's own address. */
    var keptServe = function () {
      if (served) return Promise.resolve(served);
      var pid = new URLSearchParams(location.search).get('pid');
      return caches.open('cb-pilot-v1').then(function (c) {
        return c.keys().then(function (keys) {
          // a saved copy is filed under the home's children, not under the link in this page's address (lane/home):
          // any home's "read" of this story (or the plain Read aloud) is the passage
          var hit = keys.map(function (k) { return k.url; }).filter(function (u) { return /\/api\/wq\/ch\/[^/]+\/read(\?|$)/.test(u) && (pid ? u.indexOf('pid=' + encodeURIComponent(pid)) >= 0 : u.indexOf('pid=') < 0); })[0];
          return hit ? c.match(hit).then(function (r) { return r.json(); }).then(function (j) { return j && j.story && j.story.text ? { text: j.story.text, lang: j.lang === 'ur' ? 'ur' : 'en' } : null; }) : null;
        });
      }).then(null, function () { return null; });
    };
    var feedback = function (body, s) {
      try {
        {
          var b = null;
          var host = function () { return D.querySelector('#wq section.wq-screen') || D.getElementById('wq') || D.body; };
          // the page draws its card after the result call: put the box on whatever screen is up, and keep it there
          var keep = setInterval(function () { if (b && b.el && !D.body.contains(b.el)) host().appendChild(b.el); }, 500);
          setTimeout(function () { b = box(host(), s.lang); }, 600);
          score(body, s.text, s.lang, 'passage').then(function (r) {
            window.__cbReadResult = r ? { correct: r.correct, total: r.total, stars: stars(r), engine: r.engine, confidence: r.confidence } : { later: true };
            if (!b) b = box(host(), s.lang);
            if (r) b.show(r); else { b.gone(); clearInterval(keep); }
            if (window.JugnuSpeech && window.JugnuSpeech.release) window.JugnuSpeech.release();
          });
        }
      } catch (e) { /* feedback only */ }
    };
  }

  // ---------------- Jugnu's big flight: the stories of the part just played ----------------
  // boot.js hands over the part's session (the address still carries done= and s= when boot.js runs, before the
  // map's own script takes them off).
  window.__cbFlightRead = function (sid) {
    if (navigator.onLine || !sid || !window.SAE || !window.SAE.store) return Promise.resolve(null);
    var boot = null;
    try { boot = JSON.parse(D.getElementById('boot').textContent); } catch (e) { boot = null; }
    if (!boot || !boot.form) return Promise.resolve(null);
    var L = boot.lang === 'en' ? 'en' : 'ur';
    return Promise.all([window.SAE.store.open(), fetch('/sa/batteries/sa.' + boot.form + '.' + L + '.json').then(function (r) { return r.json(); })]).then(function (v) {
      var st = v[0];
      var tasks = {};
      (v[1].tasks || []).forEach(function (t) { tasks[t.id] = t; });
      return st.results(sid).then(function (rows) {
        // a story read aloud: a recorded passage with its text (never the spoken answers, never letter sounds)
        var stories = (rows || []).filter(function (r) { var t = tasks[r.task_id]; return t && t.kind === 'passage' && t.passage && t.passage.text && !r.device_read; });
        var done = [];
        return stories.reduce(function (chain, row) {
          return chain.then(function () { return st.chunks(sid, row.task_id); }).then(function (chunks) {
            var parts = (chunks || []).filter(function (c) { return c.blob != null; }).sort(function (a, b) { return a.part - b.part; });
            if (!parts.length) return null;
            var t = tasks[row.task_id];
            var lang = /^ur\./.test(t.id) ? 'ur' : 'en';
            var blob = new Blob(parts.map(function (c) { return c.blob; }), { type: parts[0].mime || 'audio/webm' });
            var host = D.getElementById('sg-card') || D.getElementById('sg') || D.body;
            var b = box(host, lang);
            return score(blob, t.passage.text, lang, 'passage').then(function (r) {
              if (!r) { b.gone(); return null; }
              b.show(r);
              var dev = { correct: r.correct, total: r.total, confidence: r.confidence, engine: r.engine, stars: stars(r), at: new Date().toISOString() };
              done.push({ task: row.task_id, device_read: dev });
              // into the task's own result, unsent again: the engine's upload takes it to the server with the run
              var next = {}; for (var k in row) if (Object.prototype.hasOwnProperty.call(row, k) && k !== 'synced' && k !== 'session_id') next[k] = row[k];
              next.device_read = dev;
              return st.putResult(sid, next);
            });
          });
        }, Promise.resolve()).then(function () {
          if (window.JugnuSpeech && window.JugnuSpeech.release) window.JugnuSpeech.release();
          window.__cbFlightReadDone = done;
          return done;
        });
      });
    }).then(null, function (e) { window.__cbFlightReadDone = { error: String(e && e.message || e).slice(0, 120) }; return null; });
  };
}());
