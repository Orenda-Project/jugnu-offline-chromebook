// This Chromebook's child home, signed fresh by the pilot server (lane/home, bd-fc5mgd.13.3).
//
// Jugnu's home link (/h/<token>) lasts 7 days and locks to the first device that opens it; a child gets a new one by
// sending /quiz on WhatsApp. A school Chromebook has no WhatsApp, so on 4 Nov 2026 the pilot Chromebook's home, Stories
// and Games all read "This link has expired". Here the server signs a link per Chromebook whenever one asks with the
// device key; the offline worker asks again long before the link runs out, and with no network keeps opening the copy
// saved on the device whatever its date (pilot-sw.js, block HOME).
//
//   POST /__cb/home         {key, device, lang?, student?}  ->  {hub, exp, ttl, now, kind}
//   GET  /__cb/home/status  ?key=                           ->  what is set up, never a secret
//   GET  /cb/home                                           ->  home.html: the one address that always opens the home
//   GET  /cb/app.webmanifest                                ->  lets the start page be installed on the shelf (a
//                                                               browser keeps an installed site's files from clean-up)
//
// Settings (environment):
//   HUB_SIGNING_KEY   the key Jugnu signs child links with, for the environment UPSTREAM points at (see hub-sign.mjs
//                     for the three accepted forms). A server secret: never in this repo, never sent to a browser.
//   DEVICE_KEY        required to sign: only a Chromebook that was set up (its /cb?key=… link) may ask.
//   HOME_STUDENT_IDS  optional, comma separated: the child (or up to 4) this pilot's Chromebooks open as. Default: the
//                     children named by the configured home link (CB_CONFIG.hub).
//   HOME_TTL_S        optional: how long a signed home lasts. Default 604800 (7 days, Jugnu's own).
//   HOME_PER_CHILD    optional, "1": a child picked on Who's playing? gets their OWN home (their Jugnu record), when the
//                     class list's ids are Jugnu's student ids in UPSTREAM's database. Default off.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { signer, decode, HUB_TTL_S } from './hub-sign.mjs';

const PER_HOUR = 120; // links one Chromebook (or one address without a device id) may ask for in an hour

