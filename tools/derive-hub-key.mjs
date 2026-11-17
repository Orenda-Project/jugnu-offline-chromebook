// Print the key the pilot server needs to sign child home links (its HUB_SIGNING_KEY), from a Jugnu environment's
// INTERNAL_API_KEY. The printed key signs child links and nothing else: it cannot call Jugnu's internal API.
//   INTERNAL_API_KEY=<that environment's key> node tools/derive-hub-key.mjs
// Set the output as the service's HUB_SIGNING_KEY variable (a secret: never commit it, never put it in a link).
// If that environment runs with WEB_QUIZ_TOKEN_SECRET set, use that value as HUB_SIGNING_KEY instead.
import { deriveTokenKey } from '../hub-sign.mjs';

if (!process.env.INTERNAL_API_KEY) {
  console.error('usage: INTERNAL_API_KEY=… node tools/derive-hub-key.mjs');
  process.exit(1);
}
console.log(deriveTokenKey(process.env.INTERNAL_API_KEY));
