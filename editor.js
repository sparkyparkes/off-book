// Full script editor: add, remove, move, merge and retype lines, stage directions and scene headings;
// add or rename characters; or edit the whole script as plain text.
// Every line keeps its own id, so your memorization progress stays attached to it through edits.

let seq = 0;
const newId = () => 'n' + Date.now().toString(36) + (seq++).toString(36);
const clone = (x) => JSON.parse(JSON.stringify(x));
const I = (c) => `<i class="${c}" aria-hidden="true"></i>`;
const TYPE_LABEL = { line: 'Line', dir: 'Stage direction', scene: 'Scene heading' };

// Make sure every scene starts with a visible heading entry (older imports could have invisible "Part" breaks)
export function ensureSceneEntries(data) {
  const out = [];
  let lastScene = null;
  for (const e of data.entries) {
    if (e.scene !== lastScene) {
      if (e.type !== 'scene') out.push({ id: newId(), type: 'scene', text: data.scenes[e.scene]?.title || `Scene ${e.scene + 1}`, scene: e.scene });
      lastScene = e.scene;
    }
    out.push({ ...e });
  }
  return out;
}

// Scene numbers come from the headings, in order
export function rebuild(entries) {
  const scenes = [];
  let cur = -1;
  // Keep line breaks (lyrics, poetry): a single break is a new line, a blank line is a new stanza
  const tidy = (t) => String(t || '').replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const clean = entries.map(e => ({ ...e, text: tidy(e.text) })).filter(e => e.text);
  for (const e of clean) {
    if (e.type === 'scene') { scenes.push({ title: e.text.slice(0, 80) }); cur = scenes.length - 1; }
    else if (cur === -1) { scenes.push({ title: 'Opening' }); cur = 0; }
    e.scene = cur;
    if (e.type !== 'line') delete e.speaker;
  }
  if (!scenes.length) scenes.push({ title: 'Full script' });
  return { entries: clean, scenes };
}

// ---- Plain-text format
export function toText(entries) {
  return entries.map(e => e.type === 'scene' ? `# ${e.text}` : e.type === 'dir' ? `[${e.text}]` : `${e.speaker}: ${e.text}`).join('\n\n');
}

