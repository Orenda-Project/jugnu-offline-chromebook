// Lesson video sizes must be REAL, whatever Jugnu's list says. The list's size (v.mb) is there only for lessons Jugnu
// happened to have looked at lately: on 17 Nov a whole class came with none, so the log said "112 of 112 lessons
// (0 MB)" for 806 MB on the drive, and the "is there room for the whole class?" check worked with a need of 0.
//   1. the worker says how big a media file is: on the drive, or on the server (asked with a one-byte range)
//   2. the videos step (ready/videos.js, run here as on the start page) measures before it saves, refuses a class
//      that does not fit, and reports the bytes kept
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { load, ORIGIN } from './sw-harness.mjs';

const STORE = 'https://store.example.r2.cloudflarestorage.com';
const MB = 1e6;

test('the worker says how big a media file is: on the drive, or on the server with one byte asked for', async () => {
  const asked = [];
  const sw = load({ fetch: async (req) => {
    const u = new URL(req.url);
    if (u.pathname !== '/__cb/media') return new Response('no', { status: 404 });
    asked.push({ u: u.searchParams.get('u'), range: req.headers.get('range') });
    if (/c_web\.mp4/.test(u.searchParams.get('u'))) return new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }); // not this site's media route
    return new Response('x', { status: 206, headers: { 'X-CB-Media': '1', 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-0/7340032' } });
  } });
  await sw.kept(`${STORE}/student-videos/1/a_web.mp4`, new Response(new Uint8Array(1234), { headers: { 'Content-Type': 'video/mp4' } }));
  const got = await sw.message({ type: 'size', urls: [`${STORE}/student-videos/1/a_web.mp4?X-Amz-Signature=aa`, `${STORE}/student-videos/1/b_web.mp4?X-Amz-Signature=bb`, `${STORE}/student-videos/1/c_web.mp4?X-Amz-Signature=cc`] });
  assert.deepEqual(got, [{ bytes: 1234, kept: true }, { bytes: 7340032, kept: false }, { bytes: null, kept: false }]);
  assert.equal(asked.length, 2, 'a file on the drive is not asked for again');
  assert.equal(asked[0].range, 'bytes=0-0', 'one byte is asked for, never the file');
});

/* ---- the videos step, with a list that carries no sizes ---- */
const lesson = (i) => ({ vid: `0000000${i}-aaaa-4bbb-8ccc-dddddddddddd`, title: `Lesson ${i}`, code: `CODE${i}`, k: `chip${i}`, thumb: `/wq/vt/${i}.webp` }); // no mb, no secs
// `room`: what Chrome will really let this site keep (asked for with ctx.fits). `estimate`: what navigator.storage.estimate()
// says is free, which on Chrome 123+ is "10 GB" on every device whatever the drive holds. `canAsk: false` is a browser
// that cannot be asked (no private file store): then, and only then, the estimate is all there is.
function rig({ bytes, room, estimate = 10 * 2 ** 30, canAsk = true, lessons = [1, 2, 3].map(lesson), withMb = false }) {
  const kv = new Map();
  const localStorage = { getItem: (k) => (kv.has(k) ? kv.get(k) : null), setItem: (k, v) => { kv.set(k, String(v)); }, removeItem: (k) => { kv.delete(k); } };
  const saved = new Set();   // media paths "on the drive"
  const warmed = [];         // every address the step asked to save
  const video = (v) => `${STORE}/student-videos/1/${v.code}_web.mp4`;
  const fetch = async (u, init) => {
    const url = new URL(u, ORIGIN);
    const ok = (body, type = 'application/json') => ({ ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), headers: { get: () => type } });
    if (url.pathname.startsWith('/api/wq/lib/h/')) {
      if (url.searchParams.get('s')) return ok({ chapters: [{ name: 'One', videos: lessons.map((v) => (withMb ? { ...v, mb: 6.1 } : v)) }] });
      return ok({ grade: '1', grades: [{ g: '1', n: lessons.length }, { g: '2', n: 82 }], subjects: [{ key: 'English', n: lessons.length }] });
    }
    const page = /^\/q\/(CODE\d)$/.exec(url.pathname);
    if (page) return ok(`<html><script>{"video":{"url":"${video({ code: page[1] })}?X-Amz-Signature=s"},"a":"${STORE}/quiz-audio/${page[1]}/q1.ogg?X-Amz-Signature=t"}</script></html>`, 'text/html');
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../ready/videos.js', import.meta.url), 'utf8'), { window, localStorage, fetch, console, setTimeout, Promise, JSON, Math, Date, Array, Object, String, Number, RegExp, encodeURIComponent, Error });
  const logs = []; const said = [];
  const path = (u) => new URL(u).origin + new URL(u).pathname;
  const ctx = {
    cfg: {}, hub: 'HUB', kid: 'kid1', key: 'key', games: [],
    log: (t) => logs.push(t), setPct: (p, t) => { if (t) said.push(t); }, abs: (u) => (/^https?:/.test(u) ? u : ORIGIN + u),
    warm: async (urls) => { urls.forEach((u) => { warmed.push(u); if (/r2\.cloudflarestorage/.test(u)) saved.add(path(u)); }); return { warmed: urls.length, failed: [], gone: [], total: urls.length }; },
    frame: async () => null,
    ask: async (m) => {
      if (m.type === 'size') return m.urls.map((u) => ({ bytes: /_web\.mp4/.test(u) ? bytes : 40000, kept: saved.has(path(u)) }));
      if (m.type === 'have') return m.urls.map((u) => saved.has(path(u)));
      if (m.type === 'kept-text') return null;
      return null;
    },
    space: async () => ({ used: 0, quota: estimate, free: estimate, room: canAsk ? room : null, safe: false }), isFull: () => false, waitOnline: async () => {}, child: () => null,
    fits: async (n) => (canAsk ? n <= room : null),
    note: (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)), videoGrades: () => ['1'],
  };
  const step = window.CB_READY.find((s) => s.name === 'lesson videos');
  return { step, ctx, logs, said, warmed, kv, json: (k) => JSON.parse(kv.get(k) || 'null') };
}

