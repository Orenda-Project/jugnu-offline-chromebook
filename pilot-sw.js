/* Offline pilot worker for Jugnu on a Chromebook (bd-fc5mgd.1), served at /sw.js by server.mjs, scope /.
 * Modelled on NIETE-Rumi dashboard/sa/sw.js (the reading battery's offline copy).
 *
 *   GET, same origin or media on another origin   network first (4 s), else the kept copy; every good answer is kept
 *   audio/video asked with a Range header           the whole file is fetched once and kept; offline, the asked slice
 *                                                   is cut from the kept copy (206), so a video plays and seeks
 *   POST                                            network; offline, the answer to the same POST seen online, if any,
 *                                                   else 503, so the page's own answer queue (wq.js) keeps the answer
 *
 * Every miss while offline is counted and sent to /__cb/report when the network is back: that list is the gap
 * between today's Jugnu and an offline one. */
'use strict';

var KEEP = 'cb-pilot-v1';
var NETWORK_WAIT_MS = 4000;
var MEDIA_RX = /\.(mp3|m4a|ogg|opus|wav|webm|mp4|m3u8|ts)(\?|$)/i;
var misses = [];

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function keyFor(req) {
  var u = new URL(req.url);
  return u.toString();
}

function keep(key, res) {
  // 200, or an opaque answer for a file on another site (R2 clips): the browser plays those, it only cannot read them.
  if (!res || res.type === 'opaqueredirect' || (res.status !== 200 && res.type !== 'opaque')) return Promise.resolve();
  var copy = res.clone();
  return caches.open(KEEP).then(function (c) { return c.put(key, copy); }).catch(function () {});
}

function kept(key) {
  return caches.open(KEEP).then(function (c) {
    // Never a looser match for a kept POST answer: every one shares /__cb/post, so ignoreSearch would hand one
    // child's session to another (it did, 28 Oct: child four played inside child three's session).
    if (key.indexOf('/__cb/post') >= 0) return c.match(key);
    return c.match(key).then(function (hit) { return hit || c.match(key, { ignoreSearch: true }); });
  });
}

function miss(req, why) {
  misses.push({ m: req.method, u: req.url.slice(0, 300), why: why, at: Date.now() });
  if (misses.length > 500) misses.shift();
}

function offlineAnswer(req) {
  miss(req, 'not_kept');
  var html = req.mode === 'navigate';
  return new Response(html ? '<h1>Offline</h1><p>This page was not saved on this device.</p>' : 'offline', {
    status: 503, headers: { 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain', 'X-CB-Offline': '1' },
  });
}

function networkFirst(req, key) {
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      kept(key).then(function (hit) { resolve(hit || offlineAnswer(req)); });
    }, NETWORK_WAIT_MS);
    fetch(req).then(function (res) {
      // A server error (a dropped upstream answered by the tunnel or a school proxy as 502/503/504) counts as no
      // network when a kept copy exists: the child gets the copy, not an error page.
      if (res.status >= 500) {
        return kept(key).then(function (hit) { if (!done) { done = true; clearTimeout(timer); resolve(hit || res); } });
      }
      keep(key, res);
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }, function () {
      if (done) return;
      done = true; clearTimeout(timer);
      kept(key).then(function (hit) { resolve(hit || offlineAnswer(req)); });
    });
  });
}

/** Cut "bytes=a-b" out of a kept whole file. */
function slice(full, range) {
  return full.arrayBuffer().then(function (buf) {
    var m = /bytes=(\d*)-(\d*)/.exec(range || '');
    var size = buf.byteLength;
    var start = m && m[1] ? Number(m[1]) : 0;
    var end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    return new Response(buf.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': full.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
      },
    });
  });
}

function media(req, key) {
  var range = req.headers.get('Range');
  return kept(key).then(function (hit) {
    if (hit) return range && hit.type !== 'opaque' ? slice(hit, range) : hit;
    // Not kept yet: play from the network as asked, and keep the whole file for next time.
    var whole = new Request(req.url, { mode: req.mode === 'no-cors' ? 'no-cors' : 'cors', credentials: 'same-origin' });
    fetch(whole).then(function (res) { return keep(key, res); }).catch(function () {});
    return fetch(req).catch(function () { return offlineAnswer(req); });
  });
}

