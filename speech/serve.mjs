// The pilot server's speech route: /__cb/speech/… serves the on-device scorer and everything it loads.
//
//   /__cb/speech/jugnu-speech.js · match.js · proto.html    this folder's own files
//   /__cb/speech/lib/… · /__cb/speech/models/…              the libraries and model files named in sources.json: taken
//                                                           from speech/lib or speech/models when they are there (a
//                                                           developer's mirror), else fetched ONCE from the fixed
//                                                           address in sources.json, kept in speech/fetched/ and served
//
// One origin for everything means the offline worker keeps these files like any other, and Get ready can save them.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OWN = { 'jugnu-speech.js': 'text/javascript; charset=utf-8', 'match.js': 'text/javascript; charset=utf-8', 'proto.html': 'text/html; charset=utf-8' };
const MIME = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.onnx': 'application/octet-stream' };
const SOURCES = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));
const fetching = new Map();

function send(res, file, type, cache) {
  res.writeHead(200, { 'content-type': type, 'content-length': fs.statSync(file).size, 'cache-control': cache });
  fs.createReadStream(file).pipe(res);
}

/** The file for one sources.json entry: a local mirror, a kept download, or downloaded now. */
async function fileFor(rel) {
  const src = SOURCES[rel];
  if (src.startsWith('file:')) return path.join(DIR, src.slice(5));
  const mirror = path.join(DIR, rel);
  if (fs.existsSync(mirror)) return mirror;
  const kept = path.join(DIR, 'fetched', rel);
  if (fs.existsSync(kept)) return kept;
  if (!fetching.has(rel)) {
    fetching.set(rel, (async () => {
      fs.mkdirSync(path.dirname(kept), { recursive: true });
      const r = await fetch(src, { redirect: 'follow' });
      if (!r.ok || !r.body) throw new Error(`${src}: ${r.status}`);
      const part = `${kept}.part`;
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(part));
      fs.renameSync(part, kept);
      return kept;
    })().finally(() => fetching.delete(rel)));
  }
  return fetching.get(rel);
}

/** Answers a /__cb/speech/… request; false when the path is not ours. */
export function speechRoute(req, res, url) {
  if (req.method !== 'GET' || !url.pathname.startsWith('/__cb/speech/')) return false;
  const rel = decodeURIComponent(url.pathname.slice('/__cb/speech/'.length));
  if (OWN[rel]) { send(res, path.join(DIR, rel), OWN[rel], 'no-cache'); return true; }
  if (rel === 'files') {   // what Get ready saves, per language (the module's own list needs the page; this is the same list)
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(Object.keys(SOURCES).filter((k) => k !== '_')));
    return true;
  }
  if (!Object.prototype.hasOwnProperty.call(SOURCES, rel) || rel === '_') { res.writeHead(404); res.end(); return true; }
  fileFor(rel).then((file) => send(res, file, MIME[path.extname(rel)] || 'application/octet-stream', 'public, max-age=604800'),
    (e) => { console.error('speech:', rel, e.message); if (!res.headersSent) res.writeHead(502); res.end(); });
  return true;
}
