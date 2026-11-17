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

// Storybooks (shelf, books, story steps, the speech key): sw-stories.js answers those first.
try { importScripts('/__cb/sw-stories.js'); } catch (e) { /* stories then go the general way below */ }

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim().then(homeMove)); }); // homeMove: block HOME

function keyFor(req) {
  var u = new URL(req.url);
  return u.toString();
}

function keep(key, res) {
  // 200, or an opaque answer for a file on another site (R2 clips): the browser plays those, it only cannot read them.
  if (!res || res.type === 'opaqueredirect' || (res.status !== 200 && res.type !== 'opaque')) return Promise.resolve();
  // VIDEOS (lane/home): a file of the media store seen while online is saved through this site (readable, charged at
  // its real size, one copy whatever its signature) rather than as an unreadable copy Chrome charges ~7 MB for.
  if (res.type === 'opaque' && videoStore(key)) {
    var spare = res.clone(); // kept unreadable only if this site cannot fetch it (no device key yet)
    return videoSave(key).then(function (r) { return r.ok ? null : keepAs(videoKeyOf(key), spare); }).catch(function () {});
  }
  var copy = res.clone();
  // HOME (lane/home): one saved copy per child home whatever link it was opened with; never a page that only says "ask again"
  return homeFit(copy).then(function (fit) { return fit ? keepAs(homeKey(key), fit) : null; }).catch(function () {});
}
function keepAs(key, res) { return caches.open(KEEP).then(function (c) { return c.put(key, res); }); }

function kept(key) {
  key = homeKey(key); // HOME (lane/home): a child home is saved once, under its children, not under each week's link
  return caches.open(KEEP).then(function (c) {
    // Never a looser match for a kept POST answer: every one shares /__cb/post, so ignoreSearch would hand one
    // child's session to another (it did, 28 Oct: child four played inside child three's session).
    if (key.indexOf('/__cb/post') >= 0) return c.match(key);
    // READY (lane/home): a door's list is the answer to its whole question (which door, which class, which subject):
    // never another list of the same address (sameAsk), where anything else may differ in its "?…".
    // STORIES (lane/stories): any other file is looked for exactly, then as the same file kept without its "?v=…"
    // (Get ready saves most files that way), and only then by a search of every kept file for the same path. That
    // search reads the whole list: 470 ms a miss at 4,800 files on a laptop, so it must never be the common case.
    var bare = key.split('?')[0];
    return c.match(key).then(function (hit) { return hit || (LIST_RX.test(key) ? sameAsk(c, key) : (bare !== key ? c.match(bare) : undefined)); })
      .then(function (hit) { return hit || (LIST_RX.test(key) ? undefined : c.match(key, { ignoreSearch: true })); })
      .then(function (hit) { return hit || homeFallback(c, key); }); // HOME: else this Chromebook's own saved home
  });
}

