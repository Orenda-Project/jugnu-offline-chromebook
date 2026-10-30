// Sign a child home link (/h/<token>) for testing, with the same code and key the Jugnu bot uses.
//   INTERNAL_API_KEY=<that environment's key> node tools/sign-hub.mjs <path to NIETE-Rumi>/bot/shared/services/quiz/web-quiz-token.js <student uuid> [en|ur]
// A home link is bound to the FIRST device that opens it, and a Guest session counts as a new device each time:
// sign a fresh link per test device. Use a test student, never a real child.
import { createRequire } from 'node:module';
import path from 'node:path';

const [tokenModule, studentId, lang = 'en'] = process.argv.slice(2);
if (!tokenModule || !/^[0-9a-f-]{36}$/.test(studentId || '') || !process.env.INTERNAL_API_KEY) {
  console.error('usage: INTERNAL_API_KEY=… node tools/sign-hub.mjs <web-quiz-token.js> <student uuid> [en|ur]');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const T = require(path.resolve(tokenModule));
console.log(T.signHub([studentId], 'hub_link', { lang }));
