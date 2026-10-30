/* Pilot boot (bd-fc5mgd.1): registers the offline pilot worker and shows a small badge, bottom-left, with the
 * network state and how many files this device has kept. Added to every page by server.mjs; not part of Jugnu. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var badge;

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
    try { hub = localStorage.getItem('cb-hub'); } catch (e) {}
    if (!hub || !/^\/(q|c)\//.test(location.pathname) || document.querySelector('[data-cb-home]') || !document.body) return;
    var a = document.createElement('a');
    a.setAttribute('data-cb-home', '');
    a.href = '/h/' + hub + '?from=home';
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
        keepEvent({ event: 'quiz_start', code: location.pathname.split('/')[2], student_id: kid.student_id || null, local_id: kid.local_id || null,
          name: kid.name, grade: kid.grade, section: kid.section, school_id: kid.school_id, added: !!kid.added });
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
  }).then(function () { return warm(); }).then(refresh, refresh);
  navigator.serviceWorker.addEventListener('controllerchange', refresh);
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  setInterval(refresh, 5000);
  document.addEventListener('DOMContentLoaded', refresh);
}());
