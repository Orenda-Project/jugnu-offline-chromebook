// What the start page (/cb) says at the top: what is on the drive, from the worker's audit and the lesson videos' own
// record, never from the Get-ready run it remembers (which it forgets after 12 hours). Before 23 Nov 2026 a Chromebook
// with everything saved two days earlier (5 GB, all 518 lessons) showed a bare "Get ready for offline" button.
// cb.html's own driveState(d), run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../cb.html', import.meta.url), 'utf8');
const m = /function driveState\(d\) \{[\s\S]*?\n  \}\n/.exec(html);
const driveState = m ? new Function(`${m[0]}; return driveState;`)() : null;

test('cb.html has driveState(d)', () => { assert.ok(m, 'the function was not found in cb.html'); });

// the step names Get ready gives its lists (BUILT_IN ids, and x-<name> for ready/<area>.js)
const STEPS = ['app', 'doors', 'storybooks', 'quizzes', 'games', 'x-storybooks-every-grade-english-and-urdu', 'x-the-learning-games', 'x-speech', 'x-lesson-videos'];
const audit = (missing = {}) => ({ at: Date.now(), steps: STEPS.map((step) => ({ step, total: step === 'x-lesson-videos' ? 1067 : 1200, missing: missing[step] || 0 })) });
// the five classes as the rig measured them (README, 18 Nov 2026)
const FIVE = { 1: [112, 806], 2: [82, 604], 3: [94, 830], 4: [121, 1278], 5: [109, 1100] };
const saved = (except = {}) => Object.fromEntries(Object.entries(FIVE).map(([g, [n, mb]]) => [g, except[g] || { n, saved: n, mb }]));
const sizes = Object.fromEntries(Object.entries(FIVE).map(([g, [n, mb]]) => [g, { n, mb, measured: true }]));
const want = ['1', '2', '3', '4', '5'];

test('everything on the drive: Ready, each area saved, the videos named with their lessons and size', { skip: !m }, () => {
  const s = driveState({ audit: audit(), videos: saved(), sizes, want });
  assert.equal(s.state, 'ready');
  assert.equal(s.title, 'Ready to use without Wi-Fi');
  assert.deepEqual(s.areas.map((a) => a.status), ['ok', 'ok', 'ok', 'ok']);
  const v = s.areas[3];
  assert.equal(v.what, 'Classes 1 to 5, 518 lessons');
  assert.equal(v.size, '4.6 GB');
  assert.match(s.areas[1].size, /^2,400 files$/, 'both storybook steps count toward Storybooks');
});

test('nothing saved yet: says so, and lists what Get ready will save', { skip: !m }, () => {
  const s = driveState({ audit: null, videos: {}, sizes, want });
  assert.equal(s.state, 'fresh');
  assert.match(s.sub, /press Get ready once/);
  assert.equal(s.areas.length, 4);
  assert.equal(s.areas[3].status, 'none');
  assert.equal(s.areas[3].size, 'about 4.6 GB', 'a measured size is shown before anything is saved');
});

test('the first look at the drive, with no earlier answer: says it is looking, not that nothing is saved', { skip: !m }, () => {
  const s = driveState({ audit: null, videos: {}, want, checking: true });
  assert.equal(s.state, 'checking');
  assert.deepEqual(s.areas, []);
});

test('a class that did not fit: Ready except the videos, naming the class, what it needs and what Chrome allows', { skip: !m }, () => {
  const s = driveState({ audit: audit(), videos: saved({ 4: { n: 121, saved: 0, mb: 0, why: 'no room' } }), sizes, want, room: 1.1e9 });
  assert.equal(s.state, 'partial');
  assert.equal(s.title, 'Ready, except some lesson videos');
  const v = s.areas[3];
  assert.equal(v.status, 'room');
  assert.equal(v.label, 'No room');
  assert.match(v.note, /Classes 1, 2, 3 and 5 saved/);
  assert.match(v.note, /Class 4 needs 1\.3 GB, Chrome allows only 1\.1 GB more here/);
  assert.match(s.sub, /untick a class/);
});

test('a class half-saved (the Chromebook was closed in the middle): lessons saved of lessons wanted', { skip: !m }, () => {
  const s = driveState({ audit: audit(), videos: saved({ 3: { n: 94, saved: 41, mb: 362 } }), sizes, want });
  assert.equal(s.state, 'partial');
  assert.equal(s.areas[3].status, 'missing');
  assert.match(s.areas[3].note, /Class 3: 41 of 94 lessons/);
});

