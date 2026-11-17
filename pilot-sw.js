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
      // (games lane) A slow answer is not "offline": with nothing kept, go on waiting for the network. The 4 s limit
      // used to answer 503 to a first request the server did answer (the 300 KB reading battery took 4,034 ms on
      // 17 Nov; /sa/play.html then said "This did not open"). Only a kept copy may cut the wait short.
      kept(key).then(function (hit) { if (hit && !done) { done = true; resolve(hit); } });
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


/* ====================== GAMES LANE (bd-fc5mgd.13.2): Jugnu's big flight with no network ======================
 * The big flight is the reading and number battery as a game: a sea map (/sa-game/<home token>) and the child's page
 * (/sa/play.html, Jugnu's battery engine). Under the pilot this worker is the ONE offline worker: the proxy serves a
 * stand-in at /sa/sw.js (sa-sw-off.js), so /sa/ pages are this worker's too and everything below can reach them.
 *
 *   prepare / check   the engine asks "the" worker to keep, or to look for, a part's battery, clips and pictures
 *                     (sa-offline.js: postMessage {type, urls, fresh?} -> {ok, cached, missing[], bytes}); answered
 *                     from this worker's kept files, so Jugnu speaks with the recorded clips, not the device's voice
 *   HEAD              the engine goes back to the map only when a HEAD of it answers; with no network a kept page
 *                     answers 200, so a child is never left on an island's last screen
 *   /api/sa-game/s/*  a part started with no network gets a run on this device ("cblocal.<id>"); when the engine
 *                     next sends that run's answers or recordings and there is a network, the real run is opened
 *                     with the request kept from the start and everything goes to it. A run whose 12-hour token
 *                     has lapsed (played today, sent days later) is opened again the same way.
 * Its own database (cb-games), so no other lane's store version is touched. */
