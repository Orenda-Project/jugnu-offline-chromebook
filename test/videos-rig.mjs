// Runs the lesson-videos Get-ready step (ready/videos.js) as the start page runs it, against a made-up Jugnu and a
// made-up drive the test controls. Nothing here is the step's own logic: lists, lesson pages, a media store, room.
//   const r = videosRig({ classes: { 1: { n: 3, bytes: 400e6 } }, room: 700e6 });  await r.step.run(r.ctx);
// classes   class -> { n lessons, bytes per video }   (listed in this order; `own` is the home child's class)
// room      what the browser will really let this site keep (shrinks as videos are kept); canAsk:false = a browser
//           that cannot be asked, judged by `estimate` (what navigator.storage.estimate() calls free: 10 GB on Chrome)
// chosen    what the teacher ticked: null = never chose, [] = none, ['1','3']
// fullAfter the drive really fills after that many videos are kept (a write is refused), whatever was promised
// withMb    the lists carry a size (6.1 MB) for every lesson, as Jugnu's sometimes do
// rows      'code' (default): the lists name each lesson's page (a child with a class code). 'none': they name none
//           (a child with no class code, or one whose class code has slipped out of Jugnu's view of their history)
// start     what Jugnu answers when a lesson is started (POST /api/wq/videos/start): 'code' = {code, k}, a lesson
//           page; 'watch' = {watch: {vid, url, poster, …}}, the video alone (what a child with no class code gets)
// before    what an earlier Get ready left on this Chromebook: { '1': 'old' } = that class's videos, pages and clips
//           as the step saved them before it kept a record per lesson; { '1': 'whole' } = saved as it saves now
import fs from 'node:fs';
import vm from 'node:vm';

import { ORIGIN } from './sw-harness.mjs';

export const STORE = 'https://store.example.r2.cloudflarestorage.com';
export const MB = 1e6;
const CLIP = 40000; // one quiz voice clip