test('files missing from the drive in a core area: Not ready yet, naming it', { skip: !m }, () => {
  const s = driveState({ audit: audit({ 'x-storybooks-every-grade-english-and-urdu': 3 }), videos: saved(), sizes, want });
  assert.equal(s.state, 'partial');
  assert.equal(s.title, 'Not ready yet');
  assert.equal(s.areas[1].status, 'missing');
  assert.match(s.areas[1].note, /^3 of 2400 files/);
  assert.match(s.sub, /^Storybooks did not finish/);
});

test('no lesson videos chosen for this Chromebook: still Ready', { skip: !m }, () => {
  const s = driveState({ audit: audit(), videos: {}, sizes, want: [] });
  assert.equal(s.state, 'ready');
  assert.equal(s.areas[3].status, 'off');
});

test('while Get ready runs: each area from its steps, and once the core is saved the children can play', { skip: !m }, () => {
  const ids = STEPS;
  const done = Object.fromEntries(ids.filter((id) => id !== 'x-lesson-videos').map((id) => [id, { at: 1 }]));
  const s = driveState({ audit: audit(), videos: {}, want, running: { ids, done, cur: 'x-lesson-videos', curNote: 'Class 3 (3 of 5): 41 of 94 lessons' } });
  assert.equal(s.state, 'running');
  assert.deepEqual(s.areas.map((a) => a.status), ['ok', 'ok', 'ok', 'run']);
  assert.equal(s.areas[3].note, 'Class 3 (3 of 5): 41 of 94 lessons');
  assert.match(s.sub, /Children can already play/);
  const early = driveState({ audit: null, videos: {}, want, running: { ids, done: {}, cur: 'app', curNote: '' } });
  assert.equal(early.areas[0].status, 'run');
  assert.match(early.sub, /Keep the Wi-Fi on/);
  // the home is saved and its quizzes come after the storybooks: partly saved, not "waiting" and not "saving"
  const mid = driveState({ audit: null, videos: {}, want, running: { ids, done: { app: 1, doors: 1 }, cur: 'storybooks', curNote: '' } });
  assert.deepEqual(mid.areas.map((a) => a.status), ['part', 'run', 'wait', 'wait']);
  assert.equal(mid.areas[0].label, 'Partly saved');
});

test('a Get ready that stopped part-way is never "Ready", though every list on the drive is whole', { skip: !m }, () => {
  // seen on the rig, 23 Nov: the every-grade storybooks were still being read and the speech step had not begun (no
  // list on the drive at all), yet each list there had nothing missing
  const lists = audit(); lists.steps = lists.steps.filter((s) => !['x-speech', 'x-lesson-videos'].includes(s.step));
  const s = driveState({ audit: lists, videos: {}, sizes, want: [], unfinished: ['x-storybooks-every-grade-english-and-urdu', 'x-speech'] });
  assert.notEqual(s.state, 'ready');
  assert.equal(s.title, 'Not ready yet');
  assert.equal(s.areas[1].status, 'missing');
  assert.equal(s.areas[2].status, 'missing');
  assert.match(s.sub, /Storybooks, Games did not finish/);
  const early = driveState({ audit: audit(), videos: saved(), sizes, want, unfinished: ['?'] });
  assert.equal(early.state, 'partial', 'stopped before its steps were known');
  const done = driveState({ audit: audit(), videos: saved(), sizes, want, unfinished: [] });
  assert.equal(done.state, 'ready');
});

test('a class ticked on a ready Chromebook: Ready, its videos not saved yet, and the button says what it will do', { skip: !m }, () => {
  const s = driveState({ audit: audit(), videos: {}, sizes, want: ['2'] });
  assert.equal(s.state, 'partial');
  assert.equal(s.title, 'Ready, lesson videos not saved yet');
  assert.equal(s.action, 'Save lesson videos');
  assert.equal(s.areas[3].note, 'not saved on this Chromebook yet');
});

test('a check for new things cut short on a ready Chromebook: still Ready, the stop is said, the button finishes it', { skip: !m }, () => {
  // seen 23 Nov 2026: such a check stopped part-way marked Storybooks and Games "Not finished", every file on the drive
  const s = driveState({ audit: audit(), videos: {}, sizes, want: [], unfinished: [], refreshOpen: true });
  assert.equal(s.state, 'ready');
  assert.deepEqual(s.areas.map((a) => a.status), ['ok', 'ok', 'ok', 'off']);
  assert.match(s.sub, /last check for new things stopped part-way/);
  assert.equal(s.action, 'Carry on checking');
});
