// Script parser: turns raw script text into scenes, dialogue lines and stage directions.
// Handles both stage-play style ("HAMLET: To be...") and screenplay style
// (character name in caps on its own line, dialogue beneath).

const SCENE_RE = /^(?:\d+[A-Z]?\s*[.)]?\s*)?(INT\.|EXT\.|INT\/EXT|I\/E\.|EST\.|ACT\s+[IVXLC\d]+|SCENE\s+[IVXLC\d]+|PROLOGUE\b|EPILOGUE\b)/i;
const TRANSITION_RE = /^(FADE (IN|OUT|TO)|CUT TO|DISSOLVE TO|SMASH CUT|MATCH CUT|BLACKOUT|END OF (ACT|SCENE|PLAY)|THE END|CURTAIN|LIGHTS (UP|DOWN|OUT)|INTERMISSION|CONTINUED|\(CONTINUED\)|MORE|\(MORE\))\b/i;
const NOT_NAMES = new Set(['INT', 'EXT', 'THE END', 'END', 'CONTINUED', 'MORE', 'FADE IN', 'FADE OUT', 'CUT TO', 'BLACKOUT', 'CURTAIN', 'INTERMISSION', 'SCENE', 'ACT', 'LATER', 'CONTINUOUS', 'DAY', 'NIGHT', 'MORNING', 'EVENING', 'BEAT', 'PAUSE', 'SILENCE', 'TITLE', 'SUPER', 'NOTE', 'NOTES', 'SETTING', 'TIME', 'PLACE', 'CHARACTERS', 'CAST', 'CAST OF CHARACTERS', 'DRAMATIS PERSONAE', 'ALL RIGHTS RESERVED', 'PAGE']);