var G_LOCAL = 'cblocal.';
function gdb() {
  return new Promise(function (ok, no) {
    var r = indexedDB.open('cb-games', 2);
    r.onupgradeneeded = function () {
      // 'audio': a reading recorded on the Challenge page with no network {id, type, bytes}, until it has gone up
      if (!r.result.objectStoreNames.contains('audio')) r.result.createObjectStore('audio', { keyPath: 'id' });
      // 'runs': every big-flight run this device started {sid, pageSt, body, device, local, real:{session_id, st}}
      if (!r.result.objectStoreNames.contains('runs')) r.result.createObjectStore('runs', { keyPath: 'sid' });
      // 'ch': Challenge results played with no network, waiting to be sent {id, …}
      if (!r.result.objectStoreNames.contains('ch')) r.result.createObjectStore('ch', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = function () { ok(r.result); };
    r.onerror = function () { no(r.error); };
  });
}
function grec(store, mode, fn) {
  return gdb().then(function (d) {
    return new Promise(function (ok, no) {
      var tx = d.transaction(store, mode);
      var out = fn(tx.objectStore(store));
      tx.oncomplete = function () { ok(out && out.result !== undefined ? out.result : out); };
      tx.onerror = function () { no(tx.error); };
    });
  });
}
var gRuns = function () { return grec('runs', 'readonly', function (s) { return s.getAll(); }).then(function (l) { return l || []; }, function () { return []; }); };
var gPutRun = function (r) { return grec('runs', 'readwrite', function (s) { s.put(r); return null; }); };
function gRunBySt(st) {
  if (typeof st !== 'string' || !st) return Promise.resolve(null);
  return gRuns().then(function (l) { for (var i = 0; i < l.length; i += 1) if (l[i].pageSt === st) return l[i]; return null; });
}
function gUuid() {
  var b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
function gPost(path, body, device) {
  var headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (device) headers['x-wq-device'] = device;
  return fetch('/api/sa-game/s/' + path, { method: 'POST', headers: headers, credentials: 'include', cache: 'no-store', body: JSON.stringify(body) });
}
function gJsonOf(res) { return res.clone().text().then(function (t) { try { return t ? JSON.parse(t) : {}; } catch (e) { return {}; } }, function () { return {}; }); }

/** POST /session: the server's run when it answers; a run on this device when there is no network. */
function gOpenRun(req, body, device) {
  var local = function () {
    var sid = gUuid();
    return gPutRun({ sid: sid, pageSt: G_LOCAL + sid, body: body, device: device, local: true, real: null, at: Date.now() })
      .then(function () { return json({ session_id: sid, st: G_LOCAL + sid, local: true }); });
  };
  return fetch(req.clone()).then(function (res) {
    return gJsonOf(res).then(function (j) {
      if (res.ok && j.session_id && j.st) {
        return gPutRun({ sid: j.session_id, pageSt: j.st, body: body, device: device, local: false, real: { session_id: j.session_id, st: j.st, at: Date.now() }, at: Date.now() })
          .then(function () { return res; }, function () { return res; });
      }
      // the server's own refusals stay the server's (flown this month 409, the flight's "try later" 503, not this child 401)
      if (res.status >= 500 && j.error !== 'exposure_unknown') return local();
      return res;
    });
  }, local);
}

/** The real run of a kept one: opened now (with the request kept from the start) when it has none yet. */
var gOpening = {};
function gRealOf(r) {
  if (r.real && r.real.st) return Promise.resolve(r.real);
  if (gOpening[r.sid]) return gOpening[r.sid];
  var done = function () { delete gOpening[r.sid]; };
  gOpening[r.sid] = gPost('session', r.body, r.device).then(function (res) {
    return gJsonOf(res).then(function (j) {
      if (res.ok && j.session_id && j.st) {
        r.real = { session_id: j.session_id, st: j.st, at: Date.now() }; r.err = null;
        return gPutRun(r).then(function () { return r.real; });
      }
      r.err = res.status + ' ' + (j.error || '');
      return gPutRun(r).then(function () { throw json(j, res.status); });
    });
  }, function () { throw json({ error: 'offline' }, 503); });
  gOpening[r.sid].then(done, done);
  return gOpening[r.sid];
}

/** One of a run's calls (batch, audio/presign, audio/register), sent to its real run. */
function gSend(r, op, body, again) {
  return gRealOf(r).then(function (real) {
    var b = {}; for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) b[k] = body[k];
    b.st = real.st;
    if (b.sessionId != null) b.sessionId = real.session_id;
    if (b.session_id != null) b.session_id = real.session_id;
    return gPost(op, b, r.device).then(function (res) {
      // the run's token has lapsed (12 h): open the run again, once, and send this to it
      if (res.status === 401 && again && r.body) { r.real = null; return gPutRun(r).then(function () { return gSend(r, op, body, false); }); }
      if (res.ok && op === 'batch') { r.sentAt = Date.now(); gPutRun(r); }
      return res;
    }, function () { return json({ error: 'offline' }, 503); });
  }, function (why) { return why; });
}

function gSaGame(req, u) {
  var op = u.pathname.replace('/api/sa-game/s/', '');
  if (req.method === 'GET') {
    return gRunBySt(u.searchParams.get('st')).then(function (r) {
      if (!r) return fetch(req);
      return gRealOf(r).then(function (real) {
        return fetch('/api/sa-game/s/status?st=' + encodeURIComponent(real.st), { headers: { Accept: 'application/json' }, cache: 'no-store' });
      }, function (why) { return why; });
    }).then(null, function () { return json({ error: 'offline' }, 503); });
  }
  var device = req.headers.get('x-wq-device') || '';
  return req.clone().text().then(function (t) {
    var body = {}; try { body = JSON.parse(t || '{}'); } catch (e) { body = {}; }
    if (op === 'session') return gOpenRun(req, body, device);
    return gRunBySt(body.st).then(function (r) {
      if (!r) return fetch(req.clone()).then(null, function () { return json({ error: 'offline' }, 503); });
      return gSend(r, op, body, true);
    });
  });
}

/** HEAD of a page: the network's answer; with no network, 200 when the page is kept on this device. */
function gHead(req) {
  var keptAnswer = function (res) {
    return kept(req.url).then(function (hit) {
      return hit ? new Response(null, { status: 200, headers: { 'X-CB-Kept': '1' } }) : (res || new Response(null, { status: 503, headers: { 'X-CB-Offline': '1' } }));
    });
  };
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; resolve(keptAnswer(null)); } }, NETWORK_WAIT_MS);
    fetch(req).then(function (res) {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve(res.status >= 500 ? keptAnswer(res) : res);
    }, function () { if (!done) { done = true; clearTimeout(timer); resolve(keptAnswer(null)); } });
  });
}

