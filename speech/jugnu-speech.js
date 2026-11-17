/*
 * Read-aloud scoring ON the device, no network (window.JugnuSpeech; needs match.js before it).
 *
 *   JugnuSpeech.score(audio, expectedText, lang, o?) → Promise<{
 *       words: [{ text, read, state }],   state: 'read' · 'skipped' (passed over) · 'ahead' (not reached) · 'unknown' (pending)
 *       correct, total, wcpm, seconds, confidence (0–1), engine, ms,
 *       pending }                          pending: true → not scored here; the recording is kept for scoring online
 *     audio: a Blob / File (what MediaRecorder gives, or a wav) or a Float32Array of 16 kHz mono samples
 *     lang:  'en' | 'ur'
 *     o.kind: 'passage' (default) | 'words' | 'letters';  o.seconds: the reading time the page measured (else the
 *             time from the first to the last sound in the recording);  o.engine: force one;  o.id: a key for later
 *   JugnuSpeech.can(lang, kind)      'device' | 'later': where a reading of this kind is scored
 *   JugnuSpeech.prepare(langs, log)  loads each language's model once (Get ready calls it; the files are then kept)
 *   JugnuSpeech.release()            gives the model's memory back when the reading part is over
 *   JugnuSpeech.files(langs)         every URL a language needs, for the offline worker to save
 *   JugnuSpeech.later                recordings waiting for the online scorer: list(), take(id), count()
 *   JugnuSpeech.configure({ lib, models, engines, worker })   where the libraries and the model files are served from;
 *                                    worker: false runs the model in the page itself (it freezes while it listens)
 *
 * How it scores: a small speech model runs in a worker of this page (WebAssembly, one thread), writes down the words it hears,
 * and Jugnu's own word rules (match.js) line them up with the printed text. Nothing leaves the device.
 * Which model per language, and what was measured: speech/README.md.
 */
