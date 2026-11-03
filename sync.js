// Sign in with Google and keep your scripts, progress, XP and badges in sync across devices.
// Your data always lives on the device first (local-db.js); this file copies changes to and from
// your private area in Firebase: users/<your id>/... — the security rules only let YOU read or write it.

import firebaseConfig from './firebase-config.js';
import {
  onLocalChange, rawAllScripts, rawGetScript, rawPutScript, rawDeleteScript,
  getMeta, setMeta, mergeProgress, mergeProfile,
} from './local-db.js';

const MAX_DOC = 950000; // Firebase limit is ~1 MB per document
const listeners = new Set();
let fb = null, auth = null, db = null, user = null;
let unsubs = [];
let remote = { scripts: new Map(), progress: new Map(), profile: null };
let ready = { scripts: false, progress: false, meta: false };
let state = { status: 'off', lastSynced: null, error: '' }; // off | signed-out | syncing | synced | offline | error
let pushTimer = null, applying = false, warnedTooBig = new Set();

export const isConfigured = () => !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);
export const syncState = () => ({ ...state, user: user ? { name: user.displayName || user.email, email: user.email, photo: user.photoURL } : null });
export const onSyncChange = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
const notify = (extra = {}) => listeners.forEach(cb => { try { cb({ ...syncState(), ...extra }); } catch { /* */ } });
const setStatus = (status, error = '') => { state.status = status; state.error = error; if (status === 'synced') state.lastSynced = Date.now(); notify(); };

const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
const userPath = (...p) => ['users', user.uid, ...p];

export async function initSync() {
  if (!isConfigured()) { setStatus('off'); return; }
  try {
    fb = await import('./vendor/firebase/firebase.js');
  } catch {
    setStatus('offline', 'Sync will start when you\'re back online.');
    window.addEventListener('online', () => initSync(), { once: true });
    return;
  }
  const app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  db = fb.initializeFirestore(app, { localCache: fb.memoryLocalCache(), ignoreUndefinedProperties: true });
  fb.getRedirectResult(auth).catch(() => {});
  fb.onAuthStateChanged(auth, (u) => {
    stopListening();
    user = u;
    if (!u) { setStatus('signed-out'); return; }
    startListening();
  });
  onLocalChange(() => schedulePush());
  window.addEventListener('online', () => { if (user) { setStatus('syncing'); schedulePush(300); } });
  window.addEventListener('offline', () => { if (user) setStatus('offline', 'Changes are saved on this device and will sync when you\'re back online.'); });
}

export async function signIn() {
  if (!auth) throw new Error(isConfigured() ? 'Sign-in isn\'t available right now. Check your internet connection.' : 'Sync isn\'t set up yet.');
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (e) {
    const code = e && e.code || '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/web-storage-unsupported') {
      await fb.signInWithRedirect(auth, provider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    if (code === 'auth/unauthorized-domain') throw new Error('This web address isn\'t approved for sign-in yet. Add it under Authentication → Settings → Authorized domains in Firebase.');
    if (code === 'auth/network-request-failed') throw new Error('No internet connection. Try again when you\'re online.');
    throw new Error('Sign-in didn\'t work. Please try again.');
  }
}

export async function signOutUser() { if (auth) await fb.signOut(auth); }
export function syncNow() { if (user) { setStatus('syncing'); schedulePush(0); } }

// ---------------------------------------------------------------- listening for changes from other devices
function stopListening() {
  unsubs.forEach(u => u()); unsubs = [];
  remote = { scripts: new Map(), progress: new Map(), profile: null };
  ready = { scripts: false, progress: false, meta: false };
}

function startListening() {
  setStatus(navigator.onLine ? 'syncing' : 'offline');
  const onErr = (e) => {
    if (e && e.code === 'permission-denied') setStatus('error', 'Your account isn\'t allowed to save data. Check the Firestore security rules.');
    else setStatus('error', 'Sync hit a snag. It will keep trying.');
  };
  const watch = (name, map) => fb.onSnapshot(fb.collection(db, ...userPath(name)), (snap) => {
    snap.docChanges().forEach(ch => { if (ch.type === 'removed') map.delete(ch.doc.id); else map.set(ch.doc.id, ch.doc.data()); });
    ready[name] = true;
    if (!snap.metadata.hasPendingWrites) remoteChanged();
  }, onErr);
  unsubs.push(watch('scripts', remote.scripts));
  unsubs.push(watch('progress', remote.progress));
  unsubs.push(fb.onSnapshot(fb.collection(db, ...userPath('meta')), (snap) => {
    snap.docChanges().forEach(ch => { if (ch.doc.id === 'profile') remote.profile = ch.type === 'removed' ? null : ch.doc.data(); });
    ready.meta = true;
    if (!snap.metadata.hasPendingWrites) remoteChanged();
  }, onErr));
}

let remoteTimer = null;
function remoteChanged() {
  if (!ready.scripts || !ready.progress || !ready.meta) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => reconcile(), 400);
}

function schedulePush(ms = 1500) {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => reconcile(), ms);
}

// ---------------------------------------------------------------- the actual merge, both directions
let running = null, again = false;
async function reconcile() {
  if (!user || !ready.scripts || !ready.progress || !ready.meta) return;
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      if (navigator.onLine) setStatus('syncing');
      const changedLocally = await mergeAll();
      setStatus(navigator.onLine ? 'synced' : 'offline');
      if (changedLocally) notify({ dataChanged: true });
    } catch (e) {
      console.error(e);
      setStatus('error', 'Sync hit a snag. It will try again.');
    } finally {
      running = null;
      if (again) { again = false; schedulePush(500); }
    }
  })();
  return running;
}