/** The games lane's requests; true when one was answered here. */
function gamesFetch(e) {
  var req = e.request;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return false;
  if (req.method === 'HEAD') { e.respondWith(gHead(req)); return true; }
  // The sea map is kept per child and language only: back from a part its address also carries done= and s=, and a
  // looser match would hand an Urdu child the English map (whichever was kept first).
  // The child's battery page is one page whatever its address carries (session, part, language): one kept copy,
  // renewed whenever it is opened online. A looser match used to hand back the oldest copy kept (a page from before
  // an update, e.g. without the Chromebook layout).
  if (req.method === 'GET' && u.pathname === '/sa/play.html') { e.respondWith(networkFirst(req, u.origin + '/sa/play.html')); return true; }
  if (req.method === 'GET' && /^\/sa-game\/[^/]+$/.test(u.pathname)) {
    e.respondWith(networkFirst(req, u.origin + u.pathname + '?kid=' + (u.searchParams.get('kid') || '') + '&lang=' + (u.searchParams.get('lang') || '')));
    return true;
  }
  if (/^\/api\/sa-game\/s\/(session|batch|audio\/presign|audio\/register|status)$/.test(u.pathname)) { e.respondWith(gSaGame(req, u)); return true; }
  if (req.method === 'POST' && u.pathname === '/api/wq/ch/result') { e.respondWith(gChResult(req)); return true; }
  if (req.method === 'POST' && u.pathname === '/api/wq/ch/upload') { e.respondWith(gChUpload(req)); return true; }
  var am = /^\/__cb\/ch-audio\/([0-9a-f-]{36})$/.exec(u.pathname);
  if (req.method === 'PUT' && am) { e.respondWith(gChAudioPut(req, am[1])); return true; }
  return false;
}

/** Keep each URL (six at a time, one more try after a pause); `fresh` ones are read again even when kept. */
function gKeepAll(urls, fresh) {
  var queue = urls.slice();
  var missing = [];
  var bytes = 0;
  var again = fresh || [];
  function get(u) {
    var cross = new URL(u).origin !== self.location.origin;
    return fetch(new Request(u, { mode: cross ? 'no-cors' : 'same-origin', credentials: 'same-origin', cache: 'no-cache' })).then(function (res) {
      if (res.status !== 200 && res.type !== 'opaque') return false;
      bytes += Number(res.headers.get('content-length') || 0) || 0;
      return caches.open(KEEP).then(function (c) { return c.put(u, res); }).then(function () { return true; });
    }, function () { return false; });
  }
  function one(u) {
    var first = again.indexOf(u) >= 0 ? get(u) : Promise.resolve(false);
    return first.then(function (got) { return got ? true : kept(u).then(function (hit) { return !!hit; }); }).then(function (have) {
      if (have) return true;
      return get(u).then(function (got) { return got ? true : new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return get(u); }); });
    }).then(function (got) { if (!got) missing.push(u); }, function () { missing.push(u); });
  }
  function next() { var u = queue.shift(); return u === undefined ? Promise.resolve() : one(u).then(next); }
  var workers = [];
  for (var i = 0; i < Math.min(6, urls.length); i += 1) workers.push(next());
  return Promise.all(workers).then(function () { return { ok: missing.length === 0, cached: urls.length - missing.length, missing: missing, bytes: bytes }; });
}

self.addEventListener('message', function (e) {
  var d = e.data || {};
  var port = e.ports && e.ports[0];
  if ((d.type !== 'prepare' && d.type !== 'check') || !port) return;
  var abs = function (u) { try { return new URL(u, self.location.origin).toString(); } catch (x) { return null; } };
  var urls = (d.urls || []).filter(function (u) { return typeof u === 'string'; }).map(abs).filter(Boolean);
  if (d.type === 'check') {
    e.waitUntil(Promise.all(urls.map(function (u) { return kept(u).then(function (hit) { return hit ? null : u; }, function () { return u; }); })).then(function (r) {
      var missing = r.filter(Boolean);
      port.postMessage({ ok: missing.length === 0, cached: urls.length - missing.length, missing: missing });
    }));
    return;
  }
  e.waitUntil(gKeepAll(urls, (d.fresh || []).map(abs).filter(Boolean)).then(function (out) { port.postMessage(out); }, function (err) { port.postMessage({ ok: false, cached: 0, missing: urls, error: String(err) }); }));
});

