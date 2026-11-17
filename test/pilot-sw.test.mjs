// The offline worker's rules, run in node (node --test test/). Each test drives pilot-sw.js itself through
// test/sw-harness.mjs; PILOT_SW=<file> runs them against another copy of the worker (to show a test fails on the old one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, handTimers, json, tick } from './sw-harness.mjs';

const source = process.env.PILOT_SW || undefined;

test('a slow first answer is the network answer, not "offline" (nothing kept)', async () => {
  const timers = handTimers();
  let answer;
  const sw = load({ source, timers, fetch: () => new Promise((ok) => { answer = ok; }) });
  const got = sw.get('/sa/batteries/sa.game.G1.en.json');
  await tick();
  timers.fire(4000); // the worker's 4 s limit passes with no copy kept
  await tick();
  answer(json({ battery_id: 'sa.game.G1.en' })); // the server answers after 4 s
  const res = await got;
  assert.equal(res.status, 200);
  assert.equal((await res.json()).battery_id, 'sa.game.G1.en');
});

test('a slow answer with a kept copy still gives the kept copy at the limit', async () => {
  const timers = handTimers();
  const sw = load({ source, timers, fetch: () => new Promise(() => {}) });
  await sw.kept('/sa/batteries/sa.game.G1.en.json', json({ kept: true }));
  const got = sw.get('/sa/batteries/sa.game.G1.en.json');
  await tick();
  timers.fire(4000);
  assert.deepEqual(await (await got).json(), { kept: true });
});