function miss(req, why) {
  if (savedOnly()) { testMisses.push({ u: req.url.slice(0, 300), why: why }); return; } // READY (lane/home): the self-test's own list
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
  // A blob of a kept file is a handle to it on the drive: cutting a slice does not read the whole file into memory
  // (a lesson video is 6-15 MB and a player asks for many slices).
  return full.blob().then(function (file) {
    var m = /bytes=(\d*)-(\d*)/.exec(range || '');
    var size = file.size;
    var start = m && m[1] ? Number(m[1]) : 0;
    var end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    return new Response(file.slice(start, end + 1), {
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
  return videoKept(req.url, key).then(function (hit) { // VIDEOS (lane/home): the readable copy Get ready saved, first
    if (hit) return range && hit.type !== 'opaque' ? slice(hit, range) : hit;
    // VIDEOS: a lesson video not saved yet plays from the network as asked (Get ready saves videos; playing one does
    // not start a second whole download). A small clip of the media store is saved readable, in the background.
    if (videoIs(req.url)) return fetch(req).catch(function () { return offlineAnswer(req); });
    if (videoStore(req.url)) { videoSave(req.url); return fetch(req).catch(function () { return offlineAnswer(req); }); }
    // Not kept yet: play from the network as asked, and keep the whole file for next time.
    var whole = new Request(req.url, { mode: req.mode === 'no-cors' ? 'no-cors' : 'cors', credentials: 'same-origin' });
    fetch(whole).then(function (res) { return keep(key, res); }).catch(function () {});
    return fetch(req).catch(function () { return offlineAnswer(req); });
  });
}

function bodyKey(req) {
  return req.clone().text().then(function (body) {
    body = homeKey(body); // HOME (lane/home): the same question asked with next week's link is the same question
    var h = 0;
    for (var i = 0; i < body.length; i += 1) h = (h * 31 + body.charCodeAt(i)) | 0;
    return new URL('/__cb/post?u=' + encodeURIComponent(homeKey(req.url)) + '&h=' + h, self.location.origin).toString();
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

/* ==== HOME (lane/home, bd-fc5mgd.13.3): this Chromebook's child home never goes stale ============================
 * Jugnu's home link /h/<token> lasts 7 days, locks to the first device that opens it, and is renewed by sending /quiz
 * on WhatsApp. A school Chromebook has no WhatsApp: on 4 Nov 2026 the pilot Chromebook's Home, Stories and Games all
 * read "This link has expired". So the pilot server signs each Chromebook its own link (server: POST /__cb/home, with
 * the device key), and this worker owns it:
 *
 *   the record   {hub, key, device, skew, ttl, who:{id, hub}} kept beside the saved files (HUB_KEY). `hub` is this
 *                Chromebook's home; `who` the home of the child picked on Who's playing?, when the server signs one.
 *   refresh      with a network, a link a day old is replaced in the background; one that has run out (or has under an
 *                hour left) is replaced before the page opens (at most HOME_MINT_WAIT_MS).
 *   any old link a page, a saved page or a bookmark that still names last week's link is sent to the live one; a data
 *                call or an answer that names it goes to the server with the live one.
 *   no network   the link's date is not looked at: the saved copy opens. Saved copies are filed under the home's
 *                children ("~h<tag>~"), not under each week's link, so they survive every refresh; a home link that
 *                was never saved here opens this Chromebook's own saved home.
 *   /cb/home     the one address that always opens the home (Home buttons, the start page, a shelf shortcut).
 *   never        a dead link is not sent to the server (it can only answer "expired"), and a page that only says "ask
 *                again" (Jugnu's fast first page giving up) is never saved over a good copy.
 * Other lanes: self.cbHome.live(urlOrBody) -> Promise<the same text with this Chromebook's live link in it>, for a
 * saved answer sent later (an outbox); self.cbHome.key(url) is the address a saved copy is filed under. */
var HOME_MINT_WAIT_MS = 3500;
var HOME_RETRY_MS = 20000;   // after an ask that failed (no network), not again for this long
var HOME_TOKEN_RX = /eyJ[A-Za-z0-9_-]{17,400}\.[A-Za-z0-9_-]{22}/g;
var homeSeen = {}, homeSeenN = 0, homeMem = null, homeAsking = {};

/** What a link says about itself, read without any key: its expiry and a short tag for its children. Null: not a home link. */
function homeInfo(token) {
  if (typeof token !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(homeSeen, token)) return homeSeen[token];
  var info = null;
  try {
    var p = JSON.parse(atob(token.slice(0, token.indexOf('.')).replace(/-/g, '+').replace(/_/g, '/')));
    if (p && p.k === 'h' && Array.isArray(p.ids) && p.ids.length && p.exp) {
      var s = p.ids.map(String).sort().join(','), h = 5381;
      for (var i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      info = { exp: Number(p.exp), tag: (h >>> 0).toString(36) };
    }
  } catch (e) { info = null; }
  if (homeSeenN > 400) { homeSeen = {}; homeSeenN = 0; }
  homeSeen[token] = info; homeSeenN += 1;
  return info;
}
/** The address (or body) a saved copy is filed under: every home link in it replaced by its children's tag. */
function homeKey(text) {
  if (typeof text !== 'string' || text.indexOf('eyJ') < 0) return text;
  return text.replace(HOME_TOKEN_RX, function (t) { var i = homeInfo(t); return i ? '~h' + i.tag + '~' : t; });
}
function homeTokens(text) {
  var out = [];
  if (typeof text !== 'string' || text.indexOf('eyJ') < 0) return out;
  (text.match(HOME_TOKEN_RX) || []).forEach(function (t) { if (homeInfo(t) && out.indexOf(t) < 0) out.push(t); });
  return out;
}
function homeNames(u) { return u.pathname === '/cb/home' || homeTokens(u.pathname).length > 0; }

function homeState() {
  if (homeMem) return Promise.resolve(homeMem);
  return caches.open(KEEP).then(function (c) { return c.match(HUB_KEY); }).then(function (r) { return r ? r.json() : {}; })
    .then(function (o) { homeMem = homeMem || (o && typeof o === 'object' ? o : {}); return homeMem; }, function () { homeMem = homeMem || {}; return homeMem; });
}
function homeSave() {
  return caches.open(KEEP).then(function (c) { return c.put(HUB_KEY, new Response(JSON.stringify(homeMem || {}), { headers: { 'Content-Type': 'application/json' } })); }).catch(function () {});
}
function homeTell(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) { c.postMessage(msg); }); }).catch(function () {});
}
// The server's clock, learnt from its last answer: a Chromebook whose own clock is wrong still reads expiry right.
function homeNow(st) { return Math.floor(Date.now() / 1000) + (st.skew || 0); }
function homeLeft(st, token) { var i = homeInfo(token); return i ? i.exp - homeNow(st) : -1; }
/** Which of the two links this Chromebook holds is for these children: 'hub' (its own), 'who' (the picked child's), or null. */
function homeSlot(st, tag) {
  var d = st.hub && homeInfo(st.hub), w = st.who && st.who.hub && homeInfo(st.who.hub);
  return d && d.tag === tag ? 'hub' : w && w.tag === tag ? 'who' : null;
}
function homeOf(st, slot) { return slot === 'who' ? (st.who && st.who.hub) || null : st.hub || null; }

/** Ask the server for a fresh link (this Chromebook's, or the picked child's). Resolves the link, or null. */
function homeMint(st, slot) {
  var student = slot === 'who' ? st.who && st.who.id : null;
  if (!st.key || (slot === 'who' && !student)) return Promise.resolve(null);
  var id = student || '';
  if (homeAsking[id]) return homeAsking[id];
  var ctl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, HOME_MINT_WAIT_MS);
  var body = { key: st.key, device: st.device || '' };
  if (st.lang) body.lang = st.lang;
  if (student) body.student = student;
  homeAsking[id] = fetch('/__cb/home', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
    .then(function (res) {
      // the server says no to a child's own home (per-child homes off, or not on the class list): not asked again for an hour
      if (student && (res.status === 409 || res.status === 404) && st.who && st.who.id === student) { st.who.no = Date.now(); return homeSave().then(function () { return null; }); }
      if (!res.ok) { st.triedAt = Date.now(); return null; }
      return res.json().then(function (j) {
        if (!j || !homeInfo(j.hub)) return null;
        var skew = Number(j.now) ? Number(j.now) - Math.floor(Date.now() / 1000) : 0;
        st.skew = Math.abs(skew) > 90 ? skew : 0;
        st.ttl = Number(j.ttl) || st.ttl;
        st.triedAt = 0;
        if (student) { if (st.who && st.who.id === student) { st.who.hub = j.hub; st.who.no = 0; } } else st.hub = j.hub;
        return homeSave().then(function () { homeTell({ type: 'cb-home', hub: st.hub, who: st.who && st.who.hub || null }); return j.hub; });
      });
    }, function () { st.triedAt = Date.now(); return null; })
    .then(function (v) { clearTimeout(timer); delete homeAsking[id]; return v; });
  return homeAsking[id];
}
/** The link to use now for a slot: fresh enough as it is, or freshly signed; null when it has run out and none can be had. */
function homeLive(st, slot) {
  var token = homeOf(st, slot);
  if (slot === 'who' && (!st.who || !st.who.id || (st.who.no && Date.now() - st.who.no < 3600000))) return Promise.resolve(null);
  var left = token ? homeLeft(st, token) : -1;
  var ttl = st.ttl || 604800;
  var may = Boolean(st.key) && self.navigator.onLine !== false && (!st.triedAt || Date.now() - st.triedAt > HOME_RETRY_MS);
  if (left > Math.min(3600, ttl / 10)) {
    if (left < ttl - Math.min(86400, ttl / 7) && may) homeMint(st, slot); // a day old: a newer one, for the next open
    return Promise.resolve(token);
  }
  if (!may) return Promise.resolve(left > 0 ? token : null);
  return homeMint(st, slot).then(function (fresh) { token = homeOf(st, slot); return fresh || (token && homeLeft(st, token) > 0 ? token : null); });
}
/** /cb/home: the picked child's own home when this Chromebook holds one, else this Chromebook's home (live, or saved). */
function homeOpen(st) {
  return homeLive(st, 'who').then(function (own) {
    if (own) return own;
    return homeLive(st, 'hub').then(function (hub) { return hub || (st.who && st.who.hub) || st.hub || null; });
  });
}

/** A GET that names a home link (a page, or its data): the live link, or the saved copy. */
function homeGet(req, u) {
  return homeState().then(function (st) {
    if (u.pathname === '/cb/home') {
      return homeOpen(st).then(function (hub) {
        if (hub) return Response.redirect('/h/' + hub + u.search, 302);
        return fetch(req).catch(function () { return offlineAnswer(req); }); // not set up yet: the server's own page says so
      });
    }
    var token = homeTokens(u.pathname)[0];
    var info = homeInfo(token);
    var key = keyFor(req);
    var nav = req.mode === 'navigate';
    var slot = homeSlot(st, info.tag);
    // a page that holds a newer link for the same children than this record (signed while the worker was not in charge)
    if (slot && info.exp > homeInfo(homeOf(st, slot)).exp + 60) { if (slot === 'who') st.who.hub = token; else st.hub = token; homeSave(); }
    var dead = info.exp - homeNow(st) <= 0;
    return (slot ? homeLive(st, slot) : Promise.resolve(null)).then(function (live) {
      if (live && live !== token && (nav || dead)) {
        var to = u.pathname.split(token).join(live) + u.search;
        if (nav) return Response.redirect(to, 302);
        req = new Request(to, { headers: req.headers, credentials: 'same-origin' });
      } else if (dead) {
        // run out, and no live one to be had (no network): the server could only say "expired", so it is not asked
        return kept(key).then(function (hit) { return hit || offlineAnswer(req); });
      }
      return networkFirst(req, key).then(function (res) {
        if (res.status !== 401) return res;
        // The server refuses a link this Chromebook thought good (its clock is wrong, or the key changed): a new one
        // for the next open, and the saved copy now.
        if (slot) homeMint(st, slot);
        return kept(key).then(function (hit) { return hit || res; });
      });
    });
  });
}

/** A POST that names a home link, in its address or its body. */
function homePost(req) {
  // READY (self-test): nothing is sent and nothing is queued; a saved answer is given, else a plain "offline"
  if (savedOnly()) return bodyKey(req).then(kept).then(function (hit) { return hit || json({ ok: false, offline: true, selftest: true }, 503); });
  return req.clone().text().then(function (body) {
    var tokens = homeTokens(new URL(req.url).pathname + ' ' + body);
    if (!tokens.length) return post(req);
    return homeState().then(function (st) {
      return Promise.all(tokens.map(function (t) {
        var slot = homeSlot(st, homeInfo(t).tag);
        if (!slot || homeLeft(st, t) > 0) return null; // not this Chromebook's, or still good: sent as it is
        return homeLive(st, slot).then(function (live) { return live && live !== t ? [t, live] : null; });
      })).then(function (pairs) {
        var url = req.url, text = body, changed = false;
        pairs.forEach(function (p) { if (p) { url = url.split(p[0]).join(p[1]); text = text.split(p[0]).join(p[1]); changed = true; } });
        var out = changed ? new Request(url, { method: 'POST', headers: req.headers, body: text, credentials: 'same-origin' }) : req;
        var hubJson = /^\/api\/wq\/hub\//.test(new URL(url).pathname);
        return (hubJson ? homeHub(out, st) : post(out)).then(function (res) {
          if (res.status !== 401) return res;
          return bodyKey(out).then(kept).then(function (hit) { return hit || res; }); // refused: the saved answer, if any
        });
      });
    });
  });
}
/* The home's own data (POST /api/wq/hub/<token> {device_ref, kid}). An answer `locked: true` means this link is locked to
 * another device (a link someone else opened first, or this Chromebook lost its cookie): it is never saved over a good
 * answer, and a new link is signed and the page told to open it (boot.js: cb-home-moved). */
function homeHub(req, st) {
  return bodyKey(req).then(function (key) {
    return fetch(req.clone()).then(function (res) {
      if (res.status >= 500) return kept(key).then(function (hit) { return hit || res; });
      if (!res.ok || !/json/.test(res.headers.get('Content-Type') || '')) return res;
      return res.clone().json().then(function (j) {
        var token = homeTokens(req.url)[0];
        var slot = token && homeSlot(st, homeInfo(token).tag);
        // The picked child's own home has no child in it: Jugnu does not know that class-list id. Not asked again for
        // an hour; the page is sent to this Chromebook's home.
        if (j && slot === 'who' && j.locked !== true && Array.isArray(j.kids) && !j.kids.length && st.who) {
          st.who.no = Date.now(); st.who.hub = null;
          homeSave().then(function () { homeTell({ type: 'cb-home-moved', from: token }); });
          return res;
        }
        if (!j || j.locked !== true) { keep(key, res); return res; }
        if (slot && homeOf(st, slot) === token && (!st.lockedAt || Date.now() - st.lockedAt > 60000)) {
          st.lockedAt = Date.now();
          homeMint(st, slot).then(function (hub) { if (hub) homeTell({ type: 'cb-home-moved', from: token }); });
        }
        return res;
      }, function () { return res; });
    }, function () {
      return kept(key).then(function (hit) {
        if (hit) return hit;
        miss(req, 'post_offline');
        return new Response(JSON.stringify({ ok: false, offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      });
    });
  });
}

/** A page to save, or null. Jugnu's fast first page ends in "ask again" when it gave up: that is not a page. */
function homeFit(copy) {
  if (copy.type === 'opaque' || !/^text\/html/i.test(copy.headers.get('Content-Type') || '')) return Promise.resolve(copy);
  return copy.text().then(function (t) {
    if (/location\.replace\(location\.pathname\+\(location\.search\?location\.search\+"&":"\?"\)\+"nf=1"\+location\.hash\)<\/script>\s*<\/body>\s*<\/html>\s*$/.test(t)) return null;
    if (/<script>setTimeout\(function\(\)\{location\.replace\([^<]{1,600}\+location\.hash\)\},\d+\)<\/script>\s*<\/body>\s*<\/html>\s*$/.test(t)) return null;
    return new Response(t, { status: copy.status, statusText: copy.statusText, headers: copy.headers });
  });
}
/** A home link that was never saved on this Chromebook (another child's, a new one): this Chromebook's own saved home. */
function homeFallback(c, key) {
  var m = /~h([0-9a-z]+)~/.exec(key);
  if (!m) return Promise.resolve(undefined);
  return homeState().then(function (st) {
    var own = st.hub && homeInfo(st.hub);
    if (!own || own.tag === m[1]) return undefined;
    var k = key.split('~h' + m[1] + '~').join('~h' + own.tag + '~');
    return c.match(k).then(function (hit) { return hit || c.match(k, { ignoreSearch: true }); });
  });
}
/** Once, when this worker takes over: copies saved under a link (the first pilot) are filed under the home's children. */
function homeMove() {
  return caches.open(KEEP).then(function (c) {
    return c.keys().then(function (reqs) {
      return reqs.filter(function (r) { return r.url.indexOf('eyJ') >= 0 && r.url !== HUB_KEY; }).reduce(function (p, r) {
        return p.then(function () {
          var to = r.url;
          if (r.url.indexOf('/__cb/post?u=') >= 0) { try { var u = new URL(r.url); u.searchParams.set('u', homeKey(u.searchParams.get('u') || '')); to = u.toString(); } catch (e) {} } else to = homeKey(r.url);
          if (to === r.url) return null;
          return c.match(r).then(function (res) { return res ? homeFit(res) : null; })
            .then(function (fit) { return fit ? c.match(to).then(function (has) { return has ? null : c.put(to, fit); }) : null; })
            .then(function () { return c.delete(r); });
        }).catch(function () {});
      }, Promise.resolve());
    });
  }).catch(function () {});
}

/** {type:'hub', hub, key?, device?}: the start page (or a test rig) names this Chromebook's home. */
function homeSet(d) {
  return homeState().then(function (st) {
    if (homeInfo(d.hub)) st.hub = d.hub; else if (!st.hub) st.hub = d.hub;
    if (typeof d.key === 'string' && d.key) st.key = d.key;
    if (typeof d.device === 'string' && d.device) st.device = d.device;
    return homeSave();
  });
}
/** {type:'home', key, device, who, lang, fresh}: a page hands over what it knows and gets the live home back. */
function homeAsk(d, port) {
  return homeState().then(function (st) {
    if (typeof d.key === 'string' && d.key) st.key = d.key;
    if (typeof d.device === 'string' && d.device) st.device = d.device;
    if (d.lang === 'en' || d.lang === 'ur') st.lang = d.lang;
    if (d.who !== undefined) {
      var id = typeof d.who === 'string' && /^[0-9a-f-]{36}$/i.test(d.who) ? d.who : null;
      if (!id) st.who = null; else if (!st.who || st.who.id !== id) st.who = { id: id };
    }
    return (d.fresh ? homeMint(st, 'hub') : Promise.resolve(null)).then(function () { return homeLive(st, 'hub'); }).then(function (hub) {
      return homeLive(st, 'who').then(function (own) {
        return homeSave().then(function () {
          var use = hub || st.hub || null;
          if (port) port.postMessage({ hub: use, live: Boolean(hub), left: use ? homeLeft(st, use) : null, who: own || null, signing: Boolean(st.key) });
        });
      });
    });
  }).catch(function () { if (port) port.postMessage({ hub: null, live: false }); });
}
self.cbHome = {
  key: homeKey,
  live: function (text) {
    return homeState().then(function (st) {
      return Promise.all(homeTokens(text).map(function (t) {
        var slot = homeSlot(st, homeInfo(t).tag);
        return slot ? homeLive(st, slot).then(function (live) { return live && live !== t ? [t, live] : null; }) : null;
      })).then(function (pairs) { pairs.forEach(function (p) { if (p) text = text.split(p[0]).join(p[1]); }); return text; });
    });
  },
};
/* ==== end HOME ================================================================================================== */

/* ==== VIDEOS (lane/home, bd-fc5mgd.13.3): lesson videos kept whole on the device ==================================
 * A lesson video is a signed link on another site (Cloudflare R2, good for 6 hours; no CORS headers). Asked for by a
 * <video> it comes back unreadable to this worker, so it could not be cut into the byte ranges a player asks for, and
 * its address changes with every signature. So Get ready fetches each one THROUGH this site (server: GET /__cb/media,
 * device-key gated, R2 hosts only), checks it arrived whole, and files it under its address without the signature.
 * A player's range requests are then cut from that copy (slice), with or without a network. */
var VIDEO_RX = /\.(mp4|webm|m4v|mov)$/i;
var READABLE_RX = /\.(mp4|webm|m4v|mov|mp3|m4a|ogg|opus|wav|jpg|jpeg|png|webp)$/i; // what GET /__cb/media will fetch
var VIDEO_STORE_RX = /\.r2\.cloudflarestorage\.com$|\.r2\.dev$/i;                  // Jugnu's media store (the server's MEDIA_HOSTS default)
var VIDEO_STALL_MS = 45000; // no bytes for this long: given up, tried again by the start page
/** Is this a file of Jugnu's media store that this site can fetch readable? */
function videoStore(url) { try { var u = new URL(url); return u.origin !== self.location.origin && VIDEO_STORE_RX.test(u.hostname) && READABLE_RX.test(u.pathname); } catch (e) { return false; } }
function videoIs(url) { try { var u = new URL(url); return u.origin !== self.location.origin && VIDEO_RX.test(u.pathname); } catch (e) { return false; } }
function videoKeyOf(url) { var u = new URL(url); return u.origin + u.pathname; }
/** The kept copy for a media request: the readable one saved through this site first; an unreadable video copy is not used. */
function videoKept(url, key) {
  var u;
  try { u = new URL(url); } catch (e) { return kept(key); }
  if (u.origin === self.location.origin) return kept(key);
  return caches.open(KEEP).then(function (c) { return c.match(videoKeyOf(url)); }).then(function (own) {
    if (own) return own;
    return kept(key).then(function (hit) { return hit && hit.type === 'opaque' && VIDEO_RX.test(u.pathname) ? undefined : hit; });
  });
}
/** Fetch a media file on another site through this site and keep it whole. Resolves {ok, had|bytes} or {ok:false, why}. */
function videoSave(url, fresh) {
  var key = videoKeyOf(url);
  return caches.open(KEEP).then(function (c) {
    return (fresh ? Promise.resolve(null) : c.match(key)).then(function (hit) {
      if (hit) return { ok: true, had: true };
      return homeState().then(function (st) {
        var ctl = typeof AbortController === 'function' ? new AbortController() : null;
        var stall = null;
        var arm = function () { clearTimeout(stall); stall = setTimeout(function () { if (ctl) ctl.abort(); }, VIDEO_STALL_MS); };
        arm();
        return fetch('/__cb/media?u=' + encodeURIComponent(url), { headers: { 'X-CB-Key': st.key || '' }, signal: ctl ? ctl.signal : undefined }).then(function (res) {
          // Only this site's own media route is believed (it marks its answers), and only a media file is saved: a
          // server without the route hands the request to Jugnu, which answers any unknown address with a web page.
          if (res.headers.get('X-CB-Media') !== '1') { clearTimeout(stall); return { ok: false, why: 'no_route' }; }
          if (res.status !== 200 || !res.body) { clearTimeout(stall); return { ok: false, why: 'http_' + res.status }; }
          var want = Number(res.headers.get('Content-Length')) || 0;
          var type = res.headers.get('Content-Type') || 'application/octet-stream';
          if (/^text\/|json|xml/i.test(type)) { clearTimeout(stall); return { ok: false, why: 'not_media' }; }
          var reader = res.body.getReader(), chunks = [], got = 0;
          var pump = function () {
            arm();
            return reader.read().then(function (r) { if (r.done) return null; chunks.push(r.value); got += r.value.byteLength; return pump(); });
          };
          return pump().then(function () {
            clearTimeout(stall);
            if (!got || (want && got !== want)) return { ok: false, why: 'short' };
            var whole = new Response(new Blob(chunks, { type: type }), { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(got) } });
            return c.put(key, whole).then(function () {
              // unreadable copies of the same file (saved before, one per signature) are dropped: each is charged ~7 MB
              return c.keys(key, { ignoreSearch: true }).then(function (same) { return Promise.all(same.filter(function (r) { return r.url !== key; }).map(function (r) { return c.delete(r); })); });
            }).then(function () { return { ok: true, bytes: got }; });
          });
        }).catch(function (e) { clearTimeout(stall); return { ok: false, why: e && e.name === 'QuotaExceededError' ? 'no_room' : 'failed' }; });
      });
    });
  }).catch(function (e) { return { ok: false, why: e && e.name === 'QuotaExceededError' ? 'no_room' : 'failed' }; });
}
/* ==== end VIDEOS ================================================================================================ */

/* ==== READY (lane/home, bd-fc5mgd.13.3): what Get ready meant to save, and a self-test that reaches no network ====
 *   expect     the start page tells the worker every address a step set out to save (per step); `audit` then says,
 *              per step, how many are really on the device and names the missing ones. "Ready" is said only at zero.
 *   saved-only for the self-test: until it is switched off (or SAVED_ONLY_MAX_MS passes) this worker reaches no
 *              network at all, exactly as with the Wi-Fi off, so a page opened then shows what the device alone can
 *              do; every miss in that time goes to the self-test's list, not to the server's. */
var keptN = null, keptAt = 0;
/* The lists behind the three doors (Stories and Games rows: /api/wq/doors/…?d=…&g=…; Videos: /api/wq/lib/…?g=…&s=…).
 * Their "?…" chooses WHICH list. Before this, a list not on the drive was answered with any saved list of the same
 * address: the Games door showed the Stories rows, a class whose lessons were not saved showed another class's. Now a
 * saved list answers only the same question: the same names and values after "?", in any order. */
var LIST_RX = /\/api\/wq\/(lib|doors)\//;
function askOf(url) { var out = []; new URL(url).searchParams.forEach(function (v, k) { out.push(k + '=' + v); }); return out.sort().join('&'); }
function sameAsk(c, key) {
  var want = askOf(key);
  return c.keys(key, { ignoreSearch: true }).then(function (reqs) {
    var same = reqs.filter(function (r) { return askOf(r.url) === want; })[0];
    return same ? c.match(same) : undefined;
  });
}
var SAVED_ONLY_MAX_MS = 120000;
var savedOnlyUntil = 0, testMisses = [];
function savedOnly() { return Date.now() < savedOnlyUntil; }
var netFetch = self.fetch.bind(self);
self.fetch = function () { return savedOnly() ? Promise.reject(new TypeError('saved-only (self-test)')) : netFetch.apply(null, arguments); };

function expectKey(step) { return new URL('/__cb/expect/' + encodeURIComponent(step), self.location.origin).toString(); }
function expectAdd(step, urls, reset, drop) {
  return caches.open(KEEP).then(function (c) {
    return (reset ? Promise.resolve(null) : c.match(expectKey(step))).then(function (r) { return r ? r.json() : []; }).then(function (list) {
      var seen = {};
      if (drop) { urls.forEach(function (u) { seen[u] = 1; }); list = list.filter(function (u) { return !seen[u]; }); urls = []; }
      list.forEach(function (u) { seen[u] = 1; });
      urls.forEach(function (u) { if (!seen[u]) { seen[u] = 1; list.push(u); } });
      return c.put(expectKey(step), new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } })).then(function () { return list.length; });
    });
  });
}
/** Is this address on the device? Our own files by their exact address; another site's by its path. */
function has(c, u) {
  var cross = new URL(u).origin !== self.location.origin;
  if (!cross) return c.match(homeKey(u)).then(Boolean);
  return c.match(videoKeyOf(u)).then(function (own) { return own || c.match(u, { ignoreSearch: true }); }).then(function (hit) { return Boolean(hit) && !(hit.type === 'opaque' && videoIs(u)); });
}
function audit() {
  return caches.open(KEEP).then(function (c) {
    return c.keys().then(function (reqs) {
      var prefix = new URL('/__cb/expect/', self.location.origin).toString();
      var lists = reqs.filter(function (r) { return r.url.indexOf(prefix) === 0; });
      var out = { steps: [], total: 0, missing: 0, kept: reqs.length };
      return lists.reduce(function (p, r) {
        return p.then(function () { return c.match(r); }).then(function (res) { return res ? res.json() : []; }).then(function (list) {
          var step = { step: decodeURIComponent(r.url.slice(prefix.length)), total: list.length, missing: 0, sample: [] };
          var i = 0;
          var next = function () {
            if (i >= list.length) return Promise.resolve();
            var batch = list.slice(i, i + 40); i += 40;
            return Promise.all(batch.map(function (u) { return has(c, u).then(function (ok) { if (!ok) { step.missing += 1; if (step.sample.length < 25) step.sample.push(u.replace(/\?X-Amz.*$/, '').slice(0, 200)); } }, function () { step.missing += 1; }); })).then(next);
          };
          return next().then(function () { out.steps.push(step); out.total += step.total; out.missing += step.missing; });
        });
      }, Promise.resolve()).then(function () { return out; });
    });
  });
}
function readyMessage(d, port, e) {
  var reply = function (v) { if (port) port.postMessage(v); };
  if (d.type === 'expect' && typeof d.step === 'string' && Array.isArray(d.urls)) {
    e.waitUntil(expectAdd(d.step.slice(0, 60), d.urls.filter(function (u) { return typeof u === 'string' && /^https?:/.test(u); }), d.reset === true, d.drop === true).then(function (n) { reply({ ok: true, n: n }); }, function () { reply({ ok: false }); }));
    return true;
  }
  if (d.type === 'audit') { e.waitUntil(audit().then(reply, function () { reply(null); })); return true; }
  if (d.type === 'have' && Array.isArray(d.urls)) {
    e.waitUntil(caches.open(KEEP).then(function (c) { return Promise.all(d.urls.map(function (u) { return has(c, u).catch(function () { return false; }); })); }).then(reply, function () { reply(null); }));
    return true;
  }
  // the saved copy of a page or list as text, with no network asked (null when it is not on the drive)
  if (d.type === 'kept-text' && typeof d.url === 'string') {
    e.waitUntil(kept(d.url).then(function (r) { return r && r.type !== 'opaque' ? r.text() : null; }).then(reply, function () { reply(null); }));
    return true;
  }
  if (d.type === 'saved-only') {
    if (d.on) { savedOnlyUntil = Date.now() + Math.min(SAVED_ONLY_MAX_MS, Number(d.ms) || SAVED_ONLY_MAX_MS); if (d.clear !== false) testMisses = []; reply({ on: true, until: savedOnlyUntil }); } else { savedOnlyUntil = 0; reply({ on: false, misses: testMisses.splice(0, testMisses.length) }); }
    return true;
  }
  return false;
}
/* ==== end READY ================================================================================================= */

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
// The session's id in Jugnu's database, read from its own session token: with it a quiz started on the device
// (lsid, which boot.js recorded beside the picked child) names the very row it became (lane/home: who played).
function sessionIdOf(st) {
  try { var p = JSON.parse(atob(String(st).slice(0, String(st).indexOf('.')).replace(/-/g, '+').replace(/_/g, '/'))); return (p && p.sid) || null; } catch (e) { return null; }
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
            body: JSON.stringify({ synced: { lsid: r.lsid, session_id: sessionIdOf(r.realSt), played_at: new Date(r.createdAt).toISOString(), name: r.session.new && r.session.new.name, answers: items.length, finished: !!r.done, score: r.result && r.result.score, lag_s: Math.round((Date.now() - r.createdAt) / 1000) } }) }).catch(function () {});
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
  // HOME (lane/home): a home link named in the body (a run's start: {t}) is sent as this Chromebook's live link, so a
  // part started with no network last week is opened with a link the server still takes
  return gLive(JSON.stringify(body)).then(function (text) {
    return fetch('/api/sa-game/s/' + path, { method: 'POST', headers: headers, credentials: 'include', cache: 'no-store', body: text });
  });
}
function gLive(text) { return self.cbHome && self.cbHome.live ? self.cbHome.live(text).then(null, function () { return text; }) : Promise.resolve(text); }
function gJsonOf(res) { return res.clone().text().then(function (t) { try { return t ? JSON.parse(t) : {}; } catch (e) { return {}; } }, function () { return {}; }); }

/** POST /session: the server's run when it answers; a run on this device when there is no network. */
function gOpenRun(req, body, device) {
  var local = function () {
    var sid = gUuid();
    return gPutRun({ sid: sid, pageSt: G_LOCAL + sid, body: body, device: device, local: true, real: null, at: Date.now() })
      .then(function () { return json({ session_id: sid, st: G_LOCAL + sid, local: true }); });
  };
  return gPost('session', body, device).then(function (res) {
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
var G_REFUSED_WAIT_MS = 6 * 60 * 60 * 1000; // a start the server refused is not asked for again for this long
function gRealOf(r) {
  if (r.real && r.real.st) return Promise.resolve(r.real);
  // The server said no to this run's start (the Big flight already flown this month: 409; not this child: 401/403).
  // The engine sends a batch and one call per recording on every retry, and each used to ask for the run again:
  // 3,334 asks in four minutes from ten Chromebooks on 17 Nov, all behind one address for Jugnu's limits. The answer
  // is remembered; the run's answers stay on the device.
  if (r.refused && Date.now() - r.refused.at < G_REFUSED_WAIT_MS) return Promise.reject(json(r.refused.body || { error: 'refused' }, r.refused.status));
  if (gOpening[r.sid]) return gOpening[r.sid];
  var done = function () { delete gOpening[r.sid]; };
  gOpening[r.sid] = gPost('session', r.body, r.device).then(function (res) {
    return gJsonOf(res).then(function (j) {
      if (res.ok && j.session_id && j.st) {
        r.real = { session_id: j.session_id, st: j.st, at: Date.now() }; r.err = null;
        return gPutRun(r).then(function () { return r.real; });
      }
      r.err = res.status + ' ' + (j.error || '');
      if (res.status >= 400 && res.status < 500 && res.status !== 429) r.refused = { status: res.status, body: j, at: Date.now() };
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
  var hu = new URL(req.url);
  // the sea map is kept once per child home and language: look for exactly that, not for "any address like this one"
  // (a search of every kept file: 470 ms a miss at 4,800 files, lane/stories)
  var hkey = /^\/sa-game\/[^/]+$/.test(hu.pathname) ? hu.origin + hu.pathname + '?kid=' + (hu.searchParams.get('kid') || '') + '&lang=' + (hu.searchParams.get('lang') || '') : req.url;
  var keptAnswer = function (res) {
    return kept(hkey).then(function (hit) {
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
/* A recording's upload. Jugnu gives the page a signed address on its storage bucket and the page PUTs the recording
 * there; the bucket accepts that only from Jugnu's own site (its CORS rule answers 403 to any other origin), and the
 * pilot is another site, so the browser stops the upload. The pilot's server passes it on instead (/__cb/r2put). */
var G_BUCKET = /\.r2\.cloudflarestorage\.com$/;
function gPutAway(url, type, body) {
  return fetch('/__cb/r2put?u=' + encodeURIComponent(url), { method: 'PUT', headers: { 'content-type': type || 'application/octet-stream' }, body: body });
}
function gamesFetch(e) {
  var req = e.request;
  var u = new URL(req.url);
  if (savedOnly()) return false; // READY (lane/home): the self-test reaches no network; its own rules answer
  if (req.method === 'PUT' && G_BUCKET.test(u.hostname)) {
    e.respondWith(req.arrayBuffer().then(function (buf) { return gPutAway(req.url, req.headers.get('content-type'), buf); }).then(null, function () { return new Response('', { status: 503 }); }));
    return true;
  }
  if (u.origin !== self.location.origin) return false;
  if (req.method === 'HEAD') { e.respondWith(gHead(req)); return true; }
  // The sea map is kept per child and language only: back from a part its address also carries done= and s=, and a
  // looser match would hand an Urdu child the English map (whichever was kept first).
  // The child's battery page is one page whatever its address carries (session, part, language): one kept copy,
  // renewed whenever it is opened online. A looser match used to hand back the oldest copy kept (a page from before
  // an update, e.g. without the Chromebook layout).
  if (req.method === 'GET' && u.pathname === '/sa/play.html') { e.respondWith(networkFirst(req, u.origin + '/sa/play.html')); return true; }
  if (req.method === 'GET' && /^\/sa-game\/[^/]+$/.test(u.pathname)) {
    var canon = u.origin + u.pathname + '?kid=' + (u.searchParams.get('kid') || '') + '&lang=' + (u.searchParams.get('lang') || '');
    if (!homeNames(u)) { e.respondWith(networkFirst(req, canon)); return true; }
    // a home link in the address: the HOME block owns it (the live link, the copy filed under the home's children).
    // The plain map address is left to it whole; back from a part, it is asked for the plain address's copy.
    if (canon === req.url) return false;
    e.respondWith(homeGet(new Request(canon, { headers: req.headers, credentials: 'same-origin' }), new URL(canon)));
    return true;
  }
  if (/^\/api\/sa-game\/s\/(session|batch|audio\/presign|audio\/register|status)$/.test(u.pathname)) { e.respondWith(gSaGame(req, u)); return true; }
  if (req.method === 'POST' && u.pathname === '/api/wq/ch/result') { e.respondWith(gChResult(req)); return true; }
  if (req.method === 'POST' && u.pathname === '/api/wq/ch/upload') { e.respondWith(gChUpload(req)); return true; }
  if (req.method === 'POST' && u.pathname === '/api/wq/ch/qs') { e.respondWith(gListenQs(req)); return true; }
  if (req.method === 'POST' && u.pathname === '/api/wq/ch/qa') { e.respondWith(gListenQa(req)); return true; }
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
 * warm-up never change), the taps go up with the new token. Other questions: the taps are not sent, and say so.
 *
 * A LATE result (18 Nov 2026). The run a result belongs to is the run it was played in, and Jugnu now takes a result
 * for that run after its token has lapsed and after its row was closed (a day), when the request says it is late
 * (NIETE-Rumi #5015, switch web_quiz_challenge_late_result; `late: { at: when the child finished, this device's
 * clock }`). So every waiting result is sent to its own run FIRST, saying so. Only when the server refuses that (401:
 * the switch is off there, or the run is older than 45 days) is a fresh serve tried as before. A result the server
 * will not take either way is KEPT (with its recording) and offered again twice a day while its run is young enough
 * to be taken; it is never dropped while it could still count. 409 from the run itself means it has its result. */
var G_LATE_MAX_MS = 45 * 24 * 60 * 60 * 1000;   // how old a run may be for Jugnu to take its late result
var G_AGAIN_MS = 12 * 60 * 60 * 1000;           // a result the server would not take is offered again this often
var G_FULL_MS = 6 * 60 * 60 * 1000;             // the day's readings are used up (429): tried again after this
var gCh = function (mode, fn) { return grec('ch', mode, fn); };
/** A copy of a waiting result's body that says it is late: when the child finished, by this device. */
function gLate(body, q) { var b = {}; for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) b[k] = body[k]; b.late = { at: q.at }; return b; }
/** Is this waiting result to be sent now? waiting: yes, unless it was told to wait; not taken before: twice a day. */
function gChDue(q, now) {
  if (q.wait && q.wait > now) return false;
  if (q.state === 'waiting') return true;
  return q.state === 'questions_changed' && now - q.at < G_LATE_MAX_MS;
}
function gChWaiting() { return gCh('readonly', function (s) { return s.getAll(); }).then(function (l) { return l || []; }, function () { return []; }); }
/** A kept serve's real address: saved copies are filed under the home's children ("~h<tag>~", lane/home); the link
 *  itself is the one in the address of the page that asks (its referrer). */
function gChAddress(key, req) {
  var m = /\/c\/([^/?#]+)/.exec((req && req.referrer) || '');
  return m ? key.replace(/~h[0-9a-z]+~/, m[1]) : key;
}
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
        return gCh('readwrite', function (st) { st.add({ kind: 'read', url: gChAddress(hit.url, req), ex: hit.serve.ex || 'read', story: (hit.serve.story && hit.serve.story.text) || null, audio: body.key.slice(G_AUDIO_KEY.length), body: body, state: 'waiting', at: Date.now() }); return null; })
          .then(function () { gChSend(); return json({ later: true, offline: true }); });
      });
    }
    var later = function (res) {
      // a tap game's result, and only from a serve kept here
      if (!body.ct || (!Array.isArray(body.taps) && !Array.isArray(body.answers))) return res || json({ ok: false, offline: true }, 503);
      return gChServeOf(body.ct).then(function (hit) {
        if (!hit) return res || json({ ok: false, offline: true }, 503);
        return gCh('readwrite', function (s) { s.add({ url: gChAddress(hit.url, req), ex: hit.serve.ex || null, items: hit.serve.items || [], body: body, state: 'waiting', at: Date.now() }); return null; })
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
/** One kept reading, sent. First for the run it was read in (a late result: see above); when the server will not
 *  take that, to a fresh serve of the SAME story; neither: it waits, with its recording. false = no network yet. */
function gChSendRead(q, put) {
  var drop = function () { return gAudio('readwrite', function (st) { st.delete(q.audio); return null; }).then(null, function () {}); };
  var jsonPost = function (path, b) { return fetch('/api/wq/ch/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(b) }); };
  var copy = function (o) { var c = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; return c; };
  var hold = function (state, ms) { q.state = state; q.wait = Date.now() + ms; return put(q); };
  var done = function (already) {
    return drop().then(function () { return gCh('readwrite', function (st) { st.delete(q.id); return null; }); }).then(function () {
      fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_sent: { ex: 'read', recording: true, already: !!already, lag_s: Math.round((Date.now() - q.at) / 1000) } }) }).catch(function () {});
      return fetch(q.url, { cache: 'no-store', headers: { accept: 'application/json' } }).then(function (nx) { return keep(q.url, nx); }, function () { return null; });
    });
  };
  // what the server said: 'ok' | 'down' (no network: later) | 'lapsed' (401) | 'done' (409: the run has its reading)
  //                       | 'full' (429: enough readings for today) | 'refused_<status>'
  var said = function (res) { return res.status >= 500 ? 'down' : res.status === 401 ? 'lapsed' : res.status === 409 ? 'done' : res.status === 429 ? 'full' : res.ok ? 'ok' : 'refused_' + res.status; };
  /** The recording and its result, with the token `ct` (late: for the run it was read in). */
  var send = function (row, ct, late) {
    var ask = copy(row.ask); ask.ct = ct; if (late) ask.late = late;
    return jsonPost('upload', ask).then(function (up) {
      if (said(up) !== 'ok') return said(up);
      return up.json().then(function (u) {
        var up2 = G_BUCKET.test(new URL(u.put_url).hostname) ? gPutAway(u.put_url, u.content_type || row.type, row.bytes)
          : fetch(u.put_url, { method: 'PUT', headers: { 'content-type': u.content_type || row.type }, body: row.bytes });
        return up2.then(function (pr) {
          if (!pr.ok) return 'down';
          var b = copy(q.body); b.ct = ct; b.key = u.key; if (late) b.late = late;
          return jsonPost('result', b).then(said);
        });
      });
    }).then(null, function () { return 'down'; });
  };
  var settle = function (st) {
    if (st === 'down') return false;
    if (st === 'ok' || st === 'done') return done(st === 'done');
    if (st === 'full') return hold('waiting', G_FULL_MS);
    if (st === 'lapsed') return hold('questions_changed', G_AGAIN_MS);   // kept, with its recording
    q.state = st; return put(q);
  };
  return gAudio('readonly', function (st) { return st.get(q.audio); }).then(function (row) {
    if (!row || !row.bytes) { q.state = 'recording_missing'; return put(q); }
    return send(row, q.body.ct, { at: q.at }).then(function (st) {
      if (st !== 'lapsed') return settle(st);
      // the server takes no late result for that run: a fresh serve, and only of the same story
      return gLive(q.url).then(function (url) { return fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } }); }).then(function (res) {
        if (!res.ok) return res.status >= 500 ? false : (q.state = 'refused_' + res.status, put(q));
        return res.clone().json().then(function (fresh) {
          if (!fresh.ct || !fresh.story || fresh.story.text !== q.story) return settle('lapsed');
          return send(row, fresh.ct, null).then(settle);
        });
      }, function () { return false; });
    });
  }).then(null, function () { return false; });
}
/** One waiting tap game, sent: first to the run the child really played, saying it is late (see above); only when
 *  the server refuses that, to a fresh serve of the same questions. false = no network yet (stop, try later). */
function gChSendTaps(q, put) {
  var same = function (a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); };
  var post = function (b) { return fetch('/api/wq/ch/result', { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(b) }); };
  var sent = function (already) {
    return gCh('readwrite', function (s) { s.delete(q.id); return null; }).then(function () {
      fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_sent: { ex: q.ex, answers: (q.body.taps || q.body.answers || []).length, already: !!already, lag_s: Math.round((Date.now() - q.at) / 1000) } }) }).catch(function () {});
      // the kept serve is now a finished one: keep the next, so the next play with no network starts from a live one
      return fetch(q.url, { cache: 'no-store', headers: { accept: 'application/json' } }).then(function (nx) { return keep(q.url, nx); }, function () { return null; });
    });
  };
  var fresh = function () {
    return gLive(q.url).then(function (url) { return fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } }); }).then(function (res) {
      if (!res.ok) return res.status >= 500 ? false : (q.state = 'refused_' + res.status, put(q));
      return res.clone().json().then(function (fr) {
        if (!fr.ct || !same(fr.items, q.items)) { q.state = 'questions_changed'; q.wait = Date.now() + G_AGAIN_MS; return put(q); }
        var b = {}; for (var k in q.body) if (Object.prototype.hasOwnProperty.call(q.body, k)) b[k] = q.body[k];
        b.ct = fr.ct;
        return post(b).then(function (out) {
          if (out.status >= 500) return false;
          if (!out.ok) { q.state = 'refused_' + out.status; return put(q); }
          return sent(false);
        }, function () { return false; });
      });
    }, function () { return false; });
  };
  return post(gLate(q.body, q)).then(function (first) {
    if (first.status >= 500) return false;
    if (first.ok) return sent(false);
    if (first.status === 409) return sent(true);   // that run already has its result: nothing more to send for it
    return fresh();
  }, function () { return false; });
}
var gChSending = null;
function gChSend() {
  if (gChSending) return gChSending;
  var put = function (q) { return gCh('readwrite', function (s) { s.put(q); return null; }); };
  gChSending = gChWaiting().then(function (list) {
    var now = Date.now();
    // too old for the server to take any more: it says so, and a child's recording does not stay on the device
    list.filter(function (q) { return q.state === 'questions_changed' && now - q.at >= G_LATE_MAX_MS; }).forEach(function (q) {
      q.state = 'too_old';
      if (q.audio) gAudio('readwrite', function (st) { st.delete(q.audio); return null; }).then(null, function () {});
      put(q);
    });
    return list.filter(function (q) { return gChDue(q, now); }).reduce(function (p, q) {
      return p.then(function (go) {
        if (go === false) return false;
        return q.kind === 'read' ? gChSendRead(q, put) : q.kind === 'listen' ? gChSendListen(q, put) : gChSendTaps(q, put);
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
/* ---- games lane: Listen (a story, then questions about it) with no network ----
 * The story is a clip and plays from the device. Its questions are not in the game's page: after the story the page
 * asks the server for them (POST ch/qs {ct}: three questions, each with three choices in an order of that run's
 * own), and every answer is checked there (POST ch/qa {ct, q, pick} -> {ok, answer: the right choice's words}).
 * So with no network Listen stopped after the story ("Something went wrong").
 *   Get ready (message listen-prepare {url}): the game is asked for, and its questions; when the right choices of
 *     those questions are not known on this device yet, that one run is answered to learn them (ch/qa says the right
 *     words: one practice run per story per Chromebook, never a record), and a new run is asked for and kept in its
 *     place with its questions.
 *   no network: ch/qs is answered with the kept run's questions; ch/qa from the right words kept; the answers wait.
 *   back online: they go to the run they were given in; when its token has lapsed (two hours), a fresh run of the
 *     same story is asked for and each answer goes to it by the WORDS chosen (a run's order of choices is its own).
 *     The story is named by its id, so there is always the same story to send to. */
var G_RIGHTS = new URL('/__cb/listen-rights', self.location.origin).toString();
function gLqKey(ct) { return new URL('/__cb/listen-qs?ct=' + encodeURIComponent(ct), self.location.origin).toString(); }
function gJsonKept(key) { return caches.open(KEEP).then(function (c) { return c.match(key); }).then(function (r) { return r ? r.json() : null; }).then(null, function () { return null; }); }
function gJsonKeep(key, v) { return caches.open(KEEP).then(function (c) { return c.put(key, new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } })); }).then(null, function () {}); }
function gChPost(path, b) { return fetch('/api/wq/ch/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify(b) }); }
function gListenQs(req) {
  return req.clone().text().then(function (t) {
    var body = {}; try { body = JSON.parse(t || '{}'); } catch (e) { body = {}; }
    var kept = function (res) { return gJsonKept(gLqKey(body.ct)).then(function (q) { return q && q.questions ? json({ questions: q.questions, offline: true }) : (res || json({ ok: false, offline: true }, 503)); }); };
    return fetch(req.clone()).then(function (res) {
      if (res.status >= 500 || res.status === 401) return kept(res);
      if (res.ok && body.ct) res.clone().json().then(function (j) { if (j && j.questions && j.questions.some(function (q) { return q.options; })) gJsonKeep(gLqKey(body.ct), { questions: j.questions }); }, function () {});
      return res;
    }, function () { return kept(null); });
  });
}
function gListenQa(req) {
  return req.clone().text().then(function (t) {
    var body = {}; try { body = JSON.parse(t || '{}'); } catch (e) { body = {}; }
    var here = function (res) {
      return Promise.all([gJsonKept(gLqKey(body.ct)), gJsonKept(G_RIGHTS)]).then(function (v) {
        var q = v[0] && (v[0].questions || []).filter(function (x) { return x.id === body.q; })[0];
        var right = v[1] && v[1][body.q];
        if (!q || !q.options || right == null) return res || json({ ok: false, offline: true }, 503);
        var text = q.options[Number(body.pick)];
        return gChServeOf(body.ct).then(function (hit) {
          return gChWaiting().then(function (list) {
            var e = list.filter(function (x) { return x.kind === 'listen' && x.ct === body.ct && x.state === 'waiting'; })[0]
              || { kind: 'listen', ex: 'listen', ct: body.ct, url: hit ? gChAddress(hit.url, req) : null, answers: [], body: { taps: [] }, state: 'waiting', at: Date.now() };
            if (!e.answers.some(function (a) { return a.q === body.q; })) { e.answers.push({ q: body.q, text: text, body: body }); e.body.taps.push(body.q); }
            return gCh('readwrite', function (st) { st.put(e); return null; });
          });
        }).then(function () { return json({ ok: text === right, answer: right, offline: true }); });
      });
    };
    return fetch(req.clone()).then(function (res) {
      if (res.status >= 500 || res.status === 401) return here(res);
      // what the server says is the right choice is kept: the next time this question is met with no network
      if (res.ok && body.q) res.clone().json().then(function (j) { if (j && typeof j.answer === 'string') gJsonKept(G_RIGHTS).then(function (r) { r = r || {}; r[body.q] = j.answer; return gJsonKeep(G_RIGHTS, r); }); }, function () {});
      return res;
    }, function () { return here(null); });
  });
}
/** Get ready for one Listen story (its game address) -> {ok, questions, probed, media}. */
function gListenPrepare(url) {
  var abs = new URL(url, self.location.origin).toString();
  var serve = function () { return gLive(abs).then(function (u) { return fetch(u, { cache: 'no-store', headers: { accept: 'application/json' } }); }); };
  var asked = function (ct, lang) { return gChPost('qs', { ct: ct, lang: lang }).then(function (r) { return r.ok ? r.json() : null; }); };
  var media = function (j, q) { var m = []; if (j.story_clip && j.story_clip.url) m.push(j.story_clip.url); ((q && q.questions) || []).forEach(function (x) { if (x.clip && x.clip.url) m.push(x.clip.url); (x.option_clips || []).forEach(function (o) { if (o && o.url) m.push(o.url); }); }); return m; };
  var keepRun = function (res, j, q) { return keep(abs, res).then(function () { return gJsonKeep(gLqKey(j.ct), { questions: q.questions }); }).then(function () { return { ok: true, questions: q.questions.length, media: media(j, q) }; }); };
  return serve().then(function (res) {
    if (!res.ok) return { ok: false, why: 'serve_' + res.status };
    return res.clone().json().then(function (j) {
      if (!j.ct) return { ok: false, why: 'no_run' };
      return asked(j.ct, j.lang).then(function (q) {
        if (!q || !q.questions || !q.questions.length) return { ok: false, why: 'no_questions' };
        return gJsonKept(G_RIGHTS).then(function (rights) {
          rights = rights || {};
          var unknown = q.questions.filter(function (x) { return rights[x.id] == null; });
          if (!unknown.length) return keepRun(res, j, q).then(function (o) { o.probed = false; return o; });
          // learn the right words: this run is answered (first choice each), then another is kept in its place
          return unknown.reduce(function (p, x) {
            return p.then(function () { return gChPost('qa', { ct: j.ct, q: x.id, pick: 0, lang: j.lang }); }).then(function (r) { return r.ok ? r.json() : null; }).then(function (a) { if (a && typeof a.answer === 'string') rights[x.id] = a.answer; });
          }, Promise.resolve()).then(function () { return gJsonKeep(G_RIGHTS, rights); }).then(function () {
            if (q.questions.some(function (x) { return rights[x.id] == null; })) return { ok: false, why: 'right_answers_unknown' };
            return serve().then(function (res2) {
              if (!res2.ok) return { ok: false, why: 'serve_' + res2.status };
              return res2.clone().json().then(function (j2) { return asked(j2.ct, j2.lang).then(function (q2) { return q2 && q2.questions ? keepRun(res2, j2, q2).then(function (o) { o.probed = true; return o; }) : { ok: false, why: 'no_questions' }; }); });
            });
          });
        });
      });
    });
  }).then(null, function () { return { ok: false, why: 'no_network' }; });
}
/** One waiting Listen play, sent. false = no network yet. */
function gChSendListen(q, put) {
  var done = function () { return gCh('readwrite', function (st) { st.delete(q.id); return null; }).then(function () { return q.url ? gListenPrepare(q.url) : null; }).then(function () { return true; }); };
  var sendAll = function (ct, pickOf, late) {
    return q.answers.reduce(function (p, a) {
      return p.then(function (st) {
        if (st !== 'ok') return st;
        var b = {}; for (var k in a.body) if (Object.prototype.hasOwnProperty.call(a.body, k)) b[k] = a.body[k];
        b.ct = ct; b.pick = pickOf(a);
        if (late) b.late = { at: q.at };
        if (b.pick < 0) return 'ok'; // a choice the fresh run does not offer: nothing honest to send for it
        return gChPost('qa', b).then(function (r) { return r.status >= 500 ? 'down' : r.status === 401 ? 'lapsed' : 'ok'; }, function () { return 'down'; });
      });
    }, Promise.resolve('ok'));
  };
  // to the run they were given in, saying they are late: its token may have lapsed (see "A LATE result" above)
  return sendAll(q.ct, function (a) { return Number(a.body.pick); }, true).then(function (st) {
    if (st === 'down') return false;
    if (st === 'ok') return done();
    if (!q.url) { q.state = 'refused_401'; return put(q); }
    // the run's token has lapsed: a fresh run of the same story, each answer by the words chosen
    return gLive(q.url).then(function (u) { return fetch(u, { cache: 'no-store', headers: { accept: 'application/json' } }); }).then(function (res) {
      if (!res.ok) return res.status >= 500 ? false : (q.state = 'refused_' + res.status, put(q));
      return res.json().then(function (j) {
        return gChPost('qs', { ct: j.ct, lang: j.lang }).then(function (r) { return r.ok ? r.json() : null; }).then(function (qs) {
          if (!qs || !qs.questions) return false;
          var opt = {}; qs.questions.forEach(function (x) { opt[x.id] = x.options || []; });
          return sendAll(j.ct, function (a) { return (opt[a.q] || []).indexOf(a.text); }, false).then(function (st2) { return st2 === 'ok' ? done() : false; });
        });
      });
    }, function () { return false; });
  });
}
self.addEventListener('message', function (e) {
  var d = e.data || {};
  var port = e.ports && e.ports[0];
  if (d.type !== 'listen-prepare' || !port || typeof d.url !== 'string') return;
  e.waitUntil(gListenPrepare(d.url).then(function (out) { port.postMessage(out); }));
});
/* ---- games lane: the pilot's own files on the device follow the pilot's release ----
 * boot.js, games-read.js, cb-fit.css, the start page, the Get-ready steps and the child's battery page (which the
 * proxy adds to) are kept for offline like any file, and a kept copy is only renewed when a page loads it online. So
 * a Chromebook that got ready in October went on running October's pilot code with no network. The server says which
 * release it is (GET /__cb/release: a hash of every pilot file, and their addresses); when that differs from the
 * release the kept copies were read for, every one of them is read again and kept, and only then is the new release
 * noted. Asked for by boot.js on every page load with a network, by Get ready every time it is pressed, and when a
 * new worker takes over. (The worker's own files are renewed by the browser.) */
var G_RELEASE_KEY = new URL('/__cb/release-kept', self.location.origin).toString();
var gReleasing = null;
function gRelease() {
  if (gReleasing) return gReleasing;
  var done = function () { gReleasing = null; };
  gReleasing = fetch('/__cb/release', { cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : null; }).then(function (rel) {
    if (!rel || !rel.stamp) return { ok: false, why: 'no_release' };
    return caches.open(KEEP).then(function (c) {
      return c.match(G_RELEASE_KEY).then(function (r) { return r ? r.json() : {}; }).then(null, function () { return {}; }).then(function (have) {
        if (have.stamp === rel.stamp) return { ok: true, stamp: rel.stamp, refreshed: 0 };
        var urls = (rel.files || []).map(function (u) { return new URL(u, self.location.origin).toString(); });
        return gKeepAll(urls, urls).then(function (out) {
          // a file that could not be read: the release is not noted, so the next page load tries the whole of it again
          if (!out.ok) return { ok: false, stamp: rel.stamp, missing: out.missing.length };
          return c.put(G_RELEASE_KEY, new Response(JSON.stringify({ stamp: rel.stamp, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }))
            .then(function () { return { ok: true, stamp: rel.stamp, refreshed: urls.length, was: have.stamp || null }; });
        });
      });
    });
  }).then(null, function () { return { ok: false, why: 'no_network' }; });
  gReleasing.then(done, done);
  return gReleasing;
}
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type !== 'release') return;
  var port = e.ports && e.ports[0];
  e.waitUntil(gRelease().then(function (out) { if (port) port.postMessage(out); }));
});
self.addEventListener('activate', function () { gRelease(); });
/* ==================================== end of the games lane's block ==================================== */

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var u = new URL(req.url);
  if (u.pathname === '/__cb/report' || u.pathname === '/__cb/sw.js' || u.pathname === '/__cb/home') return;
  if (gamesFetch(e)) return; // games lane: the big flight's runs, HEAD of a kept page, a number game's result, a recording
  // STORIES (lane/stories): the shelf, a book, a story step and the speech key are answered by sw-stories.js
  if (self.CB_STORIES && self.CB_STORIES.fetch(e)) return;
  // HOME (lane/home): a request that names a child home link gets this Chromebook's live link (or its saved copy)
  if (req.method === 'POST' && u.origin === self.location.origin) { e.respondWith(homePost(req)); return; }
  if (req.method !== 'GET') { if (savedOnly()) { miss(req, 'other_site'); e.respondWith(Response.error()); } return; } // READY: self-test
  if (u.origin === self.location.origin && homeNames(u)) { e.respondWith(homeGet(req, u)); return; }
  var key = keyFor(req);
  if (MEDIA_RX.test(u.pathname)) { e.respondWith(media(req, key)); return; }
  if (u.origin !== self.location.origin && req.destination !== 'image' && req.destination !== 'font' && req.destination !== 'style' && req.destination !== 'script') {
    if (savedOnly()) { miss(req, 'other_site'); e.respondWith(Response.error()); } // READY (lane/home): the self-test reaches no network
    return;
  }
  e.respondWith(networkFirst(req, key));
});

function report() {
  if (!misses.length) return Promise.resolve();
  var batch = misses.splice(0, misses.length);
  return fetch('/__cb/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ misses: batch }) })
    .catch(function () { misses = batch.concat(misses); });
}

/** Keep each URL not kept yet, six at a time (the page loaded them before this worker was in charge).
 * READY (lane/home): resolves {warmed, failed, gone, full}. A file of this site counts as kept only under its exact address
 * (a list asked with another grade or subject is another list); a file on another site by its path (its signature
 * changes every time). A download that stalls is given up after WARM_WAIT_MS and named in `failed`, so the start page
 * can try it again and say honestly what is missing. opts.readable: media on another site is fetched through this
 * site (videoSave) so the copy can be cut into byte ranges; opts.fresh: saved again even when kept. */
var WARM_WAIT_MS = 60000;
function warm(urls, opts) {
  opts = opts || {};
  var queue = urls.slice();
  var out = { warmed: 0, failed: [], gone: [], full: false };
  var lanes = Math.max(1, Math.min(6, Number(opts.lanes) || 6));
  function one(u) {
    var cross = new URL(u).origin !== self.location.origin;
    if (cross && (videoIs(u) || ((opts.readable || videoStore(u)) && READABLE_RX.test(new URL(u).pathname)))) {
      return videoSave(u, opts.fresh).then(function (r) { if (r.ok) { if (!r.had) out.warmed += 1; } else if (r.why === 'http_404' || r.why === 'http_410') out.gone.push(u); else { out.failed.push(u); if (r.why === 'no_room') out.full = true; } });
    }
    return caches.open(KEEP).then(function (c) {
      return (opts.fresh ? Promise.resolve(null) : c.match(homeKey(u), { ignoreSearch: cross })).then(function (hit) {
        if (hit) return null;
        var ctl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctl) ctl.abort(); }, WARM_WAIT_MS);
        return fetch(new Request(u, { mode: cross ? 'no-cors' : 'same-origin', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined }))
          .then(function (res) {
            // 404/410: the server does not have it. That is not a download to try again; it is named in `gone`.
            if (res.status === 404 || res.status === 410) { out.gone.push(u); return null; }
            if (res.status !== 200 && res.type !== 'opaque') { out.failed.push(u); return null; }
            // HOME (lane/home): filed under the home's children; a page that only says "ask again" is not saved
            return homeFit(res).then(function (fit) {
              if (!fit) { out.failed.push(u); return null; }
              return c.put(homeKey(u), fit).then(function () { out.warmed += 1; });
            });
          })
          .catch(function (e) { out.failed.push(u); if (e && e.name === 'QuotaExceededError') out.full = true; })
          .then(function () { clearTimeout(timer); });
      });
    }).catch(function () { out.failed.push(u); });
  }
  function next() {
    var u = queue.shift();
    if (u === undefined || out.full) return Promise.resolve();
    return one(u).then(next);
  }
  var workers = [];
  for (var i = 0; i < lanes; i += 1) workers.push(next());
  return Promise.all(workers).then(function () { keptN = null; return out; });
}

self.addEventListener('message', function (e) {
  var d = e.data || {};
  var port = e.ports && e.ports[0];
  if (self.CB_STORIES && self.CB_STORIES.message(e)) return;
  if (d.type === 'report') { e.waitUntil(Promise.all([report(), sync()])); return; }
  if (d.type === 'hub' && typeof d.hub === 'string' && /^[A-Za-z0-9._-]{20,400}$/.test(d.hub)) {
    e.waitUntil(homeSet(d)); // HOME (lane/home): this Chromebook's child home, with the rest of its record kept
    return;
  }
  if (d.type === 'home') { e.waitUntil(homeAsk(d, port)); return; } // HOME: a page asks for the live home
  if (d.type === 'outbox' && port) {
    e.waitUntil(allRecs().then(function (l) {
      port.postMessage(l.map(function (r) { return { lsid: r.lsid, name: r.session.new && r.session.new.name, answers: Object.keys(r.answers).length, finish: r.finish, done: !!r.done, synced: !!r.realSt, err: r.lastError || null }; }));
    }, function () { port.postMessage([]); }));
    return;
  }
  if (d.type === 'warm') {
    e.waitUntil(warm((d.urls || []).filter(function (u) { return typeof u === 'string' && /^https?:/.test(u); }), d)
      .then(function (r) { if (port) port.postMessage(r); }));
    return;
  }
  if (readyMessage(d, port, e)) return; // READY (lane/home): expect, audit, saved-only, space
  if (d.type === 'stats' && port) {
    // READY (lane/home): pages ask every few seconds; listing thousands of kept files each time is slow on 2 cores,
    // so the count is taken at most every 20 s (and after each warm).
    e.waitUntil((keptN !== null && Date.now() - keptAt < 20000 ? Promise.resolve(keptN) : caches.open(KEEP).then(function (c) { return c.keys(); }).then(function (keys) { keptN = keys.length; keptAt = Date.now(); return keptN; }))
      .then(function (n) { port.postMessage({ kept: n, misses: misses.length }); }));
  }
});
