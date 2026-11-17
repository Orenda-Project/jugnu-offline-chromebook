// node --test speech/test/
// The word rules must stay equal to Jugnu's (dashboard/public/wq/wq-read-live.js). With NIETE_RUMI_DIR set, the
// original is read from that clone and compared directly; without it, the fixed cases below still run.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const M = require('../match.js');

function jugnu() {
  const repo = process.env.NIETE_RUMI_DIR;
  if (!repo) return null;
  const src = execFileSync('git', ['-C', repo, 'show', `${process.env.NIETE_REF || 'origin/sandbox'}:dashboard/public/wq/wq-read-live.js`], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const window = {};
  vm.runInNewContext(src, { window });
  return window.WQLive;
}

const WORDS = ['Sana', 'has', 'a', 'little', 'kite.', 'She', '"Help', 'me,"', 'flower', 'flour', 'plant', 'plane', 'water', 'آج', 'علی', 'گاجر', 'کا', 'حلوہ', 'بنا', 'رہی', 'تھی۔',
  'اَبُّو', 'کے', 'کی', 'گئی', 'گئے', 'پُھدک', 'مٹھو', 'هاتھی', 'ہاتھی', 'يہ', 'یہ', 'كتاب', 'کتاب', 'آئے', 'ائے', '—', '۔"'];

test('clean and same are Jugnu\'s own', (t) => {
  const J = jugnu();
  if (!J) { t.skip('NIETE_RUMI_DIR not set'); return; }
  for (const w of WORDS) assert.strictEqual(M.clean(w), J.clean(w), `clean(${w})`);
  for (const a of WORDS) for (const b of WORDS) assert.strictEqual(M.same(M.clean(a), M.clean(b)), J.same(J.clean(a), J.clean(b)), `same(${a}, ${b})`);
});

test('alignPrefix is Jugnu\'s own, with and without joined words', (t) => {
  const J = jugnu();
  if (!J) { t.skip('NIETE_RUMI_DIR not set'); return; }
  const ref = 'sana has a red kite she runs up the hill with it'.split(' ');
  const hyps = ['sana has a red kite', 'sana a red bite she runs', 'she runs up the hill', 'sana has ared kite she runs up the hi ll with', '', 'x y z'];
  for (const h of hyps) {
    const hyp = h.split(' ').filter(Boolean);
    for (const o of [undefined, { join: true }]) assert.strictEqual(JSON.stringify(M.alignPrefix(ref, hyp, M.same, o)), JSON.stringify(J.alignPrefix(ref, hyp, J.same, o)), `"${h}" ${JSON.stringify(o)}`);
  }
});

// The sentences below were written for these tests; they are not Jugnu passages.
const EN = 'Sana has a red kite. She runs up the hill with it.';

test('a clean reading: every word read', () => {
  const r = M.score(EN, 'sana has a red kite she runs up the hill with it');
  assert.strictEqual(r.correct, 12);
  assert.ok(r.words.every((w) => w.read && w.state === 'read'));
});

test('a skipped word is skipped, the words after the last one heard are ahead, never wrong', () => {
  const r = M.score(EN, 'Sana has red kite. She runs');
  assert.deepStrictEqual(r.words.map((w) => w.state), ['read', 'read', 'skipped', 'read', 'read', 'read', 'read', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
  assert.strictEqual(r.correct, 6);
  assert.strictEqual(r.reached, 7);
});

test('another word said in its place is not read; one letter out on a long word is (Jugnu\'s rule)', () => {
  const r = M.score('They drink cold water every day', 'they drink cold monkey every day');
  assert.strictEqual(r.words[3].read, false);
  assert.strictEqual(M.score('They drink cold water every day', 'they drink cold waters every day').words[3].read, true);
  assert.strictEqual(M.score('a cup', 'a cap').words[1].read, false);   // short words must match exactly
});

test('words said twice and false starts cost nothing', () => {
  const r = M.score('She runs up the hill with it', 'she she runs up the hi hill hill with it');
  assert.strictEqual(r.correct, 7);
});

test('nothing heard: nothing read, nothing skipped', () => {
  const r = M.score('Sana has a red kite.', '');
  assert.strictEqual(r.correct, 0);
  assert.ok(r.words.every((w) => w.state === 'ahead'));
});

test('sound fold, English: either spelling of the same sound is the printed word', () => {
  assert.strictEqual(M.score('I see two flowers for the week', 'eye sea 2 flowers 4 the weak', { sound: 'en' }).correct, 7);
  // Jugnu's rules exactly: "two" = "2" (its own number fold) and "week" ~ "weak" (one letter), but I, see and for are lost
  assert.strictEqual(M.score('I see two flowers for the week', 'eye sea 2 flowers 4 the weak').correct, 4);
});

test('sound fold, Urdu: the printed Urdu word and the same word heard in Hindi letters are one', () => {
  const urdu = 'علی نے سیب کھایا۔ امی بھی اس کے ساتھ تھیں۔ پھر بارش شروع ہو گئی۔';
  const heard = 'अली ने सेब खाया। अम्मी भी उस के साथ थीं। फिर बारिश शुरू हो गई।';
  const r = M.score(urdu, heard, { sound: 'ur' });
  assert.strictEqual(r.correct, 15);
  assert.strictEqual(M.score(urdu, 'अली ने किताब खाया', { sound: 'ur' }).words[2].read, false);   // किताब is not سیب
  assert.strictEqual(M.score(urdu, urdu, { sound: 'ur' }).correct, 15);                              // and Urdu letters still match
  assert.strictEqual(M.score(urdu, 'अली ने سेب खाया', { sound: 'ur' }).words[2].read, true);        // the two scripts inside one word
  assert.ok(M.score(urdu, heard).correct < 3);                                                       // Jugnu's rules exactly cannot see Hindi letters
});

test('sound keys: the pairs the fold was built for', () => {
  for (const [u, h] of [['حلوہ', 'हलवा'], ['جگہ', 'जगह'], ['وہ', 'वो'], ['وہ', 'वह'], ['پھر', 'फिर'], ['شکر', 'शक्कर'], ['گاؤں', 'गाँव'], ['پہنچ', 'पहुँच'], ['ہوئی', 'हुई'],
    ['عمر', 'उमर'], ['نہیں', 'नहीं'], ['بعد', 'बाद'], ['ایک', 'एक'], ['میں', 'में'], ['بیٹھے', 'बैठे'], ['ہندی', 'हिंदी'], ['مزے', 'मजे'], ['پہاڑ', 'पहार']]) {
    assert.strictEqual(M.soundKey(u), M.soundKey(h), `${u} = ${h}`);
  }
  assert.notStrictEqual(M.soundKey('گاجر'), M.soundKey('बाज़ार'));
});

test('Urdu by sound: one sound out on a short word is still the word, another word is not', () => {
  // the recogniser dropped a sound (खाय) and added one (बारिशत): still کھایا and بارش
  const r = M.score('علی نے سیب کھایا۔ پھر بارش شروع ہو گئی۔', 'अली ने सेब खाय फिर बारिशत शुरू हो गई', { sound: 'ur' });
  assert.strictEqual(r.correct, 9);
  // गाजर is not بازار (two sounds out of five), and a two-sound word must match exactly (کا is not की)
  assert.strictEqual(M.score('بازار کا راستہ', 'गाजर का रास्ता', { sound: 'ur' }).words[0].read, false);
  assert.strictEqual(M.score('بازار کا راستہ', 'बाज़ार की रास्ता', { sound: 'ur' }).words[1].read, false);
  assert.strictEqual(M.score('بازار کا راستہ', 'बाज़ार का रास्ता', { sound: 'ur' }).correct, 3);
});

test('words correct per minute', () => {
  assert.strictEqual(M.wcpm(30, 60), 30);
  assert.strictEqual(M.wcpm(18, 45), 24);
  assert.strictEqual(M.wcpm(5, 0), null);
});
