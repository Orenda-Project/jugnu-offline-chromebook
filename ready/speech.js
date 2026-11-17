/*
 * Get ready: the read-aloud scorer that runs on the Chromebook (speech/jugnu-speech.js) and the model files it needs,
 * so a child's reading can be scored with no internet.
 *
 * Saves, through the offline worker: the scorer itself, its two libraries, and one model per language
 * (English ≈ 95 MB, Urdu ≈ 120 MB on the device). Languages: cfg.speech.langs (default both).
 * cfg.speech.check = true also loads each model once here and says whether it started (heavy: about 0.5 GB of memory
 * for a minute; off by default so a small Chromebook is not pushed during Get ready). To try it by hand afterwards:
 * /__cb/speech/proto.html.
 */
(window.CB_READY = window.CB_READY || []).push({
  name: 'speech',
  run: function (ctx) {
    var sp = (ctx.cfg && ctx.cfg.speech) || {};
    var langs = sp.langs || ['en', 'ur'];
    function script(src) {
      return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { no(new Error('could not load ' + src)); }; document.head.appendChild(s); });
    }
    return script('/__cb/speech/match.js').then(function () { return script('/__cb/speech/jugnu-speech.js'); }).then(function () {
      var files = window.JugnuSpeech.files(langs).concat(['/__cb/speech/match.js', '/__cb/speech/jugnu-speech.js', '/__cb/speech/proto.html'].map(ctx.abs));
      ctx.setPct(97, 'Read-aloud scorer: ' + files.length + ' files (the models are large, this takes a few minutes)');
      return ctx.warm(files).then(function (r) {
        ctx.log('speech: ' + (r ? r.warmed : '?') + ' new files of ' + files.length + ' for ' + langs.join(' + '));
        if (!sp.check) return null;
        return window.JugnuSpeech.prepare(langs, ctx.log);
      });
    });
  },
});
