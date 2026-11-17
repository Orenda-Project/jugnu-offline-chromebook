// A child playing one game of Jugnu's Challenge page (/c/<home token>…): Numbers with Jugnu (how many dots),
// Number warm-up (missing number), Which is bigger?, Read aloud, Read along and Listen (the story room).
// Every screen is the page's own (section.wq-screen[data-screen]); the rig clicks what a child would, with the mouse.
//
//   playGame(page, { href, lang, say, trace, speakMs, maxMs, tag }) -> { screens: [...], end, posts: [...], media, anomalies }
import { shot, media, BASE } from './lib.mjs';

const UD = '۰۱۲۳۴۵۶۷۸۹';
const western = (s) => String(s).replace(/[۰-۹]/g, (d) => String(UD.indexOf(d)));

const look = (page) => page.evaluate(() => {
  const scr = document.querySelector('#wq section.wq-screen');
  const vis = (b) => b && b.offsetParent !== null;
  const box = (b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width), Math.round(r.height)]; };
  const ctl = [...document.querySelectorAll('#wq button, #wq a.wq-btn, #wq [role=button]')].filter(vis).map((b) => ({ id: b.id || '', cls: String(b.className), t: (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40), k: b.getAttribute('data-k'), dis: !!b.disabled, hid: b.hasAttribute('hidden'), box: box(b) }));
  const seq = [...document.querySelectorAll('#wqc-seq > *')].map((x) => ({ t: x.innerText.trim(), gap: x.id === 'wqc-gap' || /gap/.test(x.className) }));
  return {
    url: location.pathname + location.search + location.hash, screen: scr ? scr.getAttribute('data-screen') : null, land: scr ? scr.getAttribute('data-land') : null,
    text: (document.getElementById('wq') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 170), ctl, seq,
    dots: document.querySelectorAll('.wq-g1-c.wq-g1-on').length, gap: (document.getElementById('wqc-gap') || {}).innerText || '',
    lang: document.documentElement.lang, dir: document.documentElement.dir, w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
    font: getComputedStyle(document.getElementById('wq') || document.body).fontFamily.slice(0, 40),
  };
}).catch(() => null);

