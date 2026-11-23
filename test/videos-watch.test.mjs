// A child with no class code gets a lesson as a video alone ("watch"): Jugnu's start answers {watch: {vid, url, …}},
// there is no lesson page, and the lists name no page. Found 18 Nov 2026 on the all-five-classes run: Classes 1 to 4
// were saved, then every lesson of Class 5 "could not be read" and none was saved. The home child had a class code
// when the run began and none by Class 5: Jugnu looks at a child's 18 newest quiz codes, and the lesson pages Get
// ready had read pushed the class quiz out of that view. From then on the lists named no pages, the step threw away
// its record of what was saved (a class restored after a check came back "0 of 28"), and with the network off a
// saved lesson said "This video needs the internet".
// So: a lesson is saved either way (with its page and quiz, or as the video alone); every saved lesson has a record
// on the drive that is what "saved" means; and with no network a lesson whose video is on the drive plays, whichever
// way today's list points.
import test from 'node:test';
import assert from 'node:assert/strict';

import { videosRig, MB, STORE } from './videos-rig.mjs';
import { load, ORIGIN } from './sw-harness.mjs';

/* ---- the step (ready/videos.js) ---- */
test('a class whose lessons are videos alone is saved: every video, a record for each, no lesson page asked for', async () => {
  const r = videosRig({ classes: { 5: { n: 3, bytes: 100 * MB } }, own: '5', chosen: ['5'], rows: 'none', start: 'watch' });
  await r.step.run(r.ctx);
  assert.deepEqual(r.kept(), { 5: 3 });
  assert.equal(r.json('cb-videos')['5'].saved, 3);
  assert.equal(r.records.size, 3, 'a record on the drive for each saved lesson');
  const rec = [...r.records.values()][0];
  assert.equal(rec.url, `${STORE}/student-videos/5/C5L1_web.mp4`, 'the video by its lasting address (no signature: that runs out in hours)');
  assert.equal(rec.poster, `${STORE}/student-videos/5/C5L1_poster.jpg`);
  assert.equal(rec.title, 'Class 5 lesson 1'); assert.equal(rec.title_ur, 'سبق'); assert.equal(rec.secs, 300);
  assert.equal(rec.after, false, 'no quiz is promised that is not on the drive');
  assert.equal(rec.next, undefined, 'nor a "next" that Jugnu picked for that moment');
  assert.equal(r.fetched.filter((f) => /^\/q\//.test(f.url)).length, 0);
  assert.ok(r.warmed.some((u) => /C5L1_poster\.jpg/.test(u)), 'its picture is saved with it');
});

test('a lesson with a page still gets its page, its quiz clips, and a record that names the page', async () => {
  const r = videosRig({ classes: { 1: { n: 3, bytes: 100 * MB } }, chosen: ['1'] });
  await r.step.run(r.ctx);
  assert.equal(r.records.size, 3);
  const rec = [...r.records.values()][0];
  assert.equal(rec.page, '/q/C1L1?k=chip11&via=videos');
  assert.equal(rec.url, `${STORE}/student-videos/1/C1L1_web.mp4`);
  assert.equal(r.pages.size, 3);
  assert.equal(r.starts.length, 0, 'the lists named the pages: nothing was started');
});

test('saved before, and the lists no longer name the pages (the child\'s class code has gone): still whole, nothing fetched again, nothing started', async () => {
  const r = videosRig({ classes: { 1: { n: 3, bytes: 100 * MB } }, chosen: ['1'], rows: 'none', start: 'watch', before: { 1: 'whole' } });
  const out = await r.step.run(r.ctx);
  assert.match(out, /Class 1: 3 lessons/);
  assert.equal(r.json('cb-videos')['1'].saved, 3);
  assert.deepEqual(r.json('cb-videos-1').length, 3, 'the record of what is saved is kept, not thrown away');
  assert.equal(r.starts.length, 0, 'a lesson that is whole on the drive is not started again (a start is counted by Jugnu as the child watching)');
  assert.equal(r.videos(r.warmed).length, 0, 'and no video is fetched');
  assert.ok(r.logs.some((l) => /Class 1: 3 of 3 lessons on this Chromebook .*all were here already/.test(l)), r.logs.join(' | '));
});

test('saved by the step as it was before (videos and pages on the drive, no records): taken over, not downloaded again', async () => {
  const r = videosRig({ classes: { 1: { n: 3, bytes: 100 * MB } }, chosen: ['1'], rows: 'none', start: 'watch', before: { 1: 'old' }, room: 50 * MB });
  await r.step.run(r.ctx); // (room for 50 MB only: it must see that the 300 MB are here already)
  assert.equal(r.json('cb-videos')['1'].saved, 3);
  assert.equal(r.records.size, 3, 'each now has its record');
  assert.equal(r.starts.length, 3, 'each was started once, to learn where its video is');
  assert.ok(r.logs.some((l) => /Class 1: 3 of 3 lessons on this Chromebook .*; 3 were on the drive already and were taken over/.test(l) && !/saved now/.test(l)), r.logs.join(' | '));
});

test('nothing could be saved: the log does not say "all were here already"', async () => {
  // Jugnu answers neither a page nor a video for these lessons
  const r = videosRig({ classes: { 9: { n: 2, bytes: 50 * MB } }, own: '9', chosen: ['9'], rows: 'none', start: 'watch' });
  const real = r.ctx.warm; r.ctx.warm = async (urls) => ({ warmed: 0, failed: urls.slice(), gone: [], total: urls.length }); // nothing can be saved
  await assert.rejects(() => r.step.run(r.ctx), /Class 9: 2 of 2 lessons not saved yet/);
  r.ctx.warm = real;
  assert.ok(!r.logs.some((l) => /all were here already/.test(l)), r.logs.join(' | '));
});

/* ---- the worker ---- */
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const VID = '00050001-aaaa-4bbb-8ccc-dddddddddddd';
const REC = { vid: VID, url: `${STORE}/student-videos/5/C5L1_web.mp4`, poster: `${STORE}/student-videos/5/C5L1_poster.jpg`, secs: 300, title: 'Lesson', lang: 'en', after: false };
const startBody = (extra = {}) => ({ hub: 'not-a-home-link', kid: 'kid1', vid: VID, ...extra });

test('worker: keeps a lesson\'s record when the step hands it over, and takes it off with the lesson', async () => {
  const sw = load({ fetch: async () => jsonRes({}, 404) });
  assert.equal(await sw.message({ type: 'watch-keep', recs: [REC] }), 1);
  assert.equal(await sw.isKept(`/__cb/watch/${VID}`), true);
  await sw.message({ type: 'drop', urls: [`${ORIGIN}/__cb/watch/${VID}`] });
  assert.equal(await sw.isKept(`/__cb/watch/${VID}`), false);
});

test('worker, no network: a lesson that is started gets its saved video ({watch}), so the Videos door plays it', async () => {
  const sw = load({ fetch: async () => jsonRes({}, 404) });
  await sw.message({ type: 'watch-keep', recs: [REC] });
  sw.net.down = true;
  const res = await sw.post('/api/wq/videos/start', startBody());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-CB-Local'), '1');
  assert.deepEqual((await res.json()).watch, REC);
  const none = await sw.post('/api/wq/videos/start', startBody({ vid: '00050002-aaaa-4bbb-8ccc-dddddddddddd' }));
  assert.equal(none.status, 503, 'a lesson that is not saved: the page is told there is no network');
  const quiz = await sw.post('/api/wq/videos/start', startBody({ after: 1 }));
  assert.equal(quiz.status, 503, 'the quiz after a video alone is made by the server: not offered from the drive');
});

test('worker, no network: Jugnu\'s own earlier answer wins when it leads to a page that is on the drive, and not when the page is not', async () => {
  const page = () => new Response('<html>lesson</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  const sw = load({ fetch: async (req) => (new URL(req.url).pathname === '/api/wq/videos/start' ? jsonRes({ code: 'C5L1', k: 'chip51' }) : page()) });
  await sw.message({ type: 'watch-keep', recs: [REC] });
  assert.deepEqual(await (await sw.post('/api/wq/videos/start', startBody())).json(), { code: 'C5L1', k: 'chip51' }, 'online: the server answers');
  await new Promise((r) => setTimeout(r, 20));
  sw.net.down = true;
  const noPage = await (await sw.post('/api/wq/videos/start', startBody())).json();
  assert.deepEqual(noPage.watch, REC, 'the page it names is not on the drive: the saved video instead');
  await sw.kept('/q/C5L1?k=chip51&via=videos', page());
  assert.deepEqual(await (await sw.post('/api/wq/videos/start', startBody())).json(), { code: 'C5L1', k: 'chip51' }, 'the page is on the drive: the lesson with its quiz');
});

test('worker: with a network a start goes to the server untouched, record or no record', async () => {
  const sw = load({ fetch: async () => jsonRes({ watch: { vid: VID, url: `${STORE}/x_web.mp4?sig=1`, after: true } }) });
  await sw.message({ type: 'watch-keep', recs: [REC] });
  const j = await (await sw.post('/api/wq/videos/start', startBody())).json();
  assert.equal(j.watch.after, true);
  assert.equal(j.watch.url, `${STORE}/x_web.mp4?sig=1`);
});

test('worker, no network: a saved list of lessons names only the lessons that play (a record on the drive), and of those only the pages on the drive', async () => {
  const list = { chapters: [{ name: 'One', videos: [{ vid: 'a', title: 'A', code: 'AAA111', k: 'ka' }, { vid: 'b', title: 'B', code: 'BBB222', k: 'kb' }, { vid: 'c', title: 'C' }] }] };
  const sw = load({ fetch: async () => jsonRes(list) });
  const url = '/api/wq/lib/h/not-a-home-link?kid=kid1&l=en&g=5&s=English';
  const online = await (await sw.get(url)).json();
  assert.equal(online.chapters[0].videos[1].code, 'BBB222', 'with a network the list is Jugnu\'s own');
  await new Promise((r) => setTimeout(r, 20));
  await sw.kept('/q/AAA111?k=ka&via=videos', new Response('<html>a</html>', { headers: { 'Content-Type': 'text/html' } }));
  await sw.message({ type: 'watch-keep', recs: [{ vid: 'a', url: `${STORE}/a_web.mp4` }, { vid: 'b', url: `${STORE}/b_web.mp4` }] }); // c is not saved
  sw.net.down = true;
  const off = await (await sw.get(url)).json();
  assert.equal(off.chapters[0].videos[0].code, 'AAA111', 'its page is on the drive: named');
  assert.equal(off.chapters[0].videos[1].code, undefined, 'its page is not: the door will start it, and get the saved video');
  assert.equal(off.chapters[0].videos[1].title, 'B');
  assert.equal(off.chapters[0].videos.length, 2, 'c is not on this Chromebook: not offered (23 Nov 2026)');
});
