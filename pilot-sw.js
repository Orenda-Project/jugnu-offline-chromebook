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
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim().then(homeMove)); }); // homeMove: block HOME

function keyFor(req) {
  var u = new URL(req.url);
  return u.toString();
}

function keep(key, res) {
  // 200, or an opaque answer for a file on another site (R2 clips): the browser plays those, it only cannot read them.
  if (!res || res.type === 'opaqueredirect' || (res.status !== 200 && res.type !== 'opaque')) return Promise.resolve();
  var copy = res.clone();
  // HOME (lane/home): one saved copy per child home whatever link it was opened with; never a page that only says "ask again"
  return homeFit(copy).then(function (fit) { return fit ? caches.open(KEEP).then(function (c) { return c.put(homeKey(key), fit); }) : null; }).catch(function () {});
}

function kept(key) {
  key = homeKey(key); // HOME (lane/home): a child home is saved once, under its children, not under each week's link
  return caches.open(KEEP).then(function (c) {
    // Never a looser match for a kept POST answer: every one shares /__cb/post, so ignoreSearch would hand one
    // child's session to another (it did, 28 Oct: child four played inside child three's session).
    if (key.indexOf('/__cb/post') >= 0) return c.match(key);
    return c.match(key).then(function (hit) { return hit || c.match(key, { ignoreSearch: true }); })
      .then(function (hit) { return hit || homeFallback(c, key); }); // HOME: else this Chromebook's own saved home
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
        if (!j || j.locked !== true) { keep(key, res); return res; }
        var token = homeTokens(req.url)[0];
        var slot = token && homeSlot(st, homeInfo(token).tag);
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
  if (u.pathname === '/__cb/report' || u.pathname === '/__cb/sw.js' || u.pathname === '/__cb/home') return;
  // HOME (lane/home): a request that names a child home link gets this Chromebook's live link (or its saved copy)
  if (req.method === 'POST' && u.origin === self.location.origin) { e.respondWith(homePost(req)); return; }
  if (req.method !== 'GET') return;
  if (u.origin === self.location.origin && homeNames(u)) { e.respondWith(homeGet(req, u)); return; }
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
        .then(function (res) {
          if (res.status !== 200 && res.type !== 'opaque') return null;
          // HOME (lane/home): filed under the home's children; a page that only says "ask again" is not saved
          return homeFit(res).then(function (fit) { if (!fit) return null; got += 1; return caches.open(KEEP).then(function (c) { return c.put(homeKey(u), fit); }); });
        })
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
