// Two rules the storybook code must get exactly right with no network, run from the very files the Chromebook runs:
//   sw-stories.js judge()   a tap on an answer, judged as Jugnu's server judges it (story_answer)
//   stories.js settle()     a saved read's provisional numbers taken out of the page's count, the speech service's put in
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(file, globals) {
  const ctx = vm.createContext(globals);
  vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), ctx, { filename: file });
  return ctx;
}
const sw = load('sw-stories.js', { self: { location: { origin: 'http://cb.test' } }, URL, Response: class {}, setTimeout, clearTimeout });
const judge = sw.self.CB_STORIES._judge;
const win = { addEventListener() {}, fetch() {}, location: { hash: '' } };
const page = load('stories.js', { window: win, document: { readyState: 'complete', getElementById: () => null }, navigator: { onLine: true }, location: win.location,
  setTimeout: () => 0, setInterval: () => 0, crypto: globalThis.crypto, indexedDB: {}, Headers, Blob, URL });
const settle = page.window.__cbStories._settle;

const book = { a: { 1: 2, 2: 0 }, o: { 1: 3, 2: 2 } };   // question 1: option 2 of 3; question 2: option 0 of 2

test('a right tap is right, and the answer is not sent back', () => {
  assert.deepEqual({ ...judge(book, { n: 1, i: 2 }) }, { ok: true, right: true });
});
test('a first wrong tap is only wrong: the look-back page, never the answer', () => {
  assert.deepEqual({ ...judge(book, { n: 1, i: 0 }) }, { ok: true, right: false });
});
test('a second wrong tap, after another wrong one, shows the answer', () => {
  assert.deepEqual({ ...judge(book, { n: 1, i: 1, try: 2, first: 0 }) }, { ok: true, right: false, show: 2 });
});
test('a "second try" with no real first try shows nothing (as the server)', () => {
  assert.deepEqual({ ...judge(book, { n: 1, i: 1, try: 2 }) }, { ok: true, right: false });               // no first
  assert.deepEqual({ ...judge(book, { n: 1, i: 1, try: 2, first: 1 }) }, { ok: true, right: false });     // the same option twice
  assert.deepEqual({ ...judge(book, { n: 1, i: 1, try: 2, first: 2 }) }, { ok: true, right: false });     // the first was the answer
  assert.deepEqual({ ...judge(book, { n: 1, i: 1, try: 2, first: 7 }) }, { ok: true, right: false });     // no such option
});
test('a right second tap is right', () => {
  assert.deepEqual({ ...judge(book, { n: 1, i: 2, try: 2, first: 0 }) }, { ok: true, right: true });
});
test('a question this Chromebook has no answer for is not judged', () => {
  assert.deepEqual({ ...judge(book, { n: 9, i: 0 }) }, { ok: true });
  assert.deepEqual({ ...judge(null, { n: 1, i: 0 }) }, { ok: true });
});

test('a read saved whole (every word provisional) takes the speech service\'s count', () => {
  const d = settle({ words_total: 5, words_read: 5, skipped: 0, ms: 9000, ended: 'quiet', skipped_words: [], first: 'read' },
    { read: 5, skipped: 0, ms: 9000, idx: [] }, { read: 4, skipped: 1, ms: 1260, idx: [0], absorbed: 0, ended: 'last_word' });
  assert.deepEqual({ ...d, skipped_words: [...d.skipped_words] }, { words_total: 5, words_read: 4, skipped: 1, ms: 1260, ended: 'last_word', skipped_words: [0], first: 'read' });
});
test('a read scored on the Chromebook (its skips, no time) is replaced, not added to', () => {
  const d = settle({ words_total: 18, words_read: 17, skipped: 1, ms: 0, ended: 'quiet', skipped_words: [3] },
    { read: 17, skipped: 1, ms: 0, idx: [3] }, { read: 18, skipped: 0, ms: 7440, idx: [], absorbed: 2, ended: 'last_word' });
  assert.deepEqual({ ...d, skipped_words: [...d.skipped_words] }, { words_total: 18, words_read: 18, skipped: 0, ms: 7440, ended: 'last_word', skipped_words: [], absorbed: 2 });
});
test('a long page: the part read live keeps its numbers, only the saved part changes', () => {
  // part 1 live: 22 read, word 4 skipped, 9 s; part 2 saved: 19 provisional words, 12 s
  const d = settle({ words_total: 41, words_read: 41, skipped: 1, ms: 21000, ended: 'quiet', skipped_words: [4] },
    { read: 19, skipped: 0, ms: 12000, idx: [] }, { read: 16, skipped: 2, ms: 8000, idx: [30, 37], absorbed: 0, ended: 'quiet' });
  assert.deepEqual({ ...d, skipped_words: [...d.skipped_words] }, { words_total: 41, words_read: 38, skipped: 3, ms: 17000, ended: 'quiet', skipped_words: [4, 30, 37] });
});