(function () {
  'use strict';
  // This one file is both the page's API and, started again as a Worker, the place the model runs: the page stays
  // free (a Chromebook has two cores) while the reading is scored.
  var IN_WORKER = typeof document === 'undefined' && typeof importScripts === 'function';
  var G = IN_WORKER ? self : window;
  var here = IN_WORKER ? self.location.href : ((document.currentScript && document.currentScript.src) || location.href);
  if (IN_WORKER && !G.JugnuMatch) importScripts(new URL('match.js', here).href);
  var M = G.JugnuMatch;
  var CFG = {
    worker: true,                           // false: run the model in the page itself (the measurements do)
    lib: new URL('lib/', here).href,        // transformers.min.js, ort.wasm.min.mjs and their .wasm files
    models: new URL('models/', here).href,  // <repo>/… as on Hugging Face; dolphin/base/…
    engines: { en: 'moonshine-base', ur: 'dolphin-base' },
    // a reading of this kind in this language is scored on the device; everything else is kept for the online scorer
    // (letter sounds are never scored here: no small model hears a lone sound; Urdu word lists were too weak, 70%)
    device: { en: { passage: true, words: true }, ur: { passage: true } },
  };
  var SR = 16000;

  var ENGINES = {
    // bias: the head start the passage's own word pieces get (measured at 0, 3, 4 and 5: speech/README.md)
    'moonshine-tiny': { kind: 'tjs', repo: 'onnx-community/moonshine-tiny-ONNX', langs: ['en'], maxSec: 12, bias: 4 },
    'moonshine-base': { kind: 'tjs', repo: 'onnx-community/moonshine-base-ONNX', langs: ['en'], maxSec: 12, bias: 4 },
    'whisper-tiny.en': { kind: 'tjs', repo: 'onnx-community/whisper-tiny.en', langs: ['en'], maxSec: 28, whisper: true, mono: true },
    'whisper-tiny': { kind: 'tjs', repo: 'onnx-community/whisper-tiny', langs: ['en', 'ur'], maxSec: 28, whisper: true },
    'whisper-base': { kind: 'tjs', repo: 'onnx-community/whisper-base', langs: ['en', 'ur'], maxSec: 28, whisper: true },
    'dolphin-base': { kind: 'ctc', dir: 'dolphin/base', langs: ['ur'], maxSec: 28, sound: true, quiet: 3 },
  };
  var TJS_FILES = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
  var LIB_TJS = ['transformers.min.js', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];
  var LIB_ORT = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

  function now() { return performance.now(); }

  // ── audio ─────────────────────────────────────────────────────────────────────────────────────────
  /** Blob / ArrayBuffer / Float32Array → Float32Array, 16 kHz mono. */
  function pcm(audio) {
    if (audio instanceof Float32Array) return Promise.resolve(audio);
    var buf = audio instanceof ArrayBuffer ? Promise.resolve(audio) : audio.arrayBuffer();
    return buf.then(function (ab) {
      var wav = wavPcm(ab);
      if (wav) return wav;
      var AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var probe = new AC(1, 1, SR);
      return probe.decodeAudioData(ab.slice(0)).then(function (dec) {
        var off = new AC(1, Math.max(1, Math.ceil(dec.duration * SR)), SR);
        var src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
        return off.startRendering().then(function (r) { return r.getChannelData(0); });
      });
    });
  }

  /** A 16 kHz mono 16-bit wav read directly (no decoder needed); anything else → null. */
  function wavPcm(ab) {
    var v = new DataView(ab);
    if (ab.byteLength < 44 || v.getUint32(0, false) !== 0x52494646 || v.getUint32(8, false) !== 0x57415645) return null;
    var p = 12; var fmt = null;
    while (p + 8 <= ab.byteLength) {
      var id = v.getUint32(p, false); var sz = v.getUint32(p + 4, true);
      if (id === 0x666d7420) fmt = { tag: v.getUint16(p + 8, true), ch: v.getUint16(p + 10, true), sr: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
      if (id === 0x64617461) {
        if (!fmt || fmt.tag !== 1 || fmt.ch !== 1 || fmt.sr !== SR || fmt.bits !== 16) return null;
        var n = Math.min(sz, ab.byteLength - p - 8) >> 1; var out = new Float32Array(n);
        for (var i = 0; i < n; i += 1) out[i] = v.getInt16(p + 8 + i * 2, true) / 32768;
        return out;
      }
      p += 8 + sz + (sz & 1);
    }
    return null;
  }

  /** Loudness every 20 ms. */
  function energy(x) {
    var hop = 320; var n = Math.floor(x.length / hop); var e = new Float32Array(n);
    for (var i = 0; i < n; i += 1) { var s = 0; for (var j = i * hop; j < (i + 1) * hop; j += 1) s += x[j] * x[j]; e[i] = Math.sqrt(s / hop); }
    return e;
  }

  /** From the first sound to the last, in seconds: the reading time when the page did not measure one. */
  function spoken(x) {
    var e = energy(x); if (!e.length) return { from: 0, to: 0 };
    var sorted = Array.prototype.slice.call(e).sort(function (a, b) { return a - b; });
    var thr = Math.max(sorted[Math.floor(sorted.length * 0.1)] * 3, sorted[Math.floor(sorted.length * 0.95)] * 0.12);
    var a = 0; var b = e.length - 1;
    while (a < b && e[a] < thr) a += 1;
    while (b > a && e[b] < thr) b -= 1;
    return { from: a * 0.02, to: (b + 1) * 0.02 };
  }

  /** Pieces of at most maxSec, cut where the reader is quietest (children pause between words). */
  function pieces(x, maxSec) {
    var max = Math.floor(maxSec * SR); var out = []; var p = 0;
    if (x.length <= max) return [x];
    var e = energy(x);
    while (x.length - p > max) {
      var lo = Math.floor((p + max * 0.5) / 320); var hi = Math.floor((p + max) / 320) - 5; var best = hi; var bv = Infinity;
      for (var i = hi; i >= lo; i -= 1) {
        var s = 0; for (var k = -5; k <= 5; k += 1) s += e[Math.min(e.length - 1, Math.max(0, i + k))];
        if (s < bv) { bv = s; best = i; }
      }
      var cut = best * 320;
      out.push(x.subarray(p, cut)); p = cut;
    }
    out.push(x.subarray(p));
    return out;
  }

  // ── engine: transformers.js (Moonshine, Whisper) ─────────────────────────────────────────────────
  var tjs = null; var loaded = {};
  function tjsLib() {
    if (!tjs) {
      tjs = import(CFG.lib + 'transformers.min.js').then(function (T) {
        // a path on this origin (transformers.js skips the tokenizer and the feature settings when given a full URL)
        T.env.allowLocalModels = true; T.env.localModelPath = new URL(CFG.models, G.location.href).pathname; T.env.allowRemoteModels = false;
        T.env.useBrowserCache = false;                      // the offline worker keeps the files
        T.env.backends.onnx.wasm.wasmPaths = CFG.lib; T.env.backends.onnx.wasm.numThreads = 1; T.env.backends.onnx.wasm.proxy = false;
        return T;
      });
    }
    return tjs;
  }
  function loadTjs(name) {
    var E = ENGINES[name];
    return tjsLib().then(function (T) {
      return T.pipeline('automatic-speech-recognition', E.repo, { dtype: 'q8', device: 'wasm' });
    }).then(function (asr) {
      return tjsLib().then(function (T) {
        // We know the text: the passage's own word pieces get a small head start (o.bias, in logits). A word that sounds
        // like something else is still heard as that; a name or a child's unclear word leans to what is printed.
        function Lean(ids, bias) { var p = new T.LogitsProcessor(); p._call = function (inputIds, logits) {
          var d = logits.data; var V = logits.dims[logits.dims.length - 1];
          for (var r = 0; r < d.length; r += V) for (var k = 0; k < ids.length; k += 1) d[r + ids[k]] += bias;
          return logits;
        }; return p; }
        function pieceIds(expected) {
          var seen = {}; var ids = [];
          String(expected || '').split(/\s+/).forEach(function (w) {
            var b = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''); if (!b) return;
            var cap = b.charAt(0).toUpperCase() + b.slice(1);
            [b, ' ' + b, b.toLowerCase(), ' ' + b.toLowerCase(), cap, ' ' + cap].forEach(function (v) {
              asr.tokenizer.encode(v, { add_special_tokens: false }).forEach(function (id) { if (!seen[id]) { seen[id] = 1; ids.push(id); } });
            });
          });
          return ids;
        }
        return {
          hear: function (x, lang, expected, opt) {
            var parts = pieces(x, E.maxSec); var text = []; var i = 0;
            var bias = opt && opt.bias != null ? opt.bias : (E.bias || 0);
            var lean = bias > 0 && expected ? [Lean(pieceIds(expected), bias)] : null;
            function next() {
              if (i >= parts.length) return Promise.resolve(text.join(' '));
              var part = parts[i]; i += 1; var sec = part.length / SR;
              var o = E.whisper ? { max_new_tokens: Math.min(440, Math.ceil(sec * 6) + 16) } : { max_new_tokens: Math.ceil(sec * 6.5) + 4 };
              if (E.whisper && !E.mono) { o.language = lang === 'ur' ? 'urdu' : 'english'; o.task = 'transcribe'; }
              if (lean) o.logits_processor = lean;
              return asr(part, o).then(function (r) { text.push((r && r.text) || ''); return next(); });
            }
            return next();
          },
        };
      });
    });
  }

  // ── engine: a CTC model on onnxruntime-web (Dolphin: Urdu) ───────────────────────────────────────
  var ortLib = null;
  function ort() {
    if (!ortLib) ortLib = import(CFG.lib + 'ort.wasm.min.mjs').then(function (o) { o.env.wasm.wasmPaths = CFG.lib; o.env.wasm.numThreads = 1; o.env.wasm.proxy = false; return o; });
    return ortLib;
  }

  // 80 mel bands the way the model was trained (librosa-style: 512-point FFT of a 500-sample Hann window every 10 ms,
  // Slaney mel scale and area normalisation, natural log), checked against kaldi-native-fbank to 2e-4.
  var MEL = null; var HANN = null;
  function melBank() {
    if (MEL) return MEL;
    var nfft = 512; var nb = 80; var bins = nfft / 2 + 1; var k; var i;
    var h2m = function (f) { return f >= 1000 ? 15 + Math.log(f / 1000) / (Math.log(6.4) / 27) : f / (200 / 3); };
    var m2h = function (m) { return m >= 15 ? 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)) : m * (200 / 3); };
    var pts = []; var top = h2m(8000);
    for (k = 0; k < nb + 2; k += 1) pts.push(m2h(top * k / (nb + 1)));
    MEL = [];
    for (k = 0; k < nb; k += 1) {
      var row = { at: 0, w: [] }; var norm = 2 / (pts[k + 2] - pts[k]);
      for (i = 0; i < bins; i += 1) {
        var f = i * SR / nfft;
        var w = Math.max(0, Math.min((f - pts[k]) / (pts[k + 1] - pts[k]), (pts[k + 2] - f) / (pts[k + 2] - pts[k + 1])));
        if (w > 0) { if (!row.w.length) row.at = i; row.w.push(w * norm); }
      }
      MEL.push(row);
    }
    HANN = new Float64Array(500);
    for (i = 0; i < 500; i += 1) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / 500);
    return MEL;
  }
  function fft(re, im) {   // in place, length a power of two
    var n = re.length; var i; var j = 0; var k; var t;
    for (i = 1; i < n; i += 1) {
      k = n >> 1; while (j & k) { j ^= k; k >>= 1; } j ^= k;
      if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len; var wr = Math.cos(ang); var wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1; var ci = 0;
        for (k = 0; k < len / 2; k += 1) {
          var a = i + k; var b = a + len / 2;
          var xr = re[b] * cr - im[b] * ci; var xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  function fbank(x, mean, inv) {
    var mel = melBank(); var N = x.length; var T = Math.floor((N + 80) / 160); var out = new Float32Array(T * 80);
    var re = new Float64Array(512); var im = new Float64Array(512); var pw = new Float64Array(257);
    for (var t = 0; t < T; t += 1) {
      var s = t * 160 + 80 - 250; var i;
      for (i = 0; i < 500; i += 1) {
        var p = s + i; if (p < 0) p = -p - 1; if (p >= N) p = 2 * N - 1 - p;
        re[i] = (p >= 0 && p < N ? x[p] : 0) * HANN[i]; im[i] = 0;
      }
      for (i = 500; i < 512; i += 1) { re[i] = 0; im[i] = 0; }
      fft(re, im);
      for (i = 0; i < 257; i += 1) pw[i] = re[i] * re[i] + im[i] * im[i];
      for (var k = 0; k < 80; k += 1) {
        var row = mel[k]; var acc = 0;
        for (i = 0; i < row.w.length; i += 1) acc += row.w[i] * pw[row.at + i];
        out[t * 80 + k] = (Math.log(Math.max(acc, 1.1920929e-7)) - mean[k]) * inv[k];
      }
    }
    return { data: out, frames: T };
  }

  function loadCtc(name) {
    var E = ENGINES[name]; var base = CFG.models + E.dir + '/';
    return Promise.all([ort(), fetch(base + 'tokens.txt').then(function (r) { return r.text(); }), fetch(base + 'meta.json').then(function (r) { return r.json(); })])
      .then(function (got) {
        var o = got[0]; var meta = got[2];
        var toks = got[1].split('\n').filter(Boolean).map(function (l) { return l.slice(0, l.lastIndexOf(' ')); });
        // The model has one output for 40 languages. Only pieces written in Hindi or Urdu letters may be heard (in noise
        // it otherwise drifts into other alphabets), and "nothing was said" (the CTC blank) is made a little less
        // likely (E.quiet, in log-probability): a small model under noise prefers silence to a word it is unsure of.
        var allowed = [];
        toks.forEach(function (t, i) { if (i > 4 && /^[▁\u0900-\u097F\u0600-\u06FF .,?!]+$/.test(t)) allowed.push(i); });
        // (Leaning each frame towards the passage's own word pieces, as the English engines do, was measured and made
        // Urdu WORSE: 82.6% → 75.6% agreement on real readers. A CTC model has no memory of what it just wrote.)
        return o.InferenceSession.create(base + 'model.int8.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }).then(function (sess) {
          function hearPart(x, quiet) {
            var fb = fbank(x, meta.mean, meta.invstd);
            var feeds = { x: new o.Tensor('float32', fb.data, [1, fb.frames, 80]), x_len: new o.Tensor('int64', BigInt64Array.from([BigInt(fb.frames)]), [1]) };
            return sess.run(feeds).then(function (res) {
              var lp = res[sess.outputNames[0]]; var T = lp.dims[1]; var V = lp.dims[2]; var d = lp.data; var out = ''; var prev = -1; var n = allowed.length;
              for (var t = 0; t < T; t += 1) {
                var off = t * V; var best = 0; var bv = d[off] - quiet;
                for (var k = 0; k < n; k += 1) { var v = d[off + allowed[k]]; if (v > bv) { bv = v; best = allowed[k]; } }
                if (best !== prev && best > 0) out += toks[best];
                prev = best;
              }
              return out.replace(/▁/g, ' ');
            });
          }
          return {
            hear: function (x, lang, expected, opt) {
              var parts = pieces(x, E.maxSec); var text = []; var i = 0;
              var quiet = opt && opt.quiet != null ? opt.quiet : (E.quiet || 0);
              function next() { if (i >= parts.length) return Promise.resolve(text.join(' ')); var p = parts[i]; i += 1; return hearPart(p, quiet).then(function (s) { text.push(s); return next(); }); }
              return next();
            },
          };
        });
      });
  }

  function engine(name) {
    if (!ENGINES[name]) return Promise.reject(new Error('no such engine: ' + name));
    if (!loaded[name]) {
      var t0 = now();
      loaded[name] = (ENGINES[name].kind === 'ctc' ? loadCtc(name) : loadTjs(name)).then(function (e) { e.loadMs = Math.round(now() - t0); return e; });
      loaded[name].catch(function () { delete loaded[name]; });
    }
    return loaded[name];
  }

  // ── where the model runs: a worker (default) or this page ───────────────────────────────────────
  if (IN_WORKER) {
    self.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.cfg) { CFG.lib = m.cfg.lib; CFG.models = m.cfg.models; }
      engine(m.name).then(function (e) {
        return (m.x ? e.hear(m.x, m.lang, m.expected, m.opt) : Promise.resolve('')).then(function (text) { self.postMessage({ id: m.id, text: text, loadMs: e.loadMs }); });
      }).catch(function (err) { self.postMessage({ id: m.id, error: String((err && err.message) || err) }); });
    };
    return;
  }
  var worker = null; var calls = {}; var seq = 0;
  /** The words heard in x (x = null: only load the model) → { text, loadMs }. */
  function hearOn(name, x, lang, expected, o) {
    if (!CFG.worker || typeof Worker === 'undefined') {
      return engine(name).then(function (e) { return (x ? e.hear(x, lang, expected, o) : Promise.resolve('')).then(function (text) { return { text: text, loadMs: e.loadMs }; }); });
    }
    if (!worker) {
      worker = new Worker(here);
      worker.onmessage = function (ev) { var m = ev.data; var c = calls[m.id]; if (!c) return; delete calls[m.id]; if (m.error) c.no(new Error(m.error)); else c.ok(m); };
      worker.onerror = function (ev) {
        Object.keys(calls).forEach(function (k) { calls[k].no(new Error('speech worker: ' + ((ev && ev.message) || 'stopped'))); delete calls[k]; });
        worker = null;
      };
    }
    return new Promise(function (ok, no) {
      seq += 1; calls[seq] = { ok: ok, no: no };
      var copy = x ? x.slice() : null;
      worker.postMessage({ id: seq, cfg: { lib: CFG.lib, models: CFG.models }, name: name, x: copy, lang: lang, expected: expected, opt: { bias: o && o.bias, quiet: o && o.quiet } }, copy ? [copy.buffer] : []);
    });
  }

  // ── recordings kept for the online scorer ────────────────────────────────────────────────────────
  var db = null;
  function store(mode) {
    if (!db) {
      db = new Promise(function (ok, no) {
        var rq = indexedDB.open('jugnu-speech', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('later', { keyPath: 'id' }); };
        rq.onsuccess = function () { ok(rq.result); }; rq.onerror = function () { no(rq.error); };
      });
    }
    return db.then(function (d) { return d.transaction('later', mode).objectStore('later'); });
  }
  function rq(r) { return new Promise(function (ok, no) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); }
  var later = {
    put: function (row) { return store('readwrite').then(function (s) { return rq(s.put(row)); }); },
    list: function () { return store('readonly').then(function (s) { return rq(s.getAll()); }); },
    count: function () { return store('readonly').then(function (s) { return rq(s.count()); }); },
    /** The recording, removed from the device: call it once the online scorer has it. */
    take: function (id) { return store('readwrite').then(function (s) { return rq(s.get(id)).then(function (row) { return rq(s.delete(id)).then(function () { return row; }); }); }); },
  };

  // ── the API ──────────────────────────────────────────────────────────────────────────────────────
  function can(lang, kind) {
    var d = CFG.device[lang]; var name = CFG.engines[lang];
    return d && d[kind || 'passage'] && name && ENGINES[name] ? 'device' : 'later';
  }

  function pendingResult(audio, expected, lang, o, why) {
    var id = (o && o.id) || ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    var words = String(expected || '').split(/\s+/).filter(Boolean).map(function (w) { return { text: w, read: false, state: 'unknown' }; });
    var keep = audio instanceof Float32Array ? audio.buffer : audio;
    return later.put({ id: id, at: new Date().toISOString(), lang: lang, kind: (o && o.kind) || 'passage', expected: expected, seconds: (o && o.seconds) || null, audio: keep, why: why })
      .then(function () { return { words: words, correct: null, total: words.length, wcpm: null, seconds: (o && o.seconds) || null, confidence: 0, engine: 'later', pending: true, id: id, why: why }; });
  }

  function score(audio, expected, lang, o) {
    o = o || {};
    var kind = o.kind || 'passage';
    var name = o.engine || CFG.engines[lang];
    if (!o.engine && can(lang, kind) !== 'device') return pendingResult(audio, expected, lang, o, 'not scored on the device');
    var t0 = now();
    return pcm(audio).then(function (x) {
      var t1 = now();
      return hearOn(name, x, lang, expected, o).then(function (h) {
        var t2 = now(); var text = h.text;
        var s = M.score(expected, text, { sound: lang === 'ur' ? 'ur' : 'en' });
        var sp = spoken(x); var seconds = o.seconds || Math.max(0.5, sp.to - sp.from);
        var attempted = s.reached || 0;
        // how sure: the share of the words reached that were heard; nothing heard at all → 0
        var confidence = s.heard === 0 ? 0 : Math.round(100 * (attempted ? s.correct / attempted : 0)) / 100;
        return { words: s.words, correct: s.correct, total: s.words.length, wcpm: M.wcpm(s.correct, seconds), seconds: Math.round(seconds * 10) / 10,
          confidence: confidence, engine: 'device:' + name, pending: false, heard: text,
          ms: { decode: Math.round(t1 - t0), hear: Math.round(t2 - t1), load: h.loadMs, audio: Math.round(x.length / SR * 1000) } };
      });
    }).catch(function (err) {
      if (o.engine) throw err;
      return pendingResult(audio, expected, lang, o, String((err && err.message) || err).slice(0, 120));
    });
  }

  function files(langs) {
    var out = [];
    (langs || Object.keys(CFG.engines)).forEach(function (l) {
      var name = CFG.engines[l]; var E = ENGINES[name]; if (!E) return;
      if (E.kind === 'tjs') { LIB_TJS.forEach(function (f) { out.push(CFG.lib + f); }); TJS_FILES.forEach(function (f) { out.push(CFG.models + E.repo + '/' + f); }); }
      else { LIB_ORT.forEach(function (f) { out.push(CFG.lib + f); }); ['model.int8.onnx', 'tokens.txt', 'meta.json'].forEach(function (f) { out.push(CFG.models + E.dir + '/' + f); }); }
    });
    return out.filter(function (u, i) { return out.indexOf(u) === i; });
  }

  function prepare(langs, log) {
    var ls = langs || Object.keys(CFG.engines); var i = 0; var done = {};
    function next() {
      if (i >= ls.length) return Promise.resolve(done);
      var l = ls[i]; i += 1; var name = CFG.engines[l];
      return hearOn(name, null).then(function (e) { done[l] = { engine: name, loadMs: e.loadMs }; if (log) log('speech ' + l + ': ' + name + ' ready (' + e.loadMs + ' ms)'); },
        function (err) { done[l] = { engine: name, error: String((err && err.message) || err) }; if (log) log('speech ' + l + ': ' + name + ' NOT ready: ' + done[l].error); }).then(next);
    }
    return next();
  }

  /** Gives the model's memory back (about 0.3–0.5 GB): call it when the reading part is over. The next score() loads it again. */
  function release() {
    if (worker) { worker.terminate(); worker = null; }
    Object.keys(calls).forEach(function (k) { calls[k].no(new Error('released')); delete calls[k]; });
  }

  function configure(c) {
    Object.keys(c || {}).forEach(function (k) { if (c[k] && typeof c[k] === 'object') Object.assign(CFG[k], c[k]); else CFG[k] = c[k]; });
    return CFG;
  }

  window.JugnuSpeech = { score: score, can: can, prepare: prepare, release: release, files: files, later: later, configure: configure, engines: ENGINES,
    _: { pcm: pcm, engine: engine, hearOn: hearOn, pieces: pieces, spoken: spoken, fbank: fbank } };
})();
