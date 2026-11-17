// Runs the candidates in real Chrome on this machine, optionally with the CPU slowed down, and writes one JSON line per
// (engine, recording): what was heard, each word read / not read against the ground truth, and the time it took.
//
//   node bench/run.mjs --set syn --engines moonshine-base,whisper-base [--throttle 8] [--filter en.read] [--limit 20]
//                      [--kinds passage,words] [--noise clean] [--out bench/results/raw/x.jsonl] [--headed]
//
// --throttle N uses Chrome's own CPU throttle (CDP Emulation.setCPUThrottlingRate) on the page, and on any worker the
// engine starts. The models run on ONE thread, as they would in a Jugnu page (no cross-origin isolation there).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const SET = arg('set', 'syn');
const ENGINES = String(arg('engines', 'moonshine-base')).split(',');
const THROTTLE = Number(arg('throttle', 1));
const PORT = Number(arg('port', 8824));
const ISOLATE = !!arg('isolate');
const OPTS = arg('opts') ? JSON.parse(arg('opts')) : null;   // engine options, e.g. --opts '{"bias":3}' --tag b3
const TAG = arg('tag') ? '+' + arg('tag') : '';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.wav': 'audio/wav', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip' };

const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { if (process.env.BENCH_DEBUG) console.error('404', req.url); res.writeHead(404); res.end(); return; }
  const h = { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'content-length': fs.statSync(p).size, 'cache-control': 'no-store' };
  // --isolate: cross-origin isolation, only so that Chrome will report the page's memory (wasm included)
  if (ISOLATE) { h['cross-origin-opener-policy'] = 'same-origin'; h['cross-origin-embedder-policy'] = 'require-corp'; }
  res.writeHead(200, h);
  fs.createReadStream(p).pipe(res);
});
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));

const dir = SET === 'syn' ? 'audio/syn' : `audio/real/${SET}`;
let items = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'manifest.json'), 'utf8'));
if (arg('filter')) items = items.filter((x) => x.id.includes(arg('filter')));
if (arg('kinds')) items = items.filter((x) => String(arg('kinds')).split(',').includes(x.kind));
if (arg('noise')) items = items.filter((x) => x.noise === arg('noise'));
if (arg('lang')) items = items.filter((x) => x.lang === arg('lang'));
if (arg('limit')) items = items.slice(0, Number(arg('limit')));

const out = path.resolve(arg('out', path.join(HERE, 'results', 'raw', `${SET}.t${THROTTLE}.jsonl`)));
fs.mkdirSync(path.dirname(out), { recursive: true });
const profile = path.join(ROOT, '.cache', 'chrome-profile-' + PORT);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: arg('headed') ? false : 'new', userDataDir: profile, args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });

function rssMb() {   // the biggest renderer of this Chrome: the page with the model in it
  try {
    const ps = execSync('ps -axo rss=,command=', { maxBuffer: 1 << 26 }).toString().split('\n').filter((l) => l.includes(profile) && l.includes('--type=renderer'));
    return Math.round(Math.max(0, ...ps.map((l) => Number(l.trim().split(/\s+/)[0]))) / 1024);
  } catch (e) { return null; }
}

for (const engine of ENGINES) {
  const langs = engine === 'vosk-small-en' ? ['en'] : null;
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  if (process.env.BENCH_DEBUG) page.on('console', (m) => console.error('console:', m.text().slice(0, 300)));
  const cdp = await page.createCDPSession();
  const slow = async (rate) => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    for (const w of page.workers()) { try { await w.client.send('Emulation.setCPUThrottlingRate', { rate }); } catch (e) { /* a worker with no emulation domain */ } }
  };
  page.on('workercreated', (w) => { if (THROTTLE > 1) w.client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }).catch(() => {}); });
  await page.goto(`http://127.0.0.1:${PORT}/bench/bench.html`);
  const info = await page.evaluate((e) => ({ engine: window.JugnuSpeech.engines[e] || { langs: ['en'] }, ua: navigator.userAgent, cores: navigator.hardwareConcurrency, isolated: self.crossOriginIsolated }), engine);
  const mine = items.filter((x) => (langs || info.engine.langs).includes(x.lang));
  if (!mine.length) { await page.close(); continue; }
  const base = rssMb();
  const calib1 = await page.evaluate(() => window.BENCH.calib());
  // load the model unthrottled (a first run), then slow the CPU for the measured runs
  const first = await page.evaluate((it) => window.BENCH.run(it), { ...mine[0], engine, opts: OPTS, worker: !!arg('worker'), url: `/${dir}/${mine[0].file}` });
  await slow(THROTTLE);
  const calibN = await page.evaluate(() => window.BENCH.calib());
  console.log(`${engine}: ${mine.length} recordings, load ${first.ms.load} ms, throttle asked ${THROTTLE}x measured ${(calibN / calib1).toFixed(1)}x (${calib1} -> ${calibN} ms), ${info.cores} cores, isolated ${info.isolated}`);
  let peak = rssMb(); let n = 0; let audio = 0; let hear = 0; let mem = 0;
  for (const it of mine) {
    let r;
    try { r = await page.evaluate((x) => window.BENCH.run(x), { ...it, engine, opts: OPTS, worker: !!arg('worker'), url: `/${dir}/${it.file}` }); }
    catch (e) { r = { error: String(e.message || e).slice(0, 200) }; }
    peak = Math.max(peak, rssMb());
    if (ISOLATE) { try { mem = Math.max(mem, Math.round((await page.evaluate(() => performance.measureUserAgentSpecificMemory().then((m) => m.bytes))) / 1048576)); } catch (e) { /* not isolated */ } }
    const row = { set: SET, id: it.id, lang: it.lang, kind: it.kind, variant: it.variant, noise: it.noise, voice: it.voice, source: it.source, engine: engine + TAG, throttle: THROTTLE, throttle_measured: Math.round(calibN / calib1 * 10) / 10,
      truth: it.truth, got: r.words ? r.words.map((w) => w.read) : null, heard: r.heard, ms: r.ms, error: r.error, dur_s: it.dur_s, load_ms: first.ms.load, rss_mb: peak, rss_base_mb: base, mem_mb: mem || null };
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
    n += 1;
    if (r.ms) { audio += r.ms.audio; hear += r.ms.hear; }
    if (n % 10 === 0 || n === mine.length) console.log(`  ${n}/${mine.length}  rtf ${(hear / audio).toFixed(3)}  rss ${peak} MB (page before the model ${base} MB)${mem ? `  page memory ${mem} MB` : ''}`);
  }
  // what the page still holds once the reading is scored (after a garbage collection): the model, ready for the next child
  try { await cdp.send('HeapProfiler.collectGarbage'); await new Promise((ok) => setTimeout(ok, 3000)); } catch (e) { /* no profiler */ }
  const settled = rssMb();
  console.log(`  ${engine}${TAG}: renderer ${settled} MB at rest (peak ${peak} MB; a page with no model ${base} MB)`);
  fs.appendFileSync(out.replace(/\.jsonl$/, '.mem.jsonl'), JSON.stringify({ engine: engine + TAG, set: SET, throttle: THROTTLE, rss_rest_mb: settled, rss_peak_mb: peak, rss_base_mb: base, page_mem_mb: mem || null, load_ms: first.ms.load }) + '\n');
  await page.close();
}
await browser.close();
server.close();
console.log('->', out);
