/*
 * Jugnu's word rules, for scoring a read-aloud on the device (window.JugnuMatch; also a CommonJS module for tests).
 *
 *   clean / same / alignPrefix   the same rules as Jugnu's live reading (dashboard/public/wq/wq-read-live.js, itself a
 *                                port of the bot's scoring/text-norm.js): Urdu letter folding, diacritics and
 *                                punctuation dropped, one edit forgiven on words of 4+ letters, and the child reads a
 *                                PREFIX of the passage, so the words heard are aligned to the best-matching prefix.
 *   fold                         as wq-liveread.js: digits, Urdu digits and number words are one word.
 *   score(expected, heard, o)    printed text + the words a recogniser heard → per word read / skipped / ahead.
 *                                o.sound ('en' | 'ur'): an extra fold for a recogniser that spells by SOUND (see
 *                                soundKey); printed words are never changed, only compared.
 *   wcpm(correct, seconds)       words correct per minute.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JugnuMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UR_MAP = { 'ي': 'ی', 'ك': 'ک', 'ه': 'ہ', 'ۂ': 'ہ', 'ۀ': 'ہ', 'ے': 'ی', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ؤ': 'و', 'ئ': 'ی', 'ة': 'ہ', 'ھ': 'ہ' };
  var DIAC = /[ً-ٰٟۖ-ۭ​-‏]/g;
  var PUNC = /[؀-؅،؛؟٪-٭۔.,!?;:"'()\-–—«»]/g;

  function clean(w) {
    var s = String(w == null ? '' : w).replace(DIAC, '').replace(PUNC, '');
    s = s.replace(/[يكهۂۀےأإآؤئةھ]/g, function (c) { return UR_MAP[c] || c; });
    return s.trim().toLowerCase();
  }

  function same(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
    var i;
    if (a.length === b.length) {
      var d = 0;
      for (i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
      return d === 1;
    }
    var s = a.length < b.length ? a : b;
    var l = a.length < b.length ? b : a;
    for (i = 0; i < l.length; i += 1) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
    return false;
  }

  function table(ref, hyp, eq, jn) {
    var n = ref.length; var m = hyp.length; var D = []; var i; var j;
    for (i = 0; i <= n; i += 1) { D.push(new Array(m + 1)); D[i][0] = i; }
    for (j = 0; j <= m; j += 1) D[0][j] = j;
    for (i = 1; i <= n; i += 1) {
      for (j = 1; j <= m; j += 1) {
        var c = eq(ref[i - 1], hyp[j - 1]) ? 0 : 1;
        D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + c);
        if (jn && i > 1 && ref[i - 2] + ref[i - 1] === hyp[j - 1]) D[i][j] = Math.min(D[i][j], D[i - 2][j - 1]);
        if (jn && j > 1 && hyp[j - 2] + hyp[j - 1] === ref[i - 1]) D[i][j] = Math.min(D[i][j], D[i - 1][j - 2]);
      }
    }
    return D;
  }

  function back(D, ref, hyp, eq, i0, jn) {
    var i = i0; var j = hyp.length; var ins = 0;
    var status = []; var hypIdx = []; var k;
    for (k = 0; k < ref.length; k += 1) { status.push('omit'); hypIdx.push(-1); }
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (eq(ref[i - 1], hyp[j - 1]) ? 0 : 1)) {
        status[i - 1] = eq(ref[i - 1], hyp[j - 1]) ? 'correct' : 'sub';
        hypIdx[i - 1] = j - 1; i -= 1; j -= 1;
      } else if (jn && i > 1 && j > 0 && ref[i - 2] + ref[i - 1] === hyp[j - 1] && D[i][j] === D[i - 2][j - 1]) {
        status[i - 1] = status[i - 2] = 'correct'; hypIdx[i - 1] = hypIdx[i - 2] = j - 1; i -= 2; j -= 1;
      } else if (jn && i > 0 && j > 1 && hyp[j - 2] + hyp[j - 1] === ref[i - 1] && D[i][j] === D[i - 1][j - 2]) {
        status[i - 1] = 'correct'; hypIdx[i - 1] = j - 1; i -= 1; j -= 2;
      } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
        status[i - 1] = 'omit'; i -= 1;
      } else {
        ins += 1; j -= 1;
      }
    }
    return { status: status, hypIdx: hypIdx, ins: ins };
  }

  function alignPrefix(ref, hyp, eq, o) {
    var e = eq || same; var jn = !!(o && o.join);
    var D = table(ref, hyp, e, jn); var m = hyp.length; var best = 0; var i;
    for (i = 1; i <= ref.length; i += 1) if (D[i][m] < D[best][m]) best = i;
    return back(D, ref, hyp, e, best, jn);
  }

  // numerals: every spelling of a number is one word (wq-liveread.js)
  var NUM_EN = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
  var NUM_UR = 'صفر ایک دو تین چار پانچ چھ سات آٹھ نو دس گیارہ بارہ تیرہ چودہ پندرہ سولہ سترہ اٹھارہ انیس بیس'.split(' ');
  var NUMS = {};
  NUM_EN.forEach(function (w, n) { NUMS[clean(w)] = String(n); });
  NUM_UR.forEach(function (w, n) { NUMS[clean(w)] = String(n); });
  var DIGITS = /[۰-۹٠-٩]/g;
  function digit(c) { var k = c.charCodeAt(0); return String(k >= 0x06F0 ? k - 0x06F0 : k - 0x0660); }
  function fold(w) {
    var s = clean(String(w == null ? '' : w).replace(DIGITS, digit));
    return NUMS[s] || s;
  }

  /**
   * How a word SOUNDS, for a recogniser that writes what it hears (o.sound). Used on both sides of the comparison only:
   * the printed word is never changed.
   *
   * Urdu. The small model that hears Urdu (Dolphin) writes it in Hindi letters as often as in Urdu ones: spoken, the two
   * are one language. So both the printed Urdu word and whatever was heard become the same rough sound key:
   *   consonants by sound (ح ہ ह → h · س ص ث स → s · ز ذ ض ظ ج ज ज़ → j · ت ط त थ → t · ک ق خ क ख → k · گ غ ग घ → g ·
   *   پ ف प फ → p · ش श ष → S ...), aspiration dropped (ھ, and ख घ छ ...), the long vowels Urdu writes kept as
   *   A (ا آ ा) · y (ی ے ी े ै) · w (و ू ो ौ), the short vowels Urdu does not write dropped (ि ु अ), a word-final
   *   ہ / ح / ह as A (حلوہ = हलवा, جگہ = जगह), nasalisation dropped (ں ँ ं, and ن before a consonant), a doubled sound as one.
   * English: words that sound the same are one word (for = four, flower = flour, week = weak): a recogniser picks
   * either spelling, and a child who says it has read it.
   */
  var UR_S = { 'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 'T', 'ث': 's', 'ج': 'j', 'چ': 'c', 'ح': 'h', 'خ': 'k', 'د': 'd', 'ڈ': 'D', 'ذ': 'j', 'ر': 'r', 'ڑ': 'R', 'ز': 'j', 'ژ': 'j',
    'س': 's', 'ش': 'S', 'ص': 's', 'ض': 'j', 'ط': 't', 'ظ': 'j', 'ع': 'A', 'غ': 'g', 'ف': 'p', 'ق': 'k', 'ک': 'k', 'ك': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': '',
    'و': 'w', 'ؤ': 'w', 'ہ': 'h', 'ه': 'h', 'ۂ': 'h', 'ۃ': 'h', 'ة': 'h', 'ھ': '', 'ء': '', 'ی': 'y', 'ي': 'y', 'ے': 'y', 'ئ': 'y', 'ا': 'A', 'آ': 'A', 'أ': 'A', 'إ': 'A' };
  var HI_C = { 'क': 'k', 'ख': 'k', 'ग': 'g', 'घ': 'g', 'ङ': 'n', 'च': 'c', 'छ': 'c', 'ज': 'j', 'झ': 'j', 'ञ': 'n', 'ट': 'T', 'ठ': 'T', 'ड': 'D', 'ढ': 'D', 'ण': 'n',
    'त': 't', 'थ': 't', 'द': 'd', 'ध': 'd', 'न': 'n', 'प': 'p', 'फ': 'p', 'ब': 'b', 'भ': 'b', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'w', 'श': 'S', 'ष': 'S', 'स': 's', 'ह': 'h',
    'क़': 'k', 'ख़': 'k', 'ग़': 'g', 'ज़': 'j', 'ड़': 'R', 'ढ़': 'R', 'फ़': 'p', 'य़': 'y' };
  var HI_V = { 'ा': 'A', 'ॉ': 'A', 'ी': 'y', 'े': 'y', 'ै': 'y', 'ू': 'w', 'ो': 'w', 'ौ': 'w', 'ृ': 'r', 'ि': '', 'ु': '' };       // matras
  var HI_I = { 'अ': '', 'आ': 'A', 'ऑ': 'A', 'इ': '', 'ई': 'y', 'उ': '', 'ऊ': 'w', 'ए': 'y', 'ऐ': 'y', 'ओ': 'w', 'औ': 'w', 'ऋ': 'r' };   // vowels on their own
  var HI_WORD = { 'वह': 'w', 'यह': 'y', 'ये': 'y', 'वो': 'w' };
  var HOMOPHONES = ['for four fore 4', 'to two too 2', 'one won 1', 'ate eight 8', 'no know', 'new knew', 'see sea', 'be bee', 'by buy bye', 'their there', 'here hear',
    'right write', 'son sun', 'our hour', 'week weak', 'flower flour', 'red read', 'wood would', 'meet meat', 'tail tale', 'pair pear', 'hair hare', 'eye i', 'in inn',
    'not knot', 'made maid', 'road rode', 'blue blew', 'through threw', 'whole hole', 'night knight', 'deer dear', 'bear bare', 'plane plain', 'sale sail', 'which witch',
    'where wear', 'your youre', 'its its', 'then than', 'ant aunt', 'so sew sow', 'do due', 'peace piece', 'wait weight', 'way weigh', 'sum some', 'toe tow', 'role roll'];
  var HOMO = {};
  HOMOPHONES.forEach(function (g) { var ws = g.split(' '); ws.forEach(function (w) { HOMO[w] = ws[0]; }); });

  function soundKey(w) {
    var raw = String(w == null ? '' : w).replace(DIAC, '').replace(PUNC, '').replace(/[।॥]/g, '').replace(DIGITS, digit).trim().toLowerCase();
    if (!raw) return '';
    var out = ''; var i; var c;
    if (!/[\u0600-\u06FF\u0900-\u097F]/.test(raw)) { var e = clean(raw); e = NUMS[e] || e; return HOMO[e] || e; }
    if (HI_WORD[raw]) return HI_WORD[raw];
    // letter by letter, whichever script each one is in: the model mixes the two, even inside one word
    var s = raw.normalize('NFD');                 // a dotted Hindi letter becomes the letter + the dot
    var urdu = 0;
    for (i = 0; i < s.length; i += 1) {
      c = s[i]; var nx = s[i + 1];
      if (UR_S[c] !== undefined) { out += UR_S[c]; urdu += 1; continue; }
      if (nx === '\u093C') { out += (c === 'ड' || c === 'ढ') ? 'R' : (HI_C[c] || ''); i += 1; continue; }
      if (HI_C[c] !== undefined) { out += HI_C[c]; continue; }
      if (HI_V[c] !== undefined) {                // a short vowel before a vowel standing alone is heard (हुई, लिए)
        out += (c === 'ु' && HI_I[nx] !== undefined) ? 'w' : (c === 'ि' && HI_I[nx] !== undefined) ? 'y' : HI_V[c]; continue;
      }
      if (HI_I[c] !== undefined) out += (i === 0 ? 'A' : '') + HI_I[c];
    }
    // a final ہ / ح / ह is the vowel "a" (حلوہ = हलवा, جگہ = जगह); in a two-letter Urdu word it is silent (وہ, یہ, کہ, نہ)
    out = (urdu === s.length && s.length < 3) ? out.replace(/(.)h$/, '$1') : out.replace(/h$/, 'A');
    // nasalisation is written as ن inside an Urdu word and as a dot in Hindi (پہنچ = पहुँच, پرندے = परिंदे): not kept before a consonant
    out = out.replace(/(.)n(?=[bpTtsjcdDrRSgklmh])/g, '$1');
    // the hard t / d / r of ٹ ڈ ڑ are heard as the soft ones as often as not
    out = out.replace(/T/g, 't').replace(/D/g, 'd').replace(/R/g, 'r');
    out = out.replace(/AA+/g, 'A').replace(/(.)\1+/g, '$1');
    return out || fold(w);
  }

  function lev(a, b) {
    var d = []; var i; var j;
    for (j = 0; j <= b.length; j += 1) d.push(j);
    for (i = 1; i <= a.length; i += 1) {
      var p = d[0]; d[0] = i;
      for (j = 1; j <= b.length; j += 1) { var t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; }
    }
    return d[b.length];
  }
  /**
   * The same Urdu word by sound: a sound key is shorter than the word (no short vowels), and the recogniser doubles or
   * drops a sound here and there, so one sound may differ from 3 sounds up and two from 6 up. (Measured: fewer read
   * words missed, no more unread words accepted; English keeps Jugnu's rule.)
   */
  function sameSoundUr(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    var m = Math.min(a.length, b.length);
    return lev(a, b) <= (m >= 6 ? 2 : m >= 3 ? 1 : 0);
  }

  function wordsOf(text) {
    return String(text == null ? '' : text).split(/\s+/).filter(function (x) { return x.trim(); });
  }

  /**
   * expected: the printed passage (a string, or its words); heard: what the recogniser heard (a string, or words).
   * → { words: [{ text, read, state }], correct, reached, heard } — state: read · skipped (passed over) · ahead (not reached).
   */
  function score(expected, heard, o) {
    var key = o && o.sound ? soundKey : fold;
    var raw = Array.isArray(expected) ? expected.map(String) : wordsOf(expected);
    var ref = raw.map(key);
    var hyp = (Array.isArray(heard) ? heard.map(String) : wordsOf(heard)).map(key).filter(Boolean);
    var a = alignPrefix(ref, hyp, o && o.sound === 'ur' ? sameSoundUr : same, { join: true });
    var reached = 0; var i;
    for (i = 0; i < ref.length; i += 1) if (a.status[i] !== 'omit' && a.hypIdx[i] >= 0) reached = i + 1;
    var words = []; var correct = 0;
    for (i = 0; i < ref.length; i += 1) {
      var st = a.status[i] === 'correct' ? 'read' : (i < reached ? 'skipped' : 'ahead');
      // a printed word that folds to nothing (a dash) takes its neighbour's state
      if (!ref[i]) st = i > 0 ? words[i - 1].state : 'ahead';
      if (st === 'read') correct += 1;
      words.push({ text: raw[i], read: st === 'read', state: st });
    }
    return { words: words, correct: correct, reached: reached, heard: hyp.length };
  }

  function wcpm(correct, seconds) {
    return seconds > 0 ? Math.round(correct * 600 / seconds) / 10 : null;
  }

  return { clean: clean, same: same, alignPrefix: alignPrefix, fold: fold, soundKey: soundKey, score: score, wcpm: wcpm };
});
