/* Pilot boot (bd-fc5mgd.1): registers the offline pilot worker and shows a small badge, bottom-left, with the
 * network state and how many files this device has kept. Added to every page by server.mjs; not part of Jugnu. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var badge;

  // Storybooks: "Your turn" saved on this device when Jugnu's speech service cannot be reached, and the kept story
  // steps sent when the network is back (stories.js).
  (function () { var s = document.createElement('script'); s.src = '/__cb/stories.js'; s.async = false; (document.head || document.documentElement).appendChild(s); }());

  function show(text, offline) {
    if (!document.body) return;
    if (!badge) {
      badge = document.createElement('div');
      badge.setAttribute('data-cb-badge', '');
      badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:4px 8px;border-radius:6px;' +
        'font:12px/1.3 system-ui,sans-serif;color:#fff;pointer-events:none;opacity:.85';
      document.body.appendChild(badge);
    }
    badge.style.background = offline ? '#b45309' : '#166534';
    badge.textContent = text;
  }

  // A Home button on every quiz and game page: on a shared Chromebook there is no WhatsApp to go back to, and the
  // quiz's own Home needs the server. It goes to this Chromebook's child home, saved on the device.
  function homeButton() {
    var hub = null;
    try { hub = localStorage.getItem('cb-hub') || localStorage.getItem('cb-key'); } catch (e) {}
    if (!hub || !/^\/(q|c)\//.test(location.pathname) || document.querySelector('[data-cb-home]') || !document.body) return;
    var a = document.createElement('a');
    a.setAttribute('data-cb-home', '');
    // /cb/home: the offline worker sends it to this Chromebook's live home (a fresh link online, the saved home offline),
    // so the button never carries a link that can run out.
    a.href = '/cb/home?from=home';
    a.textContent = '⌂ Home';
    a.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:10px 16px;border-radius:999px;' +
      'background:#1f2937;color:#fff;font:600 15px/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 6px rgba(0,0,0,.25)';
    document.body.appendChild(a);
  }
  document.addEventListener('DOMContentLoaded', homeButton);
  setTimeout(homeButton, 1500);

  // The child picked on this Chromebook ("Who's playing?") answers Jugnu's own "who is playing" for them: their
  // remembered name is tapped, or their name is typed on the name screen; a resumed quiz of another child is left
  // with "Not …?". Jugnu's screens are unchanged. When the quiz starts, who played is recorded against the roster.
  /* Who-played records are written to this device first (cb-events), then sent; a record still on the device is
   * sent from the next page that loads. Leaving a page, or having no network, never loses one. */
  function events() { try { return JSON.parse(localStorage.getItem('cb-events') || '[]'); } catch (e) { return []; } }
  function keepEvent(ev) {
    try {
      ev.key = localStorage.getItem('cb-key') || ''; ev.device = localStorage.getItem('cb-device') || ''; ev.at = new Date().toISOString();
      // Jugnu's own id for this browser (quiz_sessions.device_ref and every run row carry it): with it, what was
      // played on this Chromebook between two picks can be joined to the child who was picked (lane/home).
      try { ev.wq_device = JSON.parse(localStorage.getItem('wq_d') || 'null') || null; } catch (e2) { ev.wq_device = null; }
      var list = events(); list.push(ev); localStorage.setItem('cb-events', JSON.stringify(list));
    } catch (e) { /* storage off */ }
    sendEvents();
  }
  var sending = false;
  function sendEvents() {
    var list = events();
    if (sending || !list.length) return;
    sending = true;
    fetch('/__cb/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list[0]) }).then(function (r) {
      sending = false;
      // 204 sent, 202 kept by the offline worker for later, 401 refused for good: either way it has left this list.
      if (r.status === 204 || r.status === 202 || r.status === 401) {
        try { var now = events(); now.shift(); localStorage.setItem('cb-events', JSON.stringify(now)); } catch (e) { return; }
        sendEvents();
      }
    }, function () { sending = false; });
  }
  setTimeout(sendEvents, 2000);

  /* Which quiz session this is, so the record of who played names the very row in Jugnu's database: the session id
   * inside Jugnu's own session token (wq_s_<code>.st), or, for a quiz started on the device with no network, the
   * local id the worker later reports beside the real session id when it syncs ({synced:{lsid, session_id}}). */
  function sessionOf(code) {
    try {
      var st = (JSON.parse(localStorage.getItem('wq_s_' + code) || 'null') || {}).st || '';
      if (st.indexOf('cblocal.') === 0) return { local_session: st.slice(8) };
      var p = JSON.parse(atob(st.slice(0, st.indexOf('.')).replace(/-/g, '+').replace(/_/g, '/')));
      return p && p.sid ? { session_id: p.sid } : {};
    } catch (e) { return {}; }
  }
  // Home, Stories, Games and Videos are played as this Chromebook's one home child; the picked child is recorded here
  // each time the home (or a game) opens, with Jugnu's device id, so that activity can be joined to them by time.
  function homeOpened() {
    var kid = null;
    try { kid = JSON.parse(localStorage.getItem('cb-child') || 'null'); } catch (e) { return; }
    if (!kid || !kid.name || !/^\/(h|c)\//.test(location.pathname)) return;
    keepEvent({ event: location.pathname.charAt(1) === 'h' ? 'home_open' : 'game_open', student_id: kid.student_id || null, local_id: kid.local_id || null,
      name: kid.name, grade: kid.grade, section: kid.section, school_id: kid.school_id, added: !!kid.added });
  }
  document.addEventListener('DOMContentLoaded', homeOpened);

  function autoWho() {
    var kid = null;
    try { kid = JSON.parse(localStorage.getItem('cb-child') || 'null'); } catch (e) { return; }
    if (!kid || !kid.name || !/^\/q\//.test(location.pathname)) return;
    var done = {}, steps = 0;
    var same = function (t) { return String(t || '').trim().toLowerCase() === String(kid.name).trim().toLowerCase(); };
    var act = function () {
      var root = document.getElementById('wq');
      if (!root || steps > 10) return;
      var m = root.getAttribute('data-m') || '';
      var el = function (id) { var b = document.getElementById(id); return b && b.offsetParent !== null && !b.disabled ? b : null; };
      var tap = function (b) { if (b) { done[m] = 1; steps++; b.click(); } return !!b; };
      // Jugnu's own button ids, so this works on English and Urdu screens alike.
      if (m === 'M3-continue' && !done[m]) {
        var who = (String(root.innerText).match(/Welcome back, ([^!]+)!/) || [])[1];
        if (who && !same(who)) tap(el('wq-restart'));
        return;
      }
      if ((m === 'M4-who-v2' || m === 'M4') && !done[m]) {
        var chip = [].slice.call(root.querySelectorAll('button.wq-kid')).filter(function (b) { return b.offsetParent !== null && same(b.innerText); })[0];
        tap(chip || el('wq-someone') || el('wq-play') || el('wq-new'));
        return;
      }
      if ((m === 'M4-name' || m === 'M4-new') && !done[m]) {
        var input = document.getElementById('wq-name'), start = el('wq-start');
        if (input && start) {
          done[m] = 1; steps++;
          input.value = kid.name;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function () { start.click(); }, 300);
        }
        return;
      }
      // "Is it …?": yes when Jugnu offers this child's own name (the roster pick is the record of who it really was).
      if (m === 'M4-isyou' && !done[m]) { tap(String(root.innerText).toLowerCase().indexOf(String(kid.name).toLowerCase()) >= 0 ? el('wq-yes') : el('wq-diff')); return; }
      if (m === 'M4-notfound' && !done[m]) { tap(el('wq-force')); return; }
      if (m === 'M6' && !done.started) {
        done.started = 1;
        var code = location.pathname.split('/')[2];
        keepEvent(Object.assign({ event: 'quiz_start', code: code, student_id: kid.student_id || null, local_id: kid.local_id || null,
          name: kid.name, grade: kid.grade, section: kid.section, school_id: kid.school_id, added: !!kid.added }, sessionOf(code)));
      }
    };
    new MutationObserver(function () { setTimeout(act, 250); }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-m'], childList: true });
    setTimeout(act, 800);
  }
  document.addEventListener('DOMContentLoaded', autoWho);

  function ask(sw, msg, waitMs) {
    return new Promise(function (ok) {
      var ch = new MessageChannel();
      var t = setTimeout(function () { ok(null); }, waitMs || 3000);
      ch.port1.onmessage = function (e) { clearTimeout(t); ok(e.data); };
      sw.postMessage(msg, [ch.port2]);
    });
  }

  /* HOME (lane/home): this Chromebook's child home is kept by the offline worker (pilot-sw.js, block HOME). Each page
   * hands it what only a page can read (the device key, the device id, the child picked on Who's playing?) and takes
   * back the live link, which other pages and Get-ready steps read as cb-hub. Asked on load, when the network comes
   * back, and every ten minutes: that is what renews the link long before it runs out. */
  function homeSync(fresh) {
    var sw = navigator.serviceWorker.controller;
    if (!sw) return Promise.resolve(null);
    var get = function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
    var kid = null;
    try { kid = JSON.parse(get('cb-child') || 'null'); } catch (e) { kid = null; }
    var device = get('cb-device');
    if (!device) { device = 'd' + Math.random().toString(36).slice(2, 12); try { localStorage.setItem('cb-device', device); } catch (e) {} }
    return ask(sw, { type: 'home', key: get('cb-key'), device: device, who: kid && kid.student_id ? kid.student_id : null, fresh: !!fresh }, 6000).then(function (h) {
      if (h && h.hub) { try { localStorage.setItem('cb-hub', h.hub); } catch (e) {} }
      return h;
    });
  }
  window.__cbHome = homeSync;
  navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'cb-home' && d.hub) { try { localStorage.setItem('cb-hub', d.hub); } catch (err) {} }
    // This page's home link was locked to another device: the worker has signed a new one. Open it (twice at most).
    if (d.type === 'cb-home-moved' && /^\/h\//.test(location.pathname) && location.pathname.indexOf(d.from) >= 0) {
      var n = 0;
      try { n = Number(sessionStorage.getItem('cb-home-moved') || 0); sessionStorage.setItem('cb-home-moved', String(n + 1)); } catch (err) {}
      if (n < 2) location.replace('/cb/home' + location.hash);
    }
  });
  window.addEventListener('online', function () { homeSync(); });
  setInterval(function () { if (navigator.onLine) homeSync(); }, 600000);

  function refresh() {
    var sw = navigator.serviceWorker.controller;
    var offline = !navigator.onLine;
    if (!sw) { show(offline ? 'Offline · not saved yet' : 'Saving for offline…', offline); return; }
    ask(sw, { type: 'stats' }).then(function (s) {
      var n = s ? s.kept : '?';
      show((offline ? 'Offline' : 'Online') + ' · ' + n + ' files saved on this device', offline);
    });
    if (!offline) sw.postMessage({ type: 'report' });
  }

  /** Hand the worker everything this page has loaded so far: it was loaded before the worker was in charge. */
  function warm() {
    var sw = navigator.serviceWorker.controller;
    if (!sw || !navigator.onLine) return Promise.resolve(null);
    var urls = [location.href].concat(performance.getEntriesByType('resource').map(function (r) { return r.name; }))
      .filter(function (u) { return u.indexOf('/__cb/') < 0 && !/\/api\//.test(u); });
    return ask(sw, { type: 'warm', urls: urls }, 60000);
  }
  window.__cbWarm = warm;

  // Its own URL: Jugnu's reminder code unregisters any worker whose URL ends in /sw.js when reminders are off.
  navigator.serviceWorker.register('/__cb/sw.js', { scope: '/' }).then(function () {
    return navigator.serviceWorker.ready;
  }).then(function () { homeSync(); return warm(); }).then(refresh, refresh);
  navigator.serviceWorker.addEventListener('controllerchange', function () { homeSync(); refresh(); });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  setInterval(refresh, 5000);
  document.addEventListener('DOMContentLoaded', refresh);

  /* ---- games lane (bd-fc5mgd.13.2): Jugnu's big flight ---- */
  (function gamesLane() {
    // One offline worker: Jugnu's own battery worker (scope /sa/) would take /sa/ pages away from the pilot worker
    // (no way back to the map and nothing sent later for a part started with no network). Remove it where it is.
    try {
      navigator.serviceWorker.getRegistrations().then(function (rs) {
        rs.forEach(function (r) { if (/\/sa\/$/.test(r.scope)) r.unregister(); });
      }, function () {});
    } catch (e) { /* an old browser: the stand-in at /sa/sw.js removes it */ }

    // The sea map has no way home of its own (on a phone the child goes back to WhatsApp).
    function mapHome() {
      var hub = null;
      try { hub = localStorage.getItem('cb-hub'); } catch (e) {}
      if (!hub || !/^\/sa-game\//.test(location.pathname) || document.querySelector('[data-cb-home]') || !document.body) return;
      var a = document.createElement('a');
      a.setAttribute('data-cb-home', '');
      a.href = '/cb/home?from=home'; // the one address that always opens this Chromebook's home (lane/home)
      a.textContent = '⌂ Home';
      a.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;padding:10px 16px;border-radius:999px;' +
        'background:#1f2937;color:#fff;font:600 15px/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 6px rgba(0,0,0,.25)';
      document.body.appendChild(a);
    }
    document.addEventListener('DOMContentLoaded', mapHome);
    setTimeout(mapHome, 1500);

    // What earlier parts left on this Chromebook goes up by itself when there is a network: a hidden frame runs the
    // battery engine's own upload queue for every run with something unsent (sa-drain.html). Not on the child's
    // own page (/sa/play.html sends for itself), and only when this device has ever played a part.
    var draining = false;
    function played() { try { for (var i = 0; i < localStorage.length; i += 1) if (/^sg\.st\./.test(localStorage.key(i))) return true; } catch (e) {} return false; }
    function drain() {
      if (draining || !navigator.onLine || !document.body || /^\/sa\/play\.html/.test(location.pathname) || /^\/__cb\//.test(location.pathname) || !played()) return;
      draining = true;
      var f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px';
      f.src = '/__cb/sa-drain';
      var done = function () { if (f.parentNode) f.parentNode.removeChild(f); draining = false; };
      window.addEventListener('message', function onMsg(e) {
        if (e.origin !== location.origin || !e.data || e.data.type !== 'cb:drained') return;
        window.removeEventListener('message', onMsg);
        window.__cbDrained = e.data;
        try { fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ games_sent: e.data.sessions || [], why: e.data.why || null }) }).catch(function () {}); } catch (x) { /* a report only */ }
        done();
      });
      setTimeout(done, 120000);
      document.body.appendChild(f);
    }
    window.__cbDrain = drain;
    window.addEventListener('online', function () { setTimeout(drain, 1500); });
    setTimeout(drain, 3500);

    // The pilot's own files kept on this Chromebook follow the pilot's release (pilot-sw.js, "follow the pilot's
    // release"): asked on every page load with a network; nothing is read again while the release is the same.
    setTimeout(function () {
      var w = navigator.serviceWorker.controller;
      if (w && navigator.onLine) w.postMessage({ type: 'release' });
    }, 2500);

    // A reading done with no network gets its feedback from the scorer on this Chromebook: lit words and stars,
    // never words a minute (games-read.js; the speech lane's scorer). On the Challenge page it watches for a
    // recording the offline worker took; on the sea map, back from a part, it scores that part's stories. The
    // part's session is read here, before the map's own script takes done= and s= off the address.
    if (/^\/(c|sa-game)\//.test(location.pathname)) {
      var back = new URLSearchParams(location.search);
      var doneSid = back.get('done') ? back.get('s') : null;
      var gr = document.createElement('script');
      gr.src = '/__cb/games-read.js';
      gr.onload = function () {
        if (!doneSid || navigator.onLine || !window.__cbFlightRead) return;
        var tries = 0;
        (function wait() {
          if (window.SAE && window.SAE.store && document.getElementById('sg-card')) { window.__cbFlightRead(doneSid); return; }
          if (++tries < 120) setTimeout(wait, 250);
        }());
      };
      (document.head || document.documentElement).appendChild(gr);
    }

    // The battery's screens on a short page. cb-fit.css gives the answer tiles and keys sizes that fit 633 px; what
    // still does not fit (Urdu lines are taller, a long word problem) is scaled down to the page, so no answer and
    // no key is ever below it. A story is left alone: it scrolls by design, one part at a time.
    if (/^\/sa\/play\.html/.test(location.pathname)) {
      var fitT = null;
      var fitScreen = function () {
        var scr = document.querySelector('#sae-root .sae-screen');
        if (!scr) return;
        if (scr.querySelector('.sae-passage')) { if (scr.style.zoom) scr.style.zoom = ''; return; }
        scr.style.zoom = '';
        var need = scr.scrollHeight;
        var have = window.innerHeight;
        if (need > have + 2) scr.style.zoom = String(Math.max(0.7, (have - 2) / need));
      };
      try {
        new MutationObserver(function () { clearTimeout(fitT); fitT = setTimeout(fitScreen, 50); }).observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('resize', fitScreen);
      } catch (e) { /* the screens as they are */ }
    }

    // The Challenge's screens (/c/…) on a short page. They are sized for a phone held upright: on a 633 px page the
    // number pad's 0 and delete, the microphone notice's OK and a result card's Home sat 120 to 250 px below the page
    // (the taller Urdu lines most of all), so a child had to scroll to answer. A screen taller than the page is
    // scaled down to it (never below 0.7). A screen that shows the story's words is left alone: reading size
    // matters more there, and a story scrolls by design.
    if (/^\/c\//.test(location.pathname)) {
      var fitCT = null;
      var fitChallenge = function () {
        var scr = document.querySelector('#wq section.wq-screen');
        if (!scr) return;
        scr.style.zoom = '';
        if (window.innerWidth < 600 || scr.querySelector('.wqc-w')) return;
        var page = document.documentElement.scrollHeight;
        var have = window.innerHeight;
        if (page <= have + 2) return;
        var own = scr.getBoundingClientRect().height;
        var rest = page - own;                       // what is above and below the screen keeps its size
        if (own > 0 && have - rest > 120) scr.style.zoom = String(Math.max(0.7, (have - rest - 2) / own));
      };
      try {
        new MutationObserver(function () { clearTimeout(fitCT); fitCT = setTimeout(fitChallenge, 50); }).observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('resize', fitChallenge);
      } catch (e) { /* the screens as they are */ }
    }

    // A Chromebook has a keyboard; Jugnu's number pads and letter strip are for a touch screen and take no key at
    // all (no key handler in the battery's screens or the Challenge page). A digit, a letter, Backspace or Enter
    // presses the on-screen key of that name, so a child can type "12" and press Enter. Urdu digits count as digits.
    // On a battery screen with no pad showing, Enter presses the screen's one main button (Next, Go, Start), which
    // Jugnu keeps disabled until it has finished speaking.
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      var k = e.key;
      var ur = '۰۱۲۳۴۵۶۷۸۹'.indexOf(k);
      var want = /^[0-9]$/.test(k) ? k : ur >= 0 ? String(ur) : k === 'Backspace' ? 'del' : k === 'Enter' ? 'ok' : /^[a-zA-Z]$/.test(k) ? k.toLowerCase() : null;
      if (!want) return;
      var shown = function (b) { return b && b.offsetParent !== null && !b.disabled && !b.hasAttribute('hidden'); };
      var keys = document.querySelectorAll('.sae-keypad .sae-key, .sae-letters .sae-key, .wqc-keys .wqc-k');
      for (var i = 0; i < keys.length; i += 1) {
        var name = keys[i].getAttribute('data-key') || keys[i].getAttribute('data-k');
        if (name === want && shown(keys[i])) { e.preventDefault(); keys[i].click(); return; }
      }
      if (want === 'ok' && !keys.length && /^\/sa\/play\.html/.test(location.pathname)) {
        var main = [].slice.call(document.querySelectorAll('.sae-primary')).filter(shown);
        // a focused button takes its own Enter; this is for a page where nothing is focused
        if (main.length === 1 && (!t || t.tagName !== 'BUTTON')) { e.preventDefault(); main[0].click(); }
      }
    });
  }());
}());