test('a class whose list has no sizes is still refused when it does not fit: the need is measured, not 0', async () => {
  // 3 lessons x 400 MB = 1.2 GB of video; Chrome really allows 700 MB more, while its estimate says 10 GB are free
  const r = rig({ bytes: 400 * MB, room: 700 * MB });
  await assert.rejects(() => r.step.run(r.ctx), (e) => {
    assert.match(e.message, /Class 1 needs 1\.[2-9] GB, this Chromebook has room for 700 MB/);
    return true;
  });
  assert.equal(r.warmed.filter((u) => /_web\.mp4/.test(u)).length, 0, 'no video is fetched for a class that does not fit');
  assert.equal(r.json('cb-videos')['1'].why, 'no room');
});

test('a browser that cannot be asked: the estimate is used, as before', async () => {
  const r = rig({ bytes: 400 * MB, room: 0, canAsk: false, estimate: 700 * MB });
  await assert.rejects(() => r.step.run(r.ctx), /Class 1 needs 1\.[2-9] GB, this Chromebook has room for 700 MB/);
  const fine = rig({ bytes: 400 * MB, room: 0, canAsk: false, estimate: 10 * 2 ** 30 });
  await fine.step.run(fine.ctx);
  assert.equal(fine.warmed.filter((u) => /_web\.mp4/.test(u)).length, 3);
});

test('a class whose list has no sizes is reported by the bytes really kept, never "0 MB"', async () => {
  const r = rig({ bytes: 400 * MB, room: 10000 * MB });
  const note = await r.step.run(r.ctx);
  assert.equal(r.warmed.filter((u) => /_web\.mp4/.test(u)).length, 3);
  const line = r.logs.find((l) => /Class 1: 3 of 3 lessons/.test(l));
  assert.ok(line, 'the log has a line for the class');
  assert.match(line, /1\.2 GB of video/);
  // nowhere is the class's size said as 0: not in the log, not in the step's note, not as the total in the progress line
  assert.doesNotMatch(r.logs.join('\n') + '\n' + note + '\n' + r.said.join('\n'), /\(0 MB\)|\(0 MB of video|of 0 MB|lessons, 0 MB/);
  assert.equal(r.json('cb-videos')['1'].mb, 1200, 'what the start page shows as saved is the video kept, in MB');
  assert.equal(r.json('cb-video-sizes')['1'].mb, 1200, 'and the class is listed with its real size');
  assert.match(note, /Class 1: 3 lessons, 1\.2 GB/);
});

test('when the list does carry sizes, the measured bytes still decide (the list rounds, and can be stale)', async () => {
  const r = rig({ bytes: 9 * MB, room: 10000 * MB, withMb: true }); // the list says 6.1 MB each; the files are 9 MB
  await r.step.run(r.ctx);
  assert.equal(r.json('cb-videos')['1'].mb, 27);
});

/* ---- what the start page says beside each class's tick (cb.html's own function, run here) ---- */
test('the start page never shows a size it does not have, and shows what is saved by its real size', () => {
  const html = fs.readFileSync(new URL('../cb.html', import.meta.url), 'utf8');
  const m = /function videoLine\(s, d\) \{[\s\S]*?\n  \}\n/.exec(html);
  assert.ok(m, 'cb.html has a videoLine(s, d) function');
  const mb = (bytes) => (bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.round(bytes / 1e6) + ' MB');
  const videoLine = new Function('mb', `${m[0]}; return videoLine;`)(mb);
  assert.equal(videoLine({ n: 112 }, undefined), '112 lessons', 'a class not measured yet: its lesson count, no size');
  assert.equal(videoLine({ n: 112, mb: 0 }, undefined), '112 lessons', 'a size of 0 is "not known", never "0 MB"');
  assert.equal(videoLine({ n: 112, mb: 806, measured: true }, undefined), '112 lessons, 806 MB');
  assert.equal(videoLine({ n: 112, mb: 800 }, undefined), '112 lessons, about 800 MB', 'an estimate is called one');
  assert.equal(videoLine({ n: 112, mb: 806, measured: true }, { n: 112, saved: 112, mb: 806, clips_mb: 105 }), '112 lessons, 806 MB · 112 saved (806 MB)');
  assert.equal(videoLine({ n: 121, mb: 1278, measured: true }, { n: 121, saved: 40, mb: 410, why: 'no room' }), '121 lessons, 1.3 GB · 40 saved (410 MB) · no room for the rest');
  assert.equal(videoLine(undefined, undefined), '');
});
