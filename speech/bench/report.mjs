// Reads bench/results/raw/*.jsonl and prints, per engine and test set: word-level agreement with the ground truth,
// how often a word that was NOT read was marked read (false "read"; foil_read: of the foil words put into the expected
// text of a real recording, the share marked read), how often a read word was missed (false "missed"),
// the error in the count of words correct (what WCPM is made of), and the speed.
//
//   node bench/report.mjs [--files a.jsonl,b.jsonl] [--by variant|noise|kind|voice] [--json out.json] [--plain]
//
// Every row is re-scored here from the words the engine heard, with match.js: --plain uses Jugnu's rules exactly,
// otherwise the sound fold is on (homophones in English; Urdu and Hindi letters compared by sound).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = createRequire(import.meta.url)('../match.js');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const RAW = path.join(HERE, 'results', 'raw');
const files = arg('files') ? String(arg('files')).split(',').map((f) => path.resolve(f)) : fs.readdirSync(RAW).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(RAW, f));
const BY = arg('by', null);
const SOUND = !arg('plain');

const expected = {};
for (const d of ['audio/syn', 'audio/real/so762', 'audio/real/fleurs_ur']) {
  const f = path.join(HERE, '..', d, 'manifest.json');
  if (fs.existsSync(f)) for (const it of JSON.parse(fs.readFileSync(f, 'utf8'))) expected[it.id] = it;
}

const groups = new Map();
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    const it = expected[r.id];
    if (!it || r.error || r.heard == null) { continue; }
    const got = M.score(it.expected, r.heard, { sound: SOUND ? r.lang : false }).words.map((w) => w.read);
    const key = [r.set === 'syn' ? `synthetic ${r.lang}` : r.set, r.kind, r.engine, r.throttle > 1 ? `${r.throttle}x` : '1x', BY ? r[BY] : ''].join(' | ');
    let g = groups.get(key);
    if (!g) { g = { n: 0, words: 0, agree: 0, tRead: 0, tNot: 0, falseRead: 0, falseMiss: 0, foils: 0, foilRead: 0, absErr: 0, signErr: 0, truthCorrect: 0, audio: 0, hear: 0, rss: 0, mem: 0, load: 0, slow: r.throttle_measured }; groups.set(key, g); }
    g.n += 1;
    let c = 0; let tc = 0;
    // a foil: a word put into the expected text that the reader never said (the real sets' ".foil" twins)
    const base = r.id.endsWith('.foil') ? expected[r.id.slice(0, -5)] : null;
    if (base) {
      const bw = base.expected.split(/\s+/); const fw = it.expected.split(/\s+/); let j = 0;
      fw.forEach((w, i) => { if (j < bw.length && bw[j] === w) j += 1; else { g.foils += 1; if (got[i]) g.foilRead += 1; } });
    }
    it.truth.forEach((t, i) => {
      g.words += 1; if (got[i] === t) g.agree += 1;
      if (t) { g.tRead += 1; tc += 1; if (!got[i]) g.falseMiss += 1; } else { g.tNot += 1; if (got[i]) g.falseRead += 1; }
      if (got[i]) c += 1;
    });
    g.absErr += Math.abs(c - tc); g.signErr += c - tc; g.truthCorrect += tc;
    if (r.ms) { g.audio += r.ms.audio; g.hear += r.ms.hear; }
    g.rss = Math.max(g.rss, r.rss_mb || 0); g.mem = Math.max(g.mem, r.mem_mb || 0); g.load = r.load_ms;
  }
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '–');
const rows = [...groups.entries()].sort().map(([k, g]) => ({
  group: k, recordings: g.n, words: g.words, agreement_pct: pct(g.agree, g.words), false_read_pct: pct(g.falseRead, g.tNot), foil_read_pct: g.foils ? pct(g.foilRead, g.foils) : '', false_missed_pct: pct(g.falseMiss, g.tRead),
  count_err_words: (g.absErr / g.n).toFixed(1), wcpm_bias_pct: pct(g.signErr, g.truthCorrect), rtf: g.audio ? (g.hear / g.audio).toFixed(3) : '–', slow_measured: g.slow, page_mem_mb: g.mem || '', rss_mb: g.rss || '', load_ms: g.load,
}));
if (arg('json')) fs.writeFileSync(path.resolve(arg('json')), JSON.stringify({ sound: SOUND, rows }, null, 1));
const cols = ['group', 'recordings', 'words', 'agreement_pct', 'false_read_pct', 'foil_read_pct', 'false_missed_pct', 'count_err_words', 'wcpm_bias_pct', 'rtf', 'slow_measured', 'page_mem_mb', 'rss_mb'];
console.log(`matching: ${SOUND ? "Jugnu's rules + sound fold" : "Jugnu's rules exactly"}`);
console.log(cols.join('\t'));
for (const r of rows) console.log(cols.map((c) => r[c]).join('\t'));
