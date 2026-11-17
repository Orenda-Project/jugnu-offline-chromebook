// What this server rewrites must never be answered from an older copy of itself.
//
// The pilot changes every page and script of Jugnu's on the way through (its own addresses, the boot script, the
// battery page's Chromebook sheet). It used to pass Jugnu's validators (ETag, Last-Modified) along with the changed
// body. A browser that had the page from an OLDER pilot then asked "only if changed", Jugnu said "not changed" (304:
// true of Jugnu's page), and the browser went on using the body the older pilot had made. Seen on the rig, 18 Nov
// 2026: a profile that got ready on the 30 October pilot kept its October battery page (no Chromebook sheet) through
// a release refresh, and a conditional GET of /sa/play.html through this server answered 304.
//
// A rewritten body is Jugnu's page AND this pilot release, so its validator names both: Jugnu's ETag with this
// release's stamp added (W/"<Jugnu's>.cb-<stamp>"). "Only if changed" still saves the download within one release
// (it is every page load on a school's Wi-Fi), and can never be answered across two.
//
//   upstreamHeaders   the request to Jugnu carries "only if changed" only when the browser's validator is one this
//                     release handed out (it then goes to Jugnu as Jugnu's own); any other is left out, so Jugnu
//                     sends the whole page. A date (If-Modified-Since) cannot name a release and is always left
//                     out. Files this server never rewrites (a sound, a picture, a video, a font) are not touched.
//   rewrittenHeaders  the answer for a body this server rewrote carries the stamped validator, and no date.
//   notModified       Jugnu's 304 to such a request goes back with the stamped validator, so the browser keeps it.

/** Files this server passes through untouched, by their address. */
export const UNTOUCHED = /\.(mp3|ogg|opus|wav|m4a|aac|mp4|webm|png|jpe?g|webp|gif|ico|avif|woff2?|ttf|otf|pdf|zip|wasm)$/i;

const PARTS = /^(?:W\/)?"(.*)"$/;
/** Jugnu's validator with this release's stamp: W/"<Jugnu's>.cb-<stamp>" (weak: the body was rewritten); null if none. */
export function stamped(etag, stamp) {
  const m = PARTS.exec(String(etag || '').trim());
  return m && stamp ? `W/"${m[1]}.cb-${stamp}"` : null;
}
/** Jugnu's own validator out of one this release handed out; null for any other. */
export function unstamped(etag, stamp) {
  const m = PARTS.exec(String(etag || '').trim());
  if (!m || !stamp) return null;
  const tail = `.cb-${stamp}`;
  return m[1].endsWith(tail) ? `W/"${m[1].slice(0, -tail.length)}"` : null;
}
const has = (headers, name) => Object.keys(headers).find((k) => k.toLowerCase() === name);

/** The headers for the request to Jugnu (a copy), and whether its "only if changed" is this release's own. */
export function upstreamHeaders(method, pathname, headers, stamp) {
  const out = { ...headers };
  const m = String(method).toUpperCase();
  if ((m !== 'GET' && m !== 'HEAD') || UNTOUCHED.test(String(pathname || ''))) return { headers: out, ours: false };
  const since = has(out, 'if-modified-since');
  if (since) delete out[since];
  const none = has(out, 'if-none-match');
  let ours = false;
  if (none) {
    const own = unstamped(out[none], stamp);
    if (own) { out[none] = own; ours = true; } else delete out[none];
  }
  return { headers: out, ours };
}

/** The headers for an answer whose body this server rewrote (a copy). */
export function rewrittenHeaders(headers, stamp) {
  const out = { ...headers };
  const date = has(out, 'last-modified');
  if (date) delete out[date];
  const tag = has(out, 'etag');
  if (tag) { const s = stamped(out[tag], stamp); if (s) out[tag] = s; else delete out[tag]; }
  return out;
}

/** The headers of Jugnu's 304 to a request whose validator was this release's own (a copy). */
export function notModified(headers, stamp) {
  return rewrittenHeaders(headers, stamp);
}
