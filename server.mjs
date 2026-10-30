// Offline pilot harness for Jugnu on a Chromebook (bd-fc5mgd.1).
//
// A local reverse proxy in front of the NIETE portal (sandbox by default). It changes nothing upstream; it only:
//   - serves pilot-sw.js at /sw.js (scope /), so every page the child opens is cached as it loads
//     (the portal's own /sw.js is the push-reminder worker; under this proxy it is replaced, never both)
//   - adds <script src="/__cb/boot.js"> to every HTML page (registers the worker, shows the offline badge)
//   - logs every request with its user agent to logs/requests.jsonl, so a Chromebook's visit is visible here
//
// What it measures: with the network off, which parts of Jugnu still open and play. That list is the work
// for the real offline build in NIETE-Rumi. It is a measuring tool, not the product.
//
//   UPSTREAM=https://<your Jugnu portal> node server.mjs [--port 8791]
//   (optional) NIETE_RUMI_DIR=<path to a NIETE-Rumi clone> NIETE_REF=origin/sandbox: adds every Jugnu app file to Get ready's list

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const UPSTREAM_ARG = arg('upstream', process.env.UPSTREAM);
if (!UPSTREAM_ARG) { console.error('Set UPSTREAM (or --upstream) to the Jugnu portal to put this proxy in front of.'); process.exit(1); }
const UPSTREAM = new URL(UPSTREAM_ARG);
const PORT = Number(arg('port', process.env.PORT || 8791));
const LOG_DIR = path.join(HERE, 'logs');
const OFFLINE_FLAG = path.join(HERE, 'OFFLINE');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG = fs.createWriteStream(path.join(LOG_DIR, 'requests.jsonl'), { flags: 'a' });

const LOCAL = {
  '/__cb/sw.js': ['pilot-sw.js', 'application/javascript; charset=utf-8'],
  '/sw.js': ['pilot-sw.js', 'application/javascript; charset=utf-8'], // a page that registers its own /sw.js gets this one
  '/__cb/boot.js': ['boot.js', 'application/javascript; charset=utf-8'],
  '/hello': ['hello.html', 'text/html; charset=utf-8'], // the device check: model, ChromeOS/Chrome version, memory
  '/cb': ['cb.html', 'text/html; charset=utf-8'], // the Chromebook test page: Get ready for offline, then play
};
const BOOT_TAG = '<script src="/__cb/boot.js" defer></script>';
const TEXT_RX = /^(text\/html|application\/javascript|text\/javascript|application\/json|text\/css|application\/manifest\+json)/i;

let currentIp = null;
function log(entry) {
  LOG.write(JSON.stringify({ t: new Date().toISOString(), ip: currentIp, ...entry }) + '\n');
}

function decode(buf, enc) {
  if (enc === 'gzip') return zlib.gunzipSync(buf);
  if (enc === 'br') return zlib.brotliDecompressSync(buf);
  if (enc === 'deflate') return zlib.inflateSync(buf);
  return buf;
}

/** Upstream absolute URLs become this origin, so links and fetches stay on the proxy (and under the worker). */
function rewriteText(text, ownOrigin) {
  return text.split(UPSTREAM.origin).join(ownOrigin);
}

