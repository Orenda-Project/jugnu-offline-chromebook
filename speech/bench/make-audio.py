#!/usr/bin/env python3
"""
Synthetic read-alouds with KNOWN mistakes, for measuring a read-aloud scorer.

macOS only (uses `say` and ffmpeg). Passages come from a NIETE-Rumi clone at run time (practice pool only) and are
never written into this repo: the audio and its manifest go to speech/audio/syn/ (gitignored).

  NIETE_RUMI_DIR=<clone> python3 bench/make-audio.py [--out audio/syn] [--deva audio/local/ur-deva.json]

English is read by an Indian-English voice and by a US voice shifted up to a child's pitch. macOS has no Urdu voice,
so Urdu is read by the Hindi voice from a word-by-word Devanagari copy of the same passage (--deva; simple spoken
Hindi and Urdu are the same words). Every file is written twice: clean, and with classroom babble at 10 dB.

Each reading has a ground truth per printed word (read / not read):
  clean   every word
  skip    ~12% of the words left out, and one whole sentence
  sub     ~12% of the words said as a different word (never one letter away: Jugnu's rule forgives that)
  stop    the child stops a little after half way
  repeat  ~10% of the words said twice, two false starts; every word is still read
"""
import argparse, json, os, random, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000
EN_FOILS = 'table window river happy school mother garden yellow doctor kitchen monkey basket orange pencil rabbit seven because friend people animal'.split()
PASSAGES = ['en.read.1.story01', 'en.read.2.story01', 'en.read.3.story01', 'ur.read.1.story01', 'ur.read.2.story01', 'ur.read.3.story01']
BATTERY = 'bot/shared/data/child-test/sa/sa.coach.G1.A.en.json'   # the familiar words and letters come from Jugnu's battery
EN_SOUND = {'L': 'luh', 'h': 'huh', 'R': 'ruh', 'n': 'nuh', 'D': 'duh', 'S': 'sss', 'm': 'mmm', 'T': 'tuh', 'a': 'ah', 'e': 'eh'}


def sh(args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kw)


def git_show(repo, path, ref):
    return sh(['git', '-C', repo, 'show', f'{ref}:{path}']).stdout


def lev(a, b):
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (ca != cb))
    return d[-1]


def bare(w):
    return re.sub(r'[^\w؀-ۿऀ-ॿ]', '', w).lower()


def sentences(tokens):
    out, cur = [], []
    for i, t in enumerate(tokens):
        cur.append(i)
        if re.search(r'[.!?۔।]$', t):
            out.append(cur); cur = []
    if cur:
        out.append(cur)
    return out


