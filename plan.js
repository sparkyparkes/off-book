// Practice planning helpers: breaking long speeches into chunks, deadline pacing,
// and the "Spot the Error" generator. Pure functions (no screen code) so they're easy to test.

const DIR_RE = /\[[^\]]*\]?/g;
const DAY = 86400000;
export const spokenWords = (t) => String(t || '').replace(DIR_RE, ' ').split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w));

// ---------------------------------------------------------------- chunking long speeches
// A long speech or song is learned a piece at a time (a sentence or two, or a few lyric lines),
// then linked back together. Stanza breaks are natural chunk edges; then sentences; then commas.
export function chunkLine(text, max = 22, min = 6) {
  const t = String(text || '');
  const total = spokenWords(t).length;
  const stanzas = t.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  if (total <= 30 && !(stanzas.length >= 2 && total > 20)) return [];

  // Protect [stage directions] so we never split inside one
  const dirs = [];
  const protect = (x) => x.replace(DIR_RE, (m) => { dirs.push(m); return `\u0000${dirs.length - 1}\u0000`; });
  const restore = (x) => x.replace(/\u0000(\d+)\u0000/g, (_, i) => dirs[+i]);
  const wc = (x) => spokenWords(restore(x)).length;

  const groupPieces = (pieces, joiner) => {
    const groups = [];
    let cur = [], n = 0;
    for (const p of pieces) {
      const k = wc(p);
      if (cur.length && n + k > max) { groups.push(cur.join(joiner)); cur = []; n = 0; }
      cur.push(p); n += k;
    }
    if (cur.length) groups.push(cur.join(joiner));
    return groups;
  };
  const splitLong = (piece) => {
    // A single sentence that's still too long: break at commas/semicolons/dashes, then by word count
    if (wc(piece) <= max * 1.4) return [piece];
    const parts = piece.split(/(?<=[,;:—–])\s+/);
    if (parts.length > 1) return groupPieces(parts, ' ');
    const words = piece.split(/\s+/);
    const out = [];
    for (let i = 0; i < words.length; i += max) out.push(words.slice(i, i + max).join(' '));
    return out;
  };

  let chunks = [];
  for (const raw of stanzas) {
    const st = protect(raw);
    if (wc(st) <= max) { chunks.push(st); continue; }
    if (st.includes('\n')) {
      // Verse: keep whole lyric lines together
      chunks.push(...groupPieces(st.split('\n').flatMap(splitLong), '\n'));
    } else {
      const sentences = st.split(/(?<=[.!?…]["”’)\]]*)\s+/).flatMap(splitLong);
      chunks.push(...groupPieces(sentences, ' '));
    }
  }
  // Fold tiny leftovers into the piece before them
  const merged = [];
  for (const c of chunks) {
    if (merged.length && wc(c) < min) merged[merged.length - 1] += (merged[merged.length - 1].includes('\n') ? '\n' : ' ') + c;
    else merged.push(c);
  }
  chunks = merged.map(c => restore(c).trim()).filter(c => spokenWords(c).length);
  return chunks.length >= 2 ? chunks : [];
}

// ---------------------------------------------------------------- deadline pacing
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
export function parseDate(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; }

// total: your lines; learned: lines you've said from memory at least once; learnedToday: of those, today
export function pacing({ total, learned, learnedToday, deadline, now = Date.now() }) {
  const end = parseDate(deadline);
  if (!end) return null;
  const today = startOfDay(now);
  const days = Math.round((end - today) / DAY); // days left before the off-book date
  const left = Math.max(0, total - learned);
  if (left === 0) return { status: 'done', days, left, perDay: 0, todayRemaining: 0, learnedToday };
  if (days <= 0) return { status: 'late', days, left, perDay: left, todayRemaining: left, learnedToday };
  // Finish new lines a day or two early when there's time, to leave room for review
  const buffer = days > 6 ? 2 : days > 3 ? 1 : 0;
  const learnDays = Math.max(1, days - buffer);
  const perDay = Math.ceil((left + learnedToday) / learnDays);
  const todayRemaining = Math.max(0, perDay - learnedToday);
  return { status: todayRemaining === 0 ? 'today-done' : 'on-track', days, left, perDay, todayRemaining, learnedToday };
}

// ---------------------------------------------------------------- Spot the Error
// The change has to be believable: the kind of paraphrase an actor really slips into.
// A near-synonym ("begin" for "start"), a contraction ("do not" <-> "don't"), a small word swap that
// keeps the meaning ("that" for "this"), or an extra filler word ("I just think..."). Never word-order
// shuffles or random look-alike words, which are too easy to spot.
const SYN_GROUPS = [
  ['start', 'begin'], ['started', 'began'], ['starting', 'beginning'], ['starts', 'begins'],
  ['end', 'finish'], ['ended', 'finished'], ['ending', 'finishing'],
  ['big', 'large'], ['huge', 'enormous'], ['small', 'little'], ['tiny', 'little'],
  ['fast', 'quick'], ['quickly', 'fast'],
  ['maybe', 'perhaps'], ['really', 'truly'], ['very', 'really'], ['just', 'only'], ['only', 'just'],
  ['happy', 'glad'], ['sad', 'upset'], ['angry', 'mad'], ['afraid', 'scared'], ['scared', 'frightened'], ['sure', 'certain'],
  ['look at', 'check out'], ['looking at', 'staring at'], ['watch', 'see'],
  ['think', 'believe'], ['thought', 'believed'], ['guess', 'suppose'], ['suppose', 'guess'], ['know', 'realize'],
  ['talk', 'speak'], ['talked', 'spoke'], ['talking', 'speaking'],
  ['shout', 'yell'], ['shouted', 'yelled'], ['shouting', 'yelling'],
  ['house', 'home'], ['road', 'street'], ['shop', 'store'], ['kids', 'children'], ['children', 'kids'], ['child', 'kid'],
  ['mom', 'mother'], ['mother', 'mom'], ['dad', 'father'], ['father', 'dad'],
  ['beautiful', 'lovely'], ['pretty', 'lovely'], ['lovely', 'beautiful'], ['nice', 'lovely'], ['great', 'wonderful'],
  ['wonderful', 'marvelous'], ['terrible', 'awful'], ['awful', 'horrible'], ['stupid', 'foolish'], ['silly', 'foolish'],
  ['strange', 'odd'], ['weird', 'strange'], ['odd', 'strange'],
  ['tired', 'exhausted'], ['hungry', 'starving'], ['cold', 'freezing'], ['quiet', 'silent'],
  ['wrong', 'mistaken'], ['correct', 'right'],
  ['often', 'always'], ['soon', 'shortly'],
  ['yes', 'yeah'], ['yeah', 'yes'], ['okay', 'all right'], ['hello', 'hi'], ['hi', 'hello'], ['goodbye', 'bye'],
  ['love', 'adore'], ['hate', 'despise'],
  ['try', 'attempt'], ['tried', 'attempted'], ['grab', 'take'],
  ['bought', 'got'], ['find', 'discover'], ['found', 'discovered'],
  ['remember', 'recall'], ['understand', 'see'], ['wait', 'hold on'], ['stay', 'remain'],
  ['everyone', 'everybody'], ['everybody', 'everyone'], ['someone', 'somebody'], ['somebody', 'someone'], ['anyone', 'anybody'], ['anybody', 'anyone'],
  ['nobody', 'no one'], ['something', 'anything'],
  ['kind of', 'sort of'], ['sort of', 'kind of'], ['a lot', 'lots'], ['going to', 'gonna'], ['want to', 'wanna'], ['got to', 'gotta'],
];
const SYN = new Map();
SYN_GROUPS.forEach(([a, b]) => { if (!SYN.has(a)) SYN.set(a, b); });
// Small words swapped for one with (nearly) the same meaning
const LIGHT_SWAPS = new Map([['this', 'that'], ['that', 'this'], ['these', 'those'], ['those', 'these'], ['will', 'would'], ['would', 'will'],
  ['can', 'could'], ['could', 'can'], ['shall', 'will'], ['a', 'the'], ['the', 'a'],
  ['but', 'though'], ['until', 'till'], ['because', 'since'], ['since', 'because'],
  ['must', 'have to'], ['may', 'might'], ['might', 'may']]);
const CONTRACTIONS = { "don't": 'do not', "i'm": 'I am', "it's": 'it is', "you're": 'you are', "can't": 'cannot', "won't": 'will not',
  "we'll": 'we will', "i'll": 'I will', "didn't": 'did not', "isn't": 'is not', "that's": 'that is', "i've": 'I have', "we're": 'we are',
  "they're": 'they are', "doesn't": 'does not', "wasn't": 'was not', "couldn't": 'could not', "wouldn't": 'would not', "let's": 'let us',
  "you'll": 'you will', "he's": 'he is', "she's": 'she is', "there's": 'there is', "what's": 'what is', "i'd": 'I would', "you've": 'you have',
  "aren't": 'are not', "haven't": 'have not', "shouldn't": 'should not', "we've": 'we have', "they'll": 'they will', "he'll": 'he will',
  "she'll": 'she will', "who's": 'who is', "where's": 'where is', "weren't": 'were not', "hasn't": 'has not' };
const EXPANDED = new Map(Object.entries(CONTRACTIONS).map(([c, e]) => [e.toLowerCase(), c]));
const SUBJECTS = new Set(['i', 'you', 'we', 'they', 'he', 'she']);
const VERBS = new Set(['think', 'want', 'need', 'know', 'said', 'saw', 'wanted', 'thought', 'feel', 'like', 'love', 'hate', 'came', 'went',
  'meant', 'mean', 'wish', 'hope', 'told', 'heard', 'forgot', 'remember', "don't", "can't", 'did']);
const FILLERS_IN = ['just', 'really', 'actually'];
const OPENERS = ['Well,', 'Oh,', 'Look,', 'Now,', 'So,'];

// Returns { words: [{ text, wrong }], fix, kind } with exactly one believable change; null if nothing fits
export function makeSpotError(text, vocab = [], rnd = Math.random) {
  const words = String(text || '').replace(DIR_RE, ' ').split(/\s+/).filter(Boolean);
  if (words.filter(w => /[A-Za-z]/.test(w)).length < 4) return null;
  const core = (w) => (w || '').replace(/^[^\w'’]+|[^\w'’]+$/g, '').replace(/’/g, "'");
  const low = (w) => core(w).toLowerCase();
  const lead = (w) => w.match(/^[^\w'’]*/)[0], trail = (w) => w.match(/[^\w'’]*$/)[0];
  const matchCase = (src, rep) => (/^[A-Z]/.test(src) && src !== 'I' ? rep[0].toUpperCase() + rep.slice(1) : rep);
  const options = [];
  // replace words[i .. i+len-1] (with no punctuation between them) by `rep`
  const addReplace = (i, len, rep, kind, weight) => {
    const span = words.slice(i, i + len);
    if (len > 1 && span.slice(0, -1).some(w => trail(w))) return;
    const orig = span.map(core).join(' ');
    if (rep.toLowerCase() === orig.toLowerCase()) return;
    const r = matchCase(core(span[0]), rep).replace(/^i(?=['’ ])/, 'I').replace(/^i$/, 'I');
    for (let k = 0; k < weight; k++) options.push({ i, len, rep: r, kind, fix: orig });
  };
  words.forEach((w, i) => {
    const c = low(w), c2 = i + 1 < words.length ? `${c} ${low(words[i + 1])}` : '';
    if (!c) return;
    if (CONTRACTIONS[c]) addReplace(i, 1, CONTRACTIONS[c], 'contraction', 3);
    if (c2 && EXPANDED.has(c2)) addReplace(i, 2, EXPANDED.get(c2), 'contraction', 3);
    if (c2 && SYN.has(c2)) addReplace(i, 2, SYN.get(c2), 'synonym', 3);
    if (SYN.has(c)) addReplace(i, 1, SYN.get(c), 'synonym', 3);
    if (LIGHT_SWAPS.has(c)) addReplace(i, 1, LIGHT_SWAPS.get(c), 'swap', 2);
    // an extra filler word: "I think" -> "I just think"
    if (SUBJECTS.has(c) && i + 1 < words.length && VERBS.has(low(words[i + 1])) && !trail(w)) {
      options.push({ i: i + 1, len: 0, rep: FILLERS_IN[Math.floor(rnd() * FILLERS_IN.length)], kind: 'insert' });
    }
  });
  // an opener at the very start ("Well, I don't...") — only if nothing more interesting is possible
  const openers = OPENERS.filter(o => !words.some(w => low(w) === o.replace(',', '').toLowerCase()));
  if (!options.length && openers.length && !/^(well|oh|look|now|so)$/i.test(low(words[0]))) options.push({ i: 0, len: 0, rep: openers[Math.floor(rnd() * openers.length)], kind: 'insert' });
  if (!options.length) return null;
  const pick = options[Math.floor(rnd() * options.length)];
  const out = words.map(w => ({ text: w, wrong: false }));
  if (pick.len === 0) {
    if (pick.i === 0) { const w0 = core(words[0]); out[0] = { text: lead(words[0]) + (w0 === 'I' ? w0 : w0[0].toLowerCase() + w0.slice(1)) + trail(words[0]), wrong: false }; }
    out.splice(pick.i, 0, { text: pick.rep, wrong: true });
    return { words: out, fix: `There's no “${pick.rep.replace(/,$/, '')}” in the line.`, kind: 'insert' };
  }
  const first = words[pick.i], last = words[pick.i + pick.len - 1];
  const repWords = pick.rep.split(' ');
  out.splice(pick.i, pick.len, ...repWords.map((rw, k) => ({ text: (k === 0 ? lead(first) : '') + rw + (k === repWords.length - 1 ? trail(last) : ''), wrong: true })));
  return { words: out, fix: `“${pick.fix}”`, kind: pick.kind };
}