function ownOriginOf(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

const server = http.createServer((req, res) => {
  const started = Date.now();
  currentIp = req.headers['cf-connecting-ip'] || String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const ua = req.headers['user-agent'] || '';
  const url = new URL(req.url, 'http://x');

  // The real "no network" switch: while pilot/OFFLINE exists every connection is dropped, the page's and the
  // worker's alike. (A browser's own offline emulation does not reach the service worker's fetches.)
  if (fs.existsSync(OFFLINE_FLAG)) {
    log({ m: req.method, p: req.url, s: 0, dropped: 'offline_switch', ua });
    req.socket.destroy();
    return;
  }

  // The short address to type on a Chromebook: http://<this Mac>:8791/go -> the secure tunnel's /cb page.
  if (url.pathname === '/go') {
    const t = (fs.readFileSync(path.join(LOG_DIR, 'tunnel.log'), 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/) || [])[0];
    res.writeHead(t ? 302 : 503, t ? { location: `${t}/cb` } : { 'content-type': 'text/plain' });
    res.end(t ? '' : 'tunnel not up');
    log({ m: req.method, p: req.url, s: t ? 302 : 503, ua });
    return;
  }
  if (url.pathname === '/__cb/manifest') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(HERE, 'cb-config.json'), 'utf8')), static: staticList() }));
    log({ m: req.method, p: req.url, s: 200, local: true, ua });
    return;
  }

  const local = LOCAL[url.pathname];
  if (local && req.method === 'GET') {
    res.writeHead(200, { 'content-type': local[1], 'cache-control': 'no-cache', 'service-worker-allowed': '/' });
    fs.createReadStream(path.join(HERE, local[0])).pipe(res);
    log({ m: req.method, p: req.url, s: 200, local: true, ua, ms: Date.now() - started });
    return;
  }
  if (url.pathname === '/__cb/report' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      log({ m: 'REPORT', p: url.pathname, ua, report: safeJson(body) });
      res.writeHead(204).end();
    });
    return;
  }

  const ownOrigin = ownOriginOf(req);
  const headers = { ...req.headers, host: UPSTREAM.host, 'accept-encoding': 'gzip, br, deflate' };
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  if (headers.origin) headers.origin = UPSTREAM.origin;
  if (headers.referer) headers.referer = headers.referer.replace(ownOrigin, UPSTREAM.origin);

  const up = https.request(
    { hostname: UPSTREAM.hostname, port: 443, path: req.url, method: req.method, headers },
    (upRes) => {
      const out = { ...upRes.headers };
      if (out.location) out.location = out.location.replace(UPSTREAM.origin, ownOrigin);
      if (out['set-cookie']) out['set-cookie'] = [].concat(out['set-cookie']).map((c) => c.replace(/;\s*domain=[^;]+/i, ''));
      delete out['strict-transport-security'];
      const type = String(out['content-type'] || '');

      if (!TEXT_RX.test(type)) {
        res.writeHead(upRes.statusCode, out);
        upRes.pipe(res);
        upRes.on('end', () => log({ m: req.method, p: req.url, s: upRes.statusCode, type, ua, ms: Date.now() - started }));
        return;
      }
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        let text = decode(Buffer.concat(chunks), out['content-encoding']).toString('utf8');
        text = rewriteText(text, ownOrigin);
        if (/^text\/html/i.test(type)) {
          text = /<\/head>/i.test(text) ? text.replace(/<\/head>/i, `${BOOT_TAG}</head>`) : BOOT_TAG + text;
          // the boot script is same-origin; a CSP that names 'self' already allows it
        }
        const body = Buffer.from(text, 'utf8');
        delete out['content-encoding'];
        delete out['transfer-encoding'];
        out['content-length'] = body.length;
        res.writeHead(upRes.statusCode, out);
        res.end(body);
        log({ m: req.method, p: req.url, s: upRes.statusCode, type, bytes: body.length, ua, ms: Date.now() - started });
      });
    },
  );
  up.on('error', (e) => {
    log({ m: req.method, p: req.url, s: 502, err: e.message, ua });
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('upstream error');
  });
  req.pipe(up);
});

/** Files every device needs, whoever the child: Jugnu's own files (from the sandbox code) + what the tours fetched. */
let STATIC = null;
function staticList() {
  if (STATIC) return STATIC;
  const out = new Set();
  try {
    const repo = process.env.NIETE_RUMI_DIR;
    if (!repo) throw new Error('no NIETE_RUMI_DIR');
    execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', process.env.NIETE_REF || 'origin/sandbox', 'dashboard/public/wq'], { encoding: 'utf8' })
      .split('\n').filter((f) => /\.(js|css|woff2|webp|webm|mp3|opus|jpg|webmanifest)$/.test(f) && !/probe|sw(-off)?\.js$/.test(f))
      .forEach((f) => out.add('/' + f.replace(/^dashboard\/public\//, '')));
  } catch (e) { /* the tours' list still stands */ }
  for (const l of fs.readFileSync(path.join(LOG_DIR, 'requests.jsonl'), 'utf8').split('\n')) {
    let d; try { d = JSON.parse(l); } catch { continue; }
    if (d.m === 'GET' && d.s === 200 && /^\/(wq|sa)\/|^\/q\/[A-Z0-9]+\/art\//.test(d.p || '')) out.add(d.p);
  }
  STATIC = [...out];
  return STATIC;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return s.slice(0, 2000); }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Jugnu offline pilot proxy on http://localhost:${PORT} -> ${UPSTREAM.origin}`);
});
