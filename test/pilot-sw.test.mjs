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

// ---- games lane: Jugnu's big flight with no network ----
const CLIP = '/sa/v4/en/59c239b8cb70.mp3';
const audio = () => new Response('mp3', { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '3' } });

test("prepare: the engine's clips already kept are 'cached'; one not kept is fetched and kept", async () => {
  const sw = load({ source, fetch: (req) => (req.url.endsWith('/sa/v4/en/new.mp3') ? audio() : new Response('no', { status: 404 })) });
  await sw.kept(CLIP, audio());
  const out = await sw.message({ type: 'prepare', urls: [CLIP, '/sa/v4/en/new.mp3'] });
  assert.deepEqual({ ok: out.ok, cached: out.cached, missing: out.missing }, { ok: true, cached: 2, missing: [] });
  assert.equal(await sw.isKept('/sa/v4/en/new.mp3'), true);
});

test('prepare with no network: what is kept counts, what is not is named missing', async () => {
  const sw = load({ source });
  await sw.kept(CLIP, audio());
  sw.net.down = true;
  const out = await sw.message({ type: 'prepare', urls: [CLIP, '/sa/v4/en/gone.mp3'] });
  assert.equal(out.ok, false);
  assert.equal(out.cached, 1);
  assert.deepEqual(out.missing.map((u) => new URL(u).pathname), ['/sa/v4/en/gone.mp3']);
});

test('check looks on the device only', async () => {
  const sw = load({ source, fetch: () => audio() });
  await sw.kept(CLIP, audio());
  const out = await sw.message({ type: 'check', urls: [CLIP, '/sa/v4/en/other.mp3'] });
  assert.deepEqual({ ok: out.ok, cached: out.cached }, { ok: false, cached: 1 });
  assert.equal(sw.net.calls.length, 0);
});

