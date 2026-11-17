// What the pilot's server rewrites is never answered from an older copy of itself (proxy-fresh.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { upstreamHeaders, rewrittenHeaders } from '../proxy-fresh.mjs';

test('a page, a script or a JSON answer is never asked for "only if changed": Jugnu would say 304 and the browser would keep an older pilot\'s body', () => {
  const asked = { accept: 'text/html', 'if-none-match': 'W/"a40-old"', 'If-Modified-Since': 'Fri, 30 Oct 2026 10:00:00 GMT', cookie: 'a=b' };
  for (const p of ['/sa/play.html', '/c/tok.sig', '/sa/sa-core.js', '/wq/wq-challenge.css', '/api/wq/doors/h/tok', '/sa/batteries/sa.game.G1.en.json', '/']) {
    assert.deepEqual(upstreamHeaders('GET', p, asked), { accept: 'text/html', cookie: 'a=b' }, p);
  }
  assert.deepEqual(asked['if-none-match'], 'W/"a40-old"', 'the caller\'s own headers are left alone');
});

test('a sound, a picture, a video or a font is passed through untouched, so it may still answer 304', () => {
  const asked = { 'if-none-match': '"abc"' };
  for (const p of ['/sa/audio/en/a.mp3', '/wq/img/jugnu.webp', '/s/clip.ogg', '/fonts/x.woff2', '/v/lesson.mp4']) assert.deepEqual(upstreamHeaders('GET', p, asked), asked, p);
  assert.deepEqual(upstreamHeaders('POST', '/api/wq/ch/result', asked), asked, 'only reads are changed');
});

test('a rewritten answer carries no validator of Jugnu\'s', () => {
  assert.deepEqual(rewrittenHeaders({ 'content-type': 'text/html', etag: 'W/"a40-x"', 'Last-Modified': 'x', 'cache-control': 'no-cache' }), { 'content-type': 'text/html', 'cache-control': 'no-cache' });
});

test('the server uses both rules on its way to Jugnu and back, and a change to them is a new release', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(src, /upstreamHeaders\(req\.method, url\.pathname, /);
  assert.match(src, /rewrittenHeaders\(out\)/);
  assert.match(src, /'proxy-fresh\.mjs'/);
});
