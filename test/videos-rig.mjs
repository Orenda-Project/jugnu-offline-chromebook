// Runs the lesson-videos Get-ready step (ready/videos.js) as the start page runs it, against a made-up Jugnu and a
// made-up drive the test controls. Nothing here is the step's own logic: lists, lesson pages, a media store, room.
//   const r = videosRig({ classes: { 1: { n: 3, bytes: 400e6 } }, room: 700e6 });  await r.step.run(r.ctx);
// classes   class -> { n lessons, bytes per video }   (listed in this order; `own` is the home child's class)
// room      what the browser will really let this site keep (shrinks as videos are kept); canAsk:false = a browser
//           that cannot be asked, judged by `estimate` (what navigator.storage.estimate() calls free: 10 GB on Chrome)
// chosen    what the teacher ticked: null = never chose, [] = none, ['1','3']
// fullAfter the drive really fills after that many videos are kept (a write is refused), whatever was promised
// withMb    the lists carry a size (6.1 MB) for every lesson, as Jugnu's sometimes do
import fs from 'node:fs';
import vm from 'node:vm';

import { ORIGIN } from './sw-harness.mjs';

export const STORE = 'https://store.example.r2.cloudflarestorage.com';
export const MB = 1e6;
const CLIP = 40000; // one quiz voice clip

export function videosRig({ classes = { 1: { n: 3, bytes: 400 * MB } }, own = Object.keys(classes)[0], room = 1e12, estimate = 10 * 2 ** 30, canAsk = true, chosen = [String(own)], fullAfter = Infinity, withMb = false } = {}) {
  const kv = new Map();
  const localStorage = { getItem: (k) => (kv.has(k) ? kv.get(k) : null), setItem: (k, v) => { kv.set(k, String(v)); }, removeItem: (k) => { kv.delete(k); } };
  const saved = new Map();   // media path "on the drive" -> bytes
  const warmed = [];         // every address the step asked to save, in order
  const dropped = [];        // every address the step took off the drive again
  const fetched = [];        // every page or list the step asked Jugnu for: {url, keep}
  let videosKept = 0; let full = false; let left = room;
  const grades = Object.keys(classes).map(String);
  const lessonsOf = (g) => Array.from({ length: classes[g].n }, (_, i) => ({ vid: `${String(g).padStart(4, '0')}000${i + 1}-aaaa-4bbb-8ccc-dddddddddddd`, title: `Class ${g} lesson ${i + 1}`, code: `C${g}L${i + 1}`, k: `chip${g}${i + 1}`, thumb: `/wq/vt/${g}-${i + 1}.webp`, ...(withMb ? { mb: 6.1 } : {}) }));
  const classOf = (u) => (/student-videos\/([^/]+)\//.exec(u) || /quiz-audio\/C([^L/]+)L/.exec(u) || [])[1];
  const sizeOf = (u) => (/_web\.mp4/.test(u) ? classes[classOf(u)].bytes : CLIP);
  const path = (u) => new URL(u).origin + new URL(u).pathname;
  const fetch = async (u, init = {}) => {
    const url = new URL(u, ORIGIN);
    const headers = init.headers || {};
    fetched.push({ url: url.pathname + url.search, keep: (headers['X-CB-Keep'] || headers['x-cb-keep'] || '') !== 'no' });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (url.pathname.startsWith('/api/wq/lib/h/')) {
      const g = url.searchParams.get('g') || String(own);
      if (url.searchParams.get('s')) return ok({ chapters: [{ name: 'One', videos: lessonsOf(g) }] });
      return ok({ grade: String(own), grades: grades.map((x) => ({ g: x, n: classes[x].n })), subjects: [{ key: 'English', n: classes[g].n }] });
    }
    const page = /^\/q\/(C([^L]+)L\d+)$/.exec(url.pathname);
    if (page) return ok(`<html><script>{"video":{"url":"${STORE}/student-videos/${page[2]}/${page[1]}_web.mp4?X-Amz-Signature=s"},"a":"${STORE}/quiz-audio/${page[1]}/q1.ogg?X-Amz-Signature=t"}</script></html>`);
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../ready/videos.js', import.meta.url), 'utf8'), { window, localStorage, fetch, console, setTimeout, Promise, JSON, Math, Date, Array, Object, String, Number, RegExp, encodeURIComponent, Error });
  const logs = []; const said = [];
  const ctx = {
    cfg: {}, hub: 'HUB', kid: 'kid1', key: 'key', games: [],
    log: (t) => logs.push(t), setPct: (p, t) => { if (t) said.push(t); }, abs: (u) => (/^https?:/.test(u) ? u : ORIGIN + u),
    warm: async (urls) => {
      const failed = [];
      for (const u of urls) {
        warmed.push(u);
        if (!/r2\.cloudflarestorage/.test(u) || saved.has(path(u))) continue;
        if (/_web\.mp4/.test(u) && videosKept >= fullAfter) { full = true; failed.push(u); continue; } // the drive refuses the write
        saved.set(path(u), sizeOf(u)); left -= sizeOf(u);
        if (/_web\.mp4/.test(u)) videosKept += 1;
      }
      return { warmed: urls.length - failed.length, failed, gone: [], total: urls.length };
    },
    frame: async () => null,
    ask: async (m) => {
      if (m.type === 'size') return m.urls.map((u) => ({ bytes: sizeOf(u), kept: saved.has(path(u)) }));
      if (m.type === 'have') return m.urls.map((u) => saved.has(path(u)));
      if (m.type === 'kept-text') return null;
      return null;
    },
    forget: async (urls) => { urls.forEach((u) => { dropped.push(u); if (/^https?:\/\/store\./.test(u) && saved.has(path(u))) { left += saved.get(path(u)); saved.delete(path(u)); } }); return urls.length; },
    space: async () => ({ used: 0, quota: estimate, free: estimate, room: canAsk ? left : null, safe: false }),
    fits: async (n) => (canAsk ? n <= left : null),
    isFull: () => full, waitOnline: async () => {}, child: () => null,
    note: (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)), videoGrades: () => chosen,
  };
  const step = window.CB_READY.find((s) => s.name === 'lesson videos');
  const videos = (list) => list.filter((u) => /_web\.mp4/.test(u));
  return {
    step, ctx, logs, said, warmed, dropped, fetched, kv, json: (k) => JSON.parse(kv.get(k) || 'null'),
    /** The videos kept on the drive now, per class: { '1': 3, … } */
    kept: () => { const out = {}; for (const p of saved.keys()) if (/_web\.mp4$/.test(p)) { const g = classOf(p); out[g] = (out[g] || 0) + 1; } return out; },
    videos,
  };
}
