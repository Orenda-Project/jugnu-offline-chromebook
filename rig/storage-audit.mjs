// What is really on the drive: every saved file's size, by kind, against what the browser says the site uses.
// An "opaque" copy (a file of another site the worker cannot read) is charged by Chrome at about 7 MB each whatever
// its size, so many of them eat the site's room without holding anything.
//   CB_BASE=http://localhost:8813 node rig/storage-audit.mjs
import { launch, BASE, controlled } from './cb.mjs';

const { ctx, page } = await launch({ fresh: false });
try {
  await page.goto(`${BASE}/cb?stay=1`, { waitUntil: 'load' });
  await controlled(page);
  const r = await page.evaluate(async () => {
    // (two caches: the main one, and the media store's files, lesson videos and their quiz clips, in their own)
    const by = {}; let opaque = 0; let bytes = 0; const counts = {};
    for (const name of ['cb-pilot-v1', 'cb-media-v1']) {
    const c = await caches.open(name);
    const keys = await c.keys().catch(() => null);
    counts[name] = keys ? keys.length : 'cannot be listed (too many files)';
    for (const k of keys || []) {
      const res = await c.match(k);
      const u = new URL(k.url);
      const ext = (u.pathname.match(/\.([a-z0-9]{2,5})$/i) || [0, u.pathname.startsWith('/api/') || u.pathname.startsWith('/__cb/') ? 'data' : 'page'])[1].toLowerCase();
      const kind = (u.origin === location.origin ? 'own ' : 'other-site ') + ext + (res.type === 'opaque' ? ' (opaque)' : '');
      const size = res.type === 'opaque' ? 0 : (await res.blob()).size;
      if (res.type === 'opaque') opaque += 1;
      bytes += size;
      by[kind] = by[kind] || { n: 0, mb: 0 };
      by[kind].n += 1; by[kind].mb += size / 1e6;
    }
    }
    const est = await navigator.storage.estimate();
    return { counts, files: Object.values(counts).reduce((n, x) => n + (Number(x) || 0), 0), real_mb: Math.round(bytes / 1e6), browser_says_mb: Math.round(est.usage / 1e6), quota_gb: Math.round(est.quota / 1e8) / 10, opaque, by: Object.entries(by).sort((a, b) => b[1].mb - a[1].mb).map(([k, v]) => `${k.padEnd(28)} ${String(v.n).padStart(6)} files ${v.mb.toFixed(1).padStart(8)} MB`) };
  });
  console.log(Object.entries(r.counts).map(([n, c]) => `${n}: ${c}`).join(' · '));
  console.log(`${r.files} files; really ${r.real_mb} MB; the browser charges ${r.browser_says_mb} MB of ${r.quota_gb} GB; ${r.opaque} opaque copies\n` + r.by.join('\n'));
} finally { await ctx.close(); }