function bodyKey(req) {
  return req.clone().text().then(function (body) {
    var h = 0;
    for (var i = 0; i < body.length; i += 1) h = (h * 31 + body.charCodeAt(i)) | 0;
    return new URL('/__cb/post?u=' + encodeURIComponent(req.url) + '&h=' + h, self.location.origin).toString();
  });
}

/* ---- A quiz started on the device (the prototype of what Jugnu needs for school Chromebooks) ----
 * wq.js can only start a quiz with a session token from the server. Offline, this worker starts one on the device:
 * /session answers with a local token ("cblocal.<id>"), /answers for a local token are kept in IndexedDB (the
 * outbox) and answered as recorded, /finish for a local token answers 503 so the page shows its own "saved, will
 * send" screen and keeps retrying. When the network is back, sync() makes the real session with the same request,
 * sends the kept answers and finishes it; the page's next /finish retry then gets the server's real result. */
var LOCAL = 'cblocal.';
function db() {
  return new Promise(function (ok, no) {
    var r = indexedDB.open('cb-outbox', 2);
    r.onupgradeneeded = function () {
      if (!r.result.objectStoreNames.contains('s')) r.result.createObjectStore('s', { keyPath: 'lsid' });
      // 'q': who played (/__cb/identity, /__cb/added) recorded with no network, sent by sync().
      if (!r.result.objectStoreNames.contains('q')) r.result.createObjectStore('q', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = function () { ok(r.result); };
    r.onerror = function () { no(r.error); };
  });
}
function rec(mode, fn, store) {
  return db().then(function (d) {
    return new Promise(function (ok, no) {
      var tx = d.transaction(store || 's', mode);
      var out = fn(tx.objectStore(store || 's'));
      tx.oncomplete = function () { ok(out && out.result !== undefined ? out.result : out); };
      tx.onerror = function () { no(tx.error); };
    });
  });
}
var getRec = function (lsid) { return rec('readonly', function (s) { return s.get(lsid); }); };
var putRec = function (r) { return rec('readwrite', function (s) { s.put(r); return null; }); };
var allRecs = function () { return rec('readonly', function (s) { return s.getAll(); }); };
function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json', 'X-CB-Local': '1' } });
}
function lsidOf(st) { return typeof st === 'string' && st.indexOf(LOCAL) === 0 ? st.slice(LOCAL.length) : null; }

function localSession(body) {
  var lsid = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(8)), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  var name = (body.new && body.new.name) || '';
  return putRec({ lsid: lsid, session: body, answers: {}, finish: false, createdAt: Date.now() }).then(function () {
    return json({ st: LOCAL + lsid, device_ref: body.device_ref, counted: true, resume: { answered: [] },
      child: { chip: 'l' + lsid.slice(0, 15), first: name.split(/\s+/)[0] || name, animal: 'owl' }, local: true });
  });
}

/* Home on a shared Chromebook: the page asks the server for the child's home link (POST /api/wq/hubdoor). Offline,
 * or for a quiz started on this device, the server cannot answer, so the answer is this device's child home, which
 * the test page hands the worker (message {type:'hub'}) and Get ready saved. */
var HUB_KEY = new URL('/__cb/hub', self.location.origin).toString();
function storedHub() {
  return caches.open(KEEP).then(function (c) { return c.match(HUB_KEY); }).then(function (r) { return r ? r.json() : {}; }).then(function (o) { return o.hub || null; }, function () { return null; });
}
function homeAnswer() {
  return storedHub().then(function (hub) { return hub ? json({ href: '/h/' + hub, local: true }) : json({ error: 'no_home_on_this_device' }, 404); });
}