/* ---- games lane: Jugnu's Challenge (/c), the number games with no network ----
 * A number game (how many dots, which is bigger, the missing number) sends its taps once, at the end, with the token
 * of the serve it was played from (ch/result {ct, taps|answers}); a token lives two hours. With no network the taps
 * are kept here with the questions they answer, and the page gets its end card (the score worked out on the device,
 * as the server would: the questions carry their answers). Back online, the game is asked for again: when the server
 * serves the SAME questions (an unfinished first play is served again as it was for a day; the Grade 1 dots and the
 * warm-up never change), the taps go up with the new token. Other questions: the taps are not sent, and say so. */
var gCh = function (mode, fn) { return grec('ch', mode, fn); };
function gChWaiting() { return gCh('readonly', function (s) { return s.getAll(); }).then(function (l) { return l || []; }, function () { return []; }); }
/** The kept serve a result's token came from: {url, serve}. */
function gChServeOf(ct) {
  return caches.open(KEEP).then(function (c) {
    return c.keys().then(function (keys) {
      var urls = keys.map(function (k) { return k.url; }).filter(function (u) { return /\/api\/wq\/ch\/[^/]+\/[a-z]+(\?|$)/.test(u); });
      var next = function (i) {
        if (i >= urls.length) return null;
        return c.match(urls[i]).then(function (r) { return r ? r.json() : null; }).then(function (j) { return j && j.ct === ct ? { url: urls[i], serve: j } : next(i + 1); }, function () { return next(i + 1); });
      };
      return next(0);
    });
  }).then(null, function () { return null; });
}
/** The score of the taps against the kept questions (how many dots: pick = n; bigger: the larger of a, b; missing: the answer). */
function gChScore(serve, body) {
  var items = (serve && serve.items) || [];
  var given = body.taps || body.answers || [];
  var correct = 0;
  given.forEach(function (t) {
    var it = items[t.i];
    if (!it) return;
    var want = it.n != null ? it.n : (it.answer != null ? it.answer : (it.a != null && it.b != null ? Math.max(it.a, it.b) : null));
    var got = t.pick != null ? t.pick : t.value;
    if (want != null && got != null && Number(got) === Number(want)) correct += 1;
  });
  return { correct: correct, n: items.length, stopped: false };
}
function gChResult(req) {
  return req.clone().text().then(function (t) {
    var body = {}; try { body = JSON.parse(t || '{}'); } catch (e) { body = {}; }
    // a reading whose recording is on this device (ch/upload answered here): it waits with it, whatever the network says now
    if (typeof body.key === 'string' && body.key.indexOf(G_AUDIO_KEY) === 0) {
      return gChServeOf(body.ct).then(function (hit) {
        if (!hit) return json({ ok: false, offline: true }, 503);
        return gCh('readwrite', function (st) { st.add({ kind: 'read', url: hit.url, ex: hit.serve.ex || 'read', story: (hit.serve.story && hit.serve.story.text) || null, audio: body.key.slice(G_AUDIO_KEY.length), body: body, state: 'waiting', at: Date.now() }); return null; })
          .then(function () { gChSend(); return json({ later: true, offline: true }); });
      });
    }
    var later = function (res) {
      // a tap game's result, and only from a serve kept here
      if (!body.ct || (!Array.isArray(body.taps) && !Array.isArray(body.answers))) return res || json({ ok: false, offline: true }, 503);
      return gChServeOf(body.ct).then(function (hit) {
        if (!hit) return res || json({ ok: false, offline: true }, 503);
        return gCh('readwrite', function (s) { s.add({ url: hit.url, ex: hit.serve.ex || null, items: hit.serve.items || [], body: body, state: 'waiting', at: Date.now() }); return null; })
          .then(function () { return json({ score: gChScore(hit.serve, body), offline: true }); });
      });
    };
    return fetch(req.clone()).then(function (res) {
      // a dropped upstream (5xx), or a token that lapsed while the page was open with no network (401): as no network
      if (res.status >= 500 || res.status === 401) return later(res);
      if (res.ok) gChSend();
      return res;
    }, function () { return later(null); });
  });
}
/* Read aloud (the Challenge's own, and the story room's): the page records, asks where to put the recording
 * (ch/upload), PUTs it there and posts the result with its key. With no network the "where" is this device
 * (/__cb/ch-audio/<id>, kept in cb-games), and the result waits with it; the page says the result is on its way.
 * Back online, when the server serves the SAME story, the recording goes up to the server's own place and the result
 * is posted for scoring; another story: nothing is sent and the recording is dropped (it is no reading of that one). */
