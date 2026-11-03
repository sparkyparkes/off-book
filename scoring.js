// Automatic checking: your line must be word-for-word exactly as written.
// Forgiven: punctuation, capitals, numbers written as digits vs words ("5" = "five"),
// and filler sounds ("um", "uh"). NOT forgiven: contractions ("I'm" ≠ "I am"),
// missing, extra, swapped or substituted words.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
  if (n < 10000 && n % 1000 === 0) return ONES[n / 1000] + ' thousand';
  return String(n);
}

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'mm', 'ah']);
// Same spoken word, different spelling (not contractions — those must match exactly)
const SAME_WORD = { mr: 'mister', mrs: 'missus', dr: 'doctor', ok: 'okay', st: 'saint', vs: 'versus' };

// Returns { tokens: [{ norm, orig }], words: original words }
export function normalize(text) {
  const words = String(text || '')
    .replace(/\[[^\]]*\]?/g, ' ')    // [stage directions] inside a line are shown, not spoken
    .replace(/[’‘`]/g, "'")
    .replace(/(\w)-(\w)/g, '$1$2')   // good-bye = goodbye (hyphen is punctuation)
    .replace(/[—–-]+/g, ' ')         // dashes between words
    .replace(/&/g, ' and ')
    .replace(/(\d),(\d)/g, '$1$2')   // 1,000 -> 1000
    .split(/\s+/).filter(Boolean);
  const out = [];
  words.forEach((raw, i) => {
    // Apostrophes are punctuation, so "Im" = "I'm" — but "I am" is still different from "I'm".
    const w = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!w) return;
    const parts = /^\d+$/.test(w) ? numToWords(parseInt(w, 10)).split(' ') : [SAME_WORD[w] || w];
    // Proper names mid-sentence (e.g. "Henderson"): speech-to-text often spells these differently
    const prev = words[i - 1] || '';
    const name = /^[A-Z][a-z]/.test(raw.replace(/^[^A-Za-z]+/, '')) && i > 0 && (!/[.!?:]["')\]]*$/.test(prev) || /^(mr|mrs|ms|dr|st|mt|sgt|capt|col|gen|prof|rev|lt)\.$/i.test(prev)) && !/^I('|$)/.test(raw);
    for (const p of parts) if (!FILLERS.has(p)) out.push({ norm: p, orig: i, name });
  });
  return { tokens: out, words };
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Edit distance that counts a swapped pair of letters as one slip ("recieve" -> "receive")
function osa(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

// A different FORM of the word is a different word, not a spelling slip:
// check/checked, walk/walks, run/running, quick/quickly…
const SUFFIXES = ['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'est', 'ly', 'n', 'en', 'y'];
function isWordForm(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && SUFFIXES.includes(long.slice(short.length))) return true;
  // walked vs walking, checks vs checked
  for (const s1 of SUFFIXES) for (const s2 of SUFFIXES) {
    if (s1 !== s2 && a.endsWith(s1) && b.endsWith(s2) && a.slice(0, -s1.length) === b.slice(0, -s2.length) && a.length - s1.length >= 3) return true;
  }
  return false;
}

// Rough "sounds like" spelling key: keeps vowels, smooths common English spelling patterns
function soundKey(w) {
  return w.toLowerCase()
    .replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/^wh/, 'w').replace(/^ps/, 's')
    .replace(/ight/g, 'it').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q(u)?/g, 'k')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's')
    .replace(/(ee|ea|ie|ei)/g, 'e').replace(/(oa|ow(?=[^aeiou]|$)|oe)/g, 'o').replace(/(ai|ay)/g, 'a').replace(/(oo|ou)/g, 'u')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/y$/, 'i')
    .replace(/([^aeiou])e$/, '$1');
}

// Real, different-sounding words that are one letter-slip apart. Typing one for the other is a wrong word.
const CONFUSABLE = new Set(['quiet|quite', 'form|from', 'then|than', 'lose|loose', 'angel|angle', 'dairy|diary', 'causal|casual',
  'united|untied', 'trail|trial', 'bear|beer', 'were|where', 'were|wear', 'dessert|desert', 'later|latter', 'conservation|conversation',
  'every|very', 'which|witch', 'want|went', 'what|that', 'there|three', 'they|then', 'this|thus', 'when|then', 'here|her', 'one|own',
  'now|know', 'won|own', 'sign|sing', 'slept|spelt', 'tired|tried', 'filed|field', 'fiend|friend', 'calm|clam', 'cloth|clothe',
  'breath|breathe', 'bath|bathe', 'advice|advise', 'device|devise', 'accept|except', 'affect|effect', 'chose|choose', 'loss|lose']);
const isConfusable = (a, b) => CONFUSABLE.has(`${a}|${b}`) || CONFUSABLE.has(`${b}|${a}`);

// Typed word looks like a misspelling of the script word (right word in mind, wrong letters)
export function isMisspelling(target, typed) {
  if (target === typed || typed.length < 3) return false;
  if (isConfusable(target, typed)) return false;
  // Short words: only a swapped pair of letters counts as a slip ("teh" for "the")
  if (target.length < 4) return target.length === 3 && typed.length === 3 && [...target].sort().join('') === [...typed].sort().join('') && osa(target, typed) === 1;
  if (/\d/.test(target) || /\d/.test(typed)) return false;
  if (isWordForm(target, typed)) return false;
  const dist = osa(target, typed);
  const allowed = target.length >= 8 ? 2 : 1;
  // Spelled the way it sounds ("rite" for "right", "nite" for "night", "fone" for "phone")
  if (dist > allowed) { const kt = soundKey(target), ky = soundKey(typed); return kt.length >= 2 && kt === ky; }
  // Keep the same first letter unless it's a swap of the first two ("hte" for "the")
  return target[0] === typed[0] || (target[0] === typed[1] && target[1] === typed[0]);
}

// Script token vs. said/typed token: returns 'exact', 'spell' (accepted, but spelled differently) or false.
// Typing: small misspellings of the right word are accepted and flagged.
// Speaking: speech-to-text spells words correctly, but may spell proper names differently.
const makeEq = (mode) => (e, said) => {
  if (e.norm === said) return 'exact';
  if (mode === 'type') return isMisspelling(e.norm, said) ? 'spell' : false;
  if (mode === 'speech' && e.name && e.norm.length >= 4 && lev(e.norm, said) <= (e.norm.length >= 8 ? 2 : 1)) return 'spell';
  return false;
};

// Does the attempt contain the whole line, word for word, in one go?
// (Restarts are fine: "Have you — have you seen my keys" still counts.)
function containsRun(hay, needle, eq) {
  if (!needle.length) return true;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (!eq(needle[k], hay[i + k])) continue outer;
    return true;
  }
  return false;
}

// Longest opening stretch of the line said correctly (used to aim hints).
function longestPrefix(hay, needle, eq) {
  let best = 0;
  for (let i = 0; i < hay.length; i++) {
    let k = 0;
    while (k < needle.length && i + k < hay.length && eq(needle[k], hay[i + k])) k++;
    if (k > best) best = k;
  }
  return best;
}

// opts.speech: listening mode — restarts are allowed ("Have you — have you seen…") and names are spelled loosely.
// Typing mode: the whole answer must be exactly the line, nothing more.
export function evaluate(expectedText, attemptText, opts = {}) {
  const E = normalize(expectedText), A = normalize(attemptText);
  const a = E.tokens, b = A.tokens.map(x => x.norm);
  const eq = makeEq(opts.speech ? 'speech' : 'type');
  const correct = a.length > 0 && (opts.speech ? containsRun(b, a, eq) : (a.length === b.length && a.every((t, k) => eq(t, b[k]))));
  // Mark each word you said as right or wrong (longest common subsequence)
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const okTok = new Array(m).fill(false), spellTok = new Array(m).fill(null);
  const gotE = new Array(n).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    const r = eq(a[i], b[j]);
    if (r && dp[i][j] === dp[i + 1][j + 1] + 1) { okTok[j] = true; gotE[i] = true; if (r === 'spell') spellTok[j] = E.words[a[i].orig]; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const wordOk = A.words.map(() => null), wordSpell = A.words.map(() => null);
  A.tokens.forEach((t, k) => { wordOk[t.orig] = wordOk[t.orig] === false ? false : okTok[k]; if (spellTok[k]) wordSpell[t.orig] = spellTok[k]; });
  const marks = A.words.map((w, k) => ({ w, ok: wordOk[k] === null ? true : wordOk[k], spell: wordOk[k] !== false ? wordSpell[k] : null }));
  // Which script words you already have (every piece of the word matched, in order)
  const known = E.words.map(() => null);
  a.forEach((t, k) => { known[t.orig] = known[t.orig] === false ? false : gotE[k]; });
  const knownWords = known.map(v => v !== false); // punctuation-only "words" count as known
  const misspelled = marks.filter(x => x.spell).map(x => ({ typed: x.w, correct: x.spell }));
  const prefixTokens = longestPrefix(b, a, eq);
  // Convert to number of original script words fully covered
  const prefixWords = prefixTokens >= n ? E.words.length : (E.tokens[prefixTokens] ? E.tokens[prefixTokens].orig : E.words.length);
  return { correct, marks, matched: dp[0][0], total: n, saidWords: m, prefixWords, scriptWords: E.words, knownWords, misspelled };
}