function localApi(path, body, lsid) {
  return getRec(lsid).then(function (r) {
    if (!r) return json({ error: 'unknown_local_session' }, 404);
    if (/\/hubdoor$/.test(path)) {
      // Synced already: the real session can ask the server; else (or if that fails) this device's home.
      if (!r.realSt) return homeAnswer();
      return api('hubdoor', { st: r.realSt, home: 1 }).then(function (h) { return h.ok && h.body && h.body.href ? json(h.body) : homeAnswer(); }, homeAnswer);
    }
    if (/\/answers$/.test(path)) {
      var ids = [];
      (body.a || []).forEach(function (a) { if (a && a.qid) { r.answers[a.qid] = a; ids.push(a.qid); } });
      return putRec(r).then(function () { return json({ recorded: ids, dup: [], unknown: [] }); });
    }
    if (/\/finish$/.test(path)) {
      if (r.result) return json(r.result);
      r.finish = true;
      return putRec(r).then(function () { sync(); return json({ offline: true }, 503); });
    }
    return json({ ok: true, local: true });
  });
}

var syncing = null;
function sync() {
  if (syncing) return syncing;
  syncing = allRecs().then(function (list) {
    return list.filter(function (r) { return !r.done; }).reduce(function (p, r) {
      return p.then(function () { return syncOne(r); });
    }, Promise.resolve());
  }).then(sendQueued).catch(function () {}).then(function () { syncing = null; });
  return syncing;
}

/* Who-played records made offline: send each, oldest first; stop at the first that fails (still no network). */
function queue(url, body) { return rec('readwrite', function (st) { st.add({ url: url, body: body }); return null; }, 'q'); }
function sendQueued() {
  return rec('readonly', function (st) { return st.getAll(); }, 'q').then(function (items) {
    return (items || []).reduce(function (p, it) {
      return p.then(function (go) {
        if (go === false) return false;
        return fetch(it.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: it.body }).then(function (res) {
          if (res.status === 204 || res.ok || res.status === 401) return rec('readwrite', function (st) { st.delete(it.id); return null; }, 'q');
          return false;
        }, function () { return false; });
      });
    }, Promise.resolve());
  });
}
function api(path, body) {
  return fetch('/api/wq/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
    .then(function (res) { return res.text().then(function (t) { var j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) {} return { ok: res.ok, status: res.status, body: j }; }); });
}
function syncOne(r) {
  var start = r.realSt ? Promise.resolve({ ok: true, body: { st: r.realSt } }) : api('session', Object.assign({}, r.session, r.session.new ? { new: Object.assign({}, r.session.new, { force: true }) } : {}));
  return start.then(function (s) {
    if (!s.ok || !s.body.st) { r.lastError = 'session_' + s.status + ' ' + JSON.stringify(s.body).slice(0, 120); return putRec(r); }
    r.realSt = s.body.st;
    var items = Object.keys(r.answers).map(function (q) { return r.answers[q]; });
    var batches = [];
    for (var i = 0; i < items.length; i += 20) batches.push(items.slice(i, i + 20));
    return batches.reduce(function (p, b) { return p.then(function () { return api('answers', { st: r.realSt, a: b }); }); }, Promise.resolve())
      .then(function () { return r.finish ? api('finish', { st: r.realSt }) : null; })
      .then(function (f) {
        // A quiz left half-way stays open: its answers are on the server, and any it gets later are sent next time.
        if (f && f.ok) { r.result = f.body; r.done = true; }
        r.syncedAt = Date.now();
        return putRec(r).then(function () {
          return fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ synced: { lsid: r.lsid, name: r.session.new && r.session.new.name, answers: items.length, finished: !!r.done, score: r.result && r.result.score, lag_s: Math.round((Date.now() - r.createdAt) / 1000) } }) }).catch(function () {});
        });
      });
  }, function () { return null; });
}

