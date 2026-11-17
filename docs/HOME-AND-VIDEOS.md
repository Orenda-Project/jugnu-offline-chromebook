# The child home, who is playing, and lesson videos on a school Chromebook

What the pilot does today, why, and what Jugnu itself should do so the pilot is no longer needed for it.
Written 17 Nov 2026 (bd-fc5mgd.13.3). Evidence: `rig/home-check.mjs`, `rig/ready-check.mjs`, `rig/videos-check.mjs`,
`rig/check-finds.mjs`, `rig/perchild-check.mjs`, `rig/storage-audit.mjs`, `rig/videos-sizes.mjs` (results in the README).

## What the deployed service needs

| Variable | Needed for | Value |
|---|---|---|
| `HUB_SIGNING_KEY` | a home that never goes stale | **Secret.** `INTERNAL_API_KEY=<the Jugnu environment's key> node tools/derive-hub-key.mjs` prints it (64 hex characters; it signs child links and nothing else). The server checks it against the configured home link and refuses to sign with a key that did not sign that link. `GET /__cb/home/status?key=<DEVICE_KEY>` says `signing: true` when it is right |
| `DEVICE_KEY` | already set | Signing and the video route answer only a Chromebook that presents it |
| `CB_CONFIG` | already set | Its `hub` names the home child and is the link the key is checked against (expired is fine). Its second quiz, `TWYW23`, has been closed on sandbox: Get ready now says so; a new code is needed |
| `HOME_PER_CHILD`, `HOME_STUDENT_IDS`, `HOME_TTL_S`, `MEDIA_HOSTS` | optional | Defaults are right for sandbox |

Without `HUB_SIGNING_KEY` nothing breaks: the configured link is used, an expired one still opens from the saved
copy (online and offline), but nothing new is recorded under it and the home's contents stop updating.

## 1. Why the home went stale on 4 Nov

Jugnu's home link `/h/<token>` is signed for 7 days and is locked to the first device that opens it. A child renews
it by sending `/quiz` on WhatsApp. A school Chromebook has no WhatsApp, and the pilot stored one link forever.

When that link ran out, two things happened, one after the other:

1. **Online**, Jugnu's fast first page answers `200` at once and only then learns the link is expired; its last line
   tells the browser to ask again (`?nf=1`), and that second answer is `401` "This link has expired. Send /quiz on
   WhatsApp…".
2. The offline worker kept every `200` page. So the "ask again" page was saved **over the good copy**, and from then
   on the home was broken **offline too**: the saved page asked again, and again.

## 2. What the pilot does now

| Piece | What it does |
|---|---|
| `POST /__cb/home` (server) | Signs this Chromebook its own home link, with the key Jugnu signs with (`HUB_SIGNING_KEY`, a server secret). Only for a Chromebook that presents the device key. Each link carries a random nonce, so two Chromebooks never share one device lock. |
| the offline worker, block HOME | Owns the link. With a network it replaces a link that is a day old in the background, and one that has run out before the page opens. A page, a saved page or a bookmark holding an old link is sent to the live one; a data call or an answer naming an old link goes to the server with the live one. With no network the link's date is not looked at: the saved copy opens. |
| saved copies | Filed under the home's children, not under each week's link, so they survive every renewal. A home link never saved on this Chromebook opens this Chromebook's own saved home. |
| two guards | An expired link is never sent to the server. A page that only says "ask again" is never saved. |
| `/cb/home` | The one address that always opens the home: Home buttons, the start page, a shelf shortcut. |
| a link locked elsewhere | If the home answers "this link was sent to another player", a new link is signed and the page opens it by itself. |
| a wrong clock | The worker learns the server's time from each answer, so a Chromebook whose own clock is wrong still reads expiry correctly. |

The Chromebook's home child is the one the configured home link names (`CB_CONFIG.hub`), or `HOME_STUDENT_IDS`.

## 3. Who is playing: how a result reaches the right child today

