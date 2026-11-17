// npm test            (no secrets: a made-up key; Jugnu's own signer is checked when its file is given)
//   NIETE_TOKEN_JS=<path>/web-quiz-token.js npm test   also proves Jugnu's verify() accepts what we sign
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import { signer, decode, candidates, deriveTokenKey, HUB_TTL_S, TOKEN_RX } from '../hub-sign.mjs';

const API_KEY = 'test-internal-api-key-not-a-real-one';
const KID = '11111111-2222-4333-8444-555555555555';
// What Jugnu does (web-quiz-token.js), written out here so the test stands without Jugnu's file.
const jugnuKey = crypto.createHmac('sha256', API_KEY).update('web-quiz-token-v1').digest();
function jugnuSign(payload, key = jugnuKey) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, 22)}`;
}
const reference = jugnuSign({ k: 'h', ids: [KID], l: 'en', exp: 1 }); // long expired: still a valid reference

test('each key form signs what Jugnu would sign', () => {
  const forms = { internal_api_key: API_KEY, token_key: deriveTokenKey(API_KEY) };
  for (const [form, value] of Object.entries(forms)) {
    const s = signer(value, reference);
    assert.equal(s.ok, true);
    assert.equal(s.form, form);
    assert.equal(s.checked, true);
    const now = Date.UTC(2026, 10, 17);
    const { token, exp } = s.sign({ ids: [KID], lang: 'en', now });
    assert.equal(exp, now / 1000 + HUB_TTL_S);
    assert.equal(token, jugnuSign({ k: 'h', ids: [KID], l: 'en', exp }));
    assert.match(token, TOKEN_RX);
  }
});

test('a WEB_QUIZ_TOKEN_SECRET is used as it is', () => {
  const secret = 'a-token-secret-of-its-own';
  const ref = jugnuSign({ k: 'h', ids: [KID], exp: 1 }, Buffer.from(secret));
  const s = signer(secret, ref);
  assert.equal(s.form, 'token_secret');
  assert.equal(s.genuine(s.sign({ ids: [KID] }).token), true);
});

test('a key that did not sign the reference link is refused, never used', () => {
  assert.deepEqual(signer('some-other-key', reference), { ok: false, why: 'signing_key_mismatch' });
  assert.deepEqual(signer('', reference), { ok: false, why: 'no_signing_key' });
  assert.equal(candidates('').length, 0);
});

test('a nonce gives each Chromebook its own link; the link still reads as a home link', () => {
  const s = signer(API_KEY, reference);
  const now = Date.now();
  const a = s.sign({ ids: [KID], lang: 'ur', nonce: 'device-a', now });
  const b = s.sign({ ids: [KID], lang: 'ur', nonce: 'device-b', now });
  assert.notEqual(a.token, b.token);
  assert.deepEqual(decode(a.token), { k: 'h', ids: [KID], l: 'ur', exp: a.exp, n: 'device-a' });
  assert.equal(s.genuine(a.token) && s.genuine(b.token), true);
  assert.equal(s.genuine(a.token.slice(0, -1) + (a.token.endsWith('A') ? 'B' : 'A')), false);
});

test('only real student ids are signed, at most four, and a short life is honoured', () => {
  const s = signer(API_KEY, reference);
  assert.equal(s.sign({ ids: ['not-an-id'] }), null);
  assert.equal(s.sign({ ids: [] }), null);
  const many = Array.from({ length: 6 }, (_, i) => `${i}1111111-2222-4333-8444-555555555555`);
  assert.equal(decode(s.sign({ ids: many }).token).ids.length, 4);
  const now = Date.now();
  assert.equal(s.sign({ ids: [KID], ttlS: 30, now }).exp, Math.floor(now / 1000) + 30);
});

test('decode reads only home links', () => {
  assert.equal(decode('nope'), null);
  assert.equal(decode(jugnuSign({ k: 's', sid: 'x', exp: 9 })), null);
  assert.equal(decode(reference).ids[0], KID);
});

test("Jugnu's own verify() accepts a link signed here", { skip: !process.env.NIETE_TOKEN_JS }, () => {
  const require = createRequire(import.meta.url);
  process.env.INTERNAL_API_KEY = API_KEY;
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  const T = require(path.resolve(process.env.NIETE_TOKEN_JS));
  const s = signer(deriveTokenKey(API_KEY), T.signHub([KID], 'hub_link', { lang: 'en' }));
  assert.equal(s.ok && s.checked, true);
  const { token } = s.sign({ ids: [KID], lang: 'en', nonce: 'cb-1' });
  const p = T.verify(token, 'h');
  assert.deepEqual(p.ids, [KID]);
  assert.equal(p.l, 'en');
  const dead = s.sign({ ids: [KID], now: Date.now() - (HUB_TTL_S + 60) * 1000 }).token;
  assert.equal(T.verify(dead, 'h'), null);
  assert.deepEqual(T.verify(dead, 'h', { allowExpired: true }).ids, [KID]);
});