var G_AUDIO_KEY = 'cblocal/';
var gAudio = function (mode, fn) { return grec('audio', mode, fn); };
function gChUpload(req) {
  return req.clone().text().then(function (t) {
    var body = {}; try { body = JSON.parse(t || '{}'); } catch (e) { body = {}; }
    var here = function (res) {
      return gChServeOf(body.ct).then(function (hit) {
        if (!hit) return res || json({ ok: false, offline: true }, 503);
        var id = gUuid();
        return gAudio('readwrite', function (st) { st.put({ id: id, ask: body, at: Date.now() }); return null; }).then(function () {
          return json({ put_url: new URL('/__cb/ch-audio/' + id, self.location.origin).toString(), content_type: body.type || 'audio/webm', key: G_AUDIO_KEY + id, offline: true });
        });
      });
    };
    return fetch(req.clone()).then(function (res) { return res.status >= 500 || res.status === 401 ? here(res) : res; }, function () { return here(null); });
  });
}
function gChAudioPut(req, id) {
  return req.arrayBuffer().then(function (buf) {
    return gAudio('readonly', function (st) { return st.get(id); }).then(function (row) {
      if (!row) return json({ error: 'unknown_recording' }, 404);
      row.bytes = buf; row.type = req.headers.get('content-type') || (row.ask && row.ask.type) || 'audio/webm';
      return gAudio('readwrite', function (st) { st.put(row); return null; }).then(function () { return new Response('', { status: 200 }); });
    });
  }).then(null, function () { return json({ error: 'not_kept' }, 507); });
}
/** One kept reading, sent: fresh serve (the same story) -> the server's upload place -> the recording -> the result. */
function gChSendRead(q, put) {
  var drop = function () { return gAudio('readwrite', function (st) { st.delete(q.audio); return null; }).then(null, function () {}); };
  var jsonPost = function (path, b) { return fetch('/api/wq/ch/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(b) }); };
  return fetch(q.url, { cache: 'no-store', headers: { accept: 'application/json' } }).then(function (res) {
    if (!res.ok) return res.status >= 500 ? false : (q.state = 'refused_' + res.status, put(q));
    return res.clone().json().then(function (fresh) {
      if (!fresh.ct || !fresh.story || fresh.story.text !== q.story) { q.state = 'questions_changed'; return drop().then(function () { return put(q); }); }
      return gAudio('readonly', function (st) { return st.get(q.audio); }).then(function (row) {
        if (!row || !row.bytes) { q.state = 'recording_missing'; return put(q); }
        var ask = {}; for (var k in row.ask) if (Object.prototype.hasOwnProperty.call(row.ask, k)) ask[k] = row.ask[k];
        ask.ct = fresh.ct;
        return jsonPost('upload', ask).then(function (up) {
          if (up.status >= 500) return false;
          if (!up.ok) { q.state = 'refused_' + up.status; return put(q); }
          return up.json().then(function (u) {
            return fetch(u.put_url, { method: 'PUT', headers: { 'content-type': u.content_type || row.type }, body: row.bytes }).then(function (pr) {
              if (!pr.ok) return false;
              var b = {}; for (var k2 in q.body) if (Object.prototype.hasOwnProperty.call(q.body, k2)) b[k2] = q.body[k2];
              b.ct = fresh.ct; b.key = u.key;
              return jsonPost('result', b).then(function (out) {
                if (out.status >= 500) return false;
                if (!out.ok) { q.state = 'refused_' + out.status; return put(q); }
                return drop().then(function () { return gCh('readwrite', function (st) { st.delete(q.id); return null; }); }).then(function () {
                  fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_sent: { ex: 'read', recording: true, lag_s: Math.round((Date.now() - q.at) / 1000) } }) }).catch(function () {});
                  return fetch(q.url, { cache: 'no-store', headers: { accept: 'application/json' } }).then(function (nx) { return keep(q.url, nx); }, function () { return null; });
                });
              });
            });
          });
        });
      });
    });
  }).then(null, function () { return false; });
}
/** One waiting tap game, sent: first to the run the child really played (its token lives two hours), and only when
 *  that token has lapsed to a fresh serve of the same questions. false = no network yet (stop, try later). */
