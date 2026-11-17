// A child home link (/h/<token>) signed the way Jugnu signs it (NIETE-Rumi bot/shared/services/quiz/web-quiz-token.js):
//   base64url(JSON payload) + "." + base64url(HMAC-SHA256(key, that base64url))[:22]
//   payload {k:'h', ids:[student ids], l?:'en'|'ur', exp:<unix seconds>}
// Jugnu's home links last 7 days and lock to the first device that opens them. A school Chromebook has no WhatsApp to
// ask for a new one, so the pilot server signs a fresh link for each Chromebook (server.mjs, POST /__cb/home).
//
// The key never lives in this repo. It comes from the environment (HUB_SIGNING_KEY) in one of three forms, and the
// server finds which by checking it against a link Jugnu itself signed (the configured home link):
//   - Jugnu's token key as 64 hex characters: HMAC-SHA256(INTERNAL_API_KEY, "web-quiz-token-v1"). Preferred: it can
//     sign child links and nothing else (tools/derive-hub-key.mjs prints it).
//   - that environment's INTERNAL_API_KEY itself (the key is derived here, exactly as Jugnu derives it)
//   - that environment's WEB_QUIZ_TOKEN_SECRET, when Jugnu is run with one
import crypto from 'node:crypto';

const DERIVE_LABEL = 'web-quiz-token-v1';
const SIG_LEN = 22;
export const HUB_TTL_S = 7 * 24 * 60 * 60; // Jugnu's own life for a home link
export const TOKEN_RX = /^[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{22}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mac = (key, body) => crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, SIG_LEN);

/** What a link says about itself (its children, language, expiry), read without the key. Null when it is not a home link. */
export function decode(token) {
  try {
    if (typeof token !== 'string' || !TOKEN_RX.test(token)) return null;
    const p = JSON.parse(Buffer.from(token.slice(0, token.indexOf('.')), 'base64url').toString('utf8'));
    return p && p.k === 'h' && Array.isArray(p.ids) && p.ids.length && Number.isFinite(p.exp) ? p : null;
  } catch { return null; }
}

/** Every key the configured value could mean, most limited first. */
export function candidates(value) {
  const v = String(value || '').trim();
  if (!v) return [];
  const out = [];
  if (/^[0-9a-f]{64}$/i.test(v)) out.push({ form: 'token_key', key: Buffer.from(v, 'hex') });
  out.push({ form: 'internal_api_key', key: crypto.createHmac('sha256', v).update(DERIVE_LABEL).digest() });
  out.push({ form: 'token_secret', key: Buffer.from(v) });
  return out;
}

/** Jugnu's token key in hex, from an environment's INTERNAL_API_KEY (what tools/derive-hub-key.mjs prints). */
export function deriveTokenKey(internalApiKey) {
  return crypto.createHmac('sha256', String(internalApiKey)).update(DERIVE_LABEL).digest('hex');
}

function genuine(key, token) {
  const dot = token.indexOf('.');
  const want = mac(key, token.slice(0, dot));
  const sig = token.slice(dot + 1);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

/**
 * A signer, or {ok:false, why}. `reference` is a link Jugnu signed (the configured home link, expired or not): the key
 * form that reproduces its signature is the one used. With no reference the first form is used unchecked.
 */
export function signer(value, reference) {
  const forms = candidates(value);
  if (!forms.length) return { ok: false, why: 'no_signing_key' };
  let chosen = forms[0];
  let checked = false;
  if (reference && TOKEN_RX.test(reference)) {
    chosen = forms.find((f) => genuine(f.key, reference));
    if (!chosen) return { ok: false, why: 'signing_key_mismatch' };
    checked = true;
  }
  const { key, form } = chosen;
  return {
    ok: true, form, checked,
    /** A home link for these children. `nonce` makes each Chromebook's link its own (two never share one binding). */
    sign({ ids, lang = null, ttlS = HUB_TTL_S, nonce = null, now = Date.now() } = {}) {
      const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => UUID_RX.test(id)).slice(0, 4);
      if (!list.length) return null;
      const exp = Math.floor(now / 1000) + Math.max(1, Math.floor(ttlS));
      const payload = { k: 'h', ids: list, ...(lang === 'en' || lang === 'ur' ? { l: lang } : {}), exp, ...(nonce ? { n: String(nonce).slice(0, 22) } : {}) };
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return { token: `${body}.${mac(key, body)}`, exp };
    },
    genuine: (token) => (typeof token === 'string' && TOKEN_RX.test(token) ? genuine(key, token) : false),
  };
}
