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
