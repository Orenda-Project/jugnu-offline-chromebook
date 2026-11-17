// "Protected from clean-up": what the start page says and offers (cb.html's own function, run here).
// Chrome clears a site's saved files when the drive runs low unless the site holds "persistent storage", which
// Chrome 156 gives without asking to a site that is installed as an app (https), bookmarked (5 bookmarks or fewer),
// or much used (site engagement 15+), and never in a Guest or clear-on-exit session
// (chrome/browser/storage/persistent_storage_permission_context.cc; proven on Chrome 156 by rig/persist-check.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../cb.html', import.meta.url), 'utf8');
const m = /function protectText\(st\) \{[\s\S]*?\n  \}\n/.exec(html);

test('cb.html has protectText(st)', () => { assert.ok(m, 'the function was not found in cb.html'); });

test('protected: said plainly, nothing more to do', { skip: !m }, () => {
  const protectText = new Function(`${m ? m[0] : ''}; return protectText;`)();
  const t = protectText({ safe: true, installed: false, canInstall: true, used: 1.4e9 });
  assert.equal(t.ok, true);
  assert.match(t.say, /^Protected\./);
  assert.equal(t.install, false, 'no install button is pushed on a Chromebook that is already protected');
});

test('not protected: says what is at stake and the ways to fix it, with the install button when Chrome offers one', { skip: !m }, () => {
  const protectText = new Function(`${m ? m[0] : ''}; return protectText;`)();
  const t = protectText({ safe: false, installed: false, canInstall: true, used: 1.4e9 });
  assert.equal(t.ok, false);
  assert.match(t.say, /^Not protected yet\./);
  assert.match(t.say, /1\.4 GB/, 'it says how much could be cleared');
  assert.match(t.say, /Install/); assert.match(t.say, /bookmark/i);
  assert.equal(t.install, true);
  const noOffer = protectText({ safe: false, installed: false, canInstall: false, used: 5e6 });
  assert.equal(noOffer.install, false);
  assert.match(noOffer.say, /Install page as app|bookmark/i, 'without Chrome\'s offer it names the menu and the bookmark');
});

test('installed but still not protected (http, Guest, or clear-on-exit): says so instead of asking to install again', { skip: !m }, () => {
  const protectText = new Function(`${m ? m[0] : ''}; return protectText;`)();
  const t = protectText({ safe: false, installed: true, canInstall: false, used: 1e9 });
  assert.equal(t.install, false);
  assert.match(t.say, /installed/i);
  assert.match(t.say, /Guest|signed-in|clear/i);
});

test('a browser that cannot say', { skip: !m }, () => {
  const protectText = new Function(`${m ? m[0] : ''}; return protectText;`)();
  assert.equal(protectText({ safe: null, installed: false, canInstall: false, used: 0 }).ok, null);
});