export function homeRoutes({ here, deviceKey, loadConfig, roster, readBody, log, upstream }) {
  const env = process.env;
  const ttlS = Math.max(20, Number(env.HOME_TTL_S) || HUB_TTL_S);
  const perChild = env.HOME_PER_CHILD === '1';
  const rosterIds = new Set();
  if (roster) for (const c of roster.classes || []) for (const s of c.students || []) rosterIds.add(String(s.id));
  const asked = new Map(); // who -> [timestamps]
  const known = new Map(); // class-list id -> {at, yes}: does Jugnu have this child?

  /**
   * Does Jugnu know this class-list child? Asked with a link of its own that lasts a minute and a made-up device, so
   * the link handed to the Chromebook is never opened by anyone but the Chromebook. A home with no child in it means
   * the class list's id is not a student in this Jugnu database: the Chromebook then keeps its own home.
   */
  async function inJugnu(set, id, lang) {
    const hit = known.get(id);
    if (hit && Date.now() - hit.at < (hit.yes ? 3600e3 : 600e3)) return hit.yes;
    const probe = set.s.sign({ ids: [id], lang, ttlS: 60, nonce: crypto.randomBytes(6).toString('base64url') });
    const device = crypto.randomBytes(16).toString('base64url');
    let yes = false;
    try {
      const r = await fetch(new URL(`/api/wq/hub/${probe.token}`, upstream), { method: 'POST', headers: { 'content-type': 'application/json', cookie: `wq_dv=${device}` }, body: JSON.stringify({ device_ref: device }), signal: AbortSignal.timeout(8000) });
      const j = r.ok ? await r.json() : null;
      if (!j) return false; // Jugnu did not answer: not remembered, asked again next time
      yes = Array.isArray(j.kids) && j.kids.length > 0;
    } catch { return false; }
    known.set(id, { at: Date.now(), yes });
    if (known.size > 50000) known.clear();
    return yes;
  }

  /** Read at each ask, so a config change needs no restart; the signer is rebuilt only when its inputs change. */
  let built = null;
  function setup() {
    const reference = String((loadConfig() || {}).hub || '');
    const stamp = `${env.HUB_SIGNING_KEY || ''}|${reference}|${env.HOME_STUDENT_IDS || ''}`;
    if (built && built.stamp === stamp) return built;
    const s = signer(env.HUB_SIGNING_KEY, reference);
    const ref = decode(reference);
    const ids = env.HOME_STUDENT_IDS ? env.HOME_STUDENT_IDS.split(',').map((x) => x.trim()).filter(Boolean) : (ref ? ref.ids.map(String) : []);
    built = { stamp, s, ids, lang: ref && ref.l ? ref.l : null };
    return built;
  }
  function why() {
    const b = setup();
    if (!deviceKey) return 'no_device_key';
    if (!b.s.ok) return b.s.why;
    if (!b.ids.length) return 'no_home_student';
    return null;
  }
  function tooMany(who) {
    const now = Date.now();
    const list = (asked.get(who) || []).filter((t) => now - t < 3600e3);
    list.push(now);
    asked.set(who, list);
    if (asked.size > 20000) asked.clear();
    return list.length > PER_HOUR;
  }
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  /** For /__cb/manifest: can this server sign a home (so the start page asks for one)? */
  handle.signing = () => !why();
  return handle;

  function handle(req, res, url, ip, ua) {
    if (url.pathname === '/cb/home' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      fs.createReadStream(path.join(here, 'home.html')).pipe(res);
      log({ m: 'GET', p: url.pathname, s: 200, local: true, ua });
      return true;
    }
    if (url.pathname === '/cb/app.webmanifest' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' });
      res.end(JSON.stringify({
        name: 'Jugnu', short_name: 'Jugnu', start_url: '/cb', scope: '/', display: 'standalone', background_color: '#f6f1e4', theme_color: '#f6f1e4',
        icons: [{ src: '/wq/jugnu/hello.webp', sizes: '200x200', type: 'image/webp', purpose: 'any' }], // Jugnu's own icon
        shortcuts: [{ name: 'Child home', url: '/cb/home' }, { name: "Who's playing?", url: '/who' }],
      }));
      return true;
    }
    if (url.pathname === '/__cb/home/status' && req.method === 'GET') {
      const ok = Boolean(deviceKey) && url.searchParams.get('key') === deviceKey;
      const b = setup();
      const no = why();
      json(res, ok ? 200 : 401, ok ? { signing: !no, why: no, key_form: b.s.ok ? b.s.form : null, key_checked: b.s.ok ? b.s.checked : false, home_students: b.ids.length, ttl: ttlS, per_child: perChild && rosterIds.size > 0 } : { error: 'device_key' });
      return true;
    }
    if (url.pathname === '/__cb/home' && req.method === 'POST') {
      readBody(req, async (b) => {
        const done = (status, body) => { json(res, status, body); log({ m: 'POST', p: url.pathname, s: status, local: true, ua, ...(body.error ? { err: body.error } : { kind: body.kind }) }); };
        if (!b || typeof b !== 'object') return done(400, { error: 'bad_request' });
        if (!deviceKey) return done(503, { error: 'no_device_key' });
        if (b.key !== deviceKey) return done(401, { error: 'device_key' });
        const no = why();
        if (no) return done(503, { error: no });
        const device = typeof b.device === 'string' ? b.device.slice(0, 64) : '';
        if (tooMany(device ? `d:${device}` : `ip:${ip}`)) return done(429, { error: 'slow_down' });
        const set = setup();
        const lang = b.lang === 'en' || b.lang === 'ur' ? b.lang : set.lang;
        let ids = set.ids;
        let kind = 'device';
        if (b.student != null) {
          // A child's own home: only for a child on this school's class list, and only when the pilot is told the
          // list's ids are Jugnu's (HOME_PER_CHILD). Anything else is answered plainly; the caller keeps the device home.
          if (!perChild) return done(409, { error: 'per_child_off' });
          if (!rosterIds.has(String(b.student))) return done(404, { error: 'not_on_class_list' });
          if (!(await inJugnu(set, String(b.student), lang))) return done(404, { error: 'not_in_jugnu' });
          ids = [String(b.student)];
          kind = 'child';
        }
        const out = set.s.sign({ ids, lang, ttlS, nonce: crypto.randomBytes(6).toString('base64url') });
        if (!out) return done(503, { error: 'no_home_student' });
        return done(200, { hub: out.token, exp: out.exp, ttl: ttlS, now: Math.floor(Date.now() / 1000), kind });
      }).catch(() => { if (!res.headersSent) json(res, 500, { error: 'failed' }); });
      return true;
    }
    return false;
  }
}
