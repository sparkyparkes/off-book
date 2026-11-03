// On-device storage for Off Book.
// Everything (scripts, progress, XP, badges) lives in this browser's IndexedDB first, so the app is fast and
// works offline. When you're signed in, sync.js copies changes to and from your account.
// localApi() answers the same requests the online server did, so the rest of the app is unchanged.

const DB_NAME = 'off-book';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('scripts')) db.createObjectStore('scripts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('Your browser blocked on-device storage. Turn off private browsing and try again.'));
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    let result;
    const r = fn(os);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new Error('Saving on this device failed. Your device may be out of space.'));
    tx.onabort = tx.onerror;
  });
}
const getAll = (store) => run(store, 'readonly', os => os.getAll());
const getOne = (store, key) => run(store, 'readonly', os => os.get(key));
const putOne = (store, value) => run(store, 'readwrite', os => os.put(value));
const delOne = (store, key) => run(store, 'readwrite', os => os.delete(key));

// ---- Change notifications (sync.js listens to these to upload your changes)
const listeners = new Set();
export const onLocalChange = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
const emit = (e) => listeners.forEach(cb => { try { cb(e); } catch { /* ignore */ } });

// Per-line merge: for each line keep whichever practice record is newest.
// resetAt: progress older than a "reset my progress" is dropped.
export function mergeProgress(a = {}, b = {}, resetAt = 0) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k], y = b[k];
    const pick = !x ? y : !y ? x : ((y.lastSeen || 0) >= (x.lastSeen || 0) ? y : x); // tie: second wins
    if (pick && (pick.lastSeen || 0) >= resetAt) out[k] = pick;
  }
  return out;
}

// ---- Raw access for sync.js (does NOT trigger uploads)
export const rawAllScripts = () => getAll('scripts');
export const rawGetScript = (id) => getOne('scripts', id);
export const rawPutScript = (row) => putOne('scripts', row);
export const rawDeleteScript = (id) => delOne('scripts', id);
export const getMeta = async (key) => (await getOne('meta', key))?.data;
export const setMeta = (key, data) => putOne('meta', { key, data });

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const cleanTitle = (t) => String(t || 'Untitled script').trim().slice(0, 120) || 'Untitled script';

function validateData(d) {
  if (!d || !Array.isArray(d.entries) || !Array.isArray(d.scenes)) return null;
  const entries = d.entries.slice(0, 20000).map((e, i) => ({
    id: String(e.id || 'e' + i).slice(0, 20),
    type: ['line', 'dir', 'scene'].includes(e.type) ? e.type : 'dir',
    speaker: e.speaker ? String(e.speaker).slice(0, 60) : undefined,
    text: String(e.text || '').slice(0, 5000),
    scene: Number.isInteger(e.scene) ? e.scene : 0,
  }));
  const scenes = d.scenes.slice(0, 2000).map(s => ({ title: String(s.title || '').slice(0, 120) }));
  const counts = {};
  entries.forEach(e => { if (e.type === 'line' && e.speaker) counts[e.speaker] = (counts[e.speaker] || 0) + 1; });
  const characters = Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { entries, scenes, characters };
}

function summary(row) {
  const mine = new Set(row.myCharacters || []);
  const progress = row.progress || {};
  const myLines = (row.data?.entries || []).filter(e => e.type === 'line' && mine.has(e.speaker));
  let masterySum = 0, offBook = 0, due = 0, trouble = 0;
  const now = Date.now();
  myLines.forEach(l => {
    const p = progress[l.id];
    if (!p) { due++; return; }
    masterySum += p.mastery || 0;
    if ((p.mastery || 0) >= 4) offBook++;
    if (p.due && p.due <= now) due++;
    if (p.trouble) trouble++;
  });
  return {
    id: row.id, title: row.title, myCharacters: [...mine],
    lineCount: myLines.length, offBook, due, trouble,
    percent: myLines.length ? Math.round((masterySum / (myLines.length * 5)) * 100) : 0,
    updatedAt: row.updatedAt, lastPracticed: row.lastPracticed || null, createdAt: row.createdAt,
  };
}

async function mustGet(id) {
  const row = await getOne('scripts', id);
  if (!row) throw new Error('Script not found.');
  return row;
}