function post(req) {
  var path = new URL(req.url).pathname;
  if (path === '/__cb/identity' || path === '/__cb/added') {
    return req.clone().text().then(function (body) {
      return fetch(req.clone()).then(function (res) {
        if (res.status >= 500) return queue(req.url, body).then(function () { return json({ queued: true }, 202); });
        return res;
      }, function () { return queue(req.url, body).then(function () { return json({ queued: true }, 202); }); });
    });
  }
  if (/^\/api\/wq\/(session|answers|finish|hubdoor)$/.test(path)) {
    return req.clone().text().then(function (t) {
      var body = {}; try { body = JSON.parse(t || '{}'); } catch (e) {}
      var lsid = lsidOf(body.st);
      if (lsid) return localApi(path, body, lsid);
      return fetch(req.clone()).then(function (res) {
        if (res.ok) sync();
        if (res.status >= 500 && /\/session$/.test(path)) return localSession(body);
        if (!res.ok && /\/hubdoor$/.test(path)) return homeAnswer();
        return res;
      }, function () {
        if (/\/session$/.test(path)) return localSession(body);
        if (/\/hubdoor$/.test(path)) return homeAnswer();
        miss(req, 'post_offline');
        return json({ ok: false, offline: true }, 503);
      });
    });
  }
  return bodyKey(req).then(function (key) {
    return fetch(req.clone()).then(function (res) {
      if (res.ok && /json/.test(res.headers.get('Content-Type') || '')) keep(key, res);
      return res;
    }, function () {
      return kept(key).then(function (hit) {
        if (hit) return hit;
        miss(req, 'post_offline');
        return new Response(JSON.stringify({ ok: false, offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var u = new URL(req.url);
  if (u.pathname === '/__cb/report' || u.pathname === '/__cb/sw.js') return;
  if (req.method === 'POST' && u.origin === self.location.origin) { e.respondWith(post(req)); return; }
  if (req.method !== 'GET') return;
  var key = keyFor(req);
  if (MEDIA_RX.test(u.pathname)) { e.respondWith(media(req, key)); return; }
  if (u.origin !== self.location.origin && req.destination !== 'image' && req.destination !== 'font' && req.destination !== 'style' && req.destination !== 'script') return;
  e.respondWith(networkFirst(req, key));
});

function report() {
  if (!misses.length) return Promise.resolve();
  var batch = misses.splice(0, misses.length);
  return fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ misses: batch }) })
    .catch(function () { misses = batch.concat(misses); });
}

/** Keep each URL not kept yet, six at a time (the page loaded them before this worker was in charge). */
function warm(urls) {
  var queue = urls.slice();
  var got = 0;
  function next() {
    var u = queue.shift();
    if (u === undefined) return Promise.resolve();
    return kept(u).then(function (hit) {
      if (hit) return null;
      var cross = new URL(u).origin !== self.location.origin;
      return fetch(new Request(u, { mode: cross ? 'no-cors' : 'same-origin', credentials: 'same-origin' }))
        .then(function (res) { if (res.status === 200 || res.type === 'opaque') { got += 1; return caches.open(KEEP).then(function (c) { return c.put(u, res); }); } return null; })
        .catch(function () { return null; });
    }).then(next);
  }
  var workers = [];
  for (var i = 0; i < 6; i += 1) workers.push(next());
  return Promise.all(workers).then(function () { return got; });
}

self.addEventListener('message', function (e) {
  var d = e.data || {};
  var port = e.ports && e.ports[0];
  if (d.type === 'report') { e.waitUntil(Promise.all([report(), sync()])); return; }
  if (d.type === 'hub' && typeof d.hub === 'string' && /^[A-Za-z0-9._-]{20,400}$/.test(d.hub)) {
    e.waitUntil(caches.open(KEEP).then(function (c) { return c.put(HUB_KEY, new Response(JSON.stringify({ hub: d.hub }), { headers: { 'Content-Type': 'application/json' } })); }));
    return;
  }
  if (d.type === 'outbox' && port) {
    e.waitUntil(allRecs().then(function (l) {
      port.postMessage(l.map(function (r) { return { lsid: r.lsid, name: r.session.new && r.session.new.name, answers: Object.keys(r.answers).length, finish: r.finish, done: !!r.done, synced: !!r.realSt, err: r.lastError || null }; }));
    }, function () { port.postMessage([]); }));
    return;
  }
  if (d.type === 'warm') {
    e.waitUntil(warm((d.urls || []).filter(function (u) { return typeof u === 'string' && /^https?:/.test(u); }))
      .then(function (n) { if (port) port.postMessage({ warmed: n }); }));
    return;
  }
  if (d.type === 'stats' && port) {
    e.waitUntil(caches.open(KEEP).then(function (c) { return c.keys(); }).then(function (keys) {
      port.postMessage({ kept: keys.length, misses: misses.length });
    }));
  }
});