export function fromText(text) {
  const out = [];
  let last = null, gap = false;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const t = raw.trim();
    if (!t) { gap = true; continue; }
    const plain = !/^#/.test(t) && !/^[\[(]/.test(t) && !(/^([^:\[\]#]{1,40}):/.test(t) && /[A-Za-z]/.test(t.split(':')[0]));
    if (plain && last && last.type !== 'scene') { last.text += (gap ? '\n\n' : '\n') + (last.type === 'dir' ? t.replace(/\]$/, '') : t); gap = false; continue; } // next line or stanza of the same entry
    gap = false;
    let m;
    if ((m = t.match(/^#+\s*(.+)$/))) { out.push({ type: 'scene', text: m[1] }); last = null; continue; }
    if ((m = t.match(/^\[(.*)\]?$/)) || (m = t.match(/^\((.*)\)$/))) { out.push(last = { type: 'dir', text: m[1].replace(/\]$/, '') }); continue; }
    if ((m = t.match(/^([^:\[\]#]{1,40}):\s*(.*)$/)) && /[A-Za-z]/.test(m[1])) { out.push(last = { type: 'line', speaker: m[1].trim().toUpperCase(), text: m[2] }); continue; }
    out.push(last = { type: 'dir', text: t });               // stray text with nothing above becomes a direction
  }
  return out.filter(e => e.text.trim());
}

// Keep ids (and therefore progress) for entries that survived a plain-text edit
export function carryIds(oldEntries, fresh) {
  const key = (e) => `${e.type}|${e.speaker || ''}|${e.text.replace(/\s+/g, ' ').trim()}`;
  const a = oldEntries.map(key), b = fresh.map(key);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  const used = new Set();
  pairs.forEach(([x, y]) => { fresh[y].id = oldEntries[x].id; used.add(x); });
  // Edited entries: within each gap between exact matches, pair up entries of the same kind & speaker
  const bounds = [[-1, -1], ...pairs, [n, m]];
  const edited = new Set();
  for (let k = 0; k < bounds.length - 1; k++) {
    const olds = []; for (let x = bounds[k][0] + 1; x < bounds[k + 1][0]; x++) olds.push(x);
    for (let y = bounds[k][1] + 1; y < bounds[k + 1][1]; y++) {
      const f = fresh[y];
      const idx = olds.findIndex(x => !used.has(x) && oldEntries[x].type === f.type && (f.type !== 'line' || oldEntries[x].speaker === f.speaker));
      if (idx >= 0) { const x = olds[idx]; f.id = oldEntries[x].id; used.add(x); edited.add(f.id); olds.splice(idx, 1); }
    }
  }
  fresh.forEach(f => { if (!f.id) f.id = newId(); });
  return { entries: fresh, edited };
}

// ---------------------------------------------------------------- UI
export function renderEditor(el, script, ctx) {
  const { esc, toast, modal, confirmBox, titleCase, save } = ctx;
  let draft = ensureSceneEntries(script.data);
  let selected = null;
  const undo = [];
  const pushUndo = () => { undo.push(clone(draft)); if (undo.length > 50) undo.shift(); updateUndo(); };
  let saveTimer = null, saving = Promise.resolve(), dirty = false, pendingExtra = {};
  const doSave = () => {
    const extra = pendingExtra; pendingExtra = {}; dirty = false;
    saving = saving.then(() => save(rebuild(draft), extra)).then(() => status('Saved')).catch(e => { dirty = true; status(e.message, true); });
    return saving;
  };
  const scheduleSave = (ms = 700, extra = {}) => {
    dirty = true; pendingExtra = { ...pendingExtra, ...extra };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, ms);
    status('Saving…');
  };
  const characters = () => {
    const c = {};
    draft.forEach(e => { if (e.type === 'line' && e.speaker) c[e.speaker] = (c[e.speaker] || 0) + 1; });
    return Object.entries(c).sort((x, y) => y[1] - x[1]);
  };
  const mine = () => new Set(script.myCharacters);

  el.innerHTML = `
    <div class="card editor">
      <div class="ed-bar">
        <button class="btn sm" id="ed-undo" disabled>${I('fa-solid fa-rotate-left')} Undo</button>
        <button class="btn sm" id="ed-chars">${I('fa-solid fa-user-pen')} Characters</button>
        <button class="btn sm" id="ed-text">${I('fa-regular fa-file-lines')} Edit as Text</button>
        <span class="spacer"></span>
        <span class="muted small" id="ed-status"></span>
      </div>
      <p class="muted small" style="margin:8px 0 12px">Tap any line to edit it, change who says it, move it, or insert something above or below. Press Return for a new line (for lyrics and poetry) and leave a blank line for a new stanza. Changes save automatically, and your progress stays with each line.</p>
      <datalist id="ed-names"></datalist>
      <div class="ed-list" id="ed-list"></div>
      <div class="ed-add">
        <span class="muted small">Add at the end:</span>
        <button class="btn sm" data-add="line">${I('fa-solid fa-plus')} Line</button>
        <button class="btn sm" data-add="dir">${I('fa-solid fa-plus')} Stage Direction</button>
        <button class="btn sm" data-add="scene">${I('fa-solid fa-plus')} Scene</button>
      </div>
    </div>`;
  const list = el.querySelector('#ed-list');
  const status = (t, err) => { const s = el.querySelector('#ed-status'); if (s) { s.textContent = t; s.style.color = err ? 'var(--danger)' : ''; } };
  const updateUndo = () => { const b = el.querySelector('#ed-undo'); if (b) b.disabled = !undo.length; };
  const refreshNames = () => { el.querySelector('#ed-names').innerHTML = characters().map(([n]) => `<option value="${esc(n)}">`).join(''); };

  // Who probably speaks next: the person before the previous speaker (dialogue alternates)
  const guessSpeaker = (index) => {
    const prev = draft.slice(0, index).filter(e => e.type === 'line');
    const last = prev[prev.length - 1]?.speaker;
    const before = [...prev].reverse().find(e => e.speaker !== last)?.speaker;
    return before || [...mine()][0] || last || characters()[0]?.[0] || 'CHARACTER';
  };

  const rowHTML = (e, i) => {
    const isMine = e.type === 'line' && mine().has(e.speaker);
    const head = e.type === 'line' ? `<div class="who">${esc(e.speaker || '?')}</div>` : '';
    const body = e.text ? esc(e.text) : '<span class="muted">(empty)</span>';
    if (selected !== e.id) return `<div class="ed-row ${e.type} ${isMine ? 'mine' : ''}" data-i="${i}">${head}<div class="ed-text">${body}</div></div>`;
    return `<div class="ed-row ${e.type} ${isMine ? 'mine' : ''} open" data-i="${i}">
      <div class="ed-types">${['line', 'dir', 'scene'].map(t => `<button class="seg ${e.type === t ? 'on' : ''}" data-type="${t}">${TYPE_LABEL[t]}</button>`).join('')}</div>
      ${e.type === 'line' ? `<label class="ed-field"><span>Spoken by</span><input type="text" class="ed-speaker" list="ed-names" value="${esc(e.speaker || '')}" autocomplete="off" placeholder="Character name"></label>` : ''}
      <label class="ed-field"><span>${e.type === 'line' ? 'Words' : e.type === 'dir' ? 'Direction' : 'Scene name'}</span>
        <textarea class="ed-input" rows="${e.type === 'scene' ? 1 : Math.min(14, Math.max(3, (e.text.match(/\n/g) || []).length + 2))}" placeholder="${e.type === 'line' ? 'Type the line exactly as written…' : e.type === 'dir' ? 'e.g. She slams the door.' : 'e.g. ACT II, SCENE 1'}">${esc(e.text)}</textarea></label>
      <div class="ed-actions">
        <div class="ed-menu-wrap"><button class="btn sm" data-act="above">${I('fa-solid fa-arrow-turn-up')} Insert Above</button></div>
        <div class="ed-menu-wrap"><button class="btn sm" data-act="below">${I('fa-solid fa-arrow-turn-down')} Insert Below</button></div>
        <button class="btn sm" data-act="up" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move up">${I('fa-solid fa-arrow-up')}</button>
        <button class="btn sm" data-act="down" ${i === draft.length - 1 ? 'disabled' : ''} title="Move down" aria-label="Move down">${I('fa-solid fa-arrow-down')}</button>
        ${draft[i + 1] && draft[i + 1].type === e.type && (e.type !== 'line' || draft[i + 1].speaker === e.speaker) ? `<button class="btn sm" data-act="merge" title="Join with the next entry">${I('fa-solid fa-link')} Merge With Next</button>` : ''}
        <span class="spacer"></span>
        <button class="btn sm danger" data-act="delete">${I('fa-regular fa-trash-can')} Delete</button>
        <button class="btn sm primary" data-act="done">Done</button>
      </div>
    </div>`;
  };

  const draw = (focus) => {
    refreshNames();
    list.innerHTML = draft.length ? draft.map(rowHTML).join('') : '<div class="empty">This script is empty. Add a scene or a line below.</div>';
    const open = list.querySelector('.ed-row.open');
    if (open) {
      bindOpen(open);
      if (focus) { const f = open.querySelector(focus); if (f) { f.focus(); if (f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length); } }
      open.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  const insertAt = (index, type) => {
    pushUndo();
    const e = { id: newId(), type, text: '', scene: 0 };
    if (type === 'line') e.speaker = guessSpeaker(index);
    draft.splice(index, 0, e);
    selected = e.id;
    draw('.ed-input');
  };

  const chooseType = (btn, onPick) => {
    // Small inline menu: Line / Stage direction / Scene
    const wrap = btn.parentElement;
    const existing = wrap.querySelector('.ed-menu');
    if (existing) { existing.remove(); return; }
    list.querySelectorAll('.ed-menu').forEach(m => m.remove());
    wrap.insertAdjacentHTML('beforeend', `<div class="ed-menu">${['line', 'dir', 'scene'].map(t => `<button data-pick="${t}">${TYPE_LABEL[t]}</button>`).join('')}</div>`);
    wrap.querySelectorAll('[data-pick]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); onPick(b.dataset.pick); });
  };

  const bindOpen = (row) => {
    const i = +row.dataset.i, e = draft[i];
    const input = row.querySelector('.ed-input'), sp = row.querySelector('.ed-speaker');
    let typedUndo = false;
    input.addEventListener('focus', () => { if (!typedUndo) { pushUndo(); typedUndo = true; } });
    input.addEventListener('input', () => { e.text = input.value; scheduleSave(); });
    if (sp) {
      sp.addEventListener('focus', () => { if (!typedUndo) { pushUndo(); typedUndo = true; } });
      sp.addEventListener('input', () => { e.speaker = sp.value.toUpperCase().replace(/\s+/g, ' ').trim(); scheduleSave(); });
      sp.addEventListener('change', () => { refreshNames(); });
    }
    row.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
      if (e.type === b.dataset.type) return;
      pushUndo();
      e.type = b.dataset.type;
      if (e.type === 'line' && !e.speaker) e.speaker = guessSpeaker(i);
      scheduleSave(); draw('.ed-input');
    });
    row.querySelectorAll('[data-act]').forEach(b => b.onclick = (ev) => {
      ev.stopPropagation();
      const act = b.dataset.act;
      if (act === 'above') return chooseType(b, (t) => insertAt(i, t));
      if (act === 'below') return chooseType(b, (t) => insertAt(i + 1, t));
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= draft.length) return;
        pushUndo(); [draft[i], draft[j]] = [draft[j], draft[i]]; scheduleSave(); draw();
      }
      if (act === 'merge') {
        pushUndo(); e.text = `${e.text} ${draft[i + 1].text}`.trim(); draft.splice(i + 1, 1); scheduleSave(); draw('.ed-input');
      }
      if (act === 'delete') {
        pushUndo(); draft.splice(i, 1); selected = null; scheduleSave(300); draw();
        toast('Deleted', 'Changed your mind? Tap Undo.', I('fa-regular fa-trash-can'));
      }
      if (act === 'done') { selected = null; if (dirty) scheduleSave(100); draw(); }
    });
  };

  list.addEventListener('click', (ev) => {
    const row = ev.target.closest('.ed-row');
    if (!row || row.classList.contains('open')) return;
    selected = draft[+row.dataset.i].id;
    draw();
  });
  el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => insertAt(draft.length, b.dataset.add));
  el.querySelector('#ed-undo').onclick = () => {
    if (!undo.length) return;
    draft = undo.pop(); selected = null; updateUndo(); scheduleSave(200); draw();
  };

  // ---- Characters: rename or merge
  el.querySelector('#ed-chars').onclick = () => {
    const list = characters();
    modal.open(`<h2>Characters</h2>
      <p class="muted small">Rename a character everywhere in the script. Renaming to an existing name merges the two (handy when a name was misread, like "J0HN" and "JOHN"). To add a new character, just type their name in "Spoken by" on any line.</p>
      <div class="ed-chars">${list.map(([n, c]) => `<div class="ed-char"><input type="text" value="${esc(n)}" data-old="${esc(n)}" list="ed-names"><span class="muted small">${c} line${c === 1 ? '' : 's'}</span><button class="btn sm" data-rename="${esc(n)}">Rename</button></div>`).join('') || '<div class="empty">No characters yet.</div>'}</div>
      <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn primary" id="ch-done">Done</button></div>`, (m) => {
      m.querySelector('#ch-done').onclick = modal.close;
      m.querySelectorAll('[data-rename]').forEach(b => b.onclick = () => {
        const oldName = b.dataset.rename;
        const input = b.parentElement.querySelector('input');
        const newName = input.value.toUpperCase().replace(/\s+/g, ' ').trim();
        if (!newName || newName === oldName) return;
        const merging = characters().some(([n]) => n === newName);
        pushUndo();
        draft.forEach(e => { if (e.type === 'line' && e.speaker === oldName) e.speaker = newName; });
        let roles = null;
        if (script.myCharacters.includes(oldName)) { roles = [...new Set(script.myCharacters.map(r => r === oldName ? newName : r))]; script.myCharacters = roles; }
        scheduleSave(100, roles ? { myCharacters: roles } : {});
        modal.close(); draw();
        toast(merging ? 'Characters merged' : 'Character renamed', `${titleCase(oldName)} → ${titleCase(newName)}`, I('fa-solid fa-user-pen'));
      });
    });
  };

  // ---- Edit the whole thing as plain text
  el.querySelector('#ed-text').onclick = () => {
    modal.open(`<h2>Edit as Text</h2>
      <p class="muted small" style="margin-top:0">
      <code># ACT I, SCENE 1</code> starts a scene · <code>[She exits.]</code> is a stage direction · <code>NAME: words</code> starts a line.<br>
      Lines underneath without a name continue the same speech, keeping your line breaks — leave a blank line between them for a new stanza (great for songs).<br>
      Lines you don't change keep their progress.</p>
      <textarea id="tx-all" spellcheck="false" style="min-height:50vh;font-family:ui-monospace,Menlo,monospace;font-size:13px">${esc(toText(draft))}</textarea>
      <div id="tx-err"></div>
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="tx-no">Cancel</button><button class="btn primary" id="tx-ok">Apply Changes</button></div>`, (m) => {
      m.querySelector('#tx-no').onclick = modal.close;
      m.querySelector('#tx-ok').onclick = () => {
        const fresh = fromText(m.querySelector('#tx-all').value);
        if (!fresh.length) { m.querySelector('#tx-err').innerHTML = '<div class="error">That would leave the script empty. Add at least one line.</div>'; return; }
        pushUndo();
        const { entries } = carryIds(draft, fresh.map(e => ({ ...e, scene: 0 })));
        draft = entries; selected = null;
        scheduleSave(100); modal.close(); draw();
        toast('Script updated', `${entries.length} entries. Tap Undo if something looks wrong.`, I('fa-regular fa-file-lines'));
      };
    });
    document.getElementById('modal-card').classList.add('wide');
  };

  draw();
  return { flush: () => { clearTimeout(saveTimer); return dirty ? doSave() : saving; } };
}
