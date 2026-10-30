// The physical Chromebook, driven over Chrome's remote-debugging port (bd-fc5mgd.2).
// Needs: developer mode + debugging features on the device, /etc/chrome_dev.conf with --remote-debugging-port=9222,
// and an SSH tunnel from this Mac: ssh -N -L 9333:127.0.0.1:9222 root@<chromebook-ip>
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const CDP = process.env.CB_CDP || 'http://127.0.0.1:9333';
export const DEVICE_IP = process.env.CB_IP; // the Chromebook's address on your Wi-Fi (required for SSH steps)
const KEY = process.env.CB_SSH_KEY || path.join(process.env.HOME, '.ssh/cb_pilot_ed25519');
const KNOWN = process.env.CB_KNOWN_HOSTS || path.join(process.env.HOME, '.ssh/known_hosts_cb');
export const SHOTS = path.join(HERE, '..', 'shots', 'device');
fs.mkdirSync(SHOTS, { recursive: true });

/** Run a shell command on the Chromebook as root. */
export function onDevice(cmd) {
  return execFileSync('ssh', ['-i', KEY, '-o', `UserKnownHostsFile=${KNOWN}`,
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', `root@${DEVICE_IP}`, `export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; ${cmd}`],
  { encoding: 'utf8', timeout: 60000 });
}

export async function connect() {
  // Puppeteer, not Playwright: Playwright's connectOverCDP asks for browser-context management, which ChromeOS refuses.
  return puppeteer.connect({ browserURL: CDP, defaultViewport: null, protocolTimeout: 60000 });
}

/** All page targets the browser has, with their URLs. */
export async function pages(browser) {
  return browser.pages();
}

/** The device's real screen, as the child sees it (ChromeOS screenshot tool), copied here. */
export function deviceScreenshot(name) {
  const remote = `/tmp/cb-${name}.png`;
  try {
    onDevice(`screenshot ${remote} >/dev/null 2>&1 || true; ls ${remote}`);
    const local = path.join(SHOTS, `${name}-screen.png`);
    execFileSync('scp', ['-q', '-i', KEY, '-o', `UserKnownHostsFile=${KNOWN}`, '-o', 'BatchMode=yes', `root@${DEVICE_IP}:${remote}`, local], { timeout: 30000 });
    return local;
  } catch (e) {
    return null;
  }
}
