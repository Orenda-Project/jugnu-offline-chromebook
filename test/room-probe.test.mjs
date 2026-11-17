// "How much will Chrome let this site keep?" is asked by doing: the start page's small worker (cb.html: ROOM_WORKER)
// grows a file in the site's private files (OPFS) and sees whether Chrome allows it.
// Found 18 Nov 2026 on rig/persist-check.mjs: a start page that was opened and closed again quickly showed
// "8.6 GB saved here" on a Chromebook with nothing saved. The page had closed while the probe's file was grown, the
// worker was ended, and the file stayed: room charged to the site that nothing holds, until a later probe happened
// to finish. On a small drive that could be the site's whole allowance, and then nothing more can be saved (a quiz's
// waiting answers included). So:
//   - the file is big only for the length of one call: asked, answered, cut back to nothing
//   - every Jugnu page takes a leftover probe file off the drive (boot.js: probeSweep)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../cb.html', import.meta.url), 'utf8');
const boot = fs.readFileSync(new URL('../boot.js', import.meta.url), 'utf8');

/** The probe's worker, run here against a made-up private file store that allows `allowed` bytes. */
function probe(allowed) {
  const m = /var ROOM_WORKER = ([\s\S]*?);\n  var probing/.exec(html);
  assert.ok(m, 'cb.html has the probe worker');
  const src = new Function(`return ${m[1]};`)();
  const file = { size: 0, calls: [], open: false, there: false };
  const handle = { truncate(n) { file.calls.push(n); if (n > allowed) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } file.size = n; }, close() { file.open = false; } };
  const root = {
    getFileHandle: async (name, o) => { assert.equal(name, 'cb-room-probe'); if (o && o.create) file.there = true; return { createSyncAccessHandle: async () => { file.open = true; return handle; } }; },
    removeEntry: async (name) => { assert.equal(name, 'cb-room-probe'); file.there = false; file.size = 0; },
  };
  let answer; const got = new Promise((ok) => { answer = ok; });
  const ctx = vm.createContext({ navigator: { storage: { getDirectory: async () => root } }, postMessage: (v) => answer(v), Math });
  vm.runInContext(src, ctx);
  return { ask: (data) => { ctx.onmessage({ data }); return got; }, file };
}
const MB = 1e6;

test('the probe\'s file is big only for the length of one call: after every step it is empty again', async () => {
  const p = probe(400 * MB);
  await p.ask({});
  const calls = p.file.calls;
  assert.ok(calls.some((n) => n > 0), 'it did grow the file to ask');
  // whatever a call asked for, the next thing done to the file is to cut it back to nothing
  calls.forEach((n, i) => { if (n > 0) assert.equal(calls[i + 1], 0, `after asking for ${n} bytes (step ${i}) the file is cut back before anything else`); });
});

test('it still finds how much is allowed (to the nearest 16 MB below), and leaves no file', async () => {
  for (const allowed of [400 * MB, 3.2e9, 60e9]) {
    const p = probe(allowed);
    const out = await p.ask({});
    assert.ok(out <= allowed && out > allowed - 17 * 1024 * 1024, `${allowed} allowed, found ${out}`);
    assert.equal(p.file.there, false, 'the probe file is removed');
    assert.equal(p.file.size, 0);
  }
});

test('"will this much fit?" is answered yes or no, and the file is gone either way', async () => {
  const yes = probe(400 * MB); assert.equal(await yes.ask({ fits: 300 * MB }), true); assert.equal(yes.file.there, false); assert.equal(yes.file.size, 0);
  const no = probe(400 * MB); assert.equal(await no.ask({ fits: 500 * MB }), false); assert.equal(no.file.there, false); assert.equal(no.file.size, 0);
});

test('every Jugnu page takes a leftover probe file off the drive, and is not troubled when it cannot', async () => {
  const m = /function probeSweep\(storage\) \{[\s\S]*?\n  \}\n/.exec(boot);
  assert.ok(m, 'boot.js has a probeSweep(storage) function');
  const probeSweep = new Function(`${m[0]}; return probeSweep;`)();
  const removed = [];
  await probeSweep({ getDirectory: async () => ({ removeEntry: async (n) => { removed.push(n); } }) });
  assert.deepEqual(removed, ['cb-room-probe']);
  // a probe at work holds the file (the browser refuses to remove it), there is no such file, or no private store at all
  await probeSweep({ getDirectory: async () => ({ removeEntry: async () => { const e = new Error('in use'); e.name = 'NoModificationAllowedError'; throw e; } }) });
  await probeSweep({ getDirectory: async () => ({ removeEntry: async () => { const e = new Error('none'); e.name = 'NotFoundError'; throw e; } }) });
  await probeSweep({ getDirectory: async () => { throw new Error('no store'); } });
  await probeSweep({});
  await probeSweep(undefined);
});

test('what the page says is saved is never read while a probe has its file grown (it read "1.1 GB saved" on an empty Chromebook)', async () => {
  const grab = (rx, what) => { const m = rx.exec(html); assert.ok(m, `cb.html has ${what}`); return m[0]; };
  const src = [
    grab(/var probing = [^\n]*\n/, 'a record of the probe at work (var probing)'),
    grab(/function roomProbe\(msg\) \{[\s\S]*?\n  \}\n/, 'roomProbe(msg)'),
    grab(/function space\(\) \{[\s\S]*?\n  \}\n/, 'space()'),
  ].join('\n');
  // a private file store whose probe file is 1 GiB while the probe is at work, and gone when it has answered
  let grown = false; let answer = null;
  class FakeWorker { constructor() { grown = true; } postMessage() { answer = () => { grown = false; this.onmessage({ data: 123 }); }; } terminate() {} }
  const navigator = { storage: { estimate: async () => ({ usage: grown ? 1073741824 : 5e6, quota: 10 * 2 ** 30 }), persisted: async () => false } };
  const { roomProbe, space } = new Function('navigator', 'Worker', 'URL', 'Blob', 'setTimeout', 'clearTimeout', `var allowance = null, ROOM_WORKER = ''; ${src}; return { roomProbe: roomProbe, space: space };`)(navigator, FakeWorker, { createObjectURL: () => 'blob:x' }, class {}, setTimeout, clearTimeout);
  const asked = roomProbe({});
  let said = null;
  space().then((s) => { said = s; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(said, null, 'the probe is at work: the reading waits');
  answer();
  assert.equal(await asked, 123);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(said, 'the probe has answered: the reading is taken');
  assert.equal(said.used, 5e6, 'what is really saved, not the probe\'s file');
});
