// What the pilot's server rewrites is never answered from an older copy of itself (proxy-fresh.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { upstreamHeaders, rewrittenHeaders, notModified, stamped, unstamped } from '../proxy-fresh.mjs';

const NOW = 'aaaa1111bbbb2222'; const OLD = 'cccc3333dddd4444';

test('a rewritten answer names Jugnu\'s page AND this release: Jugnu\'s ETag with the stamp, and no date', () => {
  assert.deepEqual(rewrittenHeaders({ 'content-type': 'text/html', etag: 'W/"a40-x"', 'Last-Modified': 'x', 'cache-control': 'no-cache' }, NOW),
    { 'content-type': 'text/html', etag: `W/"a40-x.cb-${NOW}"`, 'cache-control': 'no-cache' });
  assert.equal(stamped('"strong"', NOW), `W/"strong.cb-${NOW}"`, 'weak: the body was rewritten');
  assert.deepEqual(rewrittenHeaders({ etag: 'not-a-tag' }, NOW), {}, 'a validator that cannot be stamped is not sent');
});

test('"only if changed" from an OLDER pilot (Jugnu\'s bare ETag, or another release\'s stamp) is not passed on: Jugnu sends the whole page', () => {
  for (const tag of ['W/"a40-x"', `W/"a40-x.cb-${OLD}"`, '"a40-x"', 'junk']) {
    const r = upstreamHeaders('GET', '/sa/play.html', { accept: 'text/html', 'if-none-match': tag, 'If-Modified-Since': 'Fri, 30 Oct 2026 10:00:00 GMT', cookie: 'a=b' }, NOW);
    assert.deepEqual(r, { headers: { accept: 'text/html', cookie: 'a=b' }, ours: false }, tag);
  }
});

test('"only if changed" with THIS release\'s validator goes to Jugnu as Jugnu\'s own, so a page load within a release still costs no download', () => {
  const r = upstreamHeaders('GET', '/sa/sa-ui.js', { 'if-none-match': `W/"a40-x.cb-${NOW}"`, 'if-modified-since': 'x' }, NOW);
  assert.deepEqual(r, { headers: { 'if-none-match': 'W/"a40-x"' }, ours: true });
  assert.equal(unstamped(`W/"a40-x.cb-${NOW}"`, NOW), 'W/"a40-x"');
  assert.equal(unstamped(`W/"a40-x.cb-${OLD}"`, NOW), null);
  // and Jugnu's 304 goes back with the stamped validator, so the browser's copy keeps it
  assert.deepEqual(notModified({ etag: 'W/"a40-x"', 'last-modified': 'x' }, NOW), { etag: `W/"a40-x.cb-${NOW}"` });
});

test('every page, script and JSON answer is covered; a sound, a picture, a video or a font is passed through untouched', () => {
  const asked = { 'if-none-match': '"abc"' };
  for (const p of ['/sa/play.html', '/c/tok.sig', '/sa/sa-core.js', '/wq/wq-challenge.css', '/api/wq/doors/h/tok', '/sa/batteries/sa.game.G1.en.json', '/']) {
    assert.deepEqual(upstreamHeaders('GET', p, asked, NOW).headers, {}, p);
  }
  for (const p of ['/sa/audio/en/a.mp3', '/wq/img/jugnu.webp', '/s/clip.ogg', '/fonts/x.woff2', '/v/lesson.mp4']) assert.deepEqual(upstreamHeaders('GET', p, asked, NOW), { headers: asked, ours: false }, p);
  assert.deepEqual(upstreamHeaders('POST', '/api/wq/ch/result', asked, NOW), { headers: asked, ours: false }, 'only reads are changed');
  assert.deepEqual(asked, { 'if-none-match': '"abc"' }, 'the caller\'s own headers are left alone');
});

test('the server uses the rules on its way to Jugnu and back, and a change to them is a new release', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(src, /upstreamHeaders\(req\.method, url\.pathname, /);
  assert.match(src, /rewrittenHeaders\(out, /);
  assert.match(src, /notModified\(out, /);
  assert.match(src, /'proxy-fresh\.mjs'/);
});
