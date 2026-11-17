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
| Who's playing?, served from the Railway service (no tunnel) | Online: Class 3 › A › a child from the class list; the quiz started as that child without asking. Offline: Class 2 › B › "I'm not on the list" › Add me › the whole quiz. While offline the child was on neither the server's added list nor in the database; after reconnecting, both, with the quiz completed (2/7, 7 answers) |

"Network off" means the server dropped every connection **and** the Chromebook's browser was offline
(`navigator.onLine === false`), so nothing could come from the internet.

## What is proven on the laptop rig (17 Nov 2026), waiting for the Chromebook

A Chromebook-shaped Chrome (1366×768, ChromeOS user agent, its own profile) against sandbox Jugnu. The real
Chromebook was off the network that day; every line below is a script in `rig/` to run on it.

| Test | Result |
|---|---|
| **The child home never goes stale** (`rig/home-check.mjs`, 14 of 14; `--expiry`, 9 of 9) | The server signs each Chromebook its own home link. An **expired** link opened online is sent to a freshly signed one and the home opens. With the network off and **every link on the device expired** (the stored one and the one inside each saved page), `/cb/home`, the Stories door and a different expired link all open from the saved copy; nothing reached the server. Back online: a fresh link. A link locked to another device recovers by itself. On a server that cannot sign (`rig/nokey-check.mjs`, 4 of 4) an expired link still opens the saved home |
| **Get ready** (`rig/ready-check.mjs`) | Fresh device, closed and reopened in the middle: it carried on from the step that was running and said "Ready" with 3,072 files confirmed on the drive, 0 missing (a run with no interruption: 130 s). Pressed again on a ready device: about 100 s, 9,801 files confirmed. A quiz its teacher had closed was named, not silently skipped |
| **Lesson videos** (`ready/videos.js`, `rig/videos-check.mjs`, 14 of 14) | Class 2: all 82 lessons (604 MB of video, 5,815 quiz voice clips, 77 MB) saved in 9½–12 minutes at about 1 MB/s. With the network off: a Class 2 child is picked, the Videos door opens on Class 2 with all 82 lessons and their pictures, lessons from across the class **play from the saved copy and scrub ahead** (1280×720), and the questions after each open. Nothing came from the server or from R2 |
| **Check this Chromebook** (the start page's button; `rig/ready-check.mjs --check --check-offline`) | 112 things opened from the device alone in about 75 s (start page, Who's playing?, home, three doors, quiz, 6 games, 11 storybooks, 82 lesson videos each opened by a real player), and the same with the network truly off (0 requests answered) |
| **The check finds things** (`rig/check-finds.mjs`, 7 of 7) | A lesson's video, a storybook's page picture and the Games door's list were deleted from the drive: the check named each. Get ready again put them back; the check was clean |
| **Storybook option voices** (`npm test`) | The first Get ready with honest counts showed 126 storybook sound files "not on the server". Cause: the file-name pattern cut `q1o2-….ogg` down to `o2-….ogg`. Fixed: 356 files for 11 books (was 206), none missing |
| **Room on the drive** (`rig/storage-audit.mjs`) | Class 2 with everything else: 731 MB really on the drive, 740 MB charged by the browser. (Before the fix, 82 lesson pictures kept as unreadable copies were charged 572 MB.) |
| **A picked child's own home** (`rig/perchild-check.mjs`, 6 of 6, `HOME_PER_CHILD=1`) | A class-list child Jugnu knows gets a home signed for them alone; one Jugnu does not know gets this Chromebook's home, with no empty page in between. Not yet shown with two different real children: sandbox has no class list whose ids are its own students |

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
- **`home-routes.mjs`, `hub-sign.mjs`**: the server signs each Chromebook its own child home link
  (`POST /__cb/home`), so the home never goes stale; `/cb/home` is the one address that always opens it.
- **`media-routes.mjs`**: lesson videos (and their quiz clips) fetched through this site, so a Chromebook can keep them.
- **`ready/`**: Get-ready steps, one file per area (`ready/README.md`); `ready/videos.js` saves lesson videos.
- **`docs/HOME-AND-VIDEOS.md`**: why the home went stale, who-is-playing attribution, the class-link
  recommendation, how videos are served and what Jugnu should change.