test('HEAD of the sea map with no network: 200 when the page is kept, 503 when it is not', async () => {
  const sw = load({ source });
  await sw.kept('/sa-game/tok.sig?kid=abc&lang=en', new Response('<html>map</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  sw.net.down = true;
  const kept = sw.head('/sa-game/tok.sig?kid=abc&lang=en&done=maths&s=1234567');
  assert.ok(kept, 'the worker answers a HEAD');
  assert.equal((await kept).status, 200);
  assert.equal((await sw.head('/sa-game/other.sig?kid=abc')).status, 503);
});

const START = { t: 'tok.sig', kid: 'a1b2c3d4e5f60718', part: 'maths', form: 'game.G1', lang: 'en', n: 1 };

test('a part started with no network gets a run on this device', async () => {
  const sw = load({ source });
  sw.net.down = true;
  const res = await sw.post('/api/sa-game/s/session', START, { 'x-wq-device': 'dev-1' });
  assert.equal(res.status, 200);
  const run = await res.json();
  assert.match(run.session_id, /^[0-9a-f-]{36}$/);
  assert.equal(run.st, 'cblocal.' + run.session_id);
});

test("back online, a device run's answers open the real run and go to it", async () => {
  const sent = [];
  const sw = load({ source, fetch: (req, body) => {
    const p = new URL(req.url).pathname;
    sent.push({ p, body: JSON.parse(body || '{}'), device: req.headers.get('x-wq-device') });
    if (p.endsWith('/session')) return json({ session_id: 'real-run-1', st: 'real.st.1' });
    if (p.endsWith('/batch')) return json({ ok: true, ackedTo: 7, acked_to: 7 });
    return json({}, 404);
  } });
  sw.net.down = true;
  const run = await (await sw.post('/api/sa-game/s/session', START, { 'x-wq-device': 'dev-1' })).json();
  const off = await sw.post('/api/sa-game/s/batch', { st: run.st, sessionId: run.session_id, seqFrom: 1, seqTo: 7, events: [{ seq: 1 }], results: [] });
  assert.equal(off.status, 503, 'still no network: the engine keeps the answers');
  sw.net.down = false;
  const on = await sw.post('/api/sa-game/s/batch', { st: run.st, sessionId: run.session_id, seqFrom: 1, seqTo: 7, events: [{ seq: 1 }], results: [] });
  assert.equal(on.status, 200);
  assert.equal((await on.json()).ackedTo, 7);
  const open = sent.find((x) => x.p.endsWith('/session'));
  assert.deepEqual(open.body, START);
  assert.equal(open.device, 'dev-1');
  const batch = sent.find((x) => x.p.endsWith('/batch'));
  assert.deepEqual({ st: batch.body.st, sessionId: batch.body.sessionId, seqTo: batch.body.seqTo }, { st: 'real.st.1', sessionId: 'real-run-1', seqTo: 7 });
  // a recording's presign goes to the same real run, opened once
  await sw.post('/api/sa-game/s/audio/presign', { st: run.st, taskId: 'en.story', mime: 'audio/webm', bytes: 10 });
  assert.equal(sent.filter((x) => x.p.endsWith('/session')).length, 1);
  assert.equal(sent.find((x) => x.p.endsWith('/audio/presign')).body.st, 'real.st.1');
});

test('a run started online whose 12-hour token has lapsed is opened again, and the answers go to the new one', async () => {
  let opens = 0;
  const sent = [];
  const sw = load({ source, fetch: (req, body) => {
    const p = new URL(req.url).pathname;
    const b = JSON.parse(body || '{}');
    if (p.endsWith('/session')) { opens += 1; return json({ session_id: 'run-' + opens, st: 'st-' + opens }); }
    sent.push(b);
    return b.st === 'st-1' ? json({ error: 'bad_token' }, 401) : json({ ok: true, ackedTo: 3 });
  } });
  const run = await (await sw.post('/api/sa-game/s/session', START, { 'x-wq-device': 'dev-1' })).json();
  assert.equal(run.st, 'st-1');
  const res = await sw.post('/api/sa-game/s/batch', { st: 'st-1', sessionId: 'run-1', seqFrom: 1, seqTo: 3, events: [], results: [] });
  assert.equal(res.status, 200);
  assert.deepEqual(sent.map((b) => [b.st, b.sessionId]), [['st-1', 'run-1'], ['st-2', 'run-2']]);
});

test("the server's own refusals of a start stay the server's (flown this month, try later)", async () => {
  for (const [status, error] of [[409, 'flight_done'], [503, 'exposure_unknown']]) {
    const sw = load({ source, fetch: () => json({ error }, status) });
    const res = await sw.post('/api/sa-game/s/session', { ...START, part: 'tower' });
    assert.equal(res.status, status);
    assert.equal((await res.json()).error, error);
  }
});

test('back on the sea map with no network: the kept map of the SAME language, whatever else the address carries', async () => {
  const page = (l) => new Response(`<html lang="${l}">map</html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  const sw = load({ source, fetch: (req) => page(new URL(req.url).searchParams.get('lang')) });
  // Get ready opens the map in both languages, English first
  await (await sw.get('/sa-game/tok.sig?kid=abc&lang=en')).text();
  await (await sw.get('/sa-game/tok.sig?kid=abc&lang=ur')).text();
  await tick(20);
  sw.net.down = true;
  const back = await sw.get('/sa-game/tok.sig?kid=abc&lang=ur&done=urdu&s=0f1e2d3c-aaaa-4bbb-8ccc-123456789abc');
  assert.equal(back.status, 200);
  assert.match(await back.text(), /lang="ur"/);
});

// ---- games lane: Jugnu's Challenge (the number games) with no network ----
const EX = '/api/wq/ch/tok.sig/numbers?lang=en&kid=a1b2c3d4e5f60718';
const serve = (ct, tiles = [3, 7, 1]) => json({ ex: 'numbers', ct, items: tiles.map((n) => ({ n, tiles: [n, n + 1, n + 2] })) });
const TAPS = { ct: 'ct-kept', taps: [{ i: 0, pick: 3, ms: 900 }, { i: 1, pick: 7, ms: 800 }, { i: 2, pick: 2, ms: 700 }], ms: 4000, helped: 'self' };

test('a number game finished with no network: the page gets its end, the taps wait on the device', async () => {
  const sw = load({ source });
  await sw.kept(EX, serve('ct-kept'));
  sw.net.down = true;
  const res = await sw.post('/api/wq/ch/result', TAPS);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.score, { correct: 2, n: 3, stopped: false });
  const waiting = await sw.message({ type: 'games-outbox' });
  assert.deepEqual(waiting.map((w) => [w.ex, w.state]), [['numbers', 'waiting']]);
});

test('back online after the token lapsed: the waiting taps go to a fresh serve of the SAME questions, with its token', async () => {
  const sent = [];
  const sw = load({ source, fetch: (req, body) => {
    const u = new URL(req.url);
    if (req.method === 'GET' && u.pathname.startsWith('/api/wq/ch/')) return serve('ct-fresh');
    if (u.pathname === '/api/wq/ch/result') {
      if (JSON.parse(body).ct === 'ct-kept') return json({ error: 'bad_token' }, 401); // two hours have passed
      sent.push(JSON.parse(body)); return json({ score: { correct: 2, n: 3, stopped: false } });
    }
    return json({}, 404);
  } });
  await sw.kept(EX, serve('ct-kept'));
  sw.net.down = true;
  await sw.post('/api/wq/ch/result', TAPS);
  sw.net.down = false;
  await sw.message({ type: 'report' });
  await tick(30);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ct, 'ct-fresh');
  assert.deepEqual(sent[0].taps, TAPS.taps);
  assert.equal(sent[0].helped, 'self');
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
});

test('a fresh serve with other questions: the taps are NOT sent (they were answers to the kept ones)', async () => {
  const sent = [];
  const sw = load({ source, fetch: (req, body) => {
    if (req.method === 'GET') return serve('ct-fresh', [9, 4, 10]);
    if (JSON.parse(body).ct === 'ct-kept') return json({ error: 'bad_token' }, 401); // two hours have passed
    sent.push(body); return json({});
  } });
  await sw.kept(EX, serve('ct-kept'));
  sw.net.down = true;
  await sw.post('/api/wq/ch/result', TAPS);
  sw.net.down = false;
  await sw.message({ type: 'report' });
  await tick(30);
  assert.equal(sent.length, 0);
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => w.state), ['questions_changed']);
});

test('online, a result goes to the server as it is', async () => {
  const sw = load({ source, fetch: () => json({ score: { correct: 3, n: 3, stopped: false } }) });
  const res = await sw.post('/api/wq/ch/result', TAPS);
  assert.equal((await res.json()).score.correct, 3);
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
});

// ---- games lane: Read aloud on the Challenge page with no network (record now, send and score later) ----
const READ = '/api/wq/ch/tok.sig/read?lang=en&kid=a1b2c3d4e5f60718';
const readServe = (ct, text = 'Imran woke up early for school.') => json({ ex: 'read', ct, secs: 60, story: { text, tokens: text.split(' ') } });

async function readOffline(sw) {
  await sw.kept(READ, readServe('ct-kept'));
  sw.net.down = true;
  const up = await (await sw.post('/api/wq/ch/upload', { ct: 'ct-kept', type: 'audio/webm', size: 5, audio_consent: 'notice_shown' })).json();
  const put = await sw.put(new URL(up.put_url).pathname, 'VOICE', { 'content-type': up.content_type });
  const res = await sw.post('/api/wq/ch/result', { ct: 'ct-kept', key: up.key, ms: 21000, ended: 'done' });
  return { up, put, res };
}

test('a reading finished with no network is kept on the device and the page is told the result will come', async () => {
  const sw = load({ source });
  const { up, put, res } = await readOffline(sw);
  assert.match(up.put_url, /\/__cb\/ch-audio\/[0-9a-f-]{36}$/);
  assert.equal(put.status, 200);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).later, true);
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => [w.ex, w.state]), [['read', 'waiting']]);
});

test('a server that takes no late result: the kept reading goes up for the SAME story on a fresh serve: upload, then the result with the new token', async () => {
  const seen = [];
  const sw = load({ source, fetch: async (req, body) => {
    const u = new URL(req.url);
    if (req.method === 'GET') return readServe('ct-fresh');
    if (u.pathname === '/api/wq/ch/upload' && JSON.parse(body).ct === 'ct-kept') return json({ error: 'bad_token' }, 401);   // two hours have passed
    if (u.pathname === '/api/wq/ch/upload') { seen.push(['upload', JSON.parse(body)]); return json({ put_url: 'https://r2.test/put/abc', content_type: 'audio/webm', key: 'child-voice/sandbox/abc.webm' }); }
    if (u.host === 'r2.test') { seen.push(['put', body, req.headers.get('content-type')]); return new Response('', { status: 200 }); }
    if (u.pathname === '/api/wq/ch/result') { seen.push(['result', JSON.parse(body)]); return json({ pending: true }); }
    return json({}, 404);
  } });
  await readOffline(sw);
  sw.net.down = false;
  await sw.message({ type: 'report' });
  await tick(40);
  assert.deepEqual(seen.map((x) => x[0]), ['upload', 'put', 'result']);
  assert.deepEqual(seen[0][1], { ct: 'ct-fresh', type: 'audio/webm', size: 5, audio_consent: 'notice_shown' });
  assert.deepEqual([seen[1][1], seen[1][2]], ['VOICE', 'audio/webm']);
  assert.deepEqual(seen[2][1], { ct: 'ct-fresh', key: 'child-voice/sandbox/abc.webm', ms: 21000, ended: 'done' });
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
});

test('another story on the fresh serve: the reading is not sent as a reading of it', async () => {
  const seen = [];
  const sw = load({ source, fetch: (req, body) => {
    const p = new URL(req.url).pathname;
    if (req.method === 'GET') return readServe('ct-fresh', 'Another story altogether.');
    const b = JSON.parse(body || '{}');
    seen.push(p.split('/').pop() + ' ' + b.ct);
    return b.ct === 'ct-kept' ? json({ error: 'bad_token' }, 401) : json({});   // no late result taken; two hours have passed
  } });
  await readOffline(sw);
  sw.net.down = false;
  await sw.message({ type: 'report' });
  await tick(40);
  assert.deepEqual(seen.filter((x) => /upload|result/.test(x)), ['upload ct-kept'], 'offered to its own run only, never to the other story');
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => w.state), ['questions_changed']);
});

test('back online within the token\'s life: the taps go to the run they were played in (no new serve is asked for)', async () => {
  const calls = [];
  const sw = load({ source, fetch: (req, body) => {
    const u = new URL(req.url);
    calls.push(req.method + ' ' + u.pathname);
    if (u.pathname === '/api/wq/ch/result') return JSON.parse(body).ct === 'ct-kept' ? json({ score: { correct: 2, n: 3, stopped: false } }) : json({ error: 'bad_token' }, 401);
    return serve('ct-fresh');
  } });
  await sw.kept(EX, serve('ct-kept'));
  sw.net.down = true;
  await sw.post('/api/wq/ch/result', TAPS);
  sw.net.down = false;
  sw.net.calls.length = 0; calls.length = 0;
  await sw.message({ type: 'report' });
  await tick(30);
  assert.equal(calls[0], 'POST /api/wq/ch/result');
  assert.equal(calls.filter((c) => c === 'POST /api/wq/ch/result').length, 1);
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
});

test("the child's battery page with no network is the one kept copy (the newest), not an older one kept under another session's address", async () => {
  const html = (v) => new Response(`<html>${v}</html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  let version = 'old';
  const sw = load({ source, fetch: () => html(version) });
  await sw.kept('/sa/play.html?s=an-old-session&form=sa.game.G1.en', html('old')); // kept by an earlier build of the pilot
  version = 'new';
  await (await sw.get('/sa/play.html?s=todays-session&form=sa.game.G1.en')).text(); // opened online today
  await tick(20);
  sw.net.down = true;
  const res = await sw.get('/sa/play.html?s=tomorrows-session&form=sa.game.G1.en&block=maths');
  assert.equal(await res.text(), '<html>new</html>');
});

// ---- games lane: a recording's upload. The storage bucket takes a PUT only from Jugnu's own site (CORS), and the
// pilot is another site, so the browser refuses it; the worker sends it through the pilot's own server instead. ----
const R2 = 'https://bucket.abc123.r2.cloudflarestorage.com/child-voice/sandbox/kept/run/read-1.webm?X-Amz-Signature=sig';

test("a page's upload of a recording to the storage bucket goes through the pilot's server, not straight to the bucket", async () => {
  const seen = [];
  const sw = load({ source, fetch: (req, body) => { seen.push({ url: req.url, method: req.method, type: req.headers.get('content-type'), body }); return new Response('', { status: 200 }); } });
  const res = sw.put(R2, 'VOICE', { 'content-type': 'audio/webm' });
  assert.ok(res, 'the worker takes the upload');
  assert.equal((await res).status, 200);
  assert.equal(seen.length, 1);
  const u = new URL(seen[0].url);
  assert.equal(u.origin + u.pathname, 'http://pilot.test/__cb/r2put');
  assert.equal(u.searchParams.get('u'), R2);
  assert.deepEqual([seen[0].method, seen[0].type, seen[0].body], ['PUT', 'audio/webm', 'VOICE']);
});

// ---- games lane meets the home lane: the home link is renewed every day; what was saved under last week's link must still open ----
const homeLink = (exp) => Buffer.from(JSON.stringify({ k: 'h', ids: ['11111111-2222-4333-8444-555555555555'], l: 'ur', exp })).toString('base64url') + '.' + 'A'.repeat(22);

test('after the home link is renewed, the sea map saved under the old link opens with no network, in the same language', async () => {
  const now = Math.floor(Date.now() / 1000);
  const oldLink = homeLink(now + 3 * 86400), newLink = homeLink(now + 7 * 86400);
  const page = (l) => new Response(`<html lang="${l}"><body><main id="sg">map</main><script id="boot" type="application/json">{}</script></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  const sw = load({ source, fetch: (req) => page(new URL(req.url).searchParams.get('lang')) });
  await (await sw.get(`/sa-game/${oldLink}?kid=abc&lang=en`)).text(); // Get ready, last week
  await (await sw.get(`/sa-game/${oldLink}?kid=abc&lang=ur`)).text();
  await tick(30);
  sw.net.down = true;
  const back = await sw.get(`/sa-game/${newLink}?kid=abc&lang=ur&done=urdu&s=0f1e2d3c-aaaa-4bbb-8ccc-123456789abc`);
  assert.equal(back.status, 200);
  assert.match(await back.text(), /lang="ur"/);
});

test("a part started with no network under last week's link: the kept start is filed and found whatever the link", async () => {
  const now = Math.floor(Date.now() / 1000);
  const link = homeLink(now + 86400);
  const sw = load({ source });
  sw.net.down = true;
  const run = await (await sw.post('/api/sa-game/s/session', { ...START, t: link }, { 'x-wq-device': 'dev-1' })).json();
  assert.equal(run.st, 'cblocal.' + run.session_id);
  const sent = [];
  sw.net.down = false;
  sw.net.calls.length = 0;
  // (no signing key in this test: the link is sent as it is; with one, the home block swaps in the live link)
  const res = await sw.post('/api/sa-game/s/batch', { st: run.st, sessionId: run.session_id, seqFrom: 1, seqTo: 2, events: [], results: [] });
  assert.ok(res.status === 404 || res.status === 200 || res.status === 503);
  const open = sw.net.calls.find((c) => c.url.endsWith('/api/sa-game/s/session'));
  assert.ok(open, 'the real run is asked for');
  assert.equal(JSON.parse(open.body).t, link);
});

test('a run the server refuses to open (the Big flight already flown this month) is asked for once, not on every retry', async () => {
  let opens = 0;
  const sw = load({ source, fetch: (req) => {
    if (new URL(req.url).pathname.endsWith('/session')) { opens += 1; return json({ error: 'flight_done' }, 409); }
    return json({ ok: true });
  } });
  sw.net.down = true;
  const run = await (await sw.post('/api/sa-game/s/session', { ...START, part: 'tower' }, { 'x-wq-device': 'dev-1' })).json();
  sw.net.down = false;
  // the engine's upload queue: a batch, then one call per recording, again and again
  const codes = [];
  for (let i = 0; i < 12; i += 1) codes.push((await sw.post(i % 3 ? '/api/sa-game/s/audio/presign' : '/api/sa-game/s/batch', { st: run.st, sessionId: run.session_id, taskId: 'en.story', mime: 'audio/webm', bytes: 9, seqFrom: 1, seqTo: 1, events: [], results: [] })).status);
  assert.ok(codes.every((c) => c === 409), 'every call is told the run was refused');
  assert.equal(opens, 1);
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => [w.ex, w.state]), [['flight:tower', 'refused_409 flight_done']]);
});

// ---- games lane: the pilot's own files on the device follow the pilot's release ----
test("a new release of the pilot replaces the saved copies of its own files; the same release is not read again", async () => {
  let stamp = 'rel-a', body = 'boot v1', reads = 0;
  const sw = load({ source, fetch: (req) => {
    const p = new URL(req.url).pathname;
    if (p === '/__cb/release') return json({ stamp, files: ['/__cb/boot.js'] });
    if (p === '/__cb/boot.js') { reads += 1; return new Response(body, { status: 200, headers: { 'Content-Type': 'application/javascript' } }); }
    return json({}, 404);
  } });
  const kept = async () => (await (await sw.caches.open('cb-pilot-v1')).match('http://pilot.test/__cb/boot.js')).text();
  const a = await sw.message({ type: 'release' });
  assert.deepEqual([a.ok, a.stamp, a.refreshed], [true, 'rel-a', 1]);
  assert.equal(await kept(), 'boot v1');
  stamp = 'rel-b'; body = 'boot v2';            // the pilot is released again
  const b = await sw.message({ type: 'release' });
  assert.deepEqual([b.ok, b.stamp, b.refreshed, b.was], [true, 'rel-b', 1, 'rel-a']);
  assert.equal(await kept(), 'boot v2');          // offline now runs the new file, not the old copy
  body = 'boot v3 (same release)';
  const c = await sw.message({ type: 'release' });
  assert.equal(c.refreshed, 0);
  assert.equal(reads, 2);
});

// ---- games lane: Listen (a story, then questions) with no network ----
const LISTEN = '/api/wq/ch/tok.sig/listen?lang=en&kid=a1b2c3d4e5f60718&room=story&pid=en.listen.1.story01';
const RIGHT = { 'q.1': 'ice cream', 'q.2': 'in the park', 'q.3': 'it melted' };
const WRONG = { 'q.1': ['an apple', 'a cake'], 'q.2': ['at home', 'at school'], 'q.3': ['it flew', 'it sang'] };
/** A small Jugnu: every serve is a new run; a run's options are in an order of its own; qa says ok and the right answer. */
function listenServer({ expired = () => false } = {}) {
  const st = { serves: 0, calls: [], answered: [] };
  const order = (ct, id) => { const o = [RIGHT[id], ...WRONG[id]]; const k = Number(ct.split('-')[1]) % 3; return o.slice(k).concat(o.slice(0, k)); };
  st.fetch = (req, body) => {
    const u = new URL(req.url); const b = body ? JSON.parse(body) : {};
    st.calls.push(`${req.method} ${u.pathname.replace('/api/wq/ch/', '')}${b.ct ? ' ' + b.ct : ''}`);
    if (req.method === 'GET' && /\/listen$/.test(u.pathname)) { st.serves += 1; return json({ ex: 'listen', ct: 'ct-' + st.serves, lang: 'en', story_clip: { url: 'https://r2.test/story.ogg' } }); }
    if (b.ct && expired(b.ct)) return json({ error: 'bad_token' }, 401);
    if (u.pathname === '/api/wq/ch/qs') return json({ questions: Object.keys(RIGHT).map((id) => ({ id, prompt: id + '?', options: order(b.ct, id), clip: { url: `https://r2.test/${id}.ogg` } })) });
    if (u.pathname === '/api/wq/ch/qa') { const ok = order(b.ct, b.q)[b.pick] === RIGHT[b.q]; st.answered.push([b.ct, b.q, order(b.ct, b.q)[b.pick]]); return json({ ok, answer: RIGHT[b.q] }); }
    return json({}, 404);
  };
  return st;
}

test('Listen got ready: with no network the questions open and each answer is told right or wrong, from the device', async () => {
  const srv = listenServer();
  const sw = load({ source, fetch: srv.fetch });
  const ready = await sw.message({ type: 'listen-prepare', url: LISTEN });
  assert.deepEqual([ready.ok, ready.questions, ready.probed], [true, 3, true]);
  sw.net.down = true;
  const serve = await (await sw.get(LISTEN)).json();           // the page opens the game from the kept copy
  const qs = await (await sw.post('/api/wq/ch/qs', { ct: serve.ct, lang: 'en' })).json();
  assert.equal(qs.questions.length, 3);
  const q1 = qs.questions[0];
  const good = await (await sw.post('/api/wq/ch/qa', { ct: serve.ct, q: q1.id, pick: q1.options.indexOf(RIGHT[q1.id]), lang: 'en' })).json();
  assert.deepEqual([good.ok, good.answer], [true, RIGHT[q1.id]]);
  const q2 = qs.questions[1];
  const bad = await (await sw.post('/api/wq/ch/qa', { ct: serve.ct, q: q2.id, pick: q2.options.indexOf(WRONG[q2.id][0]), lang: 'en' })).json();
  assert.deepEqual([bad.ok, bad.answer], [false, RIGHT[q2.id]]);
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => [w.ex, w.state, w.answers]), [['listen', 'waiting', 2]]);
});

test('back online, Listen answers go to the run they were given in; after its token lapsed, to a fresh run by the words chosen', async () => {
  for (const lapsed of [false, true]) {
    let kept = null;
    const srv = listenServer({ expired: (ct) => lapsed && ct === kept });
    const sw = load({ source, fetch: srv.fetch });
    await sw.message({ type: 'listen-prepare', url: LISTEN });
    sw.net.down = true;
    const serve = await (await sw.get(LISTEN)).json();
    const qs = await (await sw.post('/api/wq/ch/qs', { ct: serve.ct, lang: 'en' })).json();
    const picks = {};
    for (const q of qs.questions) { picks[q.id] = q.id === 'q.2' ? WRONG[q.id][1] : RIGHT[q.id]; await sw.post('/api/wq/ch/qa', { ct: serve.ct, q: q.id, pick: q.options.indexOf(picks[q.id]), lang: 'en' }); }
    kept = serve.ct;
    sw.net.down = false; srv.answered.length = 0;
    await sw.message({ type: 'report' });
    await tick(60);
    const sent = srv.answered.filter((a) => (lapsed ? a[0] !== kept : a[0] === kept));
    assert.deepEqual(sent.map((a) => [a[1], a[2]]).sort(), Object.keys(picks).map((id) => [id, picks[id]]).sort(), lapsed ? 'a fresh run, the same words' : 'the same run');
    assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
  }
});

// ---- games lane: a result that arrives late goes to the run it was played in ----
// Jugnu takes a late result for its own run when the request says when it was played (NIETE-Rumi #5015,
// web_quiz_challenge_late_result): the run's token may have lapsed (two hours) and its row may have been closed (a
// day). So the device says so on every waiting result, and only falls back to a fresh serve when the server refuses.
const HOUR = 3600 * 1000;
/** The clock of the worker (it shares this process's Date) moved on by `ms` while `fn` runs. */
async function clockPlus(ms, fn) {
  const real = Date.now;
  Date.now = () => real() + ms;
  try { return await fn(); } finally { Date.now = real; }
}

test('waiting taps go to the run they were played in and say when they were played; a server that takes late results needs no new serve', async () => {
  const sent = []; const gets = [];
  const sw = load({ source, fetch: (req, body) => {
    const u = new URL(req.url);
    if (req.method === 'GET') { gets.push(u.pathname); return serve('ct-fresh', [9, 4, 10]); }   // other questions by now
    const b = JSON.parse(body);
    if (u.pathname === '/api/wq/ch/result') {
      // the run's token lapsed days ago: taken only as a late result
      if (b.ct === 'ct-kept' && b.late && typeof b.late.at === 'number') { sent.push(b); return json({ score: { correct: 2, n: 3, stopped: false } }); }
      return json({ error: 'bad_token' }, 401);
    }
    return json({}, 404);
  } });
  await sw.kept(EX, serve('ct-kept'));
  sw.net.down = true;
  const before = Date.now();
  await sw.post('/api/wq/ch/result', TAPS);
  sw.net.down = false; gets.length = 0;
  await clockPlus(3 * 24 * HOUR, async () => { await sw.message({ type: 'report' }); await tick(30); });
  assert.equal(sent.length, 1, 'sent once, to the run it was played in');
  assert.deepEqual(sent[0].taps, TAPS.taps);
  assert.ok(sent[0].late.at >= before && sent[0].late.at <= Date.now(), 'the time the child finished, by this device');
  assert.deepEqual(gets.filter((p) => /\/numbers$/.test(p)).length <= 1, true);   // at most the next serve kept for the next play
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
});

test('the run already has its result (409): the waiting taps are done, and are not sent to another run', async () => {
  const posts = [];
  const sw = load({ source, fetch: (req, body) => {
    if (req.method === 'GET') return serve('ct-fresh');   // the same questions: a second result would count twice
    if (new URL(req.url).pathname !== '/api/wq/ch/result') return json({});
    const b = JSON.parse(body); posts.push(b.ct);
    return b.ct === 'ct-kept' ? json({ error: 'already_done' }, 409) : json({ score: { correct: 2, n: 3, stopped: false } });
  } });
  await sw.kept(EX, serve('ct-kept'));
  sw.net.down = true;
  await sw.post('/api/wq/ch/result', TAPS);
  sw.net.down = false;
  await sw.message({ type: 'report' });
  await tick(30);
  assert.deepEqual(posts, ['ct-kept']);
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
});

test('a server that takes no late result and serves other questions: the taps are kept and asked again twice a day, not on every page', async () => {
  let takes = false; const posts = [];
  const sw = load({ source, fetch: (req, body) => {
    if (req.method === 'GET') return serve('ct-fresh', [9, 4, 10]);
    if (new URL(req.url).pathname !== '/api/wq/ch/result') return json({});
    const b = JSON.parse(body); posts.push(b.ct);
    return takes && b.ct === 'ct-kept' && b.late ? json({ score: { correct: 2, n: 3, stopped: false } }) : json({ error: 'bad_token' }, 401);
  } });
  await sw.kept(EX, serve('ct-kept'));
  sw.net.down = true;
  await sw.post('/api/wq/ch/result', TAPS);
  sw.net.down = false;
  await sw.message({ type: 'report' }); await tick(30);
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => w.state), ['questions_changed']);
  const first = posts.length;
  await sw.message({ type: 'report' }); await tick(30);
  assert.equal(posts.length, first, 'not asked again a moment later');
  takes = true;   // the server's switch is turned on
  await clockPlus(13 * HOUR, async () => { await sw.message({ type: 'report' }); await tick(30); });
  assert.equal(posts[posts.length - 1], 'ct-kept');
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), [], 'sent when the server takes it');
});

