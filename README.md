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

## What is proven on the laptop rig (17–18 Nov 2026), waiting for the Chromebook

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
| **A Chromebook short of room** (`rig/videos-room-check.mjs 1,2 1200 --fits 2`, 9 of 9; `npm test`) | The site's real allowance cut to 1.2 GB (Chrome's own estimate went on saying 10.7 GB free; the start page read "Chrome allows 1.1 GB more here"). Classes 1 and 2 ticked: "Class 1 needs 1.3 GB, this Chromebook has room for 1.1 GB", nothing of Class 1 fetched; Class 2, which fits, saved whole after it (82 of 82, 604 MB); Get ready said Ready for everything else and named what did not finish; the start page listed "Class 1 112 lessons, 806 MB · no room for the rest" |
| **Room on the drive** (`rig/storage-audit.mjs`) | Class 2 with everything else: 731 MB really on the drive, 740 MB charged by the browser. (Before the fix, 82 lesson pictures kept as unreadable copies were charged 572 MB.) |
| **Lesson video sizes are measured** (`npm test`, `rig/ready-check.mjs --videos <class>`) | Jugnu's lists carry a lesson's size only now and then (a class came with none: "112 lessons (0 MB)" for 806 MB kept, and a room check that could never say no). Each video's length is now read before saving (one byte asked through the pilot) and the bytes kept are read back from the drive. Class KG, whose list carried no sizes: the log read "lesson videos, Class KG: 28 of 28 lessons on this Chromebook (301 MB of video, 29 MB of quiz voices)", and `rig/storage-audit.mjs` counted 28 videos, 301.3 MB, and 1,976 clips, 29.4 MB, on the drive |
| **Protected from clean-up** (`rig/persist-check.mjs`, 10 of 10, Chrome 156) | Chrome clears an unprotected site's files when the drive runs low. A new profile: not protected, the start page says so and offers **Install Jugnu on this Chromebook**. A profile whose only bookmark is the start page: protected at the first open. A profile that uses it: protected by Chrome itself after 9 opens. Still for the Chromebook: the install itself (needs https and puts an app on the shelf) |
| **Lesson videos of Classes 1 to 5 on every Chromebook** (`rig/ready-check.mjs --videos default`, `--interrupt-videos`, `--check-offline`; `rig/storage-audit.mjs`; `npm test`) | With nobody choosing, Get ready saved everything else first ("Ready" in 164 s) and then the five classes, one after another, with real numbers on the page ("lesson videos — Class 3 (3 of 5): 41 of 94 lessons (362 MB of 830 MB)"). On the drive at the end: 518 lessons, 4,647 MB of video (112, 82, 94, 121 and 109 lessons; 806 MB, 604 MB, 830 MB, 1.3 GB, 1.1 GB), 5.2 GB with everything else. As pages with their quiz, Classes 1 to 4 took 18, 17, 30 and 49 minutes (the quiz voices, about 70 small files a lesson, are what takes the time); as videos alone Class 5 took 5 minutes. **Check this Chromebook with the network truly off: all 548 things opened, every one of the 518 lessons by a real player** (0 requests answered). Interrupted in the middle of a class (Nursery, 797 MB): the page closed and opened again, it carried on by itself; the network cut for 25 s, it waited and went on; 68 of 68 at the end |
| **A lesson as a page or as a video alone; a cache of their own** (`npm test`; found on that run) | The first all-five run saved Classes 1 to 4 and none of Class 5, and then could not say "Ready" at all. Two causes. Jugnu gives a child with a class code a lesson **page** and a child with none the **video alone**, and the home child changed from one to the other while Get ready ran (`docs/HOME-AND-VIDEOS.md`, section 5): the step now saves either, keeps a record of each saved lesson on the drive, and the worker plays a saved lesson with no network whichever way the list points. And Chrome will not list a cache of more than about 14,000 files, which every lane does: lesson videos and their quiz clips now have a cache of their own. The same Chromebook, on the new code: Classes 1 to 4 taken over with no download (about 2 minutes each), Class 5 saved, "Ready", 25,982 files confirmed on the drive |
| **What is not saved plays from the internet; with none it says so** (`rig/online-check.mjs fresh`, `partly 3 5`, `offline KG`, `never`; `rig/stories.mjs`, `rig/games-short.mjs`, `rig/run-quiz.mjs` on a profile that never ran Get ready) | **Network on, Get ready never pressed** (13 of 13): a lesson of each of Classes 1 to 5 played from the media store and scrubbed ahead (first picture 0.7 to 1.3 s after the tap; it streams, no video was saved), a storybook was read aloud, the big flight's map opened and a part started, a class quiz opened. With the lanes' own rigs on such a profile: a quiz played to its card, a storybook's pages read with the words lit, Numbers Island played to its card (14 stones, 208 of 208 sounds), Number warm-up and Read along to their end screens. **One class saved, network on** (6 of 6): a lesson of a class that is not saved played and scrubbed. **The same Chromebook, network truly off** (12 of 12 while the child got lessons as pages; 10 of 10 after, with lessons as videos alone): the saved class played from the drive; the door of a class never looked at, a lesson page that is not on the drive, and a lesson whose page is on the drive but whose video is not each said "This needs the internet" (in the page's language), and the home stayed whole; the saved storybook, quiz and big flight opened; nothing was answered by the server. The stories rig read two books from the drive; the games play crossed Numbers Island (209 of 209 sounds) and finished Number warm-up, its result kept on the device. **Never ran Get ready, network off** (8 of 8): the home opened from what was kept as it loaded; a storybook, a game, a quiz and a lesson that were never opened each said "This needs the internet", with Home or Back |
| **After a deploy: a newer worker takes over** (`rig/handover-check.mjs`; `--tap`; `npm test`) | Found when a full Get ready stopped at "the child home did not open". A page asked for in the moment a newer worker takes over is never answered (Chrome hands it to a fresh copy of the outgoing worker and ends that copy; a page already being fetched is waited for: held 4 s, it opened). Get ready fell into it because it opens the home in a hidden frame the moment its first step is done. Before: 2 of 4 Get-ready runs after a changed worker file failed the step, and 2 of 30 taps placed in that moment left the page on the home for good. After: Get ready waits until the newer worker is in charge, 6 of 6; 40 of 40 taps opened the quiz (the page went again 7 times) |
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