def variant(name, shown, spoken, foils, rng):
    """shown: printed words (the truth is about these). spoken: what the voice says for each (same length).
    Returns (said: [str], truth: [bool])."""
    n = len(shown)
    truth = [True] * n
    said = []
    if name == 'clean':
        said = list(spoken)
    elif name == 'skip':
        drop = set(rng.sample(range(n), max(2, round(n * 0.12))))
        ss = sentences(spoken)
        if len(ss) >= 4:
            drop |= set(ss[len(ss) // 2])
        for i in range(n):
            if i in drop:
                truth[i] = False
            else:
                said.append(spoken[i])
    elif name == 'sub':
        pick = set(rng.sample(range(n), max(2, round(n * 0.12))))
        for i in range(n):
            if i in pick:
                cands = [f for f in foils if lev(bare(f[0]), bare(shown[i])) >= 2 and bare(f[0]) not in {bare(x) for x in shown}]
                f = rng.choice(cands)
                tail = re.search(r'[.!?۔।]$', spoken[i])
                said.append(f[1] + (tail.group(0) if tail else ''))
                truth[i] = False
            else:
                said.append(spoken[i])
    elif name == 'stop':
        cut = round(n * 0.55)
        said = list(spoken[:cut])
        truth = [i < cut for i in range(n)]
    elif name == 'repeat':
        pick = set(rng.sample(range(n), max(2, round(n * 0.10))))
        starts = set(rng.sample([i for i in range(n) if len(bare(shown[i])) >= 4], 2))
        for i in range(n):
            if i in starts:
                said.append(re.sub(r'[.!?۔।]$', '', spoken[i])[:2] + ',')   # a false start, then the word
            if i in pick:
                said.append(re.sub(r'[.!?۔।]$', '', spoken[i]))
            said.append(spoken[i])
    else:
        raise ValueError(name)
    return said, truth


def speak(text_tokens, voice, rate, halting, kid, out_wav):
    gap = '[[slnc 380]]' if halting else ''
    parts = []
    for t in text_tokens:
        parts.append(t)
        if re.search(r'[.!?۔।]$', t):
            parts.append('[[slnc 700]]')
        elif gap:
            parts.append(gap)
    with tempfile.TemporaryDirectory(dir=os.path.dirname(out_wav)) as td:
        aiff = os.path.join(td, 'a.aiff')
        sh(['say', '-v', voice, '-r', str(rate), '-o', aiff, ' '.join(parts)])
        af = f'aresample={SR}'
        if kid:   # up a child's pitch and formants, same speed
            af = f'aresample=44100,asetrate=44100*1.22,aresample=44100,atempo=1/1.22,aresample={SR}'
        sh(['ffmpeg', '-y', '-v', 'error', '-i', aiff, '-af', af, '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le', out_wav])


def mean_db(wav):
    r = subprocess.run(['ffmpeg', '-v', 'info', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    m = re.search(r'mean_volume: ([-\d.]+) dB', r.stderr)
    return float(m.group(1))


def duration(wav):
    return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).stdout.strip())


def babble(out_dir):
    """Three other voices talking at once plus a little hiss: a noisy classroom, 90 s."""
    f = os.path.join(out_dir, '_babble.wav')
    if os.path.exists(f):
        return f
    lines = [('Samantha', 'Please sit down and open your books to page ten. Who can tell me what day it is today? Very good. Now look at the board and copy the date.'),
             ('Daniel', 'One two three four five six seven eight nine ten. Give me the red pencil. No, that is mine. Teacher, he took my book. Can I drink water please?'),
             ('Lekha', 'चलो सब बच्चे अपनी जगह पर बैठ जाओ। आज हम कहानी पढ़ेंगे। किताब खोलो। पानी पीने बाद में जाना। शोर मत करो।')]
    tmp = []
    for k, (v, t) in enumerate(lines):
        a = os.path.join(out_dir, f'_b{k}.aiff')
        sh(['say', '-v', v, '-r', '170', '-o', a, ' '.join([t] * 6)])
        tmp.append(a)
    ins = []
    for a in tmp:
        ins += ['-stream_loop', '-1', '-i', a]
    sh(['ffmpeg', '-y', '-v', 'error'] + ins + ['-f', 'lavfi', '-i', f'anoisesrc=color=pink:amplitude=0.02:sample_rate={SR}',
        '-filter_complex', f'[0:a]aresample={SR}[a];[1:a]aresample={SR},adelay=1300[b];[2:a]aresample={SR},adelay=2700[c];[a][b][c][3:a]amix=inputs=4:normalize=0[o]',
        '-map', '[o]', '-t', '90', '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le', f])
    for a in tmp:
        os.remove(a)
    return f


def add_noise(clean, noise, snr_db, out_wav):
    gain = (mean_db(clean) - snr_db) - mean_db(noise)
    d = duration(clean)
    sh(['ffmpeg', '-y', '-v', 'error', '-i', clean, '-stream_loop', '-1', '-i', noise, '-filter_complex',
        f'[1:a]volume={gain}dB[n];[0:a][n]amix=inputs=2:normalize=0[o]', '-map', '[o]', '-t', f'{d:.3f}', '-ac', '1', '-ar', str(SR), '-c:a', 'pcm_s16le', out_wav])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'audio', 'syn'))
    ap.add_argument('--deva', default=os.path.join(HERE, '..', 'audio', 'local', 'ur-deva.json'))
    ap.add_argument('--ref', default='origin/sandbox')
    ap.add_argument('--snr', type=float, default=10.0)
    a = ap.parse_args()
    repo = os.environ.get('NIETE_RUMI_DIR')
    if not repo:
        sys.exit('NIETE_RUMI_DIR=<path to a NIETE-Rumi clone> is needed (the passages are read from it, never copied here)')
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    deva = json.load(open(a.deva, encoding='utf-8')) if os.path.exists(a.deva) else {}
    noise = babble(out)
    rng = random.Random(20261117)
    manifest = []

    def emit(item, said, voice, rate, halting, kid):
        wav = os.path.join(out, item['id'] + '.wav')
        speak(said, voice, rate, halting, kid, wav)
        item.update(file=os.path.basename(wav), noise='clean', dur_s=round(duration(wav), 2), voice=voice + ('+kid' if kid else ''), source='synthetic')
        manifest.append(dict(item))
        nz = dict(item)
        nz['id'] = item['id'] + '.n10'
        nz['file'] = nz['id'] + '.wav'
        nz['noise'] = f'babble{int(a.snr)}dB'
        add_noise(wav, noise, a.snr, os.path.join(out, nz['file']))
        manifest.append(nz)

    for pid in PASSAGES:
        lang = pid[:2]
        if lang == 'ur' and pid not in deva:
            print('skip (no Devanagari copy):', pid); continue
        p = json.loads(git_show(repo, f'bot/shared/data/child-test/passages/{pid}.json', a.ref))
        shown = p['text'].split()
        spoken = deva[pid].split() if lang == 'ur' else shown
        assert len(spoken) == len(shown), (pid, len(spoken), len(shown))
        foils = list(deva['ur.foils'].items()) if lang == 'ur' else [(w, w) for w in EN_FOILS]
        band = int(pid.split('.')[2])
        voices = [('Lekha', False), ('Lekha', True)] if lang == 'ur' else [('Rishi', False), ('Samantha', True)]
        for vname in ['clean', 'skip', 'sub', 'stop', 'repeat']:
            for voice, kid in voices:
                said, truth = variant(vname, shown, spoken, foils, rng)
                emit({'id': f'{pid}.{vname}.{voice.lower()}{"k" if kid else ""}', 'lang': lang, 'kind': 'passage', 'passage_id': pid, 'band': band,
                      'variant': vname, 'expected': ' '.join(shown), 'truth': truth},
                     said, voice, {1: 105, 2: 125, 3: 145}[band], band == 1, kid)

    # word lists (EGRA familiar words) and letter sounds, one at a time with a pause: the battery's own first items
    tasks = {t['id']: t for t in json.loads(git_show(repo, BATTERY, a.ref))['tasks']}
    EN_WORDS = [str(i['target']) for i in tasks['en.words']['items'][:20]]
    EN_LETTERS = [str(i['target']) for i in tasks['en.letter_sounds5']['items']] + ['S', 'm', 'T', 'a', 'e']
    for lang, shown, spoken, foils, voice in [
        ('en', EN_WORDS, EN_WORDS, [(w, w) for w in EN_FOILS], 'Rishi'),
        ('ur', list(deva.get('ur.words', {}).keys()), list(deva.get('ur.words', {}).values()), list(deva.get('ur.foils', {}).items()), 'Lekha'),
    ]:
        if not shown:
            continue
        for vname in ['clean', 'skip', 'sub']:
            for kid in [False, True]:
                v = 'Samantha' if (lang == 'en' and kid) else voice
                said, truth = variant(vname, shown, [w + '.' for w in spoken], foils, rng)
                emit({'id': f'{lang}.words.{vname}.{v.lower()}{"k" if kid else ""}', 'lang': lang, 'kind': 'words', 'passage_id': f'{lang}.words', 'band': 0,
                      'variant': vname, 'expected': ' '.join(shown), 'truth': truth}, said, v, 110, False, kid)

    # letter sounds: the sound, not the name ("luh", "huh"); Urdu letters with their short "a" (ba, ma, ka)
    for lang, shown, spoken, voice in [('en', EN_LETTERS, [EN_SOUND[x] for x in EN_LETTERS], 'Rishi'),
                                       ('ur', list(deva.get('ur.letters', {}).keys()), list(deva.get('ur.letters', {}).values()), 'Lekha')]:
        if not shown:
            continue
        for kid in [False, True]:
            v = 'Samantha' if (lang == 'en' and kid) else voice
            emit({'id': f'{lang}.lettersounds.clean.{v.lower()}{"k" if kid else ""}', 'lang': lang, 'kind': 'letters', 'passage_id': f'{lang}.letter_sounds', 'band': 0,
                  'variant': 'clean', 'expected': ' '.join(shown), 'truth': [True] * len(shown), 'spoken_as': spoken}, [w + '.' for w in spoken], v, 100, False, kid)

    json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    secs = sum(m['dur_s'] for m in manifest)
    print(f'{len(manifest)} files, {secs / 60:.1f} min of audio -> {out}')


if __name__ == '__main__':
    main()
