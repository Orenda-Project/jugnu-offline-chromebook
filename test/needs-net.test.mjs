// Operator, 18 Nov 2026: "If there is internet and content is not downloaded it should still play." And with no
// internet, what is not saved must say so plainly to a child: never a blank or a broken page.
// The offline worker's part, run in node (test/sw-harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

import { load, tick } from './sw-harness.mjs';

const STORE = 'https://store.example.r2.cloudflarestorage.com';

test('online, a lesson video that is not saved streams from where it is: the range is passed on, and no whole copy is fetched beside it', async () => {
  const sw = load({ fetch: async (req) => new Response(new Uint8Array(100), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-99/7340032' } }) });
  const res = await sw.get(`${STORE}/student-videos/3/C3L1_web.mp4?X-Amz-Signature=s`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), 'bytes 0-99/7340032');
  await tick(30);
  assert.equal(sw.net.calls.length, 1, 'one request: the player\'s own');
  assert.equal(sw.net.calls[0].url, `${STORE}/student-videos/3/C3L1_web.mp4?X-Amz-Signature=s`, 'straight to where the video is (its signed link), not through a download');
  assert.equal(sw.net.calls[0].headers.range, 'bytes=0-99');
  assert.equal(await sw.isKept(`${STORE}/student-videos/3/C3L1_web.mp4`), false, 'playing a video does not save it (Get ready does)');
});

test('online, a page that is not saved is the server\'s page (and is then kept)', async () => {
  const sw = load({ fetch: async () => new Response('<html><body>the quiz</body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) });
  const res = await sw.visit('/q/ABCDEF');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /the quiz/);
});

test('no network, a page that is not saved: a page a child can read, in English and Urdu, with a way Home', async () => {
  const sw = load({});
  sw.net.down = true;
  const res = await sw.visit('/q/ABCDEF?k=chip&via=videos');
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('X-CB-Offline'), '1', 'still marked for the self-test and the rigs');
  assert.match(res.headers.get('Content-Type'), /^text\/html/);
  const html = await res.text();
  assert.match(html, /This needs the internet/);
  assert.match(html, /انٹرنیٹ/, 'said in Urdu too');
  assert.match(html, /href="\/cb\/home"/, 'a way Home');
  assert.match(html, /not saved on this (device|Chromebook)/, 'the words the other rigs look for are still there');
  assert.match(html, /<meta name="viewport"/);
  assert.doesNotMatch(html, /<h1>Offline<\/h1>/, 'not the bare page');
  assert.ok(html.length > 800, 'a real page, not two lines');
});

test('no network, a file (not a page) that is not saved is still a plain 503 for the page\'s own code to handle', async () => {
  const sw = load({});
  sw.net.down = true;
  const res = await sw.get('/api/wq/quiz/ABCDEF');
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('X-CB-Offline'), '1');
  assert.equal(await res.text(), 'offline');
});

test('the worker says whether the network is there, from what its last requests met', async () => {
  let down = false;
  const sw = load({ fetch: async () => { if (down) throw new TypeError('Failed to fetch'); return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } }); } });
  await sw.get('/wq/a.css');
  assert.deepEqual(await sw.message({ type: 'net' }), { offline: false });
  down = true;
  await sw.get('/wq/b.css');
  assert.deepEqual(await sw.message({ type: 'net' }), { offline: true });
  down = false;
  await sw.get('/wq/c.css');
  assert.deepEqual(await sw.message({ type: 'net' }), { offline: false });
});

test('a lesson quiz started with no network greets the child who was picked, not nobody ("Welcome back, !")', async () => {
  const sw = load({});
  // boot.js tells the worker who is playing (the first name only) whenever a page opens
  await sw.message({ type: 'home', name: 'Sana Bibi' });
  sw.net.down = true;
  const res = await sw.post('/api/wq/session', { code: 'ABCDEF', k: '31bc5cd1db15cc31', device_ref: 'dddddddddddddddddddddd' }); // from the home: a chip, no typed name
  const body = await res.json();
  assert.match(body.st, /^cblocal\./);
  assert.equal(body.child.first, 'Sana');
  // a name the child typed still wins
  const typed = await (await sw.post('/api/wq/session', { code: 'ABCDEF', device_ref: 'dddddddddddddddddddddd', new: { name: 'Bilal' } })).json();
  assert.equal(typed.child.first, 'Bilal');
});

/* ---- boot.js: which of Jugnu's own "this did not open" screens get the plain words when there is no network ---- */
test('with no network, Jugnu\'s "could not open" screens are the ones that get "This needs the internet": a list, the shelf, a storybook', async () => {
  const fs = await import('node:fs');
  const boot = fs.readFileSync(new URL('../boot.js', import.meta.url), 'utf8');
  const m = /var FAILED_RX = (\/.*\/);/.exec(boot);
  assert.ok(m, 'boot.js names the screens in FAILED_RX');
  const rx = new Function(`return ${m[1]};`)();
  // Jugnu's own copy (dashboard/public/wq/wq-doors.js, wq-stories.js), English and Urdu
  for (const said of ['This did not load.', 'The stories could not open yet.', 'Jugnu could not open this.', 'اوہو! یہ نہیں کھل سکا۔', 'کہانیاں ابھی نہیں کھل سکیں۔', 'یہ کتاب ابھی نہیں کھل سکی۔']) assert.ok(rx.test(`Stories ${said} Try again`), said);
  assert.equal(rx.test('Stories Storybooks Grade 3, English Eid time by Azka Zia'), false, 'a list that did load is left alone');
});
