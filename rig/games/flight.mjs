// A child playing one part of Jugnu's big flight (/sa/play.html, the EGRA/EGMA battery in game mode), with the mouse:
// every screen is read from the engine's own view (window.__sae.runner.view()) and answered by clicking what is drawn.
//
//   openMap(page, kid)                      home -> Games -> Jugnu's big flight (the sea map)
//   startPart(page, part)                   the island's intro -> Start -> /sa/play.html
//   playPart(page, opts) -> report          plays the part to its last screen
//   backToMap(page)                         the last screen's button -> the map's result card
//
// opts: { lang, say(text), trace, speakMs (how long the "child" reads a story aloud), answerMs (a spoken answer),
//         wrongFirst (answer the first n scored items of each task wrong, to see a stop rule), maxMs }
// report: { tasks: [{ id, mode, phases, items, ms }], media: {tried, played, failed: [...]}, anomalies: [...], shots }
import { shot, media, fit, BASE } from './lib.mjs';

const scrub = (s) => String(s || '').replace(/eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{16,}/g, '<hub>').replace(/kid(=|%3D)[0-9a-f]{16}/g, 'kid$1<chip>');

export async function openMap(page, kid, { viaHome = true } = {}) {
  if (viaHome) {
    await page.goto(`${BASE}/h/${kid.token}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('a.wq-door[href="#games"]', { timeout: 30000 });
    await page.waitForTimeout(1200);
    for (const t of ['Skip', 'چھوڑیں']) await page.getByText(t, { exact: true }).first().click({ timeout: 600 }).catch(() => {});
    await page.locator('a.wq-door[href="#games"]').first().click();
    await page.locator('a.wq-drow[data-item="bigtest"]').first().click({ timeout: 25000 });
  }
  await page.waitForSelector('.sg-map', { timeout: 30000 });
  await page.waitForTimeout(800);
  return page.evaluate(() => ({
    islands: [...document.querySelectorAll('.sg-isl, .sg-tower')].map((b) => ({ k: b.dataset.k, done: b.classList.contains('is-done'), next: b.classList.contains('is-next'), open: b.classList.contains('is-open'), label: b.innerText.replace(/\s+/g, ' ').trim() })),
    say: (document.querySelector('.sg-say') || {}).innerText || '', lang: document.documentElement.lang, dir: document.documentElement.dir,
  }));
}

export async function startPart(page, part) {
  // the next island bobs for ever, so Playwright never sees it "stable": click where it is, as a child does
  await page.locator(`.sg-isl[data-k="${part}"], .sg-tower[data-k="${part}"]`).first().click({ force: true });
  await page.waitForSelector('[data-tap="run"], .sg-note', { timeout: 30000 });
  const intro = await page.evaluate(() => ({ text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300), stones: [...document.querySelectorAll('.sg-stone')].map((s) => s.innerText.replace(/\s+/g, ' ').trim()), run: !!document.querySelector('[data-tap="run"]') }));
  if (!intro.run) return { ...intro, started: false };
  await page.locator('[data-tap="run"]').first().click();
  await page.waitForURL(/\/sa\/play\.html/, { timeout: 30000 }).catch(() => {});
  return { ...intro, started: /\/sa\/play\.html/.test(page.url()), url: scrub(page.url()) };
}

/** What is on the screen now: the runner's view and the controls a child could click. */
const look = (page) => page.evaluate(() => {
  const e = window.__sae;
  let v = null;
  try { v = e && e.runner ? e.runner.view() : null; } catch (x) { v = null; }
  const vis = (b) => b && b.offsetParent !== null;
  const box = (b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width), Math.round(r.height)]; };
  // is the control really the thing under its own middle? (a fixed bar or a "scroll down" cue can lie over it)
  const hit = (b) => { const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; if (y < 0 || y >= innerHeight || x < 0 || x >= innerWidth) return false; const e = document.elementFromPoint(x, y); return !!e && (e === b || b.contains(e)); };
  const ctl = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((b) => ({ hit: hit(b), t: (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30), al: b.getAttribute('aria-label') || '', v: b.getAttribute('data-value'), k: b.getAttribute('data-key'), i: b.getAttribute('data-i'), dis: !!b.disabled, hid: b.hasAttribute('hidden'), box: box(b), cls: String(b.className) }));
  const t = v && v.task;
  const mount = document.getElementById('sae-root');
  const scr = mount && mount.querySelector('.sae-screen');
  return {
    url: location.pathname + location.search.slice(0, 40),
    phase: v ? v.phase : null,
    task: t ? { id: t.id, mode: t.mode, kind: t.kind, lim: t.time_limit_s || null, n: (t.items || []).length } : null,
    item: v && v.item ? { id: v.item.id, target: v.item.target, ti: v.item.target_index, options: v.item.options || null } : null,
    ii: v ? v.item_index : null, cell: v ? v.cell_index : null, left: v ? v.time_left_ms : null,
    practice: v && v.practice ? { target: v.practice.target, ti: v.practice.target_index, options: v.practice.options || null } : null,
    scrCls: scr ? scr.className : '', refused: !!document.querySelector('.sae-refused'), fail: (document.querySelector('.sa-fail') || {}).innerText || null,
    primary: ctl('.sae-primary'), next: ctl('.sa-next'), secondary: ctl('.sae-secondary'), pics: ctl('.sae-pic'), opts: ctl('.sae-opt'), bubbles: ctl('.sae-bubble'),
    keys: ctl('.sae-keypad .sae-key, .sae-letters .sae-key'), star: ctl('.sae-star'), words: ctl('button.sae-word'), mic: ctl('.sae-mic-btn'), more: ctl('.sae-more'), replay: ctl('.sae-replay'),
    // what has been typed: the answer box of a sum or a word, or the gap tile of a number row
    typed: (() => { for (const q of ['.sae-typed', '.sae-seq .sae-gap', '.sae-gap', '.sae-sum-blank']) { const e = [...document.querySelectorAll(q)].find(vis); if (e) return e.innerText || ''; } return ''; })(),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
    dir: mount ? mount.getAttribute('dir') : null, sync: (document.querySelector('.sae-sync') || { getAttribute() { return null; } }).getAttribute('data-state'),
    w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
  };
}).catch(() => null);

// A click where the control is. One below (or above) the fold cannot be clicked: the child has to scroll first, and
// so does the rig (a wheel turn), counted in scrolls{} — on a 1366x633 Chromebook page that is a layout that does not fit.
const scrolls = {};
let viewH = 633;
let where = '';
const click = async (page, c) => {
  if (c.hit === false) {
    // below the page, or under a fixed bar: a turn of the wheel over the screen, then look again
    scrolls[where] = (scrolls[where] || 0) + 1;
    await page.mouse.move(683, Math.round(viewH / 2));
    await page.mouse.wheel(0, c.box[1] > viewH / 2 ? 220 : -220);
    await page.waitForTimeout(380);
    return 'scrolled';
  }
  await page.mouse.click(c.box[0], c.box[1]);
  return 'clicked';
};
const usable = (list) => (list || []).filter((c) => !c.dis && !c.hid && c.box[2] > 4 && c.box[3] > 4);

export async function playPart(page, opts = {}) {
  const o = { lang: 'en', say: () => {}, trace: false, speakMs: 9000, answerMs: 2500, wrongFirst: 0, maxMs: 25 * 60 * 1000, tag: 'part', shots: true, keys: false, ...opts };
  const t0 = Date.now();
  const report = { tasks: [], anomalies: [], phases: {}, layout: [], shots: [] };
  // which check word a clip says (the sound check: "tap the picture Jugnu says")
  const battery = await page.evaluate(async () => { const f = new URLSearchParams(location.search).get('form'); const r = await fetch('/sa/batteries/' + f + '.json'); return r.ok ? r.json() : null; }).catch(() => null);
  const wordOfClip = {};
  for (const w of (battery && battery.check_words) || []) for (const l of ['en', 'ur']) if (w.audio && w.audio[l]) wordOfClip[w.audio[l].split('/').pop()] = w;
  let lastKey = '', lastChange = Date.now(), cur = null, wrongLeft = 0, recStart = 0, oralStart = 0, n = 0, typedFor = '';
  const seen = new Set();
  const anomaly = (a) => { if (!report.anomalies.includes(a)) { report.anomalies.push(a); o.say(`   ! ${a}`); } };

  while (Date.now() - t0 < o.maxMs) {
    const s = await look(page);
    if (!s) { await page.waitForTimeout(300); continue; }
    if (!/\/sa\/play\.html/.test(s.url)) { report.left = scrub(s.url); break; }
    if (s.fail) { anomaly(`the page failed to open: "${s.fail}"`); break; }
    if (s.refused) { anomaly(`the engine refused to start: "${s.text}"`); break; }
    const key = `${s.phase}|${s.task && s.task.id}|${s.ii}|${s.cell}|${s.scrCls}|${s.primary.map((c) => c.t + c.dis).join()}|${s.opts.length}|${s.keys.length}|${s.typed}`;
    if (key !== lastKey) { lastKey = key; lastChange = Date.now(); }
    const tid = s.task ? s.task.id : null;
    viewH = s.h; where = `${tid || s.phase}:${s.phase}`;
    if (s.phase && tid && (!cur || cur.id !== tid)) {
      cur = { id: tid, mode: s.task.mode, kind: s.task.kind, timed: s.task.lim, items: 0, phases: [], at: Date.now() };
      report.tasks.push(cur);
      wrongLeft = o.wrongFirst;
      o.say(` · ${tid} (${s.task.mode}${s.task.lim ? ', ' + s.task.lim + ' s' : ''}, ${s.task.n} items)`);
    }
    if (cur && s.phase && cur.phases[cur.phases.length - 1] !== s.phase) cur.phases.push(s.phase);
    report.phases[s.phase] = (report.phases[s.phase] || 0) + 1;
    const stamp = `${s.phase}|${s.task && s.task.mode}|${s.scrCls.replace(/\s+/g, '.')}`;
    if (!seen.has(stamp)) {
      seen.add(stamp); n += 1;
      if (s.sw > s.w + 1) anomaly(`sideways scroll on ${stamp}: page ${s.sw}px wide in a ${s.w}px window`);
      // a control is "cut off" when its lower edge is below the page or something lies over its middle
      const cut = ['opts', 'keys', 'pics', 'primary', 'next', 'star', 'words', 'mic'].map((k) => [k, (s[k] || []).filter((c) => !c.hid && !c.dis && c.box[3] > 4 && (c.box[1] + c.box[3] / 2 > s.h + 1 || c.hit === false)).length, (s[k] || []).length]).filter((x) => x[1] > 0).map((x) => `${x[1]} of ${x[2]} ${x[0]}`);
      report.layout.push({ at: stamp, sh: s.sh, h: s.h, cut });
      if (o.shots) report.shots.push(await shot(page, `${o.tag}-${String(n).padStart(2, '0')}-${String(s.phase)}-${(tid || '').replace(/\W/g, '_')}`));
      if (o.trace) o.say(`   [${stamp}] ${s.text}`);
    }
    // nothing has changed for a long while and nothing is clickable: a dead screen
    if (Date.now() - lastChange > 75000) { anomaly(`stuck 75 s on ${s.phase} ${tid || ''}: "${s.text}"`); await shot(page, `${o.tag}-stuck-${s.phase}`); break; }

    const prim = usable(s.primary)[0];
    const act = async () => {
      switch (s.phase) {
        case 'audio_check': {
          if (prim && !s.pics.length) return click(page, prim); // "Check your headphones" -> Try again
          const heard = (await media(page)).filter((m) => wordOfClip[m.src.split('/').pop()]).pop();
          const w = heard ? wordOfClip[heard.src.split('/').pop()] : null;
          const pic = w ? usable(s.pics).find((p) => p.al === w[o.lang] || p.t.indexOf(w[o.lang]) >= 0) : null;
          if (pic) return click(page, pic);
          return null; // Jugnu has not said the word yet
        }
        case 'warmup': { const b = usable(s.bubbles)[0]; return b ? click(page, { ...b, hit: true }) : (prim ? click(page, prim) : null); }
        case 'keypad_warmup': {
          // "press each number": every key once, then whatever it asks next
          const k = usable(s.keys).find((x) => /^\d$/.test(x.k || '') && !/is-(done|hit|on)/.test(x.cls));
          if (prim) return click(page, prim);
          return k ? click(page, k) : null;
        }
        case 'mic_check': {
          const mic = usable(s.mic)[0];
          if (mic) return click(page, mic);
          return prim ? click(page, prim) : null;
        }
        case 'oral_practice': {
          if (!oralStart) oralStart = Date.now();
          if (Date.now() - oralStart < o.answerMs) return null;
          const b = prim || usable(s.next)[0];
          if (b) { oralStart = 0; return click(page, b); }
          return null;
        }
        case 'practice':
        case 'running': {
          const it = s.phase === 'practice' ? s.practice : s.item;
          const mode = s.task && s.task.mode;
          if (mode === 'tap') {
            if (s.opts.length && it) {
              let want = usable(s.opts).find((c) => String(c.v) === String(it.target));
              if (s.phase === 'running' && wrongLeft > 0) { const w = usable(s.opts).find((c) => String(c.v) !== String(it.target)); if (w) { want = w; wrongLeft -= 1; } }
              if (want) { const did = await click(page, want); if (did === 'clicked' && s.phase === 'running') cur.items += 1; return did; }
              return null;
            }
            if (s.words.length && it && typeof it.ti === 'number') { const w = usable(s.words).find((c) => Number(c.i) === it.ti); if (w) return click(page, w); }
            // a one-cell read-aloud screen in tap clothing: say it, then Next
            const nx = usable(s.next)[0] || prim;
            return nx ? click(page, nx) : null;
          }
          if (mode === 'keypad' || mode === 'keyboard') {
            if (!it || it.target == null) { const nx = prim || usable(s.next)[0]; return nx ? click(page, nx) : null; }
            let want = String(it.target);
            if (s.phase === 'running' && wrongLeft > 0 && typedFor !== `${tid}|${s.ii}`) want = mode === 'keypad' ? String(Number(want) + 1) : 'zz';
            const have = (s.typed || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
            const goal = want.toLowerCase();
            if (have === goal) {
              if (o.keys) { if (s.phase === 'running') cur.items += 1; typedFor = `${tid}|${s.ii}`; await page.keyboard.press('Enter'); return null; }
              const ok = usable(s.keys).find((x) => x.k === 'ok');
              if (ok) { if (s.phase === 'running') { cur.items += 1; if (wrongLeft > 0) wrongLeft -= 1; } typedFor = `${tid}|${s.ii}`; return click(page, ok); }
              return prim ? click(page, prim) : null;
            }
            if (!goal.startsWith(have)) { const del = usable(s.keys).find((x) => x.k === 'del'); return del ? click(page, del) : null; }
            const ch = goal.charAt(have.length);
            if (o.keys) { await page.keyboard.press(ch); return null; } // the Chromebook's own keyboard
            const k = usable(s.keys).find((x) => x.k === ch);
            if (k) return click(page, k);
            return prim ? click(page, prim) : null;
          }
          if (mode === 'record') {
            // the passage: read aloud (the rig's microphone is speaking), scroll on if there is more, then the star
            if (!recStart) recStart = Date.now();
            const more = usable(s.more)[0];
            if (more && Date.now() - recStart > 2500) { await click(page, more); return null; }
            if (Date.now() - recStart < o.speakMs) return null;
            const star = usable(s.star)[0] || prim;
            if (star) { recStart = 0; cur.items += 1; return click(page, star); }
            return null;
          }
          if (mode === 'oral') {
            if (!oralStart) oralStart = Date.now();
            if (Date.now() - oralStart < o.answerMs) return null;
            const b = usable(s.next)[0] || prim;
            if (b) { oralStart = 0; if (s.phase === 'running') cur.items += 1; return click(page, b); }
            return null;
          }
          return prim ? click(page, prim) : null;
        }
        case 'last_word': { const w = usable(s.words); if (w.length) return click(page, w[Math.min(w.length - 1, 12)]); return prim ? click(page, prim) : null; }
        case 'battery_end': return 'end';
        default: return prim ? click(page, prim) : null; // battery_intro, instruction, ready, task_end, silence_reminder
      }
    };
    const r = await act();
    if (r === 'end') break;
    await page.waitForTimeout(s.phase === 'running' && s.task && (s.task.mode === 'tap' || s.task.mode === 'keypad' || s.task.mode === 'keyboard') ? 160 : 350);
  }
  if (Date.now() - t0 >= o.maxMs) anomaly(`not finished after ${Math.round(o.maxMs / 60000)} min`);
  const m = await media(page);
  report.media = { tried: m.length, played: m.filter((x) => x.ok === true).length, failed: [...new Set(m.filter((x) => x.ok !== true && x.ok !== null).map((x) => `${x.src} (${x.ok})`))].slice(0, 12) };
  report.results = await page.evaluate(() => { try { return window.__sae.runner.results().map((r) => ({ task: r.task_id, stop: r.stop_reason, correct: r.correct, incorrect: r.incorrect, attempted: r.attempted, scored_on: r.scored_on, audio: r.audio || null })); } catch (e) { return []; } }).catch(() => []);
  report.sync = await page.evaluate(() => { const d = document.querySelector('.sae-sync'); return d ? d.getAttribute('data-state') : null; }).catch(() => null);
  report.end = await look(page);
  report.fit = await fit(page);
  report.ms = Date.now() - t0;
  report.scrolls = { ...scrolls };
  for (const k of Object.keys(scrolls)) delete scrolls[k];
  return report;
}

/** The last screen's button: back to the sea map, which shows the part's card. */
export async function backToMap(page, { waitMs = 30000 } = {}) {
  const s = await look(page);
  const b = s && (usable(s.primary)[0] || usable(s.secondary)[0]);
  if (b) await click(page, b);
  const ok = await page.waitForURL(/\/sa-game\//, { timeout: waitMs }).then(() => true, () => false);
  if (!ok) return { back: false, text: await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '') };
  await page.waitForSelector('#sg-card, .sg-map', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page.evaluate(() => ({ back: true, card: !!document.getElementById('sg-card'), text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 320), rows: [...document.querySelectorAll('.sg-rows > div')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()) }));
}

export { look, scrub };
