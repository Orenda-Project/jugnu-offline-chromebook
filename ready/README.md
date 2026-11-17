# Get-ready steps

One file per area. `cb.html` loads every `ready/<name>.js` (name order) and, after its own steps, runs each step that
the file adds to `window.CB_READY`:

```js
(window.CB_READY = window.CB_READY || []).push({
  name: 'storybooks',                 // shown on the start page while it runs
  run: async (ctx) => { … },          // may return a promise; a step that throws is logged, the rest still run
});
```

`ctx`: `cfg` (the pilot config), `hub` (this Chromebook's child home token), `kid` (Jugnu's child id from the home, or
null), `games` (game links found behind the Games door), `key` (device key), `log(text)`, `warm(urls)` (the offline
worker saves every URL; resolves `{warmed}`), `frame(src, ms)` (opens a page in a hidden 1366×633 frame so it loads
its own files; resolves the frame), `abs(url)`, `ask(message)` (to the offline worker), `setPct(pct, text)`.

That contract is unchanged. What follows was added with the reliable Get ready (lane/home); all of it is optional.

## What `warm` now does for you

- It saves in small batches and each batch is answered, so progress on the start page is real (`41 of 380 files`).
- A file that fails is tried three more times; if the Wi-Fi drops, Get ready waits and carries on by itself.
- It resolves `{warmed, failed, gone, total}`: `failed` is the list of addresses that could not be saved. You do not
  have to look at it: **a step with any failed file is marked not done**, the start page does not say "Ready", and the
  next press of Get ready runs that step again (what is already saved is skipped).
- `gone` is the list the server answered `404`/`410` for: it does not have them. That is not a failed download, so it
  does not block "Ready"; the start page's log names how many and one example. If your step sees files in `gone`, it
  is building a wrong address (on 17 Nov 126 storybook `.ogg` names were, silently, for weeks).
- Every address you pass is remembered as "this step meant to save it". **Check this Chromebook** (and the end of Get
  ready) then asks the worker whether each one is really on the drive, and names the ones that are not. So: pass
  `warm` every file a child needs and the check is free.
- A file of this site counts as saved only under its **exact** address (`?g=3&s=Maths` is another list than `?g=1`).
  A file on another site counts by its path (its signature changes each time).
- Options: `warm(urls, { readable: true })` fetches media on another site (R2 clips and videos) **through this site**,
  so the saved copy can be cut into the byte ranges a player asks for and is checked for its full length (an
  ordinary cross-site copy is unreadable to the worker). `{ fresh: true }` saves again even when kept (a list that
  has changed). `{ batch, lanes }` size the batches; `{ each(done, total) }` takes over the progress text.

## More in `ctx`

`space()` → `{used, free, quota, room, safe}` in bytes (`safe`: the browser promised not to clear it); `isFull()` (the
drive ran out: stop); `waitOnline()` (resolves when the server answers again); `child()` (the child picked on Who's
playing?, or null); `note(key, value)` (kept on the device for the start page); `videoGrades()` (the classes a
teacher ticked for lesson videos: `null` when nobody has chosen, `[]` for none).

**Room.** `fits(bytes)` → `true | false | null`: will the browser really let this site keep that much more? Ask it
before a large download. Do **not** work it out from `space().free`: since Chrome 123 `navigator.storage.estimate()`
reports "what is used plus 10 GB" on every device, however full the drive is, so `free` never says no. `fits` asks
the browser itself (it reserves that much in the site's private files and gives it straight back); `null` means this
browser cannot be asked, and then `free` is all there is. `space().room` is the same answer as a number (in steps of
128 MB, as Chrome hands room out), or `null`.

`forget(urls)` takes files off the drive again (a video by its address with or without its signature, a page of this
site by its own address) and off the list of what your step meant to save. Use it when a download that must be whole
could not be finished (the lesson videos keep a class whole or not at all).

**Reading without keeping.** The worker keeps every page and list it fetches. To read one only to look inside it
(the lesson videos read 100 lesson pages to measure a class that may not fit), ask with the header
`X-CB-Keep: no`: `fetch(url, { headers: { 'X-CB-Keep': 'no' } })`. It is answered as usual and not written to the
drive; an older saved copy, if there is one, stays.

`setPct(pct, text)`: `pct` is your step's own progress 0–100 (pass `null` to change only the text).

`ask({ type: 'size', urls })` → `[{ bytes, kept }]`: how big each media file really is. `kept: true` is its length on
the drive; otherwise its length on the server, read with a one-byte request through this site (nothing is
downloaded); `bytes: null` when neither could be read. Use it before a large download to see whether it fits, and
after it to report what was kept. Do not plan room from a size in one of Jugnu's lists: those are there only for
files Jugnu looked at lately (a whole class of lesson videos came with none).

## Two caches, and never list one

Media fetched from the media store through this site (`warm(urls, { readable: true })`: lesson videos, quiz clips,
pictures) is kept in a cache of its own, `cb-media-v1`. Everything else is in `cb-pilot-v1`. To know whether a file
is on the drive, ask the worker (`ask({ type: 'have', urls })`, `ask({ type: 'size', urls })`): it looks in both, by
the file's address without its signature.

**Do not list a whole cache** (`cache.keys()` with no request). Chrome refuses once the list passes about 10 MB
("Operation too large"): 14,062 files fitted, 15,979 did not, and from then on every listing fails. With all five
classes of lesson videos saved that is where the one cache was (18 Nov 2026). Look a file up by its address
(`cache.match`, or `cache.keys(request)`), and keep the names you will need to find again in one small file of
your own, as the audit now does. (Still listing the main cache today: `sw-stories.js` "stories-missing",
`pilot-sw.js` `gChServeOf` and the file count, `games-read.js`. They work while the main cache stays under the
limit, which the media cache is there to ensure.)

## A step can also say

- `late: true` — runs after everything else, once the start page has said "Ready" (a long download that the rest
  must not wait for: the lesson videos of Classes 1 to 5, about 4.6 GB).
- `resumes: true` — your step keeps its own record of what it saved and skips it next time (the lesson videos do, per
  lesson). Without it, the list of "what this step meant to save" starts afresh each time the step runs, so pass
  `warm` everything every time (what is already on the drive costs one lookup, not a download).
- `check: async (t) => [{ name, ok, why, group? }]` — your part of **Check this Chromebook**. It runs with the worker
  reaching **no network at all** (as with the Wi-Fi off), so what passes there works offline. `t` gives you:
  - `t.open(name, url, { see, wait, settle, not })` — opens the page in a hidden 1366×633 frame from the saved copy;
    passes when the CSS selector `see` appears, the page does not say `not` (a RegExp), and nothing it asked for was
    missing. Resolves `{name, ok, why}`.
  - `t.read(url)` — a saved answer as text, or null when it is not on the device.
  - `t.media(name, url, 'video' | 'audio')` — a real player opens the saved file and reads its length.
  - `t.have([urls])` → `[true | false]`; `t.say(text)` (progress line); `t.hub()`, `t.kid()`, `t.abs()`, `t.ls()`.
  During the check **nothing is sent and nothing is queued**: a POST gets its saved answer if there is one, else a
  plain `503 {offline: true, selftest: true}`. Do not expect a session to start; check that the page opens.

## The child home's link changes; your saved copies do not

A step never needs to worry about the home link running out. The worker files every saved copy under the home's
children (not under this week's link) and swaps a stale link for the live one on the way to the server. If your area
keeps its own outbox **inside the worker** and sends later with `fetch`, pass the address or body through
`self.cbHome.live(text)` first (it resolves the same text with the live link in it); `self.cbHome.key(url)` is the
address a saved copy is filed under.
