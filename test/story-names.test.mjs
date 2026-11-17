// Get ready's built-in storybook step finds a book's files by name in the book's list. The pattern it uses is
// taken from cb.html itself (the very line that runs on the Chromebook) and run on the names Jugnu really uses
// (NIETE-Rumi bot/shared/services/quiz/story-load.js): pages pNN, page voices aNN, cover, question voice qN,
// option voices qNoM, the question sprite qs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../cb.html', import.meta.url), 'utf8');
const m = /var fr = (\/.+\/g), x, own = \[\];/.exec(html);

test('the storybook file pattern is in cb.html', () => { assert.ok(m, 'the pattern line was not found in cb.html'); });

test('every kind of storybook file is taken by its whole name', () => {
  const fr = new Function(`return ${m[1]};`)();
  const book = JSON.stringify({
    cover: 'cover-f406f323.webp', pages: [{ img: 'p01-b2b3c6ec.webp', voice: 'a01-0a1b2c3d.ogg' }],
    questions: [{ n: 1, audio: 'q1-aabbccdd.ogg', options: ['q1o1-e1db9a66.ogg', 'q1o2-162df534.ogg'] }],
    sprite: 'qs-11223344.ogg', also: '/s/87638e27-4ff5-5deb-a88d-a4d78c8331e0/q2o3-3f8ed841.ogg',
  });
  const found = []; let x;
  while ((x = fr.exec(book))) found.push(x[1]);
  assert.deepEqual(found, ['cover-f406f323.webp', 'p01-b2b3c6ec.webp', 'a01-0a1b2c3d.ogg', 'q1-aabbccdd.ogg', 'q1o1-e1db9a66.ogg', 'q1o2-162df534.ogg', 'qs-11223344.ogg', 'q2o3-3f8ed841.ogg']);
});
