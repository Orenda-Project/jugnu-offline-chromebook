# Read-aloud scored on the Chromebook

Jugnu's reading items ask a child to read aloud. Today the words are checked by a speech service on the internet.
This folder scores a reading **on the device, with no network**: a small speech model runs in a worker of the page,
writes down the words it hears, and Jugnu's own word rules line them up with the printed text.

```html
<script src="/__cb/speech/match.js"></script>
<script src="/__cb/speech/jugnu-speech.js"></script>
<script>
  // audio: the Blob a MediaRecorder gives (or a wav, or 16 kHz samples); lang: 'en' | 'ur'
  JugnuSpeech.score(audio, expectedText, lang, { kind: 'passage', seconds: 42 }).then(function (r) {
    // r.words   [{ text, read, state }]   state: 'read' · 'skipped' (passed over) · 'ahead' (not reached) · 'unknown'
    // r.correct, r.total, r.wcpm, r.seconds, r.confidence (0–1), r.engine
    // r.pending true: not scored here (letter sounds, Urdu word lists, or the model is not on this device);
    //                 the recording is kept on the device for the online scorer: JugnuSpeech.later.list() / take(id)
  });
</script>
```

- `JugnuSpeech.can(lang, kind)` says `'device'` or `'later'` before you record (`kind`: `passage`, `words`, `letters`).
- A word is never "wrong": it is read, passed over, or not reached, as in Jugnu's live reading.
- `o.seconds` is the reading time your page measured; without it, the time from the first to the last sound.
- The model loads on the first call (about 10 seconds at Chromebook speed) and stays for the next child;
  `JugnuSpeech.release()` gives its memory back.
- Get ready saves everything (`ready/speech.js`): about 95 MB for English and 120 MB for Urdu on the device.
- Try it by hand: `/__cb/speech/proto.html`. With the network off on the rig: `node rig/speech-offline.mjs`.

## What runs

| Language | Model | Files on the device | How the text we know is used |
|---|---|---|---|
| English | Moonshine base (MIT), through transformers.js | 63 MB model + 28 MB library | the passage's own word pieces get a small head start while it listens |
| Urdu | Dolphin base CTC (Apache 2.0), through onnxruntime-web | 104 MB model + 15 MB library | it may only write Hindi or Urdu letters; printed and heard words are compared by sound |

Both run on one WebAssembly thread (a Jugnu page is not cross-origin isolated, so there are no threads to use).
Every file comes from a fixed version or commit (`sources.json`); the pilot server fetches each once and serves it
from its own address, so the offline worker keeps it like any other file.

Urdu needs one explanation. Dolphin has a single output for 40 languages, and it writes Urdu speech in Hindi letters
as often as in Urdu ones, sometimes both inside one word. Spoken, the two are one language, so `match.js` turns the
printed Urdu word and whatever was heard into the same rough sound key before comparing (`soundKey`).

## What was measured

Chrome 156, the models on one thread, the CPU slowed with Chrome's own throttle to stand in for a Celeron N4000.
The full write-up (method, every number, what is still unknown) is kept with the pilot's investigation notes. In short:

| Word agreement with the ground truth | English passage (Moonshine base) | Urdu passage (Dolphin base) |
|---|---|---|
| Synthetic readings with known skips and wrong words, clean | 99% | 93% (Hindi voice) |
| The same with classroom babble at 10 dB | 94% | 74% |
| Real voices | 79% (60 children aged 6–7, speechocean762) | 85% (40 adults, FLEURS) |
| Words never said that were marked read (real voices) | 0 of 60 | 0 of 145 |
| Read words that were missed (real voices) | 22% | 16% |
| Time to score a 60-second reading, CPU throttled 8× | 36 s | 71 s |
| Memory in the page while the model is loaded | 0.28 GB | 0.5 GB |

- English word lists: 99% clean, 88% with babble (synthetic). Urdu word lists (88% / 53%) and letter sounds (0–15% on
  every engine tried) are not scored here: they are kept for the online scorer.
- On real voices it under-credits and accepted no word that was not said. In babble on the synthetic set the English
  engine did mark 7% of skipped or replaced words as read (Urdu 1%). So show lit words and stars, and let the online
  scorer's count replace it in reports when the Chromebook is next connected.
- Not measured yet: a real Chromebook (every speed is a throttled laptop), and children in Islamabad reading Urdu or
  English (no open recording exists for Urdu children at all).

## Measure it yourself

```bash
cd speech && npm install && bash bench/vendor.sh && bash bench/fetch-models.sh     # libraries and models, ~450 MB
NIETE_RUMI_DIR=<a NIETE-Rumi clone> python3 bench/make-audio.py                    # synthetic readings (macOS)
python3 -I bench/fetch-real.py                                                     # children (English), adults (Urdu)
node bench/run.mjs --set syn --lang en --engines moonshine-base --throttle 8      # one line per recording
node bench/report.mjs                                                              # agreement, false read / missed, speed
bash bench/speed.sh 8 && node bench/speed-table.mjs 8                              # speed and memory, 1x and throttled
node --test test/match.test.cjs                                                    # the word rules
```

No audio, model or passage text is committed: `audio/`, `models/`, `lib/` and `bench/results/raw/` are ignored.
On a real Chromebook, open `/__cb/speech/proto.html`, record a reading, and read off "this device took".