test('a kept reading goes up for the run it was read in, as a late result: no new serve, the same story or not', async () => {
  const seen = [];
  const sw = load({ source, fetch: async (req, body) => {
    const u = new URL(req.url);
    if (req.method === 'GET') { seen.push(['serve']); return readServe('ct-fresh', 'Another story altogether.'); }
    if (u.pathname === '/api/wq/ch/upload') { const b = JSON.parse(body); seen.push(['upload', b]); return b.ct === 'ct-kept' && b.late ? json({ put_url: 'https://r2.test/put/abc', content_type: 'audio/webm', key: 'child-voice/sandbox/abc.webm' }) : json({ error: 'bad_token' }, 401); }
    if (u.host === 'r2.test') { seen.push(['put', body]); return new Response('', { status: 200 }); }
    if (u.pathname === '/api/wq/ch/result') { seen.push(['result', JSON.parse(body)]); return json({ pending: true }); }
    return json({}, 404);
  } });
  await readOffline(sw);
  sw.net.down = false;
  await clockPlus(3 * 24 * HOUR, async () => { await sw.message({ type: 'report' }); await tick(40); });
  assert.deepEqual(seen.slice(0, 3).map((x) => x[0]), ['upload', 'put', 'result']);
  assert.equal(seen[0][1].ct, 'ct-kept');
  assert.equal(typeof seen[0][1].late.at, 'number');
  assert.equal(seen[1][1], 'VOICE');
  assert.deepEqual([seen[2][1].ct, seen[2][1].key, typeof seen[2][1].late.at], ['ct-kept', 'child-voice/sandbox/abc.webm', 'number']);
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
  assert.equal(await sw.message({ type: 'games-audio-kept' }), 0);
});

