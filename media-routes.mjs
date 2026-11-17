// Lesson videos through this site, so a Chromebook can keep them (lane/home, bd-fc5mgd.13.3).
//
// Jugnu's lesson videos (and the clips of the quiz after each) are signed links on Cloudflare R2, good for 6 hours.
// R2 sends no CORS headers for them, so a page's offline worker cannot read them: it cannot cut the byte ranges a
// video player asks for, and it cannot check the file arrived whole. Fetched through this site they are ordinary
// same-site files.
//
//   GET /__cb/media?u=<the signed link>   header X-CB-Key: <device key>   (Range is passed on)
//
// Only for a Chromebook with the device key, only links to the media hosts below, only media files; the link must
// carry its own valid signature (this server adds nothing to it), and nothing is stored here.
//
//   MEDIA_HOSTS   optional, comma separated host endings allowed. Default ".r2.cloudflarestorage.com,.r2.dev"
//                 (Jugnu's signed bucket links, and the public bucket address some quiz clips are on).
//
// At fleet size this must not be the route: 40,000 Chromebooks x ~1 GB a grade through one small service. The lasting
// fix is on Jugnu's side (a CORS rule on the bucket, or the videos on a public file address) so each Chromebook
// fetches from Cloudflare directly; see docs/HOME-AND-VIDEOS.md.
import https from 'node:https';

const MEDIA_RX = /\.(mp4|webm|m4v|mov|mp3|m4a|ogg|opus|wav|jpg|jpeg|png|webp)$/i;

export function mediaRoutes({ deviceKey, log }) {
  const hosts = (process.env.MEDIA_HOSTS || '.r2.cloudflarestorage.com,.r2.dev').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const allowed = (u) => u.protocol === 'https:' && !u.username && !u.port && hosts.some((h) => u.hostname.toLowerCase().endsWith(h)) && MEDIA_RX.test(u.pathname);

  return function handle(req, res, url, ua) {
    if (url.pathname !== '/__cb/media' || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    const started = Date.now();
    const done = (status, extra = {}) => log({ m: req.method, p: '/__cb/media', s: status, local: true, ua, ms: Date.now() - started, ...extra });
    // X-CB-Media marks every answer as this route's own: the worker saves nothing that lacks it (an older server
    // without this route would pass the request on to Jugnu, which answers any unknown address with a web page).
    const fail = (status, error) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-cb-media': '1' }); res.end(JSON.stringify({ error })); done(status, { err: error }); };
    if (deviceKey && req.headers['x-cb-key'] !== deviceKey) { fail(401, 'device_key'); return true; }
    let target;
    try { target = new URL(url.searchParams.get('u') || ''); } catch { fail(400, 'bad_link'); return true; }
    if (!allowed(target)) { fail(403, 'not_a_media_link'); log({ m: 'NOTE', p: '/__cb/media', refused: (target.hostname + target.pathname).slice(0, 140) }); return true; }
    const headers = { 'user-agent': 'jugnu-offline-pilot' };
    if (req.headers.range) headers.range = req.headers.range;
    const up = https.request({ hostname: target.hostname, port: 443, path: target.pathname + target.search, method: req.method, headers }, (upRes) => {
      const out = { 'cache-control': 'no-store', 'x-cb-media': '1' };
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) if (upRes.headers[h]) out[h] = upRes.headers[h];
      res.writeHead(upRes.statusCode, out);
      upRes.pipe(res);
      // the file's name is logged, never its signature
      upRes.on('end', () => done(upRes.statusCode, { file: target.pathname.slice(-80), bytes: Number(upRes.headers['content-length']) || undefined }));
    });
    up.setTimeout(60000, () => up.destroy(new Error('upstream timeout')));
    up.on('error', (e) => { if (!res.headersSent) fail(502, 'upstream'); else res.destroy(); done(502, { err: e.message }); });
    req.on('close', () => { if (!res.writableEnded) up.destroy(); });
    up.end();
    return true;
  };
}
