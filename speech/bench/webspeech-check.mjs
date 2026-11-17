// What Chrome's own on-device speech recognition (Web Speech API, processLocally) offers on THIS machine.
//   node bench/webspeech-check.mjs            (on a Chromebook: paste the page.evaluate body into the DevTools console)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><title>x</title>'); });
await new Promise((ok) => server.listen(8826, '127.0.0.1', ok));
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', userDataDir: new URL('../.cache/chrome-profile-ws', import.meta.url).pathname });
const page = await b.newPage();
await page.goto('http://127.0.0.1:8826/');
const out = await page.evaluate(async () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = { ua: navigator.userAgent, api: !!SR, available: SR ? typeof SR.available : null, install: SR ? typeof SR.install : null, langs: {} };
  if (SR && SR.available) {
    for (const l of ['en-US', 'en-GB', 'en-IN', 'ur-PK', 'ur', 'hi-IN']) {
      try { r.langs[l] = await SR.available({ langs: [l], processLocally: true }); } catch (e) { r.langs[l] = 'error: ' + e.message; }
    }
  }
  return r;
});
console.log(JSON.stringify(out, null, 1));
await b.close(); server.close();