export function normalizeName(raw) {
  return raw
    .replace(/\((?:V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D|CONT\.?|CONTINUING|INTO PHONE|ON PHONE|PRE-?LAP|FILTERED|SUBTITLED|OVER)[^)]*\)/gi, '')
    .replace(/\([^)]*\)?/g, '') // any parenthetical, e.g. (V.O.), (0.S.) misread from a scan
    .replace(/\bCONT['’]?D\b/gi, '')
    .replace(/[:.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isSpeakerTag(s) {
  // For "Name: line" scripts, allow Title Case names too (e.g. "Lady Macbeth:")
  if (isCapsName(s)) return true;
  const t = s.trim();
  if (t.length > 28 || t.split(/\s+/).length > 3) return false;
  if (NOT_NAMES.has(t.toUpperCase())) return false;
  return /^([A-Z][a-z'\-]+|[A-Z]\.?)(\s+([A-Z][a-z'\-]+|[A-Z]\.?|of|the|de|van))*$/.test(t);
}

function isCapsName(s) {
  const t = s.replace(/\([^)]*\)/g, '').trim();
  if (!t || t.length > 32 || t.length < 2) return false;
  if (!/[A-Z]/.test(t)) return false;
  if (t !== t.toUpperCase()) return false;
  if (/[!?,;"]/.test(t)) return false;
  if (/^\d+$/.test(t.replace(/[.\s]/g, ''))) return false;
  if (t.split(/\s+/).length > 4) return false;
  const n = normalizeName(t);
  if (NOT_NAMES.has(n)) return false;
  if (SCENE_RE.test(t) || TRANSITION_RE.test(t)) return false;
  return /^[A-Z0-9][A-Z0-9 .'&\-#/]*$/.test(n);
}

// Pages of { lines: [{text, x}] } or plain text -> array of {text, x, blank}
export function textToLines(text) {
  return text.replace(/\r/g, '').split('\n').map(l => {
    const m = l.match(/^\s*/)[0].length;
    const t = l.trim();
    return t ? { text: t, x: m * 6 } : { blank: true };
  });
}

function stripPageNoise(lines) {
  return lines.filter(l => l.blank || !(/^\d{1,3}\.?$/.test(l.text) || /^page \d+( of \d+)?$/i.test(l.text) || /^\(?(CONTINUED|MORE)\)?:?$/i.test(l.text) || /^CONTINUED:?\s*(\(\d+\))?$/i.test(l.text)));
}

export function parseScript(rawLines) {
  const lines = stripPageNoise(rawLines);
  const entries = [];
  const scenes = [];
  let scene = -1;
  const pushScene = (title) => {
    const last = entries[entries.length - 1];
    if (last && last.type === 'scene') { last.text += ' · ' + title; scenes[scene].title = last.text.slice(0, 80); return; }
    scenes.push({ title: title.slice(0, 80) }); scene = scenes.length - 1; entries.push({ type: 'scene', text: title, scene }); };
  const pushDir = (text) => {
    const last = entries[entries.length - 1];
    if (last && last.type === 'dir' && last._open) { last.text += ' ' + text; return; }
    entries.push({ type: 'dir', text, scene, _open: true });
  };
  const closeDir = () => { const last = entries[entries.length - 1]; if (last) delete last._open; };

  // Decide which style dominates: count "NAME: text" patterns vs caps-only lines.
  const colonRe = /^([A-Z][A-Za-z0-9 .'&\-]{0,30}?)(?:\s*\(([^)]*)\))?\s*[:]\s*(.*)$/;
  const dotRe = /^([A-Z][A-Z0-9 '&\-]{1,30})\.\s+(.+)$/;
  let colonCount = 0, capsCount = 0, dotCount = 0;
  for (const l of lines) {
    if (l.blank) continue;
    const m = l.text.match(colonRe);
    if (m && isSpeakerTag(m[1])) colonCount++;
    else if (l.text.match(dotRe) && isCapsName(l.text.match(dotRe)[1])) dotCount++;
    else if (isCapsName(l.text)) capsCount++;
  }
  const style = colonCount >= capsCount && colonCount >= dotCount && colonCount > 3 ? 'colon'
    : dotCount > capsCount && dotCount > 3 ? 'dot' : 'caps';

  let speaker = null; // currently open dialogue speaker (caps style)
  let current = null; // current line entry being built
  let lastLine = null; // the speech that just ended at a blank line (may continue as the next stanza of a song)
  let pendingDir = ''; // a (parenthetical) under a character name, before their first words

  const endLine = () => { speaker = null; current = null; };
  const newLine = (who, text, x) => { lastLine = null; current = { type: 'line', speaker: who, text: '', _rows: [], scene }; addRow((pendingDir ? pendingDir + ' ' : '') + text, x); pendingDir = ''; entries.push(current); return current; };
  const addRow = (text, x) => { const t = cleanDialogue(text); if (t) current._rows.push({ t, x }); };

  // Songs & poems: after a blank line, a following verse-like paragraph continues the same speech as a new stanza
  const continuesStanza = (i, t, x) => {
    if (!lastLine || entries[entries.length - 1] !== lastLine || !isVerseRows(lastLine._rows)) return false;
    if (/^[\[(]/.test(t)) return false;
    const para = [];
    for (let k = i; k < lines.length && !lines[k].blank; k++) para.push(lines[k]);
    const ok = para.every(p => p.text.length <= 70 && !SCENE_RE.test(p.text) && !isCapsName(p.text) && !/^[\[(]/.test(p.text));
    const caps = para.filter(p => STARTS_CAP.test(p.text)).length / para.length;
    const lastX = lastLine._rows[lastLine._rows.length - 1]?.x;
    const sameIndent = typeof x === 'number' && typeof lastX === 'number' && Math.abs(x - lastX) <= 15;
    return ok && caps >= 0.6 && (para.length >= 2 || (style === 'caps' && sameIndent));
  };
  const resumeStanza = (t, x) => {
    current = lastLine; speaker = lastLine.speaker; lastLine = null;
    current._rows.push({ stanza: true });
    addRow(t, x);
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.blank) { if (current) lastLine = current; endLine(); closeDir(); continue; }
    const t = l.text;

    if (SCENE_RE.test(t) && t.length < 120) { endLine(); closeDir(); pushScene(t); continue; }
    if (TRANSITION_RE.test(t) && t.length < 40) { endLine(); closeDir(); continue; }

    if (style === 'colon' || style === 'dot') {
      const m = style === 'colon' ? t.match(colonRe) : t.match(dotRe);
      if (m && (style === 'colon' ? isSpeakerTag(m[1]) : isCapsName(m[1]))) {
        closeDir();
        const body = (style === 'colon' ? m[3] : m[2]) || '';
        newLine(normalizeName(m[1]), (style === 'colon' && m[2] ? `(${m[2]}) ` : '') + body, l.x);
        speaker = current.speaker;
        continue;
      }
      if (current && !/^\(.*\)$/.test(t)) {
        // Continuation of dialogue unless it looks like a stage direction in brackets
        if (/^[\[(]/.test(t) && /[\])]$/.test(t)) { pushDir(t.replace(/^[\[(]|[\])]$/g, '')); closeDir(); continue; }
        addRow(t, l.x);
        continue;
      }
      if (!current && continuesStanza(i, t, l.x)) { resumeStanza(t, l.x); continue; }
      endLine(); lastLine = null;
      pushDir(t.replace(/^[\[(]|[\])]$/g, ''));
      continue;
    }

    // Screenplay / caps-on-own-line style
    if (isCapsName(t)) {
      // must be followed by something non-blank to be a cue
      const next = lines[i + 1];
      if (next && !next.blank && !isCapsName(next.text)) {
        closeDir();
        speaker = normalizeName(t);
        current = null; lastLine = null; pendingDir = '';
        continue;
      }
    }
    if (speaker) {
      if (/^\(.*\)$/.test(t)) { if (current) addRow(t, l.x); else pendingDir = (pendingDir + ' ' + t).trim(); continue; } // (beat), (dry): kept as a direction inside the line
      if (!current) newLine(speaker, t, l.x);
      else addRow(t, l.x);
      continue;
    }
    if (continuesStanza(i, t, l.x)) { resumeStanza(t, l.x); continue; }
    lastLine = null;
    pushDir(t);
  }

  return finalize(entries, scenes);
}

const STARTS_CAP = /^["'“‘(¿¡]?[A-Z0-9]/;

// Does this speech look like verse (song lyrics, poetry) rather than wrapped prose?
// Prose wraps fill the line almost to the edge; verse lines are uneven and usually start with a capital.
export function isVerseRows(rows) {
  rows = rows.filter(r => r.stanza || !/^\[[^\]]*\]$/.test(r.t)); // ignore rows that are only a [direction]
  const real = rows.filter(r => !r.stanza);
  if (real.length < 2) return false;
  const stanzas = rows.some(r => r.stanza);
  const maxLen = Math.max(...real.map(r => r.t.length));
  const nonFinal = rows.filter((r, i) => !r.stanza && rows[i + 1] && !rows[i + 1].stanza);
  const shortRatio = nonFinal.length ? nonFinal.filter(r => r.t.length < maxLen * 0.85).length / nonFinal.length : 1;
  const capRatio = real.slice(1).filter(r => STARTS_CAP.test(r.t)).length / (real.length - 1);
  return (shortRatio >= 0.5 && capRatio >= 0.6) || (real.length >= 3 && capRatio >= 0.75) || (stanzas && capRatio >= 0.8);
}

// Build the final text: verse keeps its line breaks (and blank lines between stanzas); prose is joined into sentences
function rowsToText(rows) {
  const verse = isVerseRows(rows);
  let out = '';
  for (const r of rows) {
    if (r.stanza) { out = out.replace(/\s+$/, '') + '\n\n'; continue; }
    if (!out || out.endsWith('\n')) out += r.t;
    else if (verse) out += '\n' + r.t;
    else out += (out.endsWith('-') && /^[a-z]/.test(r.t) ? '' : ' ') + r.t; // re-join words hyphenated at a line end
  }
  return out;
}

// Tidy spacing but keep line breaks: single break = new line, blank line = new stanza/paragraph
export function tidyText(t) {
  return String(t || '').replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanDialogue(t) {
  // Parentheticals like (singing), (beat), (to Tom) become [stage directions] inside the line: shown, never tested
  return t.replace(/\(([^)]*)\)/g, (m, x) => x.trim() ? `[${x.trim()}]` : ' ').replace(/\s+/g, ' ').trim();
}

// Shared: assign ids, merge tiny scenes, compute characters.
export function finalize(entries, scenes) {
  let out = entries.map(e => { const c = { ...e }; if (c._rows) c.text = rowsToText(c._rows); delete c._open; delete c._rows; c.text = tidyText(c.text); return c; }).filter(e => e.text);
  scenes = scenes.slice();
  // If no scenes detected, chunk into "Part" sections of ~25 lines of dialogue
  if (!scenes.length) {
    let count = 0; let s = 0; scenes.push({ title: 'Part 1' });
    out = out.map(e => {
      if (e.type === 'line') { count++; if (count > 25 && e.type === 'line') { count = 1; s++; scenes.push({ title: 'Part ' + (s + 1) }); } }
      return { ...e, scene: s };
    });
  } else {
    // entries before first scene go into a "Opening" scene
    if (out.some(e => e.scene === -1)) {
      scenes.unshift({ title: 'Opening' });
      out = out.map(e => ({ ...e, scene: e.scene + 1 }));
    }
  }
  out.forEach((e, i) => { e.id = 'e' + i; });
  const counts = {};
  out.forEach(e => { if (e.type === 'line') counts[e.speaker] = (counts[e.speaker] || 0) + 1; });
  const characters = Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  // Drop scenes with no entries
  const used = new Set(out.map(e => e.scene));
  const remap = {}; const keptScenes = [];
  scenes.forEach((s, i) => { if (used.has(i)) { remap[i] = keptScenes.length; keptScenes.push(s); } });
  out.forEach(e => { e.scene = remap[e.scene] ?? 0; });
  if (!keptScenes.length) keptScenes.push({ title: 'Full script' });
  return { entries: out, scenes: keptScenes, characters };
}

// Convert PDF.js text items for a page into lines with x positions and blank-line gaps.
export function pdfItemsToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) { continue; }
    const x = it.transform[4], y = Math.round(it.transform[5]);
    let row = rows.find(r => Math.abs(r.y - y) <= 2);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, str: it.str, w: it.width || 0 });
  }
  rows.sort((a, b) => b.y - a.y);
  const gaps = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i - 1].y - rows[i].y);
  const sorted = gaps.slice().sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor(sorted.length * 0.3)] : 12;
  const lines = [];
  rows.forEach((r, i) => {
    if (i > 0 && rows[i - 1].y - r.y > typical * 1.6) lines.push({ blank: true });
    r.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let lastEnd = null;
    for (const p of r.parts) {
      if (lastEnd !== null && p.x - lastEnd > 1 && !text.endsWith(' ') && !p.str.startsWith(' ')) text += ' ';
      text += p.str; lastEnd = p.x + p.w;
    }
    text = text.replace(/\s+/g, ' ').trim();
    if (text) lines.push({ text, x: r.parts[0].x });
  });
  lines.push({ blank: true });
  return lines;
}

// Convert Tesseract (scanned page OCR) output into lines with x positions and blank-line gaps.
export function ocrBlocksToLines(blocks) {
  const raw = [];
  for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const text = String(l.text || '').replace(/[|_]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || !/[A-Za-z0-9]/.test(text)) continue;
    if (l.confidence !== undefined && l.confidence < 25 && text.length < 4) continue;
    raw.push({ text, x: l.bbox.x0, y: l.bbox.y0, h: l.bbox.y1 - l.bbox.y0 });
  }
  raw.sort((a, b) => a.y - b.y || a.x - b.x);
  // Merge fragments that sit on the same visual row
  const rows = [];
  for (const r of raw) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(r.y - last.y) < Math.max(6, last.h * 0.5)) { last.text += ' ' + r.text; last.x = Math.min(last.x, r.x); }
    else rows.push({ ...r });
  }
  const gaps = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i].y - rows[i - 1].y);
  const sorted = gaps.slice().sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor(sorted.length * 0.3)] : 40;
  const lines = [];
  rows.forEach((r, i) => {
    if (i > 0 && r.y - rows[i - 1].y > typical * 1.6) lines.push({ blank: true });
    lines.push({ text: r.text, x: r.x });
  });
  lines.push({ blank: true });
  return lines;
}
