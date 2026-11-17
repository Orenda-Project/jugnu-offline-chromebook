// What this server rewrites must never be answered from an older copy of itself.
//
// The pilot changes every page and script of Jugnu's on the way through (its own addresses, the boot script, the
// battery page's Chromebook sheet). It used to pass Jugnu's validators (ETag, Last-Modified) along with the changed
// body. A browser that had the page from an OLDER pilot then asked "only if changed", Jugnu said "not changed" (304:
// true of Jugnu's page), and the browser went on using the body the older pilot had made. Seen on the rig, 18 Nov
// 2026: a profile that got ready on the 30 October pilot kept its October battery page (no Chromebook sheet) through
// a release refresh, and a conditional GET of /sa/play.html through this server answered 304.
//
//   upstreamHeaders   the request sent to Jugnu carries no "only if changed" unless the file is one this server
//                     never rewrites (a sound, a picture, a video, a font): those may still answer 304.
//   rewrittenHeaders  the answer for a body this server rewrote carries no validator of Jugnu's, so nothing can
//                     be revalidated against a body that is not Jugnu's.

/** Files this server passes through untouched, by their address. */
export const UNTOUCHED = /\.(mp3|ogg|opus|wav|m4a|aac|mp4|webm|png|jpe?g|webp|gif|ico|avif|woff2?|ttf|otf|pdf|zip|wasm)$/i;

/** The headers for the request to Jugnu (a copy). */
export function upstreamHeaders(method, pathname, headers) {
  const out = { ...headers };
  if (String(method).toUpperCase() !== 'GET' && String(method).toUpperCase() !== 'HEAD') return out;
  if (UNTOUCHED.test(String(pathname || ''))) return out;
  for (const k of Object.keys(out)) if (/^(if-none-match|if-modified-since)$/i.test(k)) delete out[k];
  return out;
}

/** The headers for an answer whose body this server rewrote (a copy). */
export function rewrittenHeaders(headers) {
  const out = { ...headers };
  for (const k of Object.keys(out)) if (/^(etag|last-modified)$/i.test(k)) delete out[k];
  return out;
}