## The learning games (17 Nov 2026)

What a child reaches behind the home's **Games** door, in every grade and in English and Urdu
(`rig/games/inventory.mjs`, ten test children, one per grade and language):

| Grade | Games |
|---|---|
| 1 | **Numbers with Jugnu** (how many dots) · **Jugnu's big flight** · three video quizzes ("Try these next") |
| 2–5 | **Number warm-up** (the missing number) · **Which is bigger?** · **Read along** · **Read aloud** · **Listen** · **Jugnu's big flight** · three video quizzes |

**Jugnu's big flight** is the reading and number battery (EGRA/EGMA) as a game, and it holds the three games people ask
for by name: **Urdu Island** is the Urdu reading game (9 stones: listening, vocabulary pictures, first sounds, letters,
made-up words, words, a story read aloud and its questions), **English Island** the English reading game (11 stones,
spelling included), **Numbers Island** the maths game (14 stones; 15 in Grades 4–5), then the **Big flight** through
20 stones. There are three batteries (Grade 1, Grades 2–3, Grades 4–5), each in English and Urdu: six files that name
1,030 clips and pictures. The door's grade picker ("All grades") also opens the other grades' number games.

What the pilot does for them:

- **Get ready keeps all of it** (`ready/games.js`): all six batteries, every clip and picture they name (the list is
  the battery engine's own, never a copy that can drift), the engine, the sea map in both languages, and every
  Challenge game behind the door with the clips it names. It ends by asking the worker which files are *not* on the
  device and prints the count ("6 of 6 batteries, 1030 clips and pictures, 0 not saved"). Before, it kept the Grade 1
  battery only, no battery picture, and nothing of the Grades 2–5 number games.
- **One offline worker.** Jugnu's battery has a worker of its own (scope `/sa/`); under the pilot it took those pages
  away from the pilot's worker, so a part started with no network had no way back to the map and nothing it could ever
  send. The proxy now serves a stand-in at `/sa/sw.js` that removes that worker, and `pilot-sw.js` (its GAMES LANE
  block) answers the engine's "keep these / are these kept" itself, so Jugnu speaks with its recorded clips.
- **A part started offline is sent later.** It gets a run on the device; when the engine next sends answers or a
  recording and there is a network, the real run is opened with the request kept from the start. A hidden frame
  (`sa-drain.html`, started by `boot.js` on any page) runs the engine's own upload queue as soon as the network is
  back: nobody presses anything.
- **The Challenge's number games and Read aloud with no network**: the taps, or the recording, wait on the device and
  the page shows its end card; back online they go to the run they were played in, or, when its two-hour token has
  lapsed, to a fresh serve of the *same* questions or story. Other questions: nothing is sent, and the outbox says so.
- **A reading with no network gets its feedback on the Chromebook** (`games-read.js`, the speech scorer in
  `speech/`): the words Jugnu heard are lit and one to three stars are shown, never words a minute. On the Challenge
  page it appears under the page's own card; in the big flight, on the sea map's card after a part, for the stories
  read aloud in that part (the battery's own screens show a child no score, and are not changed). The recording is
  kept and goes to Jugnu's scorer when the network is back; letter sounds and Urdu word lists are never scored here.
- **A home link that renews itself** (the HOME block) does not lose the games: the sea map and the Challenge pages
  are filed under the home's children, a part's start and the outbox send the live link.
- **A recording's upload goes through the pilot's server** (`/__cb/r2put`): Jugnu's storage bucket accepts a browser's
  upload only from Jugnu's own site, so through the pilot every reading's upload was refused (also on the deployed
  pilot).
- **The Chromebook's keyboard types** into Jugnu's number pads and letter strip (digits, letters, Backspace, Enter);
  Jugnu's screens take no key at all.
- **The battery's screens fit a 1366×633 page** (`cb-fit.css`, added to `/sa/play.html`): Jugnu sizes any screen 600 px
  or wider as a tall tablet, so the second row of answers and the keypad's 0 sat below the page.

What is proven on the laptop rig (17 Nov 2026; a Chromebook-shaped Chrome with a 1366×633 page, twenty sandbox test
children, each in its own profile; not yet on a real Chromebook):

| Game | Grade 1 | Grades 2–3 | Grades 4–5 | Online | Network off |
|---|---|---|---|---|---|
| Big flight: Numbers Island (maths) | en, ur | en, ur | en, ur | every stone, results on the server | every stone; results on the server by itself after reconnect |
| Big flight: English Island (English reading) | en, ur | en, ur | en, ur | the same | the same, plus lit words and stars for the story on the map's card |
| Big flight: Urdu Island (Urdu reading) | en, ur | en, ur | en, ur | the same | the same (the rig has no Urdu voice for the story's own words) |
| Big flight: the Big flight (20 stones) | en, ur | en, ur | en, ur | the same | the same |
| Numbers with Jugnu (dots) | en, ur | – | – | scored | played; scored on its own run after reconnect |
| Number warm-up, Which is bigger? | – | en, ur | en, ur | scored | played; scored on their own runs after reconnect |
| Read along, Read aloud | – | en, ur | en, ur | recorded, uploaded, scored | recorded on the device; uploaded and scored after reconnect |
| Listen | – | en, ur | en, ur | scored | **the story plays, the questions do not open** (see below) |

"Network off" is the server's OFFLINE switch **and** every browser offline: in the 46 minutes of the first offline
run the server dropped 511 requests and answered none; while offline the database held nothing of the play; after
the network came back the devices opened 40 runs and sent 150 batches, 34 game results and 16 recordings, with
nobody pressing anything.

The same offline run was repeated on the code of all four lanes together (speech, home, stories, games): 53 minutes
with the switch on, 499 requests dropped and none answered, the big flight 40 of 40 parts, the dots 2 of 2, warm-up,
bigger, read along and read aloud 32 of 32, Listen 0 of 8. With no network a reading on the Challenge page got its
feedback from the device: English 36 of 36 and 63 of 63 words lit (three stars), Urdu 34 of 38 and 38 of 39 (the rig
"read" with Jugnu's own recording of each story); never words a minute. After reconnect each recording was uploaded
and scored by Jugnu. Evidence: `logs/matrix-offline-1/`, `-2/`, `-3-reads/` and `logs/evidence-*.txt` on the lane's
machine (logs are not committed).

What cannot be done by the pilot, and why:

- **Listen with no network.** The story is on the device and plays; its questions and their answer choices are asked
  of the server only after the story has been heard (`POST /api/wq/ch/qs` with the run's token), and each answer is
  checked there (`ch/qa`). Nothing on the device holds them. Jugnu has to hand the questions over with the game.
- **The big flight's readings are not scored by Jugnu at all** (online too): a game recording is kept only with a
  consent value the game never sends, and no scorer reads a game run's recordings. Offline the pilot scores the
  stories on the device (feedback, and `device_read` on the task's result); whether Jugnu keeps and scores children's
  voices in the game is a consent decision for the people who run it.
- A number game or a reading played offline is sent to the run it was played in for two hours (the life of its
  token), then to a fresh serve of the same questions or story: always possible for the dots and the warm-up, within
  a day of the last online visit for "Which is bigger?" and a reading. After that Jugnu serves other questions and the
  play is not sent (the outbox says `questions_changed`). Jugnu should accept a late result for a served run.
- The Big flight can be flown once a month: a second one flown offline is refused when it is sent (409) and stays on
  the device.

Test it: `node rig/games/matrix.mjs online <children>` and `… offline <children>` (each child in its own Chrome
profile; offline = Get ready, then the server's OFFLINE switch and every browser offline, then the network back and
only watching). `npm test` runs the worker's rules in node (`test/pilot-sw.test.mjs`).

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

### What is proven for storybooks (17 Nov 2026, laptop rig only)

A Chromebook-shaped Chrome (1366×633, ChromeOS user agent, Chrome's own autoplay rule), sandbox Jugnu, one test
child. "Offline" is the server dropping every connection and the browser offline, both. **Not yet on a real
Chromebook**: the test unit was off the network that day.

| Test | Result |
|---|---|
| Get ready on a new device | 14 shelves, 86 books (50 English, 36 Urdu), 717 pages, 3,182 of 3,182 pictures and voices, answers for 86 books; 15 min in all on a laptop, 13 of them storybooks (7 of those asking the answers: the first Chromebook only). A second Get ready: 2 min 20 s. With the scorer's models, 483 MB on the device |
| Check this Chromebook (no network reached) | Stories: 18 of 18 fine (every shelf, every book's files, the answers, a book of each grade and language opened, voices played) |
| Every book online: Jugnu reads, the words light, questions, look-back, done | 86 of 86 books, 717 of 717 pages played to the end with the light moving, 394 questions, every step answered 200 by the server |
| Every book with the network off | 86 of 86 books, 717 of 717 pages, 394 questions checked on the device (253 look-backs), 86 done screens; 975 steps kept |
| Back online after the offline run | 1,076 kept steps sent by themselves (411 from one device in 4 min 9 s), none dropped, each answered by the server (93 "book done", 93 "questions done"). The server's shelf then marks 50 of 50 English and 36 of 36 Urdu books read (the online run, same child, had finished them too) |
| Your turn online (live), a page of each grade 1-5, English and Urdu | Words counted on every page: Urdu 14/16, 26/26, 11/11, 20/21, 49/71; English 4/5, 15/15, 27/27, 61 in four parts, 29/64 |
| Your turn with the network off, the same pages | Saved and scored after reconnecting: Urdu 14/16, 26/26, 11/11, 20/21 (equal to live), 71/71 in four parts |
| Your turn with the network off, scored on the device | English: 12/12, 8/8, 8/8 on the device and online; Urdu: 15, 17, 17 on the device, 14/16, 18/18, 18/18 online. The page shows words and stars, no speed; the server gets the online count |
| Chrome's fake microphone playing a recording of the page, network off | Device: 5 words lit. 12 s after reconnecting the server had 4/5, 1,260 ms, the same as the live read of that recording. Two of five words said: 2 lit. Silence: nothing saved, "Let's read it together" |
| The network cut 2.5 s into a live read | Before: sent as 0 words. Now: 5 words lit on the device, 4/5 from the speech service after reconnecting |
| A new home link for the same child, network off | The Urdu grade 3 shelf and a book opened from the device; its steps were sent under the new link |

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
| `READY_ONLY`, `SW_STAMP_FILE` | a rig's settings, **never a service's**: offer only some Get-ready step files; add a file's text to the worker file (plays "a new version was deployed") |

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
`node rig/videos-sizes.mjs` (lesson video sizes per class, as Jugnu's lists give them); `CB_BASE=http://127.0.0.1:8813 node rig/persist-check.mjs`
(when Chrome protects the saved files from clean-up); `node rig/ready-check.mjs --videos default --interrupt-videos`
(all five classes; the page closed and the network cut in the middle of a class); `node rig/videos-room-check.mjs 1,2 1100 --fits 2`
(a Chromebook short of room: Class 1 refused whole, Class 2 saved whole); `node rig/online-check.mjs fresh | partly 3 5 | offline KG`
(what is not saved plays from the internet; with none it says so); `node rig/handover-check.mjs` and `--tap` (a newer
worker taking over, as after a deploy); `node rig/games-short.mjs <token | own> [--offline]` (the games lane's own
play on any profile); `npm test`.

**On a Chromebook by hand:** sign in to the shared school account (not Guest), open `https://<service>/cb?key=<key>` once
and tap **Get ready for offline**. "Ready" comes first (the home, storybooks, quizzes and games work from then on);
the lesson videos of Classes 1 to 5 follow, one class after another, with their real sizes on the page (untick a
class to leave it out). It can be closed and opened again: it carries on. Press **Install Jugnu on this Chromebook**
(or bookmark the page) so Chrome does not clear what was saved. Tap **Check that everything opens without Wi-Fi**: it opens every saved page, story,
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
   And a pack list per class (lesson → file, size, checksum), so preparing a Chromebook starts no lesson as the
   child (each start is counted by Jugnu as the child watching) and the quiz after a video alone can be saved too
   (today the server makes it only on the child's tap).
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
9. The whole library on the device: done in the pilot (all storybooks and voices, and by default the lesson videos
   of Classes 1 to 5). For Jugnu itself: a pack list per class (lesson → file, size, checksum), and the videos
   on an address a Chromebook can fetch from without this pilot's server in between (item 4).
10. Fleet measurement: per device, ready for offline, last sync, offline plays, sync delay.

The learning games need these in Jugnu itself (the pilot covers each today, on its own pages only):

- The battery's screens (`dashboard/sa/sa.css`, "Round 8 layout") sized for a wide, short page: the rules in
  `cb-fit.css` and the scale-to-fit in `boot.js` are the ones to carry over.
- Keys: a digit, a letter, Backspace and Enter for the number pads and the letter strip (battery and Challenge).
- A part of the big flight started with no network: keep the start's request and open the run when the network is
  back (`dashboard/sa/sink-game.js` already has `forGame`; the map page does not use it), and send from any page.
- The way back to the sea map with no network (`sa-engine.js` waits for a HEAD of the map to answer).
- The battery worker asked to keep all six batteries when the game is first opened, not one part at a time.
- Listen's questions handed over with the game; a late result accepted for a served run (number games, readings).
- A decision on keeping and scoring children's readings in the big flight (today: recorded, dropped, never scored).
- Uploads of recordings from any origin Jugnu is served from (the bucket's CORS names one).
- The last battery screen's "Go back" 48 px below a 633 px page; the Challenge's microphone notice and read-along
  controls just under it.

## What we learned

- **Two home links signed in the same second are the same link** (the link has no nonce), and a link locks to the
  first device that opens it: five test links made together were one link, and a rig that opened it after another
  was told "This link was sent to another player". (The HOME block's links carry a nonce.)
- **A worker of its own scope takes its pages away from every other worker.** Jugnu's battery worker (`/sa/`) left
  the pilot's worker blind on the child's battery page: one offline worker per site, or none of them can finish the job.
- **A time limit on the network must never answer "offline" when nothing is saved.** The worker's 4 seconds answered
  503 to a first request the server did answer in 4.03 s.
- **Jugnu's screens are sized by width.** A Chromebook page is wide and short; "600 px or wider" meant "a tall
  tablet", and half the answers were below the page.
- **Storage outside Jugnu's own site refuses the pilot's uploads** (CORS allows one origin): anything the page sends
  straight to the bucket has to go through the pilot's server.
- **A rig that jumps from one game to the next by address can skip a game**: two addresses that differ only after
  "#" do not load a page. Come to each game the way a child does, or leave the page first.

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
- **A size in Jugnu's lesson list is there only when Jugnu looked at that video lately.** A whole class can come
  with none. Anything that plans room or reports what was saved must measure the files, never trust the list.
- **Chrome protects a site's files from clean-up only when the site is installed, bookmarked or much used, and only
  when asked.** A fresh Chromebook that ran Get ready once holds 1.4 GB Chrome may clear. The start page now asks on
  every open, says where it stands and offers the install (`docs/HOME-AND-VIDEOS.md`, section 8).
- **A permission granted through the debugging port refuses all the others.** The rig grants the microphone that
  way, so every ordinary rig run says "not yet protected" whatever the site does.
- **`navigator.storage.estimate()` does not say how much room there is.** Since Chrome 123 it answers "what this
  site uses, plus 10 GB" on every device, however full the drive: a check built on it can never say no. The start
  page asks by doing (it reserves the amount in the site's private files and gives it back).
- **A newer worker's takeover loses a page asked for in that moment.** After a deploy the new worker takes over a
  second or two after a page opens. A page already being fetched is waited for; a page asked for in the instant
  between the old worker stopping and the new one being in charge is handed to a fresh copy of the old worker and
  never answered. Get ready hit it 4 runs in 7 ("the child home did not open"). Get ready now waits for the new
  worker first, and a page whose tap was cut off goes again (`docs/HOME-AND-VIDEOS.md`, section 7).
- **Jugnu gives a lesson two ways, and a child can change from one to the other.** With a class code: a page with
  the video and its quiz. Without: the video alone, played in the home. Jugnu looks at a child's 18 newest quiz
  codes, and the lesson pages Get ready reads push the class quiz out of that view: Classes 1 to 4 came as pages,
  Class 5 as videos, and a step that knew only the page saved none of it. "Saved" must be a record on the device,
  never what today's list says.
- **Chrome will not list a cache whose list passes about 10 MB** ("Operation too large"). 14,062 files fitted;
  15,979 did not, and then nothing that lists the cache works (Get ready's audit could never say "Ready"). Files
  that come by the thousand and are never listed (lesson videos, quiz clips) belong in a cache of their own.
- **A server change needs a server restart.** With an old server running, Jugnu answered the new video route with
  a web page (`200 text/html`), and each "video" was saved as 16 KB of HTML. The worker now only saves what this
  site's own media route answered, and never a web page.

## Licence

Apache 2.0. Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).
