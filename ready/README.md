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
