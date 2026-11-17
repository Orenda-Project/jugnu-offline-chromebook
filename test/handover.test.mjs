// A newer version of the offline worker takes over (the pilot was deployed since this Chromebook last opened it).
// Found on the rig, 18 Nov 2026: a full Get ready stopped at "the child home did not open". What the experiments
// showed (an instrumented worker; rig/handover-check.mjs plays it):
//   - Get ready registers the worker, which is when Chrome fetches the changed file. The new worker installs, and
//     once the outgoing one is idle Chrome stops it and makes the new one the worker in charge (skipWaiting).
//   - A page asked for in that moment (after the outgoing worker was stopped, before the new one is "activating")
//     is handed to a FRESH copy of the outgoing worker (it starts with nothing in memory), and that copy is ended
//     when the new worker is in charge. The page is never answered: a frame stays blank, a tab stays where it was.
//   - A page already being fetched is waited for (held 4 s by the server: the new worker waited 4 s, the page
//     opened). A page asked for once the new worker is "activating" is kept for it and opens. Requests for data at
//     that moment were all answered (18 of 18).
// Before: the Child home step failed in 4 Get-ready runs of 7 after a changed worker file, and 2 of 13 moves to
// another page begun 0.6 to 0.9 s after a new worker appeared were never answered. Tested here:
//   - Get ready waits for a worker that is on its way in before its first step (cb.html: workerSettled)
//   - a home that did not open in its frame is opened once more before the step gives up (cb.html: homeFrame)
//   - a move to another page that a takeover cut off is made again by the page (boot.js: moveGuard)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ORIGIN } from './sw-harness.mjs';

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

/* ---- a child's tap in the moment a newer worker takes over (boot.js: moveGuard) ----
 * The page remembers where it was last asked to go, and goes again when a newer worker has taken over and the page
 * is still there. */
const boot = fs.readFileSync(new URL('../boot.js', import.meta.url), 'utf8');
function guarded() {
  const m = /function moveGuard\(w\) \{[\s\S]*?\n  \}\n/.exec(boot);
  assert.ok(m, 'boot.js has a moveGuard(w) function');
  const on = {}; const timers = []; const went = []; const kv = new Map();
  const w = {
    navigation: { addEventListener: (t, f) => { on[t] = f; } },
    navigator: { serviceWorker: { addEventListener: (t, f) => { on[t] = f; } } },
    setTimeout: (f, ms) => { timers.push({ f, ms }); },
    location: { origin: ORIGIN, set href(u) { went.push(u); } },
    sessionStorage: { getItem: (k) => (kv.has(k) ? kv.get(k) : null), setItem: (k, v) => kv.set(k, String(v)) },
  };
  new Function('w', `${m[0]}; moveGuard(w);`)(w);
  const move = (url, extra = {}) => on.navigate({ hashChange: false, downloadRequest: null, formData: null, destination: { url, sameDocument: false }, ...extra });
  return { on, move, takeover: () => on.controllerchange(), later: () => { timers.splice(0).forEach((t) => t.f()); }, went, timers, kv };
}

test('a tap that began before a newer worker took over, on a page that is still here a moment later, is made again', async () => {
  const p = guarded();
  p.move(`${ORIGIN}/q/ABC123?k=chip`);
  await tick(3);
  p.takeover();
  assert.deepEqual(p.went, [], 'not at once: a move that was answered leaves this page by itself');
  assert.ok(p.timers[0].ms >= 300 && p.timers[0].ms <= 1500, 'a moment later');
  p.later();
  assert.deepEqual(p.went, [`${ORIGIN}/q/ABC123?k=chip`]);
  assert.equal(p.kv.get('cb-move-again'), '1', 'counted, for a rig or a fleet view to see');
  p.takeover(); p.later();
  assert.equal(p.went.length, 1, 'once: a second takeover does not send the page there again');
});

test('nothing is made again without a reason: no tap, a tap after the takeover, a door inside the page, a form, another site, an old tap', async () => {
  const none = guarded(); none.takeover(); none.later();
  assert.deepEqual(none.went, []);
  const after = guarded(); after.takeover(); await tick(3); after.move(`${ORIGIN}/q/ABC123`); after.later();
  assert.deepEqual(after.went, [], 'begun after the takeover: the newer worker has it');
  const door = guarded(); door.move(`${ORIGIN}/h/x#games`, { hashChange: true, destination: { url: `${ORIGIN}/h/x#games`, sameDocument: true } }); await tick(3); door.takeover(); door.later();
  assert.deepEqual(door.went, [], 'a door opens inside the page');
  const form = guarded(); form.move(`${ORIGIN}/submit`, { formData: {} }); await tick(3); form.takeover(); form.later();
  assert.deepEqual(form.went, [], 'a form is never sent twice');
  const away = guarded(); away.move('https://wa.me/923000000000?text=hi'); await tick(3); away.takeover(); away.later();
  assert.deepEqual(away.went, [], 'a link to another site (or to an app) is not this worker\'s to answer');
  const real = Date.now; const old = guarded(); old.move(`${ORIGIN}/q/ABC123`);
  try { Date.now = () => real() + 60000; old.takeover(); old.later(); } finally { Date.now = real; }
  assert.deepEqual(old.went, [], 'a tap from a minute ago is not what was cut off');
});

test('a browser without the navigation events (or a page with no worker) is left alone', () => {
  const m = /function moveGuard\(w\) \{[\s\S]*?\n  \}\n/.exec(boot);
  assert.ok(m, 'boot.js has a moveGuard(w) function');
  const run = new Function('w', `${m[0]}; moveGuard(w);`);
  assert.doesNotThrow(() => run({ navigator: { serviceWorker: { addEventListener() {} } } }));
  assert.doesNotThrow(() => run({ navigation: { addEventListener() {} }, navigator: {} }));
});