test('a reading the server will not take yet (no late result, another story): the recording is KEPT and offered again later', async () => {
  let takes = false; const seen = [];
  const sw = load({ source, fetch: async (req, body) => {
    const u = new URL(req.url);
    if (req.method === 'GET') return readServe('ct-fresh', 'Another story altogether.');
    if (u.pathname === '/api/wq/ch/upload') { const b = JSON.parse(body); seen.push('upload ' + b.ct); return takes && b.ct === 'ct-kept' && b.late ? json({ put_url: 'https://r2.test/put/abc', content_type: 'audio/webm', key: 'k.webm' }) : json({ error: 'bad_token' }, 401); }
    if (u.host === 'r2.test') return new Response('', { status: 200 });
    if (u.pathname === '/api/wq/ch/result') { seen.push('result'); return json({ pending: true }); }
    return json({}, 404);
  } });
  await readOffline(sw);
  sw.net.down = false;
  await sw.message({ type: 'report' }); await tick(40);
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => w.state), ['questions_changed']);
  assert.equal(await sw.message({ type: 'games-audio-kept' }), 1, 'the recording is still on the device');
  takes = true;
  await clockPlus(13 * HOUR, async () => { await sw.message({ type: 'report' }); await tick(40); });
  assert.equal(seen[seen.length - 1], 'result');
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
  assert.equal(await sw.message({ type: 'games-audio-kept' }), 0);
});