export function videosRig({ classes = { 1: { n: 3, bytes: 400 * MB } }, own = Object.keys(classes)[0], room = 1e12, estimate = 10 * 2 ** 30, canAsk = true, chosen = [String(own)], fullAfter = Infinity, withMb = false, rows = 'code', start = 'code', before = {} } = {}) {
  const kv = new Map();
  const localStorage = { getItem: (k) => (kv.has(k) ? kv.get(k) : null), setItem: (k, v) => { kv.set(k, String(v)); }, removeItem: (k) => { kv.delete(k); } };
  const saved = new Map();   // media path "on the drive" -> bytes
  const warmed = [];         // every address the step asked to save, in order
  const dropped = [];        // every address the step took off the drive again
  const fetched = [];        // every page or list the step asked Jugnu for: {url, keep}
  const starts = [];         // every lesson the step asked Jugnu to start (the vid)
  const records = new Map(); // the worker's record per saved lesson (vid -> {vid, url, …})
  const pages = new Set();   // lesson pages kept on the drive (their address)
  let videosKept = 0; let full = false; let left = room;
  const grades = Object.keys(classes).map(String);
  const vidOf = (g, i) => `${String(g).padStart(4, '0')}000${i + 1}-aaaa-4bbb-8ccc-dddddddddddd`;
  const lessonsOf = (g) => Array.from({ length: classes[g].n }, (_, i) => ({ vid: vidOf(g, i), title: `Class ${g} lesson ${i + 1}`, secs: 300, ...(rows === 'code' ? { code: `C${g}L${i + 1}`, k: `chip${g}${i + 1}` } : {}), thumb: `/wq/vt/${g}-${i + 1}.webp`, ...(withMb ? { mb: 6.1 } : {}) }));
  const byVid = (vid) => { for (const g of grades) for (let i = 0; i < classes[g].n; i += 1) if (vidOf(g, i) === vid) return { g, i, code: `C${g}L${i + 1}`, k: `chip${g}${i + 1}` }; return null; };
  const videoUrl = (g, code) => `${STORE}/student-videos/${g}/${code}_web.mp4`;
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
    if (url.pathname === '/api/wq/videos/start') {
      const b = JSON.parse(init.body || '{}'); const l = byVid(b.vid); starts.push(b.vid);
      if (!l) return { ok: false, status: 400, json: async () => ({}), text: async () => '' };
      if (start === 'watch') return ok({ watch: { vid: b.vid, url: `${videoUrl(l.g, l.code)}?X-Amz-Signature=w`, poster: `${STORE}/student-videos/${l.g}/${l.code}_poster.jpg?X-Amz-Signature=p`, secs: 300, title: `Class ${l.g} lesson ${l.i + 1}`, title_ur: 'سبق', lang: 'en', after: true, next: { kind: 'game', href: '/c/x#bigger' } } });
      return ok({ code: l.code, k: l.k });
    }
    const page = /^\/q\/(C([^L]+)L\d+)$/.exec(url.pathname);
    if (page) return ok(`<html><script>{"video":{"url":"${videoUrl(page[2], page[1])}?X-Amz-Signature=s"},"a":"${STORE}/quiz-audio/${page[1]}/q1.ogg?X-Amz-Signature=t"}</script></html>`);
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
        if (/\/q\/C/.test(u)) pages.add(new URL(u).pathname + new URL(u).search);
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
      if (m.type === 'watch-keep') { m.recs.forEach((r) => records.set(r.vid, r)); return m.recs.length; }
      if (m.type === 'kept-text') {
        const u = new URL(m.url, ORIGIN);
        const w = /^\/__cb\/watch\/(.+)$/.exec(u.pathname);
        if (w) return records.has(decodeURIComponent(w[1])) ? JSON.stringify(records.get(decodeURIComponent(w[1]))) : null;
        if (pages.has(u.pathname + u.search)) return (await fetch(u.pathname + u.search)).text();
        return null;
      }
      return null;
    },
    forget: async (urls) => { urls.forEach((u) => { dropped.push(u); const w = /\/__cb\/watch\/(.+)$/.exec(u); if (w) records.delete(decodeURIComponent(w[1])); if (/^https?:\/\/store\./.test(u) && saved.has(path(u))) { left += saved.get(path(u)); saved.delete(path(u)); } }); return urls.length; },
    space: async () => ({ used: 0, quota: estimate, free: estimate, room: canAsk ? left : null, safe: false }),
    fits: async (n) => (canAsk ? n <= left : null),
    isFull: () => full, waitOnline: async () => {}, child: () => null,
    note: (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)), videoGrades: () => chosen,
  };
  // what an earlier Get ready left here
  for (const [g, how] of Object.entries(before)) {
    const had = [];
    for (let i = 0; i < classes[g].n; i += 1) {
      const code = `C${g}L${i + 1}`; had.push(vidOf(g, i));
      saved.set(path(videoUrl(g, code)), classes[g].bytes); saved.set(`${STORE}/quiz-audio/${code}/q1.ogg`, CLIP); pages.add(`/q/${code}?k=chip${g}${i + 1}&via=videos`);
      if (how === 'whole') records.set(vidOf(g, i), { vid: vidOf(g, i), url: videoUrl(g, code), poster: null, secs: 300, title: `Class ${g} lesson ${i + 1}`, lang: 'en', after: false, page: `/q/${code}?k=chip${g}${i + 1}&via=videos` });
    }
    kv.set('cb-videos-' + g, JSON.stringify(had));
  }
  const step = window.CB_READY.find((s) => s.name === 'lesson videos');
  const videos = (list) => list.filter((u) => /_web\.mp4/.test(u));
  return {
    step, ctx, logs, said, warmed, dropped, fetched, starts, records, pages, kv, json: (k) => JSON.parse(kv.get(k) || 'null'),
    /** The videos kept on the drive now, per class: { '1': 3, … } */
    kept: () => { const out = {}; for (const p of saved.keys()) if (/_web\.mp4$/.test(p)) { const g = classOf(p); out[g] = (out[g] || 0) + 1; } return out; },
    videos,
  };
}
