// The read-aloud scorer with the network truly off, on the laptop rig.
//
//   UPSTREAM=<any> PORT=8814 node server.mjs &                 (the upstream is not used by this check)
//   CB_BASE=http://localhost:8814 node rig/speech-offline.mjs [--kept] [--wav <16 kHz wav> --text "<the printed text>" --lang en|ur]
//
// 1. online: the offline worker is installed and saves the scorer, its libraries and both models (as Get ready does)
// 2. the server drops every connection (OFFLINE) and the browser is set offline
// 3. the scorer page is opened again from the device, loads its model from the kept files, and scores a recording
// With no --wav it uses the first clean English and Urdu readings of speech/audio/syn (made by speech/bench/make-audio.py).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, BASE } from './cb.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const OFFLINE = path.join(ROOT, 'OFFLINE');

let cases = [];
if (arg('wav')) cases.push({ wav: arg('wav'), text: arg('text'), lang: arg('lang') || 'en' });
else {
  const dir = path.join(ROOT, 'speech', 'audio', 'syn');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const lang of ['en', 'ur']) {
    const it = m.find((x) => x.lang === lang && x.kind === 'passage' && x.variant === 'skip' && x.noise === 'clean');
    if (it) cases.push({ wav: path.join(dir, it.file), text: it.expected, lang, truth: it.truth });
  }
}

fs.rmSync(OFFLINE, { force: true });
// --kept: use the device as Get ready left it (rig/cb-check.mjs first): nothing is saved here, only checked offline
const KEPT = process.argv.includes('--kept');
const { ctx, page, log } = await launch({ fresh: !KEPT });
try {
  await page.goto(`${BASE}/__cb/speech/proto.html`, { waitUntil: 'load' });
  if (KEPT) {
    const have = await page.evaluate(async () => { const c = await caches.open('cb-pilot-v1'); const want = window.JugnuSpeech.files(['en', 'ur']); let n = 0; for (const u of want) if (await c.match(u)) n += 1; return { kept: n, of: want.length }; });
    console.log('1. as Get ready left it: speech files kept on the device:', JSON.stringify(have));
  } else {
  await page.evaluate(() => navigator.serviceWorker.register('/__cb/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready));
  for (let i = 0; i < 3 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i += 1) await page.reload({ waitUntil: 'load' });
  const warmed = await page.evaluate(async () => {
    const urls = window.JugnuSpeech.files(['en', 'ur']).concat(['match.js', 'jugnu-speech.js', 'proto.html'].map((f) => new URL(f, location.href).href));
    const t0 = performance.now();
    const r = await new Promise((ok) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => ok(e.data); navigator.serviceWorker.controller.postMessage({ type: 'warm', urls }, [ch.port2]); });
    const est = await navigator.storage.estimate();
    return { files: urls.length, warmed: r && r.warmed, seconds: Math.round((performance.now() - t0) / 100) / 10, onDeviceMb: Math.round(est.usage / 1048576) };
  });
  console.log('1. online, saved by the offline worker:', JSON.stringify(warmed));
  }

  fs.writeFileSync(OFFLINE, '');
  await ctx.setOffline(true);
  const gone = await fetch(`${BASE}/__cb/speech/match.js`).then(() => false, () => true);
  console.log('2. network off: the server drops connections =', gone, '· navigator.onLine =', await page.evaluate(() => navigator.onLine));

  await page.reload({ waitUntil: 'load' });
  for (const c of cases) {
    const b64 = fs.readFileSync(c.wav).toString('base64');
    const r = await page.evaluate(async ({ b64, text, lang }) => {
      const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
      const t0 = performance.now(); let ticks = 0; const iv = setInterval(() => { ticks += 1; }, 100);   // does the page stay alive while it listens?
      const res = await window.JugnuSpeech.score(new Blob([u8], { type: 'audio/wav' }), text, lang);
      clearInterval(iv);
      return { engine: res.engine, pending: res.pending, why: res.why, correct: res.correct, total: res.total, wcpm: res.wcpm, seconds: res.seconds, confidence: res.confidence, ms: res.ms,
        read: res.words.map((w) => w.read), pageTicks: ticks, wall: Math.round(performance.now() - t0) };
    }, { b64, text: c.text, lang: c.lang });
    const agree = c.truth ? `${r.read.filter((x, i) => x === c.truth[i]).length}/${c.truth.length} words agree with the ground truth` : '';
    console.log(`3. offline, ${c.lang}:`, JSON.stringify({ ...r, read: undefined }), agree);
  }
} finally {
  fs.rmSync(OFFLINE, { force: true });
  await ctx.close();
  const bad = log.filter((l) => /pageerror/.test(l));
  if (bad.length) console.log('page errors:', bad.slice(0, 5).join('\n'));
}