One Chromebook is used by many children. The pilot's **Who's playing?** screen (class › section › name, from the
school's class list) records the child on the device. What happens to that pick depends on what the child opens:

| What the child plays | Who Jugnu records | How it is joined to the picked child |
|---|---|---|
| A class quiz (`/q/<code>`) | The child by **name**: the pilot answers Jugnu's own "who is playing" screens with the picked child's name, so Jugnu finds or makes that child in the quiz's class | Exact. The pilot's log line `quiz_start` carries the class-list id and Jugnu's `session_id` (or, for a quiz started with no network, the local id that the worker reports beside the real `session_id` when it syncs). |
| Home, Stories, Games, Videos (and the quiz after a video) | **This Chromebook's one home child**, whoever is sitting there | By time. `home_open` / `game_open` log lines carry the picked child and Jugnu's device id (`wq_device` = `quiz_sessions.device_ref`, also on run rows): everything that device did between one pick and the next belongs to the picked child. |

Log lines are written on the device first and sent when there is a network (`/__cb/identity`; the server appends
them to `logs/identity.jsonl`).

**This is the weak point.** Stories read, games played and lesson quizzes all land on one shared record in Jugnu's
database. A teacher's report shows one very busy child. The time join works for analysis, never for the teacher.

### A child's own home (built, off by default)

`HOME_PER_CHILD=1` makes the server sign a home for the **picked child's own Jugnu record**: only for a child on the
school's class list, and only after asking Jugnu whether it knows that child (with a one-minute link of its own, so
the Chromebook's link stays unopened). The worker opens that home from `/cb/home` when it holds one; a child Jugnu
does not know, or no network, gets this Chromebook's home. Everything is then recorded against the child by Jugnu
itself. Proven on the rig for one child Jugnu knows and one it does not (`rig/perchild-check.mjs`). The known child
in that run was sandbox's one test student, who is also the Chromebook's home child: it shows the signing, the
asking and the routing, not two different children's homes side by side.

It is off because it needs one thing to be true: **the class list's ids must be the ids of Jugnu's own student rows
in the database the pilot points at.** On sandbox they are not (asked: a link signed for three ids of the pilot
school's class list opened a home with no child in it). On production, with a class list exported from Jugnu's own
`students`, they would be. With it on and the ids not matching, nothing breaks: every child gets this Chromebook's
home, as today.

One limit to know: with no network a child whose own home was never opened on this Chromebook gets the Chromebook's
home, so that session is again joined by the pilot's log, not by Jugnu.

## 4. Should Chromebooks use Jugnu's standing class link (`/j/<code>`)?

**Yes for the idea, not as it is built.** The class link is Jugnu's own answer to "a link with no child in it":
teacher › first letter › first-name chips, the server places the child, signs a home for that child alone, remembers
the pick on that phone for up to 28 days, and writes where the child came from on every run
(`via: class_link`, `class_id`, `id_src`, `id_confidence`, `homonym_in_list`). That is exactly the server-side
attribution section 3 lacks. But it was built for a family phone:

| The class link today | What a school Chromebook needs |
|---|---|
| One class per link | A Chromebook cart serves every class in the school: one entry per **school** (class › section › name) |
| Every step is a server call; the page never holds the class list (first names appear only after the teacher's name is tapped) | The class list **on the device**, so a child can be picked with no network. A school's own enrolled device can be trusted with first names and roll numbers |
| "Whose turn?" lists the children this phone remembers (8 from the device record, 50 from sessions) | A shared device has had 300 children: always the full picker, never a remembered few |
| The home it signs lasts 7–28 days and locks to the phone | The same, renewed by the device without a child doing anything, and a saved copy that opens when it has run out (section 2) |
| Needs `web_quiz_class_link` on and the class enrolled (`class_teachers`, `class_enrollments`) | The same: ICT classes enrolled in Jugnu |
| First-name chips only | First name **and roll number** (two children with one name in a section of 39 is common) |

### The change to ask of Jugnu ("school device link")

1. **Enrol a device**: from the teacher or admin portal, a school gets a device link; opening it once stores a
   device token (a new signed kind, long-lived, revocable, bound to the school). This replaces the pilot's
   `DEVICE_KEY`.
2. **`GET /api/wq/device/roster`**: the school's classes with first name + roll number per child, only to an enrolled
   device. This replaces the pilot's `ROSTER_B64`.
3. **`POST /api/wq/device/home {student_id}`**: a home link for that child, signed by Jugnu, carrying the class-link
   style origin (`via: device`, `class_id`, `id_src: roster_pick`, `id_confidence: high`). This replaces the pilot's
   signing key: **the key then never leaves Jugnu.**
4. **Results made with no network**: one endpoint that accepts a batch `{device, student_id, what, played_at, …}`
   signed by the device token, idempotent. Today a quiz synced late is stamped with the time it arrived.
5. **A home that does not depend on its link's date** when opened from the saved copy (the two guards of section 2,
   inside Jugnu's own offline worker).

Until then the pilot stands in for 1–3 with `DEVICE_KEY`, the class list and `HUB_SIGNING_KEY`.

## 5. Lesson videos

**How they are served.** The Videos door lists lessons from `GET /api/wq/lib/h/<token>` (grade → subject → chapter →
lesson, each with its size in MB and length). A lesson opens as a page `/q/<code>?k=<chip>&via=videos`: the video,
then its quiz. The video is a **signed link straight to Cloudflare R2**, good for 6 hours
(`…r2.cloudflarestorage.com/student-videos/<grade>/<subject>/<name>_web.mp4?X-Amz-…`).

**Why nothing was kept.** Measured on sandbox R2 on 17 Nov 2026: byte ranges are supported (`206`), but the bucket
sends **no CORS headers** (no `Access-Control-Allow-Origin`; a preflight answers `403`). A page's worker therefore
gets an unreadable ("opaque") answer: it cannot cut the byte ranges a player asks for, cannot check the file is
whole, and the address changes with every signature.

**What the pilot does.** Get ready fetches each lesson's video **through the pilot server**
(`GET /__cb/media?u=<signed link>`, device-key gated, R2 hosts only, nothing stored on the server), checks the length,
and files it under its address without the signature. The player's range requests are then cut from that file on
the drive, with or without a network. The lesson's page, its picture and the voice clips of its quiz are saved with
it (about 90 clips a lesson; a few sit on the bucket's public address `pub-….r2.dev`, which sends no CORS headers
either), and a lesson that has no page yet gets one (what a child's first tap does), so a tap needs no server.

Two things found on the way:

- **An unreadable copy costs room it does not use.** Chrome charges about 7 MB for each file of another site that
  the worker cannot read. 82 lesson pictures were charged 572 MB. Every file of the media store is now fetched
  through this site, online as well as in Get ready: Class 2 is 731 MB on the drive and 740 MB charged.
- **"Which class" is not fixed.** The Videos door asks for the home child's own class with no class in the address.
  On the rig that class changed from 1 to 2 for the test child after Class 2 lessons were played as that child. So
  each class's lists are saved under its own name as well, and Who's playing? sets the door to the picked child's
  class by name.

**Sizes** (sandbox library, read from Jugnu's own lists by `rig/videos-sizes.mjs`, 17 Nov 2026):

| Class | Lessons | Total | Median | Largest | Hours |
|---|---|---|---|---|---|
| 1 | 112 | 807 MB | 5.8 MB | 14.6 MB | 9.0 |
| 2 | 82 | 604 MB | 7.0 MB | 13.3 MB | 6.7 |
| 3 | 94 | 829 MB | 8.3 MB | 13.3 MB | 9.7 |
| 4 | 121 | 1,278 MB | 12.4 MB | 13.3 MB | 17.6 |
| 5 | 109 | 1,129 MB | 12.3 MB | 13.6 MB | 15.3 |
| **1–5** | **518** | **4,647 MB** | | | **58** |

Nursery (68 lessons), KG (28) and Class 6 (195) are listed without a size on sandbox, so they are not in the totals.

**The sizes in Jugnu's lists come and go.** A lesson's size is in the list only when Jugnu happened to look at that
video lately (it keeps what it learnt for 6 hours). On 17 Nov Classes 1 to 5 all carried sizes; a day later Class 3's
94 lessons carried none, and on the deployed service Class 1's did not: the log said "112 of 112 lessons (0 MB)" for
806 MB on the drive, and the check "is there room for the whole class?" worked with a need of 0. So the videos step
no longer trusts the list. Before it saves a class it reads every lesson's page and asks for each video's real length
with a one-byte request through `/__cb/media` (the total comes back in `Content-Range`; nothing is downloaded), and
after saving it reads the bytes back from the drive. The room check, the progress line, the log and the start page
all use those numbers; a size that could not be read is called an estimate, and one that is not known is not shown.

Each lesson also brings about 1 MB of quiz voice clips (Class 2: 5,815 clips, 77 MB), so a class takes about 13 %
more than its videos; the room check counts 1.3 MB a lesson for them. Saving Class 2 took 9½ minutes on the laptop rig at about 1 MB/s; a school's line decides the
rest.

The pilot Chromebook has about 16 GB free: all five classes fit. A class is saved only when the device has room for
all of it; otherwise the start page says what is needed and what there is. The start page ticks the home child's
class and the picked child's class to begin with; a teacher ticks the others (`/cb?videos=all`, `1,2` or `none`
does the same for a script).

**What Jugnu should change.** The pilot's route sends every video through one small service. For 40,000 Chromebooks
that is the wrong road. Either of these lets each Chromebook fetch from Cloudflare directly, with no pilot server:

- a **CORS rule on the bucket** for the portal's address (`GET`, `HEAD`; allow `Range`; expose `Content-Range`,
  `Content-Length`, `ETag`), or
- the `_web.mp4` files on a **public file address** (a Cloudflare custom domain) with addresses that do not change,
  which also lets a school's own cache or a neighbour Chromebook serve them.

And a "pack" list per grade (lesson → file, size, checksum) so a device can ask for exactly what it lacks.

## 6. Protected from clean-up

**The risk.** When a device's drive runs low, Chrome clears the saved files of sites it does not count as
important, a whole site at a time. After Get ready that is 1.4 GB on a Chromebook. A site that holds *persistent
storage* is passed over. A page asks for it with `navigator.storage.persist()`; Chrome never shows a question, it
decides by rule.

**The rule** (Chromium `chrome/browser/storage/persistent_storage_permission_context.cc` and
`chrome/browser/engagement/important_sites_util.cc`, read 18 Nov 2026; the same code on ChromeOS and desktop):

| Chrome says yes when the site is… | Notes |
|---|---|
| **installed as an app** | Any installed web app counts, installed by a person or by the school's admin. Only an `https` site counts |
| **bookmarked** | When the profile has 5 bookmarks or fewer, every bookmarked site. With more, the 5 most used |
| **much used** | Site engagement of 15 or more. At most 15 points can be earned in a day, so about a day of real use |
| allowed to send notifications | Not used by the pilot |

and the site must be among the profile's 10 most important sites for the last three. Chrome says **no, always**, in
a Guest session, where site data is cleared at sign-out, and inside another site's frame. And it only answers when
asked: a site that qualifies on Tuesday but asked on Monday stays unprotected until it asks again.

**What the pilot does.**

- **It can be installed.** `/cb/app.webmanifest` (name, start page, standalone, Jugnu's own icon) is linked from the
  start page. Chrome 156 finds the page installable, on the rig and on the deployed https service (its own check
  reports no errors and it offers the install).
- **It asks every time.** The start page asks when it opens, after Get ready, after an install and every minute
  until it is held; `boot.js` asks on every Jugnu page. Whichever condition becomes true is picked up by itself.
- **It says where it stands.** The start page's "Keep what is saved" card reads "Protected." or "Not protected
  yet", with how much is at stake and what to do: an **Install Jugnu on this Chromebook** button (shown when Chrome
  offers the install), or bookmark the page. The header line says it too, and the server is told
  (`/__cb/report` → `protect: {persisted, installed, …}`), so a fleet view can list unprotected Chromebooks.

**Proven on the rig** (`rig/persist-check.mjs`, 10 of 10, on Chrome 156.0.8078.82, the Chromebook's own version):
a new profile is not protected and the start page says so and offers Install; a profile whose only bookmark is the
start page is protected at its first open (asked for by `boot.js` on a quiz page), the start page says "Protected."
and the server is told; a profile that opens and taps the start page is protected by Chrome itself after 9 opens
(site engagement 15).

**What still needs the real Chromebook.**

1. **The installed-app route.** It needs `https` and a real install, which puts an app on the machine's shelf, so it
   was not done on the laptop. On the Chromebook: open the start page, press **Install Jugnu on this Chromebook**;
   the card must turn to "Protected." within a minute. This is the route for the fleet: the school's Google admin
   force-installs `https://<service>/cb` for the device OU (Devices › Chrome › Apps & extensions › Add by URL ›
   Force install), and each Chromebook is protected the first time any Jugnu page opens.
2. **That the account keeps its data.** In Guest, or with "clear site data on exit" set by policy, Chrome never
   protects a site, and the start page will say "Not protected yet, although Jugnu is installed".
3. **A full drive.** That Chrome under real pressure passes over the protected site was not tried (it means filling
   a drive).

Not covered by any of this: a powerwash, removing the account from the Chromebook, and ChromeOS removing whole
accounts that are not signed in when the drive is nearly full. One shared school account that is always the one
signed in is not removed that way.

**A trap in the rig.** `rig/cb.mjs` grants the microphone through the browser's debugging port. A permission granted
that way makes Chrome refuse every other, persistent storage included, so every ordinary rig run reports "not yet
protected" whatever the site does. `rig/persist-check.mjs` opens its own browser without it.
