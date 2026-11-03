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
const SWAPS = [['a', 'the'], ['this', 'that'], ['these', 'those'], ['will', 'would'], ['can', 'could'], ['shall', 'should'],
  ['is', 'was'], ['are', 'were'], ['my', 'your'], ['he', 'she'], ['him', 'her'], ['his', 'her'], ['we', 'you'], ['never', 'ever'],
  ['all', 'every'], ['some', 'any'], ['then', 'now'], ['here', 'there'], ['just', 'only'], ['so', 'very'], ['and', 'but'],
  ['if', 'when'], ['know', 'think'], ['want', 'need'], ['said', 'told'], ['come', 'go'], ['little', 'small'], ['big', 'large'],
  ['always', 'often'], ['maybe', 'perhaps'], ['really', 'truly'], ['before', 'after'], ['up', 'down'], ['in', 'on'], ['to', 'for'],
  ['of', 'from'], ['me', 'us'], ['our', 'their'], ['not', 'never'], ['look', 'see'], ['tell', 'ask'], ['give', 'get']];
const SWAP_MAP = new Map(); SWAPS.forEach(([x, y]) => { SWAP_MAP.set(x, y); SWAP_MAP.set(y, x); });
const CONTRACTIONS = { "don't": 'do not', "i'm": 'I am', "it's": 'it is', "you're": 'you are', "can't": 'cannot', "won't": 'will not',
  "we'll": 'we will', "i'll": 'I will', "didn't": 'did not', "isn't": 'is not', "that's": 'that is', "i've": 'I have', "we're": 'we are',
  "they're": 'they are', "doesn't": 'does not', "wasn't": 'was not', "couldn't": 'could not', "wouldn't": 'would not', "let's": 'let us',
  "you'll": 'you will', "he's": 'he is', "she's": 'she is', "there's": 'there is', "what's": 'what is', "i'd": 'I would', "you've": 'you have' };

// Returns { words: [{ text, wrong }], fix: 'the correct words' } with exactly one change; null if the line is too short
export function makeSpotError(text, vocab = [], rnd = Math.random) {
  const words = String(text || '').replace(DIR_RE, ' ').split(/\s+/).filter(Boolean);
  if (words.filter(w => /[A-Za-z]/.test(w)).length < 4) return null;
  const core = (w) => w.replace(/^[^\w'’]+|[^\w'’]+$/g, '').replace(/’/g, "'");
  const wrap = (orig, rep) => { const m = orig.match(/^([^\w'’]*)(.*?)([^\w'’]*)$/); return m[1] + rep + m[3]; };
  const matchCase = (src, rep) => (src[0] === src[0].toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep);
  const options = [];
  words.forEach((w, i) => {
    const c = core(w).toLowerCase();
    if (!c) return;
    if (SWAP_MAP.has(c)) options.push({ i, kind: 'swap', rep: matchCase(core(w), SWAP_MAP.get(c)) });
    if (CONTRACTIONS[c]) options.push({ i, kind: 'expand', rep: matchCase(core(w), CONTRACTIONS[c]) });
    if (c.length >= 4) {
      const alt = vocab.filter(v => v.length >= 3 && Math.abs(v.length - c.length) <= 2 && v !== c && v[0] === c[0]);
      if (alt.length) options.push({ i, kind: 'vocab', rep: matchCase(core(w), alt[Math.floor(rnd() * alt.length)]) });
    }
    if (i < words.length - 1 && /[A-Za-z]$/.test(w) && /^[A-Za-z]/.test(words[i + 1]) && core(words[i + 1]).toLowerCase() !== c) options.push({ i, kind: 'order' });
  });
  if (!options.length) return null;
  // Prefer the kinds of mistakes actors really make: contractions and small word swaps
  const weighted = options.flatMap(o => (o.kind === 'expand' ? [o, o, o] : o.kind === 'swap' ? [o, o] : [o]));
  const pick = weighted[Math.floor(rnd() * weighted.length)];
  const out = words.map(w => ({ text: w, wrong: false }));
  let fix;
  if (pick.kind === 'order') {
    const a = words[pick.i], b = words[pick.i + 1];
    out[pick.i] = { text: wrap(a, core(b)), wrong: true };
    out[pick.i + 1] = { text: wrap(b, core(a)), wrong: true };
    fix = `${core(a)} ${core(b)}`;
  } else if (pick.kind === 'expand') {
    const parts = pick.rep.split(' ');
    const orig = words[pick.i];
    out.splice(pick.i, 1, { text: wrap(orig, parts[0]).replace(/[^\w'’]+$/, ''), wrong: true }, { text: wrap(orig, parts[1]).replace(/^[^\w'’]+/, ''), wrong: true });
    fix = core(orig);
  } else {
    out[pick.i] = { text: wrap(words[pick.i], pick.rep), wrong: true };
    fix = core(words[pick.i]);
  }
  return { words: out, fix, kind: pick.kind };
}
