// SAVED WHILE IT PLAYS (operator, 23 Nov 2026): "if classes outside 1-5 are playing a video, it gets downloaded on
// the Chromebook as well while streaming. If the download is stopped mid way, the UI can say so and show other
// classes' videos to choose from." Streamed instantly; the whole video is saved beside it through this site, the
// lesson gets a record, and with no network it plays. The worker's part, run in node (test/sw-harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

import { load, tick, ORIGIN } from './sw-harness.mjs';

const STORE = 'https://store.example.r2.cloudflarestorage.com';
const VID = '00060001-aaaa-4bbb-8ccc-dddddddddddd';
const VIDEO = `${STORE}/student-videos/6/C6L1_web.mp4`;
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const LIST = `/api/wq/lib/h/not-a-home-link?kid=kid1&l=en&g=6&s=English`;
const list = (rows) => ({ chapters: [{ name: 'One', videos: rows }] });

/** A network with Jugnu's list, its start answer, the lesson page, and the media route (cut short when `cut`). */
function net(opts = {}) {
  const o = opts; // the same object the test holds: it can cut the network and bring it back
  if (o.cut == null) o.cut = false;
  if (!o.start) o.start = { watch: { vid: VID, url: `${VIDEO}?X-Amz-Signature=s1`, title: 'Class 6 lesson 1', poster: `${STORE}/student-videos/6/C6L1_poster.jpg?X-Amz-Signature=p`, secs: 240 } };
  return async (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/api/wq/lib/h/not-a-home-link') {
      const subj = u.searchParams.get('s');
      if (!subj) return jsonRes({ grade: 6, subjects: [{ key: 'English' }, { key: 'Science' }] });
      if (subj === 'Science') return jsonRes(list([{ vid: 'sci1', title: 'Science 1' }, { vid: 'sci2', title: 'Science 2' }]));
      return jsonRes(list([{ vid: VID, title: 'Class 6 lesson 1', code: 'C6L1', k: 'chip61', thumb: `${STORE}/t.jpg` }, { vid: 'other', title: 'Not played' }]));
    }
    if (u.pathname === '/api/wq/videos/start') return jsonRes(o.start);
    if (u.pathname.startsWith('/q/')) return new Response('<html>lesson page</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    if (u.pathname === '/__cb/media') {
      const body = new Uint8Array(o.cut ? 400 : 1000);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1000', 'X-CB-Media': '1' } });
    }
    return new Response(new Uint8Array(100), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-99/1000' } });
  };
}
const record = async (sw, vid = VID) => {
  const c = await sw.caches.open('cb-pilot-v1');
  const r = await c.match(`${ORIGIN}/__cb/watch/${encodeURIComponent(vid)}`);
  return r ? r.json() : null;
};

test('a lesson started as a video alone is saved while it plays, gets its record, and plays with no network', async () => {
  const sw = load({ fetch: net() });
  await (await sw.get(LIST)).json(); // the door showed Class 6's list (its lessons' names and class are learnt)
  const started = await (await sw.post('/api/wq/videos/start', { hub: 'not-a-home-link', kid: 'kid1', vid: VID })).json();
  assert.equal(started.watch.url, `${VIDEO}?X-Amz-Signature=s1`, 'online, the start is Jugnu\'s own answer');
  await sw.get(started.watch.url, { headers: { Range: 'bytes=0-99' } }); // the player streams it
  await tick(60);
  const rec = await record(sw);
  assert.ok(rec, 'the lesson has a record once its video is whole');
  assert.equal(rec.url, VIDEO, 'by its lasting address');
  assert.equal(rec.title, 'Class 6 lesson 1');
  assert.equal(rec.g, '6', 'its class, from the list it was shown in');
  assert.equal(rec.played, 1, 'saved while it played, not by Get ready');
  assert.equal(sw.net.calls.filter((c) => c.url.startsWith('/__cb/media?u=') && /C6L1_web/.test(decodeURIComponent(c.url))).length, 1, 'downloaded whole once, beside the stream');
  sw.net.down = true;
  const off = await sw.post('/api/wq/videos/start', { hub: 'not-a-home-link', kid: 'kid1', vid: VID });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).watch.url, VIDEO, 'with no network the saved video is started');
  const played = await sw.get(`${VIDEO}?X-Amz-Signature=s9`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(played.status, 206, 'and plays from the drive');
  const st = await sw.message({ type: 'played-status' });
  assert.deepEqual(st.played, { 6: 1 });
  assert.deepEqual(st.wanted, []);
});

test('a lesson page playing its video: matched to its lesson by the page, saved, and given a record', async () => {
  const sw = load({ fetch: net() });
  await (await sw.get(LIST)).json(); // the list names the page /q/C6L1?k=chip61 for this lesson
  await sw.getFrom('/q/C6L1?k=chip61&via=videos', `${VIDEO}?X-Amz-Signature=s2`, { headers: { Range: 'bytes=0-99' } });
  await tick(60);
  const rec = await record(sw);
  assert.ok(rec, 'the page told which lesson its video is');
  assert.equal(rec.vid, VID);
  assert.equal(rec.g, '6');
});