async function mergeAll() {
  const writes = [];
  let changedLocally = false;
  const locals = new Map((await rawAllScripts()).map(r => [r.id, r]));
  const tomb = (await getMeta('tombstones')) || {};
  const ids = new Set([...locals.keys(), ...remote.scripts.keys(), ...Object.keys(tomb)]);

  for (const id of ids) {
    const L = locals.get(id), R = remote.scripts.get(id), RP = remote.progress.get(id), T = tomb[id];
    const localStamp = L ? Math.max(L.updatedAt || 0, L.lastPracticed || 0) : 0;

    // Deleted on another device
    if (R && R.deleted) {
      if (L && localStamp > (R.deletedAt || 0)) { writes.push(pushWhole(L)); continue; } // changed here after the delete: keep it
      if (L) { await rawDeleteScript(id); changedLocally = true; }
      continue;
    }
    // Deleted on this device
    if (!L && T) {
      if (R && (R.updatedAt || 0) > T) { await rawPutScript(fromRemote(id, R, RP)); changedLocally = true; continue; }
      if (R || RP) writes.push(pushTombstone(id, T));
      continue;
    }
    if (L && !R) { writes.push(pushWhole(L)); continue; }
    if (!L && R) { await rawPutScript(fromRemote(id, R, RP)); changedLocally = true; continue; }

    // On both: newest title/roles/script text wins; progress merges line by line
    const resetAt = Math.max(L.progressResetAt || 0, RP?.resetAt || 0);
    const mergedProgress = mergeProgress(RP?.progress || {}, L.progress || {}, resetAt);
    const lastPracticed = Math.max(L.lastPracticed || 0, RP?.lastPracticed || 0) || null;
    let next = { ...L };
    let localDirty = false;
    if ((R.updatedAt || 0) > (L.updatedAt || 0)) {
      const data = parseData(R.data);
      if (data) { next = { ...next, title: R.title, myCharacters: R.myCharacters || [], data, updatedAt: R.updatedAt, createdAt: R.createdAt || L.createdAt }; localDirty = true; }
    } else if ((L.updatedAt || 0) > (R.updatedAt || 0)) {
      writes.push(pushScriptDoc(L));
    }
    if (stable(mergedProgress) !== stable(L.progress || {}) || (L.progressResetAt || 0) !== resetAt) { next.progress = mergedProgress; next.progressResetAt = resetAt; localDirty = true; }
    if ((next.lastPracticed || 0) !== (lastPracticed || 0)) { next.lastPracticed = lastPracticed; localDirty = true; }
    if (localDirty) { await rawPutScript(next); changedLocally = true; }
    if (!RP || stable(mergedProgress) !== stable(RP.progress || {}) || (RP.resetAt || 0) !== resetAt) writes.push(pushProgress(id, mergedProgress, lastPracticed, resetAt));
  }

  // Profile (XP, streak, badges)
  const localProfile = (await getMeta('profile')) || {};
  const remoteProfile = remote.profile?.data || null;
  const mergedP = remoteProfile ? mergeProfile(localProfile, remoteProfile) : localProfile;
  if (remoteProfile && stable(mergedP) !== stable(localProfile)) { await setMeta('profile', mergedP); changedLocally = true; }
  if (Object.keys(mergedP).length && (!remoteProfile || stable(mergedP) !== stable(remoteProfile))) {
    writes.push(fb.setDoc(fb.doc(db, ...userPath('meta', 'profile')), { data: mergedP, updatedAt: Date.now() }));
  }

  await Promise.all(writes);
  return changedLocally;
}

const parseData = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };

function fromRemote(id, R, RP) {
  return {
    id, title: R.title || 'Untitled script', myCharacters: R.myCharacters || [], data: parseData(R.data) || { entries: [], scenes: [], characters: [] },
    progress: RP?.progress || {}, progressResetAt: RP?.resetAt || 0,
    createdAt: R.createdAt || Date.now(), updatedAt: R.updatedAt || Date.now(), lastPracticed: RP?.lastPracticed || null,
  };
}

function pushScriptDoc(L) {
  const data = JSON.stringify(L.data);
  if (data.length > MAX_DOC) {
    if (!warnedTooBig.has(L.id)) { warnedTooBig.add(L.id); notify({ warning: `“${L.title}” is too large to sync, so it stays on this device only.` }); }
    return Promise.resolve();
  }
  return fb.setDoc(fb.doc(db, ...userPath('scripts', L.id)), {
    title: L.title, myCharacters: L.myCharacters || [], data, createdAt: L.createdAt || Date.now(), updatedAt: L.updatedAt || Date.now(),
  });
}
function pushProgress(id, progress, lastPracticed, resetAt) {
  return fb.setDoc(fb.doc(db, ...userPath('progress', id)), { progress, lastPracticed: lastPracticed || null, resetAt: resetAt || 0 });
}
function pushWhole(L) {
  return Promise.all([pushScriptDoc(L), pushProgress(L.id, L.progress || {}, L.lastPracticed, L.progressResetAt || 0)]);
}
function pushTombstone(id, at) {
  return Promise.all([
    fb.setDoc(fb.doc(db, ...userPath('scripts', id)), { deleted: true, deletedAt: at, updatedAt: at }),
    fb.deleteDoc(fb.doc(db, ...userPath('progress', id))),
  ]);
}
