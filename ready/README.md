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

`space()` → `{used, free, quota, safe}` in bytes (`safe`: the browser promised not to clear it); `isFull()` (the drive
ran out: stop); `waitOnline()` (resolves when the server answers again); `child()` (the child picked on Who's
playing?, or null); `note(key, value)` (kept on the device for the start page); `videoGrades()`.

`setPct(pct, text)`: `pct` is your step's own progress 0–100 (pass `null` to change only the text).

## A step can also say

- `late: true` — runs after the start page has said "Ready" (a long, optional download, like the lesson videos).
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
