// Games lane rig: the same Chromebook-shaped Chrome as rig/cb.mjs, but sized as the page a school Chromebook really
// gives (1366x633), never wiping the profile (a child home link binds to the first profile that opens it), and able
// to speak into the microphone from a WAV file (read-aloud items).
//
//   const { ctx, page, log } = await launch({ wav: '/path/speech.wav' })
//   offline(ctx, true|false)   TRUE offline: the server's OFFLINE switch AND the browser offline. Playwright's
//                              setOffline alone does not reach a service worker's requests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import pw from 'playwright-core';

const { chromium } = pw;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..', '..');
export const BASE = process.env.CB_BASE || 'http://localhost:8812';
export const SHOTS = path.join(ROOT, 'shots');
export const FLAG = process.env.CB_OFFLINE_FLAG || path.join(ROOT, 'OFFLINE'); // a second server on this machine has its own switch (its OFFLINE_FLAG)
export const UA = 'Mozilla/5.0 (X11; CrOS x86_64 16328.55.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
fs.mkdirSync(SHOTS, { recursive: true });

export async function launch({ wav = null, profile = path.join(ROOT, '.chrome-profile') } = {}) {
  const args = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  // The microphone is a WAV of this profile's own (logs/speech/mic-<profile>.wav), started as a copy of `wav`: the rig
  // can put other speech in it before a reading (speakClip), and Chrome reads the file when a recording opens.
  let mic = null;
  if (wav) {
    mic = path.join(ROOT, 'logs', 'speech', `mic-${path.basename(profile).replace(/[^A-Za-z0-9.-]/g, '_')}.wav`);
    fs.mkdirSync(path.dirname(mic), { recursive: true });
    fs.copyFileSync(wav, mic);
    args.push(`--use-file-for-fake-audio-capture=${mic}`);
  }
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: !process.env.CB_HEADED, viewport: { width: 1366, height: 633 }, userAgent: UA,
    locale: 'en-PK', permissions: ['microphone'], args,
  });
  // Every sound the page tries to play, and whether it played: clips are half of these games.
  await ctx.addInitScript(() => {
    const rec = (window.__cbMedia = []);
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      // .src first: a pooled <audio> given a new src still reports the old currentSrc until it loads
      const r = { src: String(this.src || this.currentSrc || '').split('?')[0].slice(-60), full: String(this.src || this.currentSrc || ''), ok: null, at: Date.now() };
      rec.push(r);
      const p = orig.apply(this, arguments);
      if (p && p.then) p.then(() => { r.ok = true; }, (e) => { r.ok = (e && e.name) || 'error'; });
      return p;
    };
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${m.type()}] ${m.text()}`.slice(0, 300)); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`.slice(0, 300)));
  page.on('requestfailed', (r) => log.push(`[failed] ${r.method()} ${r.url().replace(/[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{16,}/, '<hub>').slice(0, 160)} ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) log.push(`[http ${r.status()}] ${r.request().method()} ${r.url().replace(/[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{16,}/, '<hub>').slice(0, 160)}`); });
  return { ctx, page, log, mic };
}

/**
 * The child "reads" what Jugnu just read: a clip the page played (its signed address, as the page had it) becomes
 * this profile's microphone. Jugnu's own reading of a passage is the one voice sure to say that passage's words, in
 * English and in Urdu (the Mac has no Urdu voice). Needs ffmpeg. → true when the microphone now holds the clip.
 */
export function speakClip(mic, url) {
  if (!mic || !url) return false;
  try {
    const tmp = mic.replace(/\.wav$/, '.next.wav');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', url, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', tmp], { timeout: 60000 });
    fs.renameSync(tmp, mic);
    return true;
  } catch (e) { return false; }
}

export async function offline(ctx, on) {
  if (on) { fs.writeFileSync(FLAG, ''); await ctx.setOffline(true); } else { fs.rmSync(FLAG, { force: true }); await ctx.setOffline(false); }
}

export async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

/** The private folder's test children: { 'G1.en': { id, grade, lang, token } }. Never printed, never committed. */
export function children(dir = process.env.CB_PRIVATE) {
  if (!dir) throw new Error('set CB_PRIVATE to the private games-lane folder (students.json + hub-G<n>-<l>.txt)');
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'students.json'), 'utf8'));
  for (const k of Object.keys(st)) st[k].token = fs.readFileSync(path.join(dir, `hub-${k.replace(/\./g, '-')}.txt`), 'utf8').trim();
  return st;
}

/** Sounds the page tried since `since` (ms): [{src, ok}]. */
export const media = (page, since = 0) => page.evaluate((s) => (window.__cbMedia || []).filter((m) => m.at >= s).map((m) => ({ src: m.src, ok: m.ok })), since).catch(() => []);

/** Anything on the page that does not fit a 1366x633 Chromebook page: horizontal scroll, or a visible control cut off. */
export const fit = (page) => page.evaluate(() => {
  const de = document.documentElement;
  const out = { w: innerWidth, h: innerHeight, scrollW: de.scrollWidth, scrollH: de.scrollHeight, cut: [] };
  for (const b of document.querySelectorAll('button, a.wq-btn, a.sg-btn, [role=button], input')) {
    if (b.offsetParent === null) continue;
    const r = b.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right > innerWidth + 1 || r.left < -1) out.cut.push(`${(b.innerText || b.getAttribute('aria-label') || b.id || b.className).trim().slice(0, 30)} x:${Math.round(r.left)}-${Math.round(r.right)}`);
  }
  out.cut = out.cut.slice(0, 6);
  return out;
}).catch(() => null);
