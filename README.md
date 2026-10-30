# Jugnu offline on Chromebooks (pilot)

Jugnu is NIETE's learning experience for children in Islamabad (ICT) schools: class quizzes, storybooks read aloud,
a number game and a reading game. This pilot proves it can run **with no internet on a school Chromebook**, and that
everything a child does reaches the server **by itself once the Chromebook is back online**.

It is a pilot, not the product: it sits in front of a running Jugnu portal as a small proxy and adds an offline
layer, plus a **"Who's playing?"** screen that lets a child find themselves in their school's class list.
It runs as a normal web service (Railway), so a Chromebook just opens its https address. Nothing in Jugnu itself was changed. What Jugnu needs so that this works without the proxy is listed under
[What is left](#what-is-left).

## What is proven (28–30 Oct 2026)

On a real ICT Chromebook (2018–19 education model, Celeron N4000 class, 2 cores, 1366×768, ChromeOS 156), signed in
to one shared account:

| Test | Result |
|---|---|
| "Get ready for offline" | 2,334 files saved in ~7 min (app, voices, 10 storybooks, 2 quizzes, number game, reading game); 72 MB on the device's drive |
| New child, network off from the first tap | Typed a name, played all 7 questions and the "fix it with Jugnu" round, reached "QUIZ COMPLETE" |
| While offline | The child was **not** in the database; their 7 answers waited on the Chromebook |
| Back online | **5 s later** the database held the child: completed, 2/7, 7 answers |
| Child home, number game, reading game, storybook with narration | All opened and played with the network off |

"Network off" means the server dropped every connection **and** the Chromebook's browser was offline
(`navigator.onLine === false`), so nothing could come from the internet.

## Who's playing? (class lists on a shared Chromebook)

1. The child taps their **class**, then their **section**.
2. They tap their **name** in that section's list (first name + roll number), or **search** by name or roll number.
3. Not on the list? **"I'm not on the list"** → they type their name → Jugnu suggests close matches from that section
   (**"Is one of these you?"**) → else **"Add me"**: they are added with their class and section and play at once.
4. The quiz then starts as that child without asking again (the pilot answers Jugnu's own "who is playing" screens).
5. **Next child** goes back to step 1.

Every pick, every "Add me" and every quiz start is written on the Chromebook first and sent to the server whenever
there is a connection (`/__cb/identity`, `/__cb/added`), so each result can be joined to the roster child. The
children who added themselves are listed at `/__cb/added?key=…` for a teacher or admin to match to the roster.

The school's class list is loaded once by Get ready and kept on the device, so all of this works offline. It holds
**first names and roll numbers only** (no family names, phones or dates of birth), and the server gives it only to a
Chromebook that has the **device key**, which the Chromebook receives once from its setup link (`/cb?key=…`).

## How it works

```
Chromebook (Chrome)                          this repo                       Jugnu portal
 ├─ test page /cb  ── Get ready ──►  server.mjs (proxy, :8791) ──────────►  pages + /api/wq/*
 ├─ offline worker (pilot-sw.js)       • serves pilot-sw.js, boot.js, cb.html
 │    • keeps every page and file      • adds boot.js to every page
 │    • offline: answers from the kept copy   • logs requests (logs/requests.jsonl)
 │    • starts quizzes on the device   • OFFLINE switch: touch ./OFFLINE = drop everything
 │    • outbox of answers (IndexedDB) ──── synced when online ──────────►  session, answers, finish
 └─ boot.js: registers the worker, status badge, Home button
```

- **`pilot-sw.js`** (the offline worker): pages and data network-first with a 4 s limit, then the kept copy; media
  kept whole and served in byte ranges; a quiz started with no network gets a local session, its answers go to an
  outbox, and the worker replays them to the real API when the network is back (the page then shows the server's
  result). Server errors count as "no network" when a kept copy exists. Home falls back to this device's child home.
- **`cb.html`** (the test page): "Get ready for offline" installs the worker and saves the app, every voice clip,
  the storybooks, the quizzes and both games; then shows links and a "waiting to send / sent" panel.
- **`server.mjs`**: the proxy. `UPSTREAM` is the Jugnu portal it sits in front of.
- **`rig/`**: Playwright scripts that run a Chromebook-shaped Chrome (1366×768, ChromeOS user agent) on a laptop.
- **`device/`**: scripts that drive a real Chromebook's Chrome over its remote-debugging port (test unit only).

## Run it

Settings (environment variables; on a laptop, files work too):

| Variable | What |
|---|---|
| `UPSTREAM` | the Jugnu portal this sits in front of |
| `CB_CONFIG` | JSON as in `cb-config.example.json` (else `./cb-config.json`) |
| `ROSTER_B64` | the school's class list, gzip + base64 of `{school, classes:[{grade, section, students:[{id, name, name_ur, roll}]}]}` (else `ROSTER_FILE`, a path to that JSON) |
| `DEVICE_KEY` | the key a Chromebook must present to get the class list and send who played |

**As a service (Railway or any host):** deploy this repo with those variables set (the start command is
`node server.mjs`, it listens on `PORT`), attach a volume at `/app/logs` so who-played records survive a redeploy,
and give each Chromebook its setup link once: `https://<service>/cb?key=<DEVICE_KEY>`.

```bash
npm install                                               # browser drivers for the test scripts (dev only)
UPSTREAM=https://<jugnu portal> node server.mjs          # http://localhost:8791
cp cb-config.example.json cb-config.json                   # a child home link and two class quiz codes
```

**On a laptop:** `node rig/cb-check.mjs <child home token>` runs Get ready, turns the network off and opens every
link; `node rig/run-quiz.mjs <code> "<name>" [--keep] [--offline] [--new-child]` plays a quiz;
`node rig/tour.mjs <token> online|offline` tours storybook, video, number game and reading game;
`node rig/who-check.mjs <device key> "<new name>"` runs Who's playing? online (pick a child) and offline (add me).
For a true offline run, `touch OFFLINE` (the server drops every connection) — a browser's own offline switch does
not reach the worker's requests. `rm OFFLINE` to come back.

**On a Chromebook by hand:** sign in to the shared school account (not Guest), open `https://<service>/cb?key=<key>` once, tap
**Get ready for offline**, wait for "Ready", switch Wi-Fi off and play. Switch Wi-Fi on: section 3 shows the quiz
going from "Waiting to send" to "Sent".

**On a Chromebook, automated:** a test unit in developer mode with debugging features, `--remote-debugging-port=9222`
in `/etc/chrome_dev.conf`, and `ssh -N -L 9333:127.0.0.1:9222 root@<chromebook>`. Then
`CB_IP=<chromebook> node device/device-ready.mjs <token>` and `node device/device-offline.mjs <token> "<name>"`
(set `DATABASE_URL`, read-only, to have it check the results arrive). Never put a child's device in developer mode.

Child home links are signed by Jugnu: `tools/sign-hub.mjs` signs one for a test student.

## Learning analytics

Every answer is saved on the Chromebook first, then sent in batches whenever there is a connection; nothing waits
for a person to press anything. A quiz played offline arrives as a normal session with its answers and score, so
the existing reports read it like any other. Today this covers **quizzes**. Storybook reading events, game results
and the page's usage events are not yet kept while offline, and a synced session is stamped with the time it
arrived, not the time it was played. Both are open issues.

## What is left

The remaining work is filed as issues in this repo. In short:

1. Build the offline worker into Jugnu itself (precache on install; "Get ready" per grade), so no proxy is needed.
2. Quiz sessions that start on the device, accepted by the server in batches with the time they were played.
3. Shared-device mode: a Chromebook set to one class, children tap their name, finishing goes back to the list.
4. Lesson videos the device can keep (today they are 6-hour signed links on another site, so they are not saved).
5. Nothing live during a child's turn: every clip pre-recorded; read-aloud recorded offline and scored later.
6. A Chromebook screen: layout for 1366×633, "saved on this device" (not "this phone"), no WhatsApp step.
7. Offline analytics for storybooks, games and usage events; the time a quiz was played.
8. Proof that saved content survives a restart in a signed-in account.
9. The whole library on the device: all storybooks and voices (~0.5 GB) plus one grade's videos (1–2 GB).
10. Fleet measurement: per device, ready for offline, last sync, offline plays, sync delay.

## What we learned

- **Guest mode erases everything when the session ends** (exit, restart, shutdown, flat battery). Nothing saved in
  Guest survives a restart. A shared school account per school, signed in once on each Chromebook, keeps everything
  on the drive; children never sign in to Google, they pick their name in Jugnu.
- **A child's home link locks to the first device that opens it**, and every Guest session counts as a new device.
- **Cutting a test Chromebook's network with its own firewall makes it unreachable over SSH**, even from the same
  Wi-Fi. Offline tests cut the server (`OFFLINE`) and set the browser offline instead.
- **A browser's offline emulation does not reach a service worker's requests**: test offline at the server.
- **On a first visit nothing is kept** until the worker is in charge; the page hands it everything it loaded.
- These Chromebooks give a page 1366×633: anything below that line needs scrolling.

## Licence

Apache 2.0. Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).