- **`rig/`**: Playwright scripts that run a Chromebook-shaped Chrome (1366×768, ChromeOS user agent) on a laptop.
- **`device/`**: scripts that drive a real Chromebook's Chrome over its remote-debugging port (test unit only).

## Storybooks (Stories door)

A storybook has four parts, and each has its own way of working with no network:

| Part | Online | With no network |
|---|---|---|
| Jugnu reads the page, the words light | the page's stored voice clip and its word times, from Jugnu | the same clip and times from this Chromebook (Get ready saves every book: all grades, English and Urdu) |
| **Your turn**: the child reads aloud and is graded | live: the microphone is streamed to Jugnu's speech service, each word lights as it is heard | **scored on the Chromebook** (`speech/`): "Listening…", the words it heard light up, then words and stars (never a speed). The recording is kept and **scored again online** after reconnecting; that score is the one the server gets. Where the Chromebook cannot score, the read is saved and the page says "Saved! Jugnu will listen when the internet is back" |
| Questions, and the look-back page after a wrong pick | the server checks each tap | checked on the Chromebook from the answers Get ready left on it |
| What the child did (pages heard, pages read, questions, finished) | sent as it happens | kept on the Chromebook, sent by itself when the network is back |

- **`sw-stories.js`** (the worker's storybook part): keeps each shelf and book under a name that does not hold the
  child's home link, so a book saved under one link opens under the next (links last 7 days); keeps every story step
  that could not be sent (IndexedDB `cb-stories`); answers a question's tap from the saved answers; never keeps or
  replays the one-read speech key.
- **`stories.js`** (on every page): when the speech service cannot be reached (no network, no key in 4 s, the
  browser going offline mid-read, or a voice in the room for 3.5 s with no word back from an open stream) it takes the
  read over: it records the child's reading beside Jugnu's own reading screen (opus, about 4 KB a second), scores it
  on the Chromebook where it can (`JugnuSpeech.score`), and after reconnecting plays each recording to the speech
  service exactly as a live read (a one-read key, the same stream, Jugnu's own word matcher), then sends the page's
  real numbers. A recording leaves the Chromebook only for the speech service and is deleted once heard. A read with
  no voice in it is not saved.
- **`ready/stories.js`** (Get ready): every shelf a child can reach (my grade, All grades, grades 1-5, both
  languages), every book on them, every picture and voice, the reader's own files, each book's answers; it asks for
  the microphone while an adult is at the Chromebook; it checks that each file was kept and says how many were not.
- **`rig/stories.mjs`**: a child's whole way through storybooks on the laptop rig, online or with the network truly
  off, with real speech in the microphone, and what reached the server after reconnecting.

A saved reading is scored with the same daily limits as a live one (40 pages a child a day, and the whole service's
daily reads), counted on the day it is scored: a child who read more than that offline is scored over the next days.

## Run it

Settings (environment variables; on a laptop, files work too):

| Variable | What |
|---|---|
| `UPSTREAM` | the Jugnu portal this sits in front of |
| `CB_CONFIG` | JSON as in `cb-config.example.json` (else `./cb-config.json`) |
| `ROSTER_B64` | the school's class list, gzip + base64 of `{school, classes:[{grade, section, students:[{id, name, name_ur, roll}]}]}` (else `ROSTER_FILE`, a path to that JSON) |
| `DEVICE_KEY` | the key a Chromebook must present to get the class list, send who played, ask for its child home and fetch lesson videos |
| `HUB_SIGNING_KEY` | **secret.** The key Jugnu signs child home links with, for the environment `UPSTREAM` points at. Print it with `INTERNAL_API_KEY=… node tools/derive-hub-key.mjs` (that form signs child links and nothing else). Without it the configured home link is used as it is, and runs out after 7 days |
| `HOME_STUDENT_IDS` | optional: the child this pilot's Chromebooks open as. Default: the child the configured home link (`CB_CONFIG.hub`) names |
| `HOME_TTL_S` | optional: how long a signed home lasts. Default 604800 (7 days, Jugnu's own) |
| `HOME_PER_CHILD` | optional, `1`: a child picked on Who's playing? gets their own Jugnu home. Only when the class list's ids are Jugnu's student ids in that database (`docs/HOME-AND-VIDEOS.md`) |
| `MEDIA_HOSTS` | optional: host endings lesson media may be fetched from. Default `.r2.cloudflarestorage.com,.r2.dev` |

**As a service (Railway or any host):** deploy this repo with those variables set (the start command is
`node server.mjs`, it listens on `PORT`), attach a volume at `/app/logs` so who-played records survive a redeploy,
and give each Chromebook its setup link once: `https://<service>/cb?key=<DEVICE_KEY>`.
`GET /__cb/home/status?key=<DEVICE_KEY>` says whether the server can sign homes (never a secret).

```bash
npm install                                               # browser drivers for the test scripts (dev only)
UPSTREAM=https://<jugnu portal> node server.mjs          # http://localhost:8791
cp cb-config.example.json cb-config.json                   # a child home link and two class quiz codes
```

**On a laptop:** `node rig/cb-check.mjs <child home token>` runs Get ready, turns the network off and opens every
link; `node rig/run-quiz.mjs <code> "<name>" [--keep] [--offline] [--new-child]` plays a quiz;
`node rig/tour.mjs <token> online|offline` tours storybook, video, number game and reading game;
`node rig/stories.mjs <token> online|offline [--lang en|ur] [--grade all] [--books all] [--reconnect]` reads storybooks as a
child does (Jugnu reads, Your turn with real speech, questions, done) and says what reached the server;
`node rig/who-check.mjs <device key> "<new name>"` runs Who's playing? online (pick a child) and offline (add me).
For a true offline run, `touch OFFLINE` (the server drops every connection) — a browser's own offline switch does
not reach the worker's requests. `rm OFFLINE` to come back.

Home, Get ready and videos (each prints PASS/FAIL lines; `P=<private folder> sh rig/serve.sh` runs the server
with its secrets): `node rig/home-check.mjs` (an expired home link online and with no network; `--expiry` against a
server run with `HOME_TTL_S=40`; `rig/nokey-check.mjs` against a server with no key); `node rig/ready-check.mjs --videos 2 --interrupt --check --check-offline` (Get ready
with Class 2's lesson videos, the page closed half-way, then Check this Chromebook); `node rig/videos-check.mjs 2`
(with no network: Who's playing?, the Videos door, lessons played and scrubbed, the questions after);
`node rig/videos-sizes.mjs` (lesson video sizes per class); `npm test` (the link signer).

**On a Chromebook by hand:** sign in to the shared school account (not Guest), open `https://<service>/cb?key=<key>` once, tick
the classes whose lesson videos to save, tap **Get ready for offline** and wait for "Ready" (it can be closed and
opened again: it carries on). Tap **Check that everything opens without Wi-Fi**: it opens every saved page, story,
game and video from the Chromebook alone and lists anything missing. Switch Wi-Fi off and play. Switch Wi-Fi on:
section 3 shows the quiz going from "Waiting to send" to "Sent".

**On a Chromebook, automated:** a test unit in developer mode with debugging features, `--remote-debugging-port=9222`
in `/etc/chrome_dev.conf`, and `ssh -N -L 9333:127.0.0.1:9222 root@<chromebook>`. Then
`CB_IP=<chromebook> node device/device-ready.mjs <token>` and `node device/device-offline.mjs <token> "<name>"`
(set `DATABASE_URL`, read-only, to have it check the results arrive). Never put a child's device in developer mode.

Child home links are signed by Jugnu: `tools/sign-hub.mjs` signs one for a test student.

## Learning analytics

Every answer is saved on the Chromebook first, then sent in batches whenever there is a connection; nothing waits
for a person to press anything. A quiz played offline arrives as a normal session with its answers and score, so
the existing reports read it like any other. This covers **quizzes** and **storybooks** (pages heard, pages read
aloud with their word counts, questions, finished books). Game results and the page's usage events are not yet kept
while offline, and what is sent later is stamped with the time it arrived, not the time it was played. Both are
open issues.

**Who it was.** The pilot's own log (`logs/identity.jsonl`, sent from the device whenever there is a network)
names the picked child beside Jugnu's own ids: a `quiz_start` line carries the quiz's `session_id` (for a quiz
started with no network, a local id that the worker's sync report pairs with the real `session_id` and the time it
was played); `home_open` and `game_open` lines carry Jugnu's device id, so what the Chromebook's one home child did
between two picks can be joined to the picked child. What this cannot do, and what Jugnu should do instead, is in
`docs/HOME-AND-VIDEOS.md`.

## What is left

The remaining work is filed as issues in this repo. In short:

1. Build the offline worker into Jugnu itself (precache on install; "Get ready" per grade), so no proxy is needed.
2. Quiz sessions that start on the device, accepted by the server in batches with the time they were played.
3. Shared-device mode: a school's enrolled Chromebook, children tap their name, and Jugnu itself signs that
   child's home and records the result against them (the "school device link" in `docs/HOME-AND-VIDEOS.md`). Today
   Home, Stories, Games and Videos are played as the Chromebook's one home child and joined to the picked child by
   the pilot's own log.
4. Lesson videos the device can keep **without this pilot's server in between**: a CORS rule on the bucket or a
   public file address (the pilot now saves them, but through its own small service: `docs/HOME-AND-VIDEOS.md`).
5. Nothing live during a child's turn: every clip pre-recorded. A storybook's "Your turn" now works with no network
   (scored on the Chromebook, the recording scored again online); for that to be Jugnu's own it needs: a late
   reading accepted without spending the scoring day's limits (40 pages a child, the service's daily reads); the
   time a page was read, not the time it arrived; the microphone notice's words for a recording that waits on the
   device ("story pages are never kept" is about the server); and each book's answers shipped with the book for a
   device that prepares for offline (today the first Chromebook asks the server about each question once, and the
   pilot keeps what it learned for the others).
6. A Chromebook screen: layout for 1366×633, "saved on this device" (not "this phone"), no WhatsApp step.
7. Offline analytics for games and usage events (storybooks: done); the time a quiz or a page was played.
8. Proof that saved content survives a restart in a signed-in account.
9. The whole library on the device: all storybooks and voices (~0.5 GB) plus the videos of the classes that use
   it (0.6–1.3 GB a class, 4.6 GB for Classes 1–5; Nursery, KG and Class 6 are listed without a size on sandbox).
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
- **A worker that keeps every POST answer will replay a one-read speech key.** Offline, "Your turn" got last week's
  key, opened a stream that could not open, listened for 10 s and said "0 words". Keys are never kept now.
- **A look-up that searches every kept file is slow in proportion to the files kept**: 470 ms a miss at 4,800 files on
  a laptop (an exact look-up: 0.1 ms). Get ready slowed with every file it saved. Look a file up exactly first.
- **A dropped Wi-Fi leaves a speech stream that looks open and hears nothing**: the read ended as "0 words". A voice in
  the room with no word back for 3.5 s now means the read is taken over on the Chromebook.
- **A child home link runs out after 7 days, and a worker that keeps every `200` page will keep the wrong one.**
  Jugnu's fast first page answers `200` before it knows the link is expired, then tells the browser to ask again.
  That page was saved over the good copy, so the home broke offline too (4 Nov). The worker now never sends an
  expired link to the server and never saves an "ask again" page.
- **A file from another site that the worker cannot read is charged about 7 MB by Chrome, whatever its size.**
  82 lesson pictures cost 572 MB of room. Anything from Jugnu's media store is now fetched through this site.
- **"The same address with a different `?…`" is not the same list.** A missing Games list was being answered with
  the Stories list. Door lists are now answered only by a saved copy of the same question.
- **Silent skips hide for weeks.** 126 storybook option voices asked for under names cut short (404), and a quiz
  closed by its teacher, were being "saved" without a word. Get ready now names what it could not save and why;
  Check this Chromebook opens everything from the device alone.
- **A server change needs a server restart.** With an old server running, Jugnu answered the new video route with
  a web page (`200 text/html`), and each "video" was saved as 16 KB of HTML. The worker now only saves what this
  site's own media route answered, and never a web page.

## Licence

Apache 2.0. Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).