test("the day's readings are used up (429): the reading waits with its recording and goes up later", async () => {
  let full = true; let results = 0;
  const sw = load({ source, fetch: async (req, body) => {
    const u = new URL(req.url);
    if (req.method === 'GET') return readServe('ct-fresh');
    if (u.pathname === '/api/wq/ch/upload') return full ? json({ error: 'enough_for_today' }, 429) : json({ put_url: 'https://r2.test/put/abc', content_type: 'audio/webm', key: 'k.webm' });
    if (u.host === 'r2.test') return new Response('', { status: 200 });
    if (u.pathname === '/api/wq/ch/result') { results += 1; return json({ pending: true }); }
    return json({}, 404);
  } });
  await readOffline(sw);
  sw.net.down = false;
  await sw.message({ type: 'report' }); await tick(40);
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => w.state), ['waiting']);
  assert.equal(await sw.message({ type: 'games-audio-kept' }), 1);
  full = false;
  await sw.message({ type: 'report' }); await tick(40);
  assert.equal(results, 0, 'not asked again at once');
  await clockPlus(7 * HOUR, async () => { await sw.message({ type: 'report' }); await tick(40); });
  assert.equal(results, 1);
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
});

test('Listen answers given with no network say when they were given, so a lapsed run still takes them (its own order of choices)', async () => {
  let kept = null; const late = [];
  const srv = listenServer();
  const sw = load({ source, fetch: (req, body) => {
    const u = new URL(req.url); const b = body ? JSON.parse(body) : {};
    if (u.pathname === '/api/wq/ch/qa' && b.ct === kept) { late.push(b.late); if (!b.late) return json({ error: 'bad_token' }, 401); }
    return srv.fetch(req, body);
  } });
  await sw.message({ type: 'listen-prepare', url: LISTEN });
  sw.net.down = true;
  const s = await (await sw.get(LISTEN)).json();
  const qs = await (await sw.post('/api/wq/ch/qs', { ct: s.ct, lang: 'en' })).json();
  for (const q of qs.questions) await sw.post('/api/wq/ch/qa', { ct: s.ct, q: q.id, pick: q.options.indexOf(RIGHT[q.id]), lang: 'en' });
  kept = s.ct;
  sw.net.down = false; srv.answered.length = 0;
  await clockPlus(3 * 24 * HOUR, async () => { await sw.message({ type: 'report' }); await tick(60); });
  assert.equal(late.length, 3);
  assert.ok(late.every((l) => l && typeof l.at === 'number'), 'every answer says when it was given');
  assert.deepEqual(srv.answered.map((a) => a[0]), [kept, kept, kept], 'all three to the run they were given in');
  assert.deepEqual(await sw.message({ type: 'games-outbox' }), []);
});

test('a kept reading no server took for 45 days is given up: it says so, and the recording leaves the device', async () => {
  const sw = load({ source, fetch: (req) => (req.method === 'GET' ? readServe('ct-fresh', 'Another story altogether.') : json({ error: 'bad_token' }, 401)) });
  await readOffline(sw);
  sw.net.down = false;
  await sw.message({ type: 'report' }); await tick(40);
  assert.equal(await sw.message({ type: 'games-audio-kept' }), 1);
  await clockPlus(44 * 24 * HOUR, async () => { await sw.message({ type: 'report' }); await tick(40); });
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => w.state), ['questions_changed']);
  assert.equal(await sw.message({ type: 'games-audio-kept' }), 1, 'still kept at 44 days');
  await clockPlus(46 * 24 * HOUR, async () => { await sw.message({ type: 'report' }); await tick(40); });
  assert.deepEqual((await sw.message({ type: 'games-outbox' })).map((w) => w.state), ['too_old']);
  assert.equal(await sw.message({ type: 'games-audio-kept' }), 0);
});
