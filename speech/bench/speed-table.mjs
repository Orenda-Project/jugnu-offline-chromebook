// The speed and memory table from bench/speed.sh's results: seconds of work per second of sound (1.0 = as long as the
// reading itself), on this machine and with the CPU throttle, and what that means for a 60-second reading.
//   node bench/speed-table.mjs [throttle=8] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results', 'raw');
const T = Number(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 8);
const rows = {}; const mem = {};
for (const f of fs.readdirSync(RAW).filter((x) => x.startsWith('speed.'))) {
  for (const l of fs.readFileSync(path.join(RAW, f), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    if (f.endsWith('.mem.jsonl')) { (mem[r.engine] = mem[r.engine] || {})[r.throttle] = r; continue; }
    if (!r.ms) continue;
    const k = `${r.lang} ${r.engine}`; const g = (rows[k] = rows[k] || {}); const t = (g[r.throttle] = g[r.throttle] || { audio: 0, hear: 0, n: 0, slow: r.throttle_measured });
    t.audio += r.ms.audio; t.hear += r.ms.hear; t.n += 1;
  }
}
const out = [];
for (const k of Object.keys(rows).sort()) {
  const g = rows[k]; if (!g[1]) continue;
  const engine = k.split(' ')[1]; const r1 = g[1].hear / g[1].audio; const rT = g[T] ? g[T].hear / g[T].audio : null; const m = (mem[engine] || {})[1] || {};
  out.push({ lang: k.split(' ')[0], engine, recordings: g[1].n, audio_s: Math.round(g[1].audio / 1000), rtf_1x: +r1.toFixed(3), [`rtf_${T}x`]: rT ? +rT.toFixed(2) : null,
    model_slowdown: rT ? +(rT / r1).toFixed(1) : null, js_slowdown: g[T] ? g[T].slow : null,
    rtf_if_4_4x: +(r1 * 4.4).toFixed(2), rtf_if_11x: +(r1 * 11).toFixed(2), s_for_60s_at_throttle: rT ? Math.round(rT * 60) : null,
    page_mem_mb: m.page_mem_mb, rss_rest_mb: m.rss_rest_mb, rss_peak_mb: m.rss_peak_mb, rss_base_mb: m.rss_base_mb, load_ms_1x: m.load_ms });
}
const i = process.argv.indexOf('--json'); if (i > 0) fs.writeFileSync(path.resolve(process.argv[i + 1]), JSON.stringify(out, null, 1));
const cols = Object.keys(out[0] || {});
console.log(cols.join('\t')); for (const r of out) console.log(cols.map((c) => r[c]).join('\t'));
