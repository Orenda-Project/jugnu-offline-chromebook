// Operator, 18 Nov 2026: every Chromebook saves the lesson videos of Classes 1 to 5 by default (about 4.6 GB), after
// everything else; a teacher can untick a class; a Chromebook short of room says so, saves as many classes as fit
// and leaves nothing half-saved. The lesson-videos step (ready/videos.js) run against test/videos-rig.mjs, and the
// start page's own default (cb.html).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { videosRig, MB, STORE } from './videos-rig.mjs';
import { load } from './sw-harness.mjs';

const school = { NURSERY: { n: 2, bytes: 50 * MB }, KG: { n: 2, bytes: 50 * MB }, 1: { n: 3, bytes: 100 * MB }, 2: { n: 3, bytes: 100 * MB }, 3: { n: 3, bytes: 100 * MB }, 4: { n: 3, bytes: 100 * MB }, 5: { n: 3, bytes: 100 * MB }, 6: { n: 2, bytes: 50 * MB } };

test('nobody has chosen: Classes 1 to 5 are saved, each whole, in order; Nursery, KG and Class 6 are not', async () => {
  const r = videosRig({ classes: school, own: '1', chosen: null });
  await r.step.run(r.ctx);
  assert.deepEqual(r.kept(), { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 });
  const order = [...new Set(r.videos(r.warmed).map((u) => /student-videos\/([^/]+)\//.exec(u)[1]))];
  assert.deepEqual(order, ['1', '2', '3', '4', '5'], 'one class after another, lowest first');
  assert.deepEqual(Object.keys(r.json('cb-videos')).sort(), ['1', '2', '3', '4', '5']);
});

test("a teacher's ticks stand: an unticked class is not saved, and none means none", async () => {
  const some = videosRig({ classes: school, own: '1', chosen: ['2', '4'] });
  await some.step.run(some.ctx);
  assert.deepEqual(some.kept(), { 2: 3, 4: 3 });
  const none = videosRig({ classes: school, own: '1', chosen: [] });
  assert.equal(await none.step.run(none.ctx), 'no class ticked');
  assert.deepEqual(none.kept(), {});
});

test('short of room: every class that fits is saved whole, the one that does not fit is not started, and it is said', async () => {
  // Class 2 is big (3 x 400 MB). Room for 1.1 GB: Class 1 (300 MB) fits, Class 2 (1.2 GB) does not, Class 3 (300 MB) still does.
  const r = videosRig({ classes: { 1: { n: 3, bytes: 100 * MB }, 2: { n: 3, bytes: 400 * MB }, 3: { n: 3, bytes: 100 * MB } }, own: '1', chosen: null, room: 1100 * MB });
  await assert.rejects(() => r.step.run(r.ctx), (e) => {
    assert.match(e.message, /Class 2 needs 1\.[2-9] GB, this Chromebook has room for \d+ MB/);
    assert.doesNotMatch(e.message, /Class 1|Class 3/, 'only the class that does not fit is named');
    return true;
  });
  assert.deepEqual(r.kept(), { 1: 3, 3: 3 }, 'the classes that fit are whole; nothing of Class 2 is on the drive');
  const s = r.json('cb-videos');
  assert.equal(s['2'].why, 'no room'); assert.equal(s['2'].saved, 0);
  assert.equal(s['1'].saved, 3); assert.equal(s['3'].saved, 3);
});

test('the drive fills in the middle of a class: what was kept of THAT class is taken off again, and no further class is started', async () => {
  // room was promised, but the drive itself refuses the 5th video (the 2nd of Class 2)
  const r = videosRig({ classes: { 1: { n: 3, bytes: 100 * MB }, 2: { n: 3, bytes: 100 * MB }, 3: { n: 3, bytes: 100 * MB } }, own: '1', chosen: null, fullAfter: 4 });
  await assert.rejects(() => r.step.run(r.ctx), /Class 2: the drive filled up; nothing of Class 2 is kept/);
  assert.deepEqual(r.kept(), { 1: 3 }, 'Class 1 is whole, Class 2 is gone again, Class 3 was not started');
  assert.ok(r.dropped.some((u) => /student-videos\/2\/C2L1_web\.mp4/.test(u)), 'the one Class 2 video that was kept is taken off');
  assert.ok(r.dropped.some((u) => /quiz-audio\/C2L1\//.test(u)), 'with its quiz voices');
  assert.ok(!r.dropped.some((u) => /student-videos\/1\//.test(u)), 'nothing of Class 1 is touched');
  assert.deepEqual(r.json('cb-videos-2'), []);
  assert.equal(r.json('cb-videos')['2'].saved, 0);
  assert.equal(r.json('cb-videos')['2'].why, 'no room');
});

test("a lesson's page is not kept while its video is only being measured; it is kept with its video", async () => {
  const r = videosRig({ classes: { 1: { n: 3, bytes: 400 * MB } }, own: '1', chosen: null, room: 700 * MB }); // does not fit: only measured
  await assert.rejects(() => r.step.run(r.ctx));
  const pages = r.fetched.filter((f) => /^\/q\/C1L\d/.test(f.url));
  assert.equal(pages.length, 3);
  assert.ok(pages.every((f) => f.keep === false), 'a page read only to find its video is asked for with X-CB-Keep: no');
  assert.equal(r.warmed.filter((u) => /\/q\/C1L\d/.test(u)).length, 0, 'and is not handed to the worker to keep');
  const fits = videosRig({ classes: { 1: { n: 3, bytes: 100 * MB } }, own: '1', chosen: null });
  await fits.step.run(fits.ctx);
  assert.equal(fits.warmed.filter((u) => /\/q\/C1L\d/.test(u)).length, 3, 'a class that is saved has each page kept with its video');
});

test('the progress line names the class and where it stands among the classes', async () => {
  const r = videosRig({ classes: { 1: { n: 3, bytes: 100 * MB }, 2: { n: 3, bytes: 100 * MB }, 3: { n: 3, bytes: 100 * MB } }, own: '1', chosen: null });
  await r.step.run(r.ctx);
  assert.ok(r.said.some((t) => /^Class 2 \(2 of 3\): 3 of 3 lessons \(300 MB of 300 MB\)/.test(t)), r.said.filter((t) => /Class 2/).slice(-1)[0]);
});

/* ---- the start page's ticks (cb.html's own functions, run here) ---- */
test('the start page ticks Classes 1 to 5 until a teacher chooses otherwise', () => {
  const html = fs.readFileSync(new URL('../cb.html', import.meta.url), 'utf8');
  const m = /function videoDefault\(all\) \{[\s\S]*?\n  \}\n/.exec(html);
  assert.ok(m, 'cb.html has a videoDefault(all) function');
  const videoDefault = new Function(`${m[0]}; return videoDefault;`)();
  assert.deepEqual(videoDefault(['NURSERY', 'KG', '1', '2', '3', '4', '5', '6']), ['1', '2', '3', '4', '5']);
  assert.deepEqual(videoDefault(['1', '2', '3']), ['1', '2', '3'], 'a school with three classes: those three');
  assert.deepEqual(videoDefault([]), []);
});

/* ---- the worker's part ---- */
const page = () => new Response('<html><body>lesson</body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

test('the worker does not keep a page asked for with X-CB-Keep: no, and keeps the same page asked for plainly', async () => {
  const sw = load({ fetch: async () => page() });
  const res = await sw.get('/q/C1L1?k=chip&via=videos', { headers: { 'X-CB-Keep': 'no' } });
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await sw.isKept('/q/C1L1?k=chip&via=videos'), false, 'only read, not kept');
  await sw.get('/q/C1L1?k=chip&via=videos');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await sw.isKept('/q/C1L1?k=chip&via=videos'), true);
});

test('the worker takes files off the drive when asked ({type: "drop"}): a video by its address without the signature, a page by its own', async () => {
  const sw = load({ fetch: async () => new Response('no', { status: 404 }) });
  await sw.kept(`${STORE}/student-videos/2/C2L1_web.mp4`, new Response(new Uint8Array(10), { headers: { 'Content-Type': 'video/mp4' } }));
  await sw.kept(`${STORE}/student-videos/1/C1L1_web.mp4`, new Response(new Uint8Array(10), { headers: { 'Content-Type': 'video/mp4' } }));
  await sw.kept('/q/C2L1?k=chip&via=videos', page());
  const n = await sw.message({ type: 'drop', urls: [`${STORE}/student-videos/2/C2L1_web.mp4?X-Amz-Signature=zz`, 'http://pilot.test/q/C2L1?k=chip&via=videos', `${STORE}/student-videos/2/never_web.mp4?X-Amz-Signature=yy`] });
  assert.equal(n, 2, 'two of the three were on the drive');
  assert.equal(await sw.isKept(`${STORE}/student-videos/2/C2L1_web.mp4`), false);
  assert.equal(await sw.isKept('/q/C2L1?k=chip&via=videos'), false);
  assert.equal(await sw.isKept(`${STORE}/student-videos/1/C1L1_web.mp4`), true, 'what was not named stays');
});
