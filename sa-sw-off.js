/* Served by the pilot at /sa/sw.js in place of Jugnu's own battery worker (scope /sa/).
 * Under the pilot ONE worker (pilot-sw.js, scope /) keeps everything, the reading and number battery included: a
 * second worker on /sa/ would take those pages away from it, and then a part started with no network could neither
 * go back to the sea map nor send its answers later. This stand-in answers the engine's "keep these" / "are these
 * kept" (so a page that still reaches it starts at once), then removes itself and the battery worker's own copies;
 * the next page under /sa/ is the pilot worker's. Not part of Jugnu. */
'use strict';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.registration.unregister().then(function () { return caches.keys(); }).then(function (keys) {
    return Promise.all(keys.filter(function (k) { return /^sa-(core|session)-/.test(k); }).map(function (k) { return caches.delete(k); }));
  }).catch(function () {}));
});
self.addEventListener('message', function (e) {
  var d = e.data || {};
  var port = e.ports && e.ports[0];
  if (!port || (d.type !== 'prepare' && d.type !== 'check')) return;
  var n = (d.urls || []).length;
  port.postMessage({ ok: true, cached: n, missing: [], bytes: 0 });
});