function gChSendTaps(q, put) {
  var same = function (a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); };
  var post = function (b) { return fetch('/api/wq/ch/result', { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(b) }); };
  var sent = function () {
    return gCh('readwrite', function (s) { s.delete(q.id); return null; }).then(function () {
      fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_sent: { ex: q.ex, answers: (q.body.taps || q.body.answers || []).length, lag_s: Math.round((Date.now() - q.at) / 1000) } }) }).catch(function () {});
      // the kept serve is now a finished one: keep the next, so the next play with no network starts from a live one
      return fetch(q.url, { cache: 'no-store', headers: { accept: 'application/json' } }).then(function (nx) { return keep(q.url, nx); }, function () { return null; });
    });
  };
  var fresh = function () {
    return fetch(q.url, { cache: 'no-store', headers: { accept: 'application/json' } }).then(function (res) {
      if (!res.ok) return res.status >= 500 ? false : (q.state = 'refused_' + res.status, put(q));
      return res.clone().json().then(function (fr) {
        if (!fr.ct || !same(fr.items, q.items)) { q.state = 'questions_changed'; return put(q); }
        var b = {}; for (var k in q.body) if (Object.prototype.hasOwnProperty.call(q.body, k)) b[k] = q.body[k];
        b.ct = fr.ct;
        return post(b).then(function (out) {
          if (out.status >= 500) return false;
          if (!out.ok) { q.state = 'refused_' + out.status; return put(q); }
          return sent();
        }, function () { return false; });
      });
    }, function () { return false; });
  };
  return post(q.body).then(function (first) {
    if (first.status >= 500) return false;
    return first.ok ? sent() : fresh();
  }, function () { return false; });
}
var gChSending = null;
function gChSend() {
  if (gChSending) return gChSending;
  var put = function (q) { return gCh('readwrite', function (s) { s.put(q); return null; }); };
  gChSending = gChWaiting().then(function (list) {
    return list.filter(function (q) { return q.state === 'waiting'; }).reduce(function (p, q) {
      return p.then(function (go) {
        if (go === false) return false;
        return q.kind === 'read' ? gChSendRead(q, put) : gChSendTaps(q, put);
      });
    }, Promise.resolve());
  }).then(null, function () {}).then(function () { gChSending = null; });
  return gChSending;
}
self.addEventListener('message', function (e) {
  var d = e.data || {};
  var port = e.ports && e.ports[0];
  if (d.type === 'report') { e.waitUntil(gChSend()); return; }
  if (d.type === 'games-audio-kept' && port) { e.waitUntil(gAudio('readonly', function (st) { return st.getAll(); }).then(function (l) { port.postMessage((l || []).length); }, function () { port.postMessage(0); })); return; }
  if (d.type === 'games-outbox' && port) {
    e.waitUntil(Promise.all([gChWaiting(), gRuns()]).then(function (v) {
      port.postMessage(v[0].map(function (q) { return { ex: q.ex, state: q.state, answers: (q.body.taps || q.body.answers || []).length, at: q.at }; })
        .concat(v[1].filter(function (r) { return r.local && !r.real; }).map(function (r) { return { ex: 'flight:' + (r.body && r.body.part), state: r.err ? 'refused_' + r.err : 'waiting', at: r.at }; })));
    }, function () { port.postMessage([]); }));
  }
});
/* ==================================== end of the games lane's block ==================================== */

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var u = new URL(req.url);
  if (u.pathname === '/__cb/report' || u.pathname === '/__cb/sw.js') return;
  if (gamesFetch(e)) return; // games lane: the big flight's runs, HEAD of a kept page
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