test('a save cut short: nothing half-kept, it waits on a list, and goes again when a page says the network is back', async () => {
  const opts = { cut: true };
  const n = net(opts);
  const sw = load({ fetch: (req) => n(req) });
  await (await sw.get(LIST)).json();
  await (await sw.post('/api/wq/videos/start', { hub: 'not-a-home-link', kid: 'kid1', vid: VID })).json();
  await tick(60);
  assert.equal(await record(sw), null, 'no record: the lesson is not whole');
  assert.deepEqual(await sw.message({ type: 'have', urls: [VIDEO] }), [false], 'and no half video on the drive');
  let st = await sw.message({ type: 'played-status' });
  assert.equal(st.wanted.length, 1, 'the page can say a lesson did not finish saving');
  assert.equal(st.wanted[0].g, '6');
  assert.equal(st.wanted[0].why, 'short');
  opts.cut = false; // the Wi-Fi is back
  assert.equal(await sw.message({ type: 'played-retry' }), 1);
  await tick(60);
  assert.ok(await record(sw), 'saved on the second go, with its record');
  st = await sw.message({ type: 'played-status' });
  assert.deepEqual(st.wanted, []);
  assert.deepEqual(st.played, { 6: 1 });
});

test('a save cut short whose signed link has run out is let go (the lesson is saved the next time it is played)', async () => {
  const sw = load({ fetch: net({ cut: true }) });
  await (await sw.post('/api/wq/videos/start', { hub: 'not-a-home-link', kid: 'kid1', vid: VID })).json();
  await tick(60);
  const c = await sw.caches.open('cb-pilot-v1');
  const key = `${ORIGIN}/__cb/played-wanted`;
  const l = await (await c.match(key)).json();
  l[0].at -= 6 * 3600e3; // six hours ago
  await c.put(key, jsonRes(l));
  assert.equal(await sw.message({ type: 'played-retry' }), 0);
  assert.deepEqual((await sw.message({ type: 'played-status' })).wanted, []);
});

test('no network: a list names only lessons that play, and the page is told how many of how many; the self-test sees the list whole', async () => {
  const sw = load({ fetch: net() });
  await (await sw.get(LIST)).json();
  await (await sw.post('/api/wq/videos/start', { hub: 'not-a-home-link', kid: 'kid1', vid: VID })).json();
  await tick(60);
  sw.net.down = true;
  const off = await (await sw.getFrom('/cb/home', LIST)).json();
  assert.deepEqual(off.chapters[0].videos.map((v) => v.vid), [VID], 'the lesson that was saved while it played; not the other');
  await tick(10);
  const told = sw.posted.filter((p) => p.data.type === 'cb-lib-offline');
  assert.equal(told.length, 1);
  assert.deepEqual({ g: told[0].data.g, s: told[0].data.s, kept: told[0].data.kept, total: told[0].data.total }, { g: '6', s: 'English', kept: 1, total: 2 });
  // "Check this Chromebook": the list as saved, so a saved lesson gone missing is still named
  sw.net.down = false;
  await sw.message({ type: 'saved-only', on: true, ms: 5000 });
  const whole = await (await sw.getFrom('/cb', LIST)).json();
  assert.equal(whole.chapters[0].videos.length, 2);
  await sw.message({ type: 'saved-only', on: false });
});

test('with a network nothing is held back: the list is Jugnu\'s own, and a lesson not saved still plays from the internet', async () => {
  const sw = load({ fetch: net() });
  const on = await (await sw.getFrom('/cb/home', LIST)).json();
  assert.equal(on.chapters[0].videos.length, 2);
  assert.equal(sw.posted.length, 0);
  const res = await sw.get(`${STORE}/student-videos/6/C6L2_web.mp4?X-Amz-Signature=x`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(res.status, 206);
});

test('no network: a class\'s subjects with nothing that plays are left out, and the page gets the whole class\'s count', async () => {
  const sw = load({ fetch: net() });
  const TOP = '/api/wq/lib/h/not-a-home-link?kid=kid1&l=en&g=6';
  await (await sw.get(TOP)).json();
  await (await sw.get(LIST)).json();
  await (await sw.get(`${TOP}&s=Science`)).json();
  await (await sw.post('/api/wq/videos/start', { hub: 'not-a-home-link', kid: 'kid1', vid: VID })).json();
  await tick(60);
  sw.net.down = true;
  const off = await (await sw.getFrom('/cb/home', TOP)).json();
  assert.deepEqual(off.subjects.map((x) => x.key), ['English'], 'Science has nothing that plays: Jugnu would draw it as tiles that never fill');
  await tick(10);
  const told = sw.posted.filter((p) => p.data.type === 'cb-lib-offline' && p.data.s === '*');
  assert.equal(told.length, 1);
  assert.deepEqual({ g: told[0].data.g, kept: told[0].data.kept, total: told[0].data.total }, { g: '6', kept: 1, total: 4 });
});
