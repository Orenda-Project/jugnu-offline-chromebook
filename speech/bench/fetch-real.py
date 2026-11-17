#!/usr/bin/env python3
"""
Real voices reading a KNOWN text, from two open datasets (no children's voices are ever committed: audio/ is gitignored).

  python3 -I bench/fetch-real.py [--out audio/real] [--n-en 60] [--n-ur 40]

  so762     speechocean762 (OpenSLR 101, CC BY 4.0): children aged <= 11 reading English sentences, with an expert
            score per word (0-10). Mandarin-speaking learners of English: not Pakistani children, but real children
            reading English as a second language. A word counts as read when its score is >= 6.
  fleurs_ur Google FLEURS ur_pk (CC BY 4.0): adults reading Urdu sentences. There is no open set of children
            reading Urdu. Every word is read.

Each clip is listed twice: as it is, and with foil words put into the expected text (words the reader never said,
truth = not read), so a scorer that says "read" to everything is caught.
"""
import argparse, json, os, random, re, subprocess, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = 'https://datasets-server.huggingface.co/rows'
UA = {'User-Agent': 'read-aloud-bench/0.1'}
EN_FOILS = 'table window river yellow doctor kitchen monkey basket orange pencil rabbit seven garden purple'.split()


def rows(dataset, config, split, offset, length):
    q = urllib.parse.urlencode({'dataset': dataset, 'config': config, 'split': split, 'offset': offset, 'length': length})
    with urllib.request.urlopen(urllib.request.Request(f'{API}?{q}', headers=UA), timeout=60) as r:
        return json.load(r)['rows']


def save_wav(url, out_wav):
    tmp = out_wav + '.src'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(tmp, 'wb') as f:
        f.write(r.read())
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out_wav], check=True)
    os.remove(tmp)
    d = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out_wav], check=True, capture_output=True, text=True)
    return round(float(d.stdout.strip()), 2)


def lev(a, b):
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        p, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (ca != cb))
    return d[-1]


def with_foils(words, truth, pool, rng, share=0.15):
    """Foil words inserted into the expected text: the reader never said them."""
    w, t = list(words), list(truth)
    k = max(1, round(len(words) * share))
    for _ in range(k):
        cands = [f for f in pool if all(lev(f.lower(), x.lower()) >= 2 for x in w)]
        if not cands:
            break
        at = rng.randrange(0, len(w) + 1)
        w.insert(at, rng.choice(cands)); t.insert(at, False)
    return w, t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'audio', 'real'))
    ap.add_argument('--n-en', type=int, default=60)
    ap.add_argument('--n-ur', type=int, default=40)
    a = ap.parse_args()
    rng = random.Random(762)
    manifest = []

    # English children
    out = os.path.join(os.path.abspath(a.out), 'so762'); os.makedirs(out, exist_ok=True)
    got, off = 0, 0
    while got < a.n_en and off < 2500:
        for r in rows('mispeech/speechocean762', 'default', 'test', off, 100):
            x = r['row']
            if got >= a.n_en or int(x.get('age') or 99) > 11 or len(x['words']) < 5:
                continue
            words = [w['text'].lower() for w in x['words']]
            truth = [int(w['accuracy']) >= 6 for w in x['words']]
            iid = f'so762.{r["row_idx"]:04d}'
            dur = save_wav(x['audio'][0]['src'], os.path.join(out, iid + '.wav'))
            base = {'lang': 'en', 'kind': 'passage', 'passage_id': iid, 'band': 0, 'file': iid + '.wav', 'noise': 'as recorded', 'dur_s': dur,
                    'voice': f'child {x.get("age")}y {x.get("gender")}', 'source': 'speechocean762', 'word_scores': [int(w['accuracy']) for w in x['words']]}
            manifest.append({**base, 'id': iid, 'variant': 'as read', 'expected': ' '.join(words), 'truth': truth})
            fw, ft = with_foils(words, truth, EN_FOILS, rng)
            manifest.append({**base, 'id': iid + '.foil', 'variant': 'foil', 'expected': ' '.join(fw), 'truth': ft})
            got += 1
        off += 100
    print('speechocean762 children:', got)

    # Urdu adults
    out = os.path.join(os.path.abspath(a.out), 'fleurs_ur'); os.makedirs(out, exist_ok=True)
    rs = rows('google/fleurs', 'ur_pk', 'test', 0, 100)
    pool = sorted({w for r in rs for w in re.sub(r'[۔،؟!.,"\']', ' ', r['row']['transcription']).split() if len(w) >= 4})
    got = 0
    seen = set()
    for r in rs:
        x = r['row']
        if got >= a.n_ur:
            break
        text = re.sub(r'\s+', ' ', x['transcription']).strip()
        words = text.split()
        if text in seen or not (8 <= len(words) <= 40):
            continue
        seen.add(text)
        iid = f'fleurs_ur.{r["row_idx"]:04d}'
        dur = save_wav(x['audio'][0]['src'], os.path.join(out, iid + '.wav'))
        base = {'lang': 'ur', 'kind': 'passage', 'passage_id': iid, 'band': 0, 'file': iid + '.wav', 'noise': 'as recorded', 'dur_s': dur,
                'voice': f'adult {x.get("gender")}', 'source': 'fleurs ur_pk'}
        truth = [True] * len(words)
        manifest.append({**base, 'id': iid, 'variant': 'as read', 'expected': text, 'truth': truth})
        fw, ft = with_foils(words, truth, pool, rng)
        manifest.append({**base, 'id': iid + '.foil', 'variant': 'foil', 'expected': ' '.join(fw), 'truth': ft})
        got += 1
    print('fleurs ur_pk adults:', got)

    for sub in ('so762', 'fleurs_ur'):
        items = [m for m in manifest if m['file'].startswith(sub)]
        json.dump(items, open(os.path.join(os.path.abspath(a.out), sub, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(sub, len(items), 'items', round(sum(m['dur_s'] for m in items) / 120, 1), 'min of audio')


if __name__ == '__main__':
    main()
