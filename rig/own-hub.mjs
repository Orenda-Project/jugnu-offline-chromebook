// Prints the child home link this profile keeps (what Get ready saved), for a rig that takes a link as its argument:
//   CB_BASE=http://localhost:8843 node rig/stories.mjs "$(node rig/own-hub.mjs)" offline --books 1
// A link is a key to a child's home: never paste it anywhere, never commit it.
import { launch, BASE } from './cb.mjs';
const { ctx, page } = await launch({ fresh: false });
try {
  await page.goto(`${BASE}/cb/app.webmanifest`, { waitUntil: 'load' });
  const hub = await page.evaluate(() => localStorage.getItem('cb-hub'));
  if (!hub) { console.error('this profile has no saved home (run Get ready on it first)'); process.exitCode = 1; } else process.stdout.write(hub);
} finally { await ctx.close(); }
