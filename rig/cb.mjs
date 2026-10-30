// Shared driver for the offline pilot: a Chromebook-shaped Chrome (1366x768, ChromeOS user agent) with its own
// profile, so the pilot worker and its kept files survive between steps the way they would on a real device.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import pw from 'playwright-core';

const { chromium } = pw;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

export const BASE = process.env.CB_BASE || 'http://localhost:8791';
export const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
export const UA = 'Mozilla/5.0 (X11; CrOS x86_64 16328.55.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export async function launch({ fresh = false } = {}) {
  const profile = path.join(ROOT, '.chrome-profile');
  if (fresh) fs.rmSync(profile, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: process.env.CB_HEADED ? false : true,
    viewport: { width: 1366, height: 768 },
    userAgent: UA,
    locale: 'en-PK',
    permissions: ['microphone'],
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const log = [];
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`.slice(0, 400)));
  page.on('requestfailed', (r) => log.push(`[failed] ${r.method()} ${r.url().slice(0, 200)} ${r.failure() && r.failure().errorText}`));
  return { ctx, page, log };
}

export async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Wait until the pilot worker controls the page (first visit needs one reload for that). */
export async function controlled(page) {
  for (let i = 0; i < 2; i += 1) {
    const on = await page.evaluate(async () => {
      if (!navigator.serviceWorker) return false;
      await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 8000))]);
      return !!navigator.serviceWorker.controller;
    });
    if (on) return true;
    await page.reload({ waitUntil: 'networkidle' });
  }
  return false;
}

export async function keptCount(page) {
  return page.evaluate(async () => {
    const keys = await caches.open('cb-pilot-v1').then((c) => c.keys());
    return keys.length;
  });
}

export async function state(page) {
  return page.evaluate(() => {
    const wq = document.getElementById('wq');
    const boot = document.getElementById('boot');
    return {
      url: location.pathname,
      title: document.title,
      screen: wq ? wq.getAttribute('data-m') : null,
      hasBoot: !!boot,
      text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 600),
      buttons: [...document.querySelectorAll('button, [role=button], a.btn, .chip')]
        .filter((b) => b.offsetParent !== null).slice(0, 25)
        .map((b) => ({ t: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 40), id: b.id, cls: String(b.className).slice(0, 40), d: b.dataset ? { ...b.dataset } : {} })),
    };
  });
}