export async function localApi(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body || {};
  let m;

  if (path === '/me') return { signedIn: false, local: true, name: 'You' };

  if (path === '/profile') {
    if (method === 'GET') { const r = await getOne('meta', 'profile'); return r ? r.data : {}; }
    await putOne('meta', { key: 'profile', data: { ...body, updatedAt: Date.now() } });
    emit({ type: 'profile' });
    return { ok: true };
  }

  if (path === '/scripts' && method === 'GET') {
    const rows = await getAll('scripts');
    rows.sort((a, b) => (b.lastPracticed || b.updatedAt) - (a.lastPracticed || a.updatedAt));
    return rows.map(summary);
  }

  if (path === '/scripts' && method === 'POST') {
    const data = validateData(body.data);
    if (!data) throw new Error('That script could not be read. Please try again.');
    const now = Date.now();
    const row = { id: newId(), title: cleanTitle(body.title), data, myCharacters: (body.myCharacters || []).map(String).slice(0, 20), progress: {}, createdAt: now, updatedAt: now, lastPracticed: null };
    await putOne('scripts', row);
    emit({ type: 'script', id: row.id });
    return { id: row.id };
  }

  if ((m = path.match(/^\/scripts\/([\w-]+)\/progress$/)) && method === 'PUT') {
    const row = await mustGet(m[1]);
    if (body.replace) {
      // "Reset my progress": start over everywhere
      row.progress = body.progress || {};
      row.progressResetAt = Date.now();
    } else {
      // Merge line by line so progress synced from another device is never lost
      row.progress = mergeProgress(row.progress, body.progress || {}, row.progressResetAt || 0);
    }
    row.lastPracticed = Date.now();
    await putOne('scripts', row);
    emit({ type: 'progress', id: row.id });
    return { ok: true };
  }

  if ((m = path.match(/^\/scripts\/([\w-]+)$/))) {
    if (method === 'DELETE') {
      await delOne('scripts', m[1]);
      const tomb = (await getMeta('tombstones')) || {};
      tomb[m[1]] = Date.now();
      await setMeta('tombstones', tomb);
      emit({ type: 'delete', id: m[1] });
      return { ok: true };
    }
    const row = await mustGet(m[1]);
    if (method === 'GET') return { id: row.id, title: row.title, data: row.data, myCharacters: row.myCharacters, progress: row.progress || {}, summary: summary(row) };
    if (method === 'PUT') {
      if (body.title !== undefined) row.title = cleanTitle(body.title);
      if (Array.isArray(body.myCharacters)) row.myCharacters = body.myCharacters.map(String).slice(0, 20);
      if (body.data) { const v = validateData(body.data); if (!v) throw new Error('Those changes could not be saved.'); row.data = v; }
      row.updatedAt = Date.now();
      await putOne('scripts', row);
      emit({ type: 'script', id: row.id });
      return { ok: true };
    }
  }

  if (path === '/ai/parse') throw new Error('Smart read needs the online version of Off Book.');

  throw new Error('Something went wrong. Please try again.');
}

// ---- Back up & restore (a single file you can keep or move to another device)

export async function exportAll() {
  const [scripts, profile] = await Promise.all([getAll('scripts'), getOne('meta', 'profile')]);
  return { app: 'off-book', format: 1, exportedAt: new Date().toISOString(), profile: profile ? profile.data : {}, scripts };
}

// Combine two copies of your profile (XP, streak, badges, practice history) without losing anything
export function mergeProfile(cur = {}, inc = {}) {
  const merged = { ...cur, ...inc };
  merged.xp = Math.max(cur.xp || 0, inc.xp || 0);
  merged.reviews = Math.max(cur.reviews || 0, inc.reviews || 0);
  merged.bestCombo = Math.max(cur.bestCombo || 0, inc.bestCombo || 0);
  merged.fixed = Math.max(cur.fixed || 0, inc.fixed || 0);
  merged.badges = [...new Set([...(cur.badges || []), ...(inc.badges || [])])].sort(); // sorted so every device agrees
  merged.days = { ...(inc.days || {}) };
  Object.entries(cur.days || {}).forEach(([d, n]) => { merged.days[d] = Math.max(n, merged.days[d] || 0); });
  const curNewer = (cur.lastDay || '') >= (inc.lastDay || '');
  merged.lastDay = curNewer ? cur.lastDay : inc.lastDay;
  merged.streak = curNewer ? (cur.streak || 0) : (inc.streak || 0);
  const goalFromCur = (cur.updatedAt || 0) >= (inc.updatedAt || 0);
  merged.goal = (goalFromCur ? cur.goal : inc.goal) || cur.goal || inc.goal || 20;
  merged.lastBackup = Math.max(cur.lastBackup || 0, inc.lastBackup || 0) || undefined;
  merged.updatedAt = Math.max(cur.updatedAt || 0, inc.updatedAt || 0);
  return merged;
}

export async function importAll(backup) {
  if (!backup || backup.app !== 'off-book' || !Array.isArray(backup.scripts)) throw new Error('That file isn\'t an Off Book backup.');
  let added = 0, updated = 0;
  for (const s of backup.scripts) {
    const data = validateData(s.data);
    if (!data || !s.id) continue;
    const existing = await getOne('scripts', s.id);
    const incoming = { id: String(s.id), title: cleanTitle(s.title), data, myCharacters: (s.myCharacters || []).map(String), progress: s.progress || {}, createdAt: s.createdAt || Date.now(), updatedAt: s.updatedAt || Date.now(), lastPracticed: s.lastPracticed || null };
    if (!existing) { await putOne('scripts', incoming); added++; continue; }
    // Keep whichever copy was practiced or edited most recently
    const stamp = (r) => Math.max(r.lastPracticed || 0, r.updatedAt || 0);
    if (stamp(incoming) > stamp(existing)) { await putOne('scripts', incoming); updated++; }
  }
  // Profile: keep the best of both (XP, streak, badges, practice history)
  const cur = (await getOne('meta', 'profile'))?.data || {};
  const inc = backup.profile || {};
  const merged = { ...cur, ...inc };
  merged.xp = Math.max(cur.xp || 0, inc.xp || 0);
  merged.reviews = Math.max(cur.reviews || 0, inc.reviews || 0);
  merged.bestCombo = Math.max(cur.bestCombo || 0, inc.bestCombo || 0);
  merged.fixed = Math.max(cur.fixed || 0, inc.fixed || 0);
  merged.badges = [...new Set([...(cur.badges || []), ...(inc.badges || [])])];
  merged.days = { ...(inc.days || {}) };
  Object.entries(cur.days || {}).forEach(([d, n]) => { merged.days[d] = Math.max(n, merged.days[d] || 0); });
  const curNewer = (cur.lastDay || '') >= (inc.lastDay || '');
  merged.lastDay = curNewer ? cur.lastDay : inc.lastDay;
  merged.streak = curNewer ? (cur.streak || 0) : (inc.streak || 0);
  merged.goal = cur.goal || inc.goal || 20;
  merged.updatedAt = Date.now();
  await putOne('meta', { key: 'profile', data: merged });
  emit({ type: 'all' });
  return { added, updated };
}
