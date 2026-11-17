// The media store's files in a cache of their own.
// Found 18 Nov 2026 on the all-five-classes run: with four classes of lesson videos on the drive (15,979 files in the
// one cache) Get ready could no longer say "Ready": the worker's look through the cache failed with "Failed to
// execute 'keys' on 'Cache': Operation too large" (Chrome will not list a cache whose list is over about 10 MB; the
// deployed run, 14,062 files, was just under). Every lane lists that cache (the audit, the storybooks' own check, a
// game's scoring with no network). Lesson videos and their quiz clips are most of the files, by the thousand, and
// nobody needs them listed: they go in a cache of their own, and the main cache stays the size it was.
import test from 'node:test';
import assert from 'node:assert/strict';

import { load, ORIGIN } from './sw-harness.mjs';

const STORE = 'https://store.example.r2.cloudflarestorage.com';
const VIDEO = `${STORE}/student-videos/5/L1_web.mp4`;
const bytes = (n) => new Uint8Array(n);
const media = (n = 1000) => new Response(bytes(n), { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(n), 'X-CB-Media': '1' } });
const net = async (req) => {
  const u = new URL(req.url);
  if (u.pathname === '/__cb/media') return req.headers.get('Range') ? new Response(bytes(1), { status: 206, headers: { 'Content-Range': 'bytes 0-0/1000', 'X-CB-Media': '1', 'Content-Type': 'video/mp4' } }) : media();
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const inCache = async (sw, name, key) => !!(await (await sw.caches.open(name)).match(key));

test('a media-store file that Get ready saves goes in the media cache, not the main one', async () => {
  const sw = load({ fetch: net });
  const r = await sw.message({ type: 'warm', urls: [`${VIDEO}?X-Amz-Signature=a`], readable: true });
  assert.equal(r.warmed, 1);
  assert.equal(await inCache(sw, 'cb-media-v1', VIDEO), true, 'in the media cache, under its address without the signature');
  assert.equal(await inCache(sw, 'cb-pilot-v1', VIDEO), false, 'not in the main cache (which every lane lists)');
});

test('it is found there: "is it on the drive", its size, and a player\'s request for a part of it', async () => {
  const sw = load({ fetch: net });
  await sw.message({ type: 'warm', urls: [`${VIDEO}?X-Amz-Signature=a`], readable: true });
  sw.net.down = true;
  assert.deepEqual(await sw.message({ type: 'have', urls: [`${VIDEO}?X-Amz-Signature=later`] }), [true]);
  assert.deepEqual(await sw.message({ type: 'size', urls: [`${VIDEO}?X-Amz-Signature=later`] }), [{ bytes: 1000, kept: true }]);
  const part = await sw.get(`${VIDEO}?X-Amz-Signature=later`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
});

test('a file an earlier version saved in the main cache still plays, and is moved over when Get ready next looks at it', async () => {
  const sw = load({ fetch: net });
  await sw.kept(VIDEO, new Response(bytes(1000), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1000' } }));
  sw.net.down = true;
  const part = await sw.get(`${VIDEO}?X-Amz-Signature=x`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(part.status, 206, 'it plays from where it is');
  assert.equal(await inCache(sw, 'cb-pilot-v1', VIDEO), true, 'playing moves nothing');
  assert.deepEqual(await sw.message({ type: 'size', urls: [VIDEO] }), [{ bytes: 1000, kept: true }]);
  assert.equal(await inCache(sw, 'cb-media-v1', VIDEO), true, 'Get ready looked at it: now in the media cache');
  assert.equal(await inCache(sw, 'cb-pilot-v1', VIDEO), false, 'and out of the main one');
  const again = await sw.get(`${VIDEO}?X-Amz-Signature=y`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(again.status, 206);
});

test('taking a lesson off the drive takes its file out of whichever cache holds it', async () => {
  const sw = load({ fetch: net });
  await sw.message({ type: 'warm', urls: [`${VIDEO}?X-Amz-Signature=a`], readable: true });
  await sw.kept(`${STORE}/student-videos/5/L2_web.mp4`, new Response(bytes(10), { headers: { 'Content-Type': 'video/mp4' } }));
  assert.equal(await sw.message({ type: 'drop', urls: [VIDEO, `${STORE}/student-videos/5/L2_web.mp4?X-Amz-Signature=z`] }), 2);
  assert.equal(await inCache(sw, 'cb-media-v1', VIDEO), false);
  assert.equal(await inCache(sw, 'cb-pilot-v1', `${STORE}/student-videos/5/L2_web.mp4`), false);
});

test('the audit does not list the cache: it finds each step\'s list by the step\'s name, so a cache too big to list still gets its answer', async () => {
  const sw = load({ fetch: net });
  await sw.message({ type: 'expect', step: 'x-lesson-videos', urls: [`${VIDEO}?X-Amz-Signature=a`, `${ORIGIN}/q/NOPE01?k=x&via=videos`] });
  await sw.message({ type: 'warm', urls: [`${VIDEO}?X-Amz-Signature=a`], readable: true });
  // from here on the main cache refuses to be listed, as Chrome's does past about 10 MB of names
  const c = await sw.caches.open('cb-pilot-v1');
  c.keys = async (req) => { if (req) return []; const e = new Error("Failed to execute 'keys' on 'Cache': Operation too large."); e.name = 'AbortError'; throw e; };
  const a = await sw.message({ type: 'audit' });
  assert.ok(a, 'the audit answers');
  const step = a.steps.find((s) => s.step === 'x-lesson-videos');
  assert.ok(step, 'and knows the step');
  assert.equal(step.total, 2); assert.equal(step.missing, 1, 'the video is on the drive, the page is not');
});