export async function playGame(page, opts = {}) {
  const o = { lang: 'en', say: () => {}, trace: false, speakMs: 12000, maxMs: 6 * 60 * 1000, tag: 'ch', keys: false, ...opts };
  const report = { screens: [], anomalies: [], posts: [], cut: [], scrolls: 0 };
  const anomaly = (a) => { if (!report.anomalies.includes(a)) { report.anomalies.push(a); o.say(`   ! ${a}`); } };
  const onReq = (r) => { if (/\/api\/wq\/ch\//.test(r.url()) && r.method() === 'POST') report.posts.push({ p: new URL(r.url()).pathname.replace('/api/wq/', ''), status: null, r }); };
  const onRes = async (res) => { const hit = report.posts.find((x) => x.r === res.request()); if (hit) { hit.status = res.status(); hit.local = res.headers()['x-cb-local'] === '1'; } };
  page.on('request', onReq); page.on('response', onRes);
  const t0 = Date.now();
  await page.goto(BASE + o.href, { waitUntil: 'load', timeout: 45000 }).catch((e) => anomaly('the page did not load: ' + e.message.split('\n')[0]));
  let lastKey = '', lastChange = Date.now(), readStart = 0, listenStart = 0, n = 0, ended = false;
  const click = async (c) => {
    if (c.box[1] > 633 - 4 || c.box[1] < 4) { report.scrolls += 1; await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'instant' }), c.box[1] - 316); await page.waitForTimeout(60); return false; }
    await page.mouse.click(c.box[0], c.box[1]); return true;
  };
  while (Date.now() - t0 < o.maxMs) {
    const s = await look(page);
    if (!s) { await page.waitForTimeout(300); continue; }
    if (!/^\/c\//.test(s.url)) { report.left = s.url.replace(/eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{16,}/, '<hub>'); break; }
    const on = (s.ctl || []).filter((c) => !c.dis && !c.hid && c.box[2] > 4);
    const by = (id) => on.find((c) => c.id === id);
    const key = `${s.screen}|${s.text.slice(0, 60)}|${on.map((c) => c.id).join()}|${s.dots}|${s.gap}`;
    if (key !== lastKey) {
      lastKey = key; lastChange = Date.now();
      if (report.screens[report.screens.length - 1] !== s.screen) {
        report.screens.push(s.screen); n += 1;
        const below = on.filter((c) => c.box[1] + c.box[3] / 2 > s.h).map((c) => c.id || c.t);
        if (below.length) report.cut.push(`${s.screen}: ${below.slice(0, 4).join(', ')} (${s.sh}px)`);
        if (s.sw > s.w + 1) anomaly(`sideways scroll on ${s.screen}`);
        await shot(page, `${o.tag}-${String(n).padStart(2, '0')}-${String(s.screen)}`);
        if (o.trace) o.say(`   [${s.screen}] ${s.text} {${on.map((c) => c.id || c.t).slice(0, 12).join(' ')}}`);
      }
    }
    if (Date.now() - lastChange > 60000) { anomaly(`stuck 60 s on "${s.screen}": ${s.text}`); await shot(page, `${o.tag}-stuck`); break; }
    report.last = { screen: s.screen, text: s.text, lang: s.lang, dir: s.dir, font: s.font };

    // the end of a game: its card (never a number), with Home / the next thing
    if (by('wqc-fhome') || by('wqc-fnext') || /^(.*-end|.*-done|end|done|result|.*-result)$/.test(String(s.screen)) && (by('wqc-menu') || by('wqc-again'))) { ended = true; report.endScreen = s.screen; report.endText = s.text; break; }
    if (s.screen === 'error') { report.errorText = s.text; anomaly(`error screen: ${s.text}`); break; }

    let c = null;
    if ((c = by('wqc-help-no'))) await click(c);                       // "Is someone helping you today?" -> on my own
    else if ((c = by('wqc-notice-ok'))) await click(c);                // the microphone notice -> Got it
    else if (s.dots > 0 && on.some((x) => /^wq-g1-t/.test(x.id))) {   // how many dots?
      const t = on.find((x) => /^wq-g1-t/.test(x.id) && Number(western(x.t)) === s.dots) || on.find((x) => /^wq-g1-t/.test(x.id));
      await click(t);
    } else if (by('wqc-a') && by('wqc-b')) {                            // which is bigger?
      const a = by('wqc-a'), b = by('wqc-b');
      await click(Number(western(a.t).replace(/\D/g, '')) >= Number(western(b.t).replace(/\D/g, '')) ? a : b);
    } else if (on.some((x) => /wqc-k/.test(x.cls)) && s.seq.length) {  // the missing number: type it, then the tick
      const nums = s.seq.map((x) => (x.gap ? null : Number(western(x.t).replace(/\D/g, ''))));
      const gi = nums.indexOf(null);
      let want = null;
      if (gi >= 0) {
        const known = nums.map((v, i) => [i, v]).filter((x) => x[1] != null);
        const step = known.length >= 2 ? (known[1][1] - known[0][1]) / (known[1][0] - known[0][0]) : 1;
        want = String(known[0][1] + step * (gi - known[0][0]));
      }
      const have = western(s.gap).replace(/\D/g, '');
      if (want == null) { const sk = by('wqc-skip1'); if (sk) await click(sk); }
      else if (o.keys) {
        // the Chromebook's own keyboard: digits, Backspace, Enter (no click on the on-screen keys at all)
        report.typed = (report.typed || 0) + 1;
        if (have === want) await page.keyboard.press('Enter');
        else if (!want.startsWith(have)) await page.keyboard.press('Backspace');
        else await page.keyboard.press(want.charAt(have.length));
      }
      else if (have === want) { const ok = by('wqc-kok'); if (ok) await click(ok); }
      else if (!want.startsWith(have)) { const del = on.find((x) => x.k === 'del'); if (del) await click(del); }
      else { const k = on.find((x) => x.k === want.charAt(have.length)); if (k) await click(k); }
    } else if (on.some((x) => /^wqc-o\d/.test(x.id))) {                // a story question: the first answer offered
      listenStart = 0;
      await click(on.find((x) => /^wqc-o\d/.test(x.id)));
    } else if ((c = by('wqc-story-along') || by('wqc-along-ra'))) await click(c); // the story room: hear it from Jugnu first
    else if ((c = by('wqc-go'))) await click(c);
    else if ((c = by('wqc-qa'))) await click(c);
    else if (/read|live|mic/.test(String(s.screen)) && !by('wqc-go')) {
      // reading aloud: the rig's microphone speaks; when the child has read for a while, Done/Stop if the page has one
      if (!readStart) readStart = Date.now();
      const stop = by('wqc-stop') || by('wqc-done') || by('wqc-stop-yes') || by('wqc-rf');
      if (stop && Date.now() - readStart > o.speakMs) { readStart = 0; await click(stop); }
    } else {
      const next = by('wqc-next') || by('wqc-again') && null || on.find((x) => /wq-go/.test(x.cls) && !/wqc-menu|wq-home/.test(x.id));
      if (next) await click(next);
    }
    await page.waitForTimeout(260);
  }
  page.off('request', onReq); page.off('response', onRes);
  if (!ended && !report.anomalies.length) anomaly(`did not reach an end card in ${Math.round(o.maxMs / 60000)} min (last screen "${report.last && report.last.screen}")`);
  const m = await media(page);
  report.media = { tried: m.length, played: m.filter((x) => x.ok === true).length, failed: [...new Set(m.filter((x) => x.ok !== true && x.ok !== null).map((x) => `${x.src.split('/').slice(-2).join('/')} (${x.ok})`))].slice(0, 8) };
  report.posts = report.posts.map((x) => `${x.p.replace(/eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{16,}/, '<hub>')}=${x.status == null ? 'no answer' : x.status}${x.local ? '(device)' : ''}`);
  report.ended = ended;
  report.ms = Date.now() - t0;
  return report;
}

/** The Games door's rows for a child: [{ section, name, kind, item, href }] (the big flight and the video quizzes too). */
export async function doorRows(page, kid) {
  await page.goto(`${BASE}/h/${kid.token}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('a.wq-door[href="#games"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  for (const t of ['Skip', 'چھوڑیں']) await page.getByText(t, { exact: true }).first().click({ timeout: 600 }).catch(() => {});
  await page.locator('a.wq-door[href="#games"]').first().click();
  await page.waitForFunction(() => document.querySelector('section.wq-droom') && !document.querySelector('.wq-dskel'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page.evaluate(() => [...document.querySelectorAll('section.wq-droom .wq-drow')].map((el) => ({ name: (el.querySelector('b') || el).innerText.replace(/\s+/g, ' ').trim(), kind: el.getAttribute('data-kind'), item: el.getAttribute('data-item'), href: el.getAttribute('href') })));
}
