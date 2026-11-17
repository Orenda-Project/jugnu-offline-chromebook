// A new version of the offline worker takes over while Get ready is starting (the pilot was deployed since this
// Chromebook last opened it). Found on the rig, 18 Nov 2026: Get ready registers the worker, which is when Chrome
// fetches the new file; about two seconds later the "Child home" step opens the home in a hidden frame. When that
// request reached the OUTGOING worker and it was still reading this Chromebook's home record from the drive (1.7 s
// on a drive holding 800 MB), the incoming worker took over, the outgoing one was ended with the request unanswered,
// and the frame stayed blank for ever: "the child home did not open" (4 of 7 runs after a changed worker file).
// Three things, each tested here:
//   - Get ready waits for a worker that is on its way in before its first step (cb.html: workerSettled)
//   - a home that did not open in the frame is opened once more before the step gives up (cb.html: homeFrame)
//   - the worker has the home record in memory from its start, so a home request never waits on the drive
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { load, ORIGIN } from './sw-harness.mjs';

const html = fs.readFileSync(new URL('../cb.html', import.meta.url), 'utf8');
const fn = (name, args) => {
  const m = new RegExp(`function ${name}\\(${args}\\) \\{[\\s\\S]*?\\n  \\}\\n`).exec(html);
  assert.ok(m, `cb.html has a ${name}(${args}) function`);
  return m[0];
};
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
/** A worker as a page sees it: a state, and "statechange" listeners. */
const worker = (state) => { const ls = []; return { state, addEventListener: (t, f) => { if (t === 'statechange') ls.push(f); }, to(s) { this.state = s; ls.forEach((f) => f()); } }; };

test('Get ready: no new worker on its way in, so nothing to wait for', async () => {
  const workerSettled = new Function('setTimeout', 'clearTimeout', `${fn('workerSettled', 'reg, wait')}; return workerSettled;`)(setTimeout, clearTimeout);
  const reg = { installing: null, waiting: null, active: worker('activated'), update: async () => {} };
  assert.equal(await workerSettled(reg, 1000), 'same');
});

test('Get ready: a new worker is on its way in; the first step waits until it is in charge', async () => {
  const workerSettled = new Function('setTimeout', 'clearTimeout', `${fn('workerSettled', 'reg, wait')}; return workerSettled;`)(setTimeout, clearTimeout);
  const incoming = worker('installing');
  // (the browser finds the new file when asked to look: update() resolves with the new worker installing)
  const reg = { installing: null, waiting: null, active: worker('activated'), update: async () => { reg.installing = incoming; } };
  let done = null;
  workerSettled(reg, 5000).then((v) => { done = v; });
  await tick(); assert.equal(done, null, 'still installing: wait');
  incoming.to('installed'); reg.installing = null; reg.waiting = incoming;
  await tick(); assert.equal(done, null, 'installed, the old one still in charge: wait');
  incoming.to('activating');
  await tick(); assert.equal(done, null, 'taking over: wait');
  incoming.to('activated');
  await tick(); assert.equal(done, 'new', 'in charge: go');
});

test('Get ready: a worker already waiting when the page looks is waited for too; one that is thrown away is not', async () => {
  const workerSettled = new Function('setTimeout', 'clearTimeout', `${fn('workerSettled', 'reg, wait')}; return workerSettled;`)(setTimeout, clearTimeout);
  const waiting = worker('installed');
  const reg = { installing: null, waiting, active: worker('activated'), update: async () => {} };
  let done = null;
  workerSettled(reg, 5000).then((v) => { done = v; });
  await tick(); assert.equal(done, null);
  waiting.to('redundant');
  await tick(); assert.equal(done, 'new');
});

test('Get ready: no network to look for a new worker with, or a worker that never takes over: Get ready still starts', async () => {
  const workerSettled = new Function('setTimeout', 'clearTimeout', `${fn('workerSettled', 'reg, wait')}; return workerSettled;`)(setTimeout, clearTimeout);
  const offline = { installing: null, waiting: null, active: worker('activated'), update: async () => { throw new TypeError('Failed to fetch'); } };
  assert.equal(await workerSettled(offline, 1000), 'same');
  const stuck = { installing: worker('installing'), waiting: null, active: worker('activated'), update: async () => {} };
  const t0 = Date.now();
  assert.equal(await workerSettled(stuck, 60), 'late');
  assert.ok(Date.now() - t0 >= 50, 'waited as long as it was told to, no longer');
  const slowLook = { installing: null, waiting: null, active: worker('activated'), update: () => new Promise(() => {}) }; // the look itself hangs
  assert.equal(await workerSettled(slowLook, 60), 'late');
});

test('Child home step: a home that did not open in its frame is opened once more; twice blank is "did not open"', async () => {
  const make = (frames) => {
    const opened = []; const removed = [];
    const frame = async (src) => { const f = frames.shift(); f.src = src; f.remove = () => removed.push(f); opened.push(f); return f; };
    const homeFrame = new Function('frame', 'CFG', `${fn('homeFrame', 'tries')}; return homeFrame;`)(frame, { hub: 'HUB' });
    return { homeFrame, opened, removed };
  };
  const blank = () => ({ contentDocument: { querySelector: () => null } });
  const home = () => ({ contentDocument: { querySelector: (q) => (q === 'a.wq-door' ? {} : null) } });
  const ok = make([blank(), home()]);
  const f = await ok.homeFrame(2);
  assert.equal(f, ok.opened[1], 'the second frame, with the home in it');
  assert.equal(ok.opened[1].src, '/h/HUB');
  assert.deepEqual(ok.removed, [ok.opened[0]], 'the blank one is taken off the page');
  const first = make([home()]);
  assert.equal(await first.homeFrame(2), first.opened[0]);
  assert.equal(first.opened.length, 1, 'a home that opened is not opened twice');
  const never = make([blank(), blank()]);
  await assert.rejects(() => never.homeFrame(2), /the child home did not open/);
  assert.equal(never.opened.length, 2);
});

/* ---- the worker's part ---- */
const token = (ids, exp) => `${Buffer.from(JSON.stringify({ k: 'h', ids, exp })).toString('base64url')}.${'s'.repeat(22)}`;

test('worker: the home record is in memory from the start, so a home page is asked of the network at once even when the drive does not answer', async () => {
  const now = Math.floor(Date.now() / 1000);
  const hub = token(['11111111-1111-4111-8111-111111111111'], now + 600000);
  const sw = load({ fetch: async (req) => (new URL(req.url).pathname.startsWith('/h/') ? new Response('<html><a class="wq-door"></a></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }) : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) });
  await tick(20);
  assert.equal(sw.run('homeMem !== null'), true, 'read when the worker started, before anything asked for it');
  // from here on the drive does not answer (what a busy 800 MB store did for 1.7 s while a new worker was coming in)
  sw.caches.open = () => new Promise(() => {});
  const res = await Promise.race([sw.visit(`/h/${hub}`), tick(400).then(() => 'never answered')]);
  assert.notEqual(res, 'never answered', 'the request must not wait for the drive');
  assert.equal(res.status, 200);
  assert.ok(sw.net.calls.some((c) => c.url === `/h/${hub}`), 'it went to the network');
});
