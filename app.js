import { parseScript, textToLines, pdfItemsToLines, ocrBlocksToLines, finalize } from './parser.js';
import { evaluate } from './scoring.js';
import { localApi, exportAll, importAll } from './local-db.js';
import { renderEditor } from './editor.js';
import { initSync, signIn, signOutUser, syncNow, syncState, onSyncChange, isConfigured } from './sync.js';

const BASE = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/+$/, '');
const $app = document.getElementById('app');
const DAY = 86400000;

// ---------------------------------------------------------------- utilities
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const titleCase = (s) => String(s).toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase());

// Offline version: everything is stored on this device (see local-db.js)
async function api(path, opts = {}) { return localApi(path, opts); }

function debounce(fn, ms) {
  let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  return d;
}

function ringSVG(pct, size = 64, stroke = 7, color = 'var(--brand)') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset .6s"/></svg>`;
}
const ring = (pct, size = 64, stroke = 7, fs = 15) => `<div class="ring" style="width:${size}px;height:${size}px">${ringSVG(pct, size, stroke)}<div class="pct" style="font-size:${fs}px">${Math.round(pct)}%</div></div>`;

// ---------------------------------------------------------------- toasts, confetti, modal
function toast(title, msg, ico = '<i class="fa-solid fa-masks-theater" aria-hidden="true"></i>') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="ico">${ico}</span><div><b>${esc(title)}</b>${esc(msg || '')}</div>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3800);
}

function confetti(n = 140) {
  const cv = document.getElementById('confetti');
  const ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ['#7c1d3a', '#e0a915', '#f5c542', '#d76d8a', '#2f8f5b', '#2c6db5'];
  const ps = Array.from({ length: n }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: Math.random() * -12 - 4, r: Math.random() * 6 + 4, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - .5) * .3 }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); });
    if (++frames < 150) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

function floatXP(amount, el) {
  const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
  const f = document.createElement('div');
  f.className = 'float-xp'; f.textContent = `+${amount} XP`;
  f.style.left = (r.left + r.width / 2 - 30) + 'px'; f.style.top = (r.top - 10) + 'px';
  document.body.appendChild(f); setTimeout(() => f.remove(), 1000);
}

const modal = {
  open(html, onMount) {
    document.getElementById('modal-card').className = 'modal-card';
    document.getElementById('modal-card').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
    onMount && onMount(document.getElementById('modal-card'));
  },
  close() { document.getElementById('modal').classList.add('hidden'); document.getElementById('modal-card').innerHTML = ''; },
};
document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') modal.close(); });

// ---------------------------------------------------------------- profile & gamification
const LEVEL_TITLES = ['Understudy', 'Chorus', 'Ensemble', 'Featured', 'Supporting', 'Lead', 'Star', 'Headliner', 'Legend'];
const BADGES = [
  { id: 'first', ico: '<i class="fa-solid fa-ticket" aria-hidden="true"></i>', name: 'Opening Night', desc: 'Finish your first practice session' },
  { id: 'streak3', ico: '<i class="fa-solid fa-fire" aria-hidden="true"></i>', name: 'On a Roll', desc: 'Practice 3 days in a row' },
  { id: 'streak7', ico: '<i class="fa-regular fa-calendar-check" aria-hidden="true"></i>', name: 'Tech Week', desc: 'Practice 7 days in a row' },
  { id: 'combo10', ico: '<i class="fa-solid fa-bolt" aria-hidden="true"></i>', name: 'In the Zone', desc: 'Hit a 10× combo' },
  { id: 'perfect', ico: '<i class="fa-regular fa-gem" aria-hidden="true"></i>', name: 'Clean Run', desc: 'Finish a session of 8+ lines with no misses' },
  { id: 'scene', ico: '<i class="fa-solid fa-clapperboard" aria-hidden="true"></i>', name: 'Scene Stealer', desc: 'Get every line in a scene off book' },
  { id: 'fixer', ico: '<i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i>', name: 'Trouble Shooter', desc: 'Fix 5 trouble spots' },
  { id: 'century', ico: '<i class="fa-solid fa-award" aria-hidden="true"></i>', name: 'Century', desc: 'Complete 100 line reviews' },
  { id: 'thousand', ico: '<i class="fa-solid fa-building-columns" aria-hidden="true"></i>', name: 'Repertory', desc: 'Complete 1,000 line reviews' },
  { id: 'offbook', ico: '<i class="fa-solid fa-trophy" aria-hidden="true"></i>', name: 'Off Book!', desc: 'Get every one of your lines in a script off book' },
];

let me = { name: 'Guest', signedIn: false };
let profile = null;
const saveProfile = debounce(() => api('/profile', { method: 'PUT', body: profile }).catch(() => {}), 1200);

function levelInfo(xp) {
  const level = Math.floor(Math.sqrt(xp / 60)) + 1;
  const cur = 60 * (level - 1) ** 2, next = 60 * level ** 2;
  return { level, pct: ((xp - cur) / (next - cur)) * 100, toNext: next - xp, title: LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.floor((level - 1) / 2))] };
}

function normalizeProfile(p) {
  return { xp: 0, streak: 0, lastDay: null, days: {}, badges: [], reviews: 0, bestCombo: 0, fixed: 0, goal: 20, ...p };
}

function currentStreak() {
  if (!profile.lastDay) return 0;
  const diff = Math.round((new Date(todayKey()) - new Date(profile.lastDay)) / DAY);
  return diff <= 1 ? profile.streak : 0;
}

function award(id) {
  if (profile.badges.includes(id)) return;
  profile.badges.push(id);
  const b = BADGES.find(x => x.id === id);
  if (b) { toast(`Badge unlocked: ${b.name}`, b.desc, b.ico); confetti(90); }
}

function addXP(n, el) {
  const before = levelInfo(profile.xp).level;
  profile.xp += n;
  if (el) floatXP(n, el);
  const after = levelInfo(profile.xp);
  if (after.level > before) { toast(`Level ${after.level}!`, `You're now a ${after.title}.`, '<i class="fa-regular fa-star" aria-hidden="true"></i>'); confetti(); }
  renderPlayer();
  saveProfile();
}

function recordReview() {
  const t = todayKey();
  if (profile.lastDay !== t) {
    const diff = profile.lastDay ? Math.round((new Date(t) - new Date(profile.lastDay)) / DAY) : 99;
    profile.streak = diff === 1 ? profile.streak + 1 : 1;
    profile.lastDay = t;
    if (profile.streak > 1) toast(`${profile.streak}-day streak!`, 'Consistency is how lines stick.', '<i class="fa-solid fa-fire" aria-hidden="true"></i>');
  }
  profile.days[t] = (profile.days[t] || 0) + 1;
  profile.reviews++;
  // keep the day log small
  const keys = Object.keys(profile.days).sort();
  if (keys.length > 120) keys.slice(0, keys.length - 120).forEach(k => delete profile.days[k]);
  if (profile.streak >= 3) award('streak3');
  if (profile.streak >= 7) award('streak7');
  if (profile.reviews >= 100) award('century');
  if (profile.reviews >= 1000) award('thousand');
  if (profile.days[t] === profile.goal) { toast('Daily goal reached!', `${profile.goal} lines today. Bravo.`, '<i class="fa-solid fa-bullseye" aria-hidden="true"></i>'); confetti(70); addXP(20); }
}

function renderPlayer() {
  const el = document.getElementById('player');
  if (!profile) { el.innerHTML = ''; return; }
  const L = levelInfo(profile.xp);
  el.innerHTML = `
    <span class="chip streak" title="Daily practice streak"><i class="fa-solid fa-fire" aria-hidden="true"></i> ${currentStreak()}</span>
    <div class="level" title="${L.toNext} XP to next level">
      <div class="level-badge">${L.level}</div>
      <div><div class="xpbar"><span style="width:${L.pct}%"></span></div><div class="xplabel">${esc(L.title)} · ${profile.xp} XP</div></div>
    </div>
    ${accountButtonHTML()}`;
  const ab = document.getElementById('account-btn');
  if (ab) ab.onclick = openAccount;
}

// ---------------------------------------------------------------- account & sync
const SYNC_ICON = { syncing: 'fa-solid fa-rotate fa-spin', synced: 'fa-solid fa-cloud', offline: 'fa-solid fa-plane', error: 'fa-solid fa-triangle-exclamation' };
const SYNC_TEXT = { syncing: 'Syncing…', synced: 'Synced', offline: 'Offline — will sync later', error: 'Sync problem' };
function accountButtonHTML() {
  if (!isConfigured()) return '';
  const st = syncState();
  if (!st.user) return `<button class="chip account" id="account-btn" title="Sign in to sync across devices"><i class="fa-brands fa-google" aria-hidden="true"></i><span class="acct-label"> Sign In</span></button>`;
  const initial = esc((st.user.name || st.user.email || '?').trim()[0].toUpperCase());
  return `<button class="chip account" id="account-btn" title="${esc(SYNC_TEXT[st.status] || 'Account')}"><i class="${SYNC_ICON[st.status] || 'fa-solid fa-cloud'}" aria-hidden="true"></i><span class="avatar">${initial}</span></button>`;
}
function timeAgo(t) {
  if (!t) return 'not yet';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} hr ago` : new Date(t).toLocaleDateString();
}
function openAccount() {
  const st = syncState();
  if (!st.user) {
    modal.open(`<h2>Sync Across Devices</h2>
      <p>Sign in with Google to keep your scripts, progress, XP and badges the same on your phone, tablet and computer.</p>
      <p class="muted small">Anything already on this device is added to your account. You can keep using Off Book without signing in — your data just stays on this device.</p>
      <div id="signin-err"></div>
      <div class="row"><span class="spacer"></span><button class="btn ghost" id="a-no">Not Now</button><button class="btn primary" id="a-go"><i class="fa-brands fa-google" aria-hidden="true"></i> Sign In With Google</button></div>`, (m) => {
      m.querySelector('#a-no').onclick = modal.close;
      m.querySelector('#a-go').onclick = async (e) => {
        e.currentTarget.disabled = true;
        try { await signIn(); modal.close(); } catch (err) { m.querySelector('#signin-err').innerHTML = `<div class="error">${esc(err.message)}</div>`; e.currentTarget.disabled = false; }
      };
    });
    return;
  }
  modal.open(`<h2>Your Account</h2>
    <p>Signed in as <b>${esc(st.user.email || st.user.name)}</b></p>
    <p class="muted small"><i class="${SYNC_ICON[st.status] || 'fa-solid fa-cloud'}" aria-hidden="true"></i> ${esc(SYNC_TEXT[st.status] || '')} · last synced ${timeAgo(st.lastSynced)}${st.error ? `<br>${esc(st.error)}` : ''}</p>
    <p class="muted small">Signing out keeps a copy of everything on this device. Sign in again any time to resume syncing.</p>
    <div class="row"><button class="btn ghost" id="a-out">Sign Out</button><span class="spacer"></span><button class="btn" id="a-sync"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Sync Now</button><button class="btn primary" id="a-ok">Done</button></div>`, (m) => {
    m.querySelector('#a-ok').onclick = modal.close;
    m.querySelector('#a-sync').onclick = () => { syncNow(); modal.close(); };
    m.querySelector('#a-out').onclick = async () => { await signOutUser(); modal.close(); toast('Signed out', 'Your data stays on this device.', '<i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>'); };
  });
}
let lastSyncError = '', lastUser = null;
onSyncChange(async (st) => {
  me = st.user ? { signedIn: true, name: st.user.name, email: st.user.email } : { signedIn: false, name: 'You' };
  const who = st.user ? st.user.email : null;
  const userChanged = who !== lastUser; lastUser = who;
  if (userChanged && (location.hash || '#/') === '#/' && profile) renderHome();
  renderPlayer();
  if (st.warning) toast('Not synced', st.warning, '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>');
  if (st.status === 'error' && st.error && st.error !== lastSyncError) toast('Sync problem', st.error, '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>');
  lastSyncError = st.status === 'error' ? st.error : '';
  if (st.dataChanged) {
    // New data arrived from another device: refresh what's on screen (but never interrupt a practice session)
    try { profile = normalizeProfile(await api('/profile')); renderPlayer(); } catch { /* */ }
    if (!(location.hash || '').startsWith('#/practice/') && !activeEditor) { current.script = null; router(); }
  } else if ((location.hash || '#/') === '#/' && document.getElementById('data-card')) {
    const n = document.getElementById('sync-line'); if (n) n.innerHTML = syncLineHTML();
  }
});
function syncLineHTML() {
  if (!isConfigured()) return '';
  const st = syncState();
  if (!st.user) return '<i class="fa-solid fa-cloud" aria-hidden="true"></i> Want this on your other devices? <button class="btn sm" id="dc-signin"><i class="fa-brands fa-google" aria-hidden="true"></i> Sign In to Sync</button>';
  return `<i class="${SYNC_ICON[st.status] || 'fa-solid fa-cloud'}" aria-hidden="true"></i> Syncing as <b>${esc(st.user.email || st.user.name)}</b> — ${esc((SYNC_TEXT[st.status] || '').toLowerCase())}${st.lastSynced ? `, last synced ${timeAgo(st.lastSynced)}` : ''}.`;
}

// ---------------------------------------------------------------- spaced repetition
const MASTERY = ['New', 'Learning', 'Familiar', 'Almost', 'Off book', 'Locked in'];
const GRADES = [
  { label: 'Missed It', xp: 2 },
  { label: 'Close', xp: 5 },
  { label: 'Got It', xp: 10 },
  { label: 'Nailed It', xp: 12 },
];

function applyGrade(p, g) {
  const now = Date.now();
  p = { mastery: 0, ease: 2.5, ivl: 0, reps: 0, attempts: 0, misses: 0, hards: 0, streak: 0, trouble: false, ...p };
  p.attempts++; p.lastGrade = g; p.lastSeen = now;
  let fixed = false;
  if (g === 0) {
    p.misses++; p.reps = 0; p.ivl = 0; p.streak = 0;
    p.ease = Math.max(1.3, p.ease - 0.2);
    p.mastery = Math.max(0, p.mastery - 1);
    p.trouble = true;
  } else if (g === 1) {
    p.hards++; p.streak = 0;
    p.ease = Math.max(1.3, p.ease - 0.15);
    p.ivl = Math.max(0.3, p.ivl * 1.2);
    if (p.mastery < 1) p.mastery = 1;
    p.trouble = true;
  } else {
    p.reps++; p.streak++;
    if (g === 3) p.ease = Math.min(3.2, p.ease + 0.15);
    p.ivl = p.reps === 1 ? (g === 3 ? 2 : 1) : p.reps === 2 ? (g === 3 ? 4 : 3) : Math.round(p.ivl * p.ease * (g === 3 ? 1.3 : 1));
    p.mastery = Math.min(5, p.mastery + (g === 3 && p.mastery < 3 ? 2 : 1));
    if (p.trouble && p.streak >= 2) { p.trouble = false; fixed = true; }
  }
  // Trouble spots come back twice as often. Cap intervals for rehearsal timelines.
  const ivl = Math.min(30, p.trouble ? p.ivl * 0.5 : p.ivl);
  p.due = now + ivl * DAY;
  p.troubleScore = +((2 * p.misses + p.hards) / p.attempts).toFixed(2);
  return { p, fixed };
}

const troubleRank = (p) => (p ? (p.trouble ? 10 : 0) + (p.troubleScore || 0) * 3 + (p.lastGrade === 0 ? 2 : 0) : 0);

// ---------------------------------------------------------------- script helpers
function myLines(script) {
  const mine = new Set(script.myCharacters);
  return script.data.entries.filter(e => e.type === 'line' && mine.has(e.speaker));
}

function cueFor(script, line) {
  const es = script.data.entries;
  const i = es.findIndex(e => e.id === line.id);
  let cue = null, dir = null;
  for (let j = i - 1; j >= 0; j--) {
    const e = es[j];
    if (e.type === 'scene') break;
    if (e.type === 'dir' && !dir && !cue) dir = e;
    if (e.type === 'line') { cue = e; break; }
  }
  return { cue, dir };
}

function stats(script) {
  const lines = myLines(script);
  const counts = [0, 0, 0, 0, 0, 0];
  let sum = 0, due = 0, trouble = 0;
  const now = Date.now();
  lines.forEach(l => {
    const p = script.progress[l.id];
    const m = p ? p.mastery : 0;
    counts[m]++; sum += m;
    if (!p || p.due <= now) due++;
    if (p && p.trouble) trouble++;
  });
  return { total: lines.length, counts, pct: lines.length ? (sum / (lines.length * 5)) * 100 : 0, due, trouble, offBook: counts[4] + counts[5] };
}

// ---------------------------------------------------------------- router
let current = { script: null };
const routes = [
  [/^#?\/?$/, renderHome],
  [/^#\/add$/, renderAdd],
  [/^#\/script\/([\w-]+)(?:\/(\w+))?$/, (m) => renderScript(m[1], m[2])],
  [/^#\/practice\/([\w-]+)$/, (m) => renderPractice(m[1])],
];
async function router() {
  flushEditor();
  window.speechSynthesis?.cancel?.();
  stopListening();
  const h = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) { try { await fn(m); } catch (e) { $app.innerHTML = `<div class="error">${esc(e.message)}</div><a class="btn" href="#/">Back to My Scripts</a>`; } window.scrollTo(0, 0); return; }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', router);

// ---------------------------------------------------------------- HOME
async function renderHome() {
  $app.innerHTML = '<div class="loading">Loading your scripts…</div>';
  const scripts = await api('/scripts');
  const today = profile.days[todayKey()] || 0;
  const goalPct = Math.min(100, (today / profile.goal) * 100);
  const totalDue = scripts.reduce((a, s) => a + Math.min(s.due, 25), 0);
  $app.innerHTML = `
    ${backupNotice()}
    <div class="hero">
      <div>
        <h1>${me.signedIn ? `Welcome back, ${esc(me.name.split(' ')[0])}` : 'Welcome to Off Book'}</h1>
        <p class="sub">${scripts.length ? (totalDue ? `You have <b>${totalDue}</b> line${totalDue === 1 ? '' : 's'} ready for review. A little every day beats cramming.` : 'You\'re all caught up. Run a scene to keep it sharp.') : 'Upload a script, pick your role, and start getting off book.'}</p>
      </div>
      <div class="today card" style="padding:14px 18px">
        <div class="goal-ring">${ringSVG(goalPct, 84, 8, 'var(--lime-500)')}<div class="center"><div><b>${today}/${profile.goal}</b>today</div></div></div>
        <div class="small"><b>Daily goal</b><br><span class="muted">${today >= profile.goal ? 'Done! Extra reps still count.' : `${profile.goal - today} more lines to go`}</span><br><button class="btn ghost sm" id="goal-btn" style="padding-left:0">Change Goal</button></div>
      </div>
    </div>
    <div class="section-head"><h2>My scripts</h2></div>
    <div class="grid cols-3">
      ${scripts.map(s => `
        <div class="card script-card" data-id="${s.id}">
          <div class="top">${ring(s.percent, 58, 6, 13)}<div style="min-width:0"><h3>${esc(s.title)}</h3><div class="muted small">${s.myCharacters.map(c => esc(titleCase(c))).join(', ') || 'No role chosen'} · ${s.lineCount} lines</div></div></div>
          <div class="meta">
            ${s.due ? `<span class="tag due">${s.due} to review</span>` : `<span class="tag done">All caught up</span>`}
            ${s.trouble ? `<span class="tag trouble">${s.trouble} trouble spot${s.trouble === 1 ? '' : 's'}</span>` : ''}
            <span class="tag">${s.offBook}/${s.lineCount} off book</span>
          </div>
        </div>`).join('')}
      <div class="card add-card" id="add-card"><div><div class="plus">+</div>Add a Script</div></div>
    </div>
    <div class="section">
      <div class="section-head"><h2>Badges</h2><span class="muted small">${profile.badges.length}/${BADGES.length} earned</span></div>
      <div class="badges">${BADGES.map(b => `<div class="badge ${profile.badges.includes(b.id) ? '' : 'locked'}" title="${esc(b.desc)}"><span class="ico">${b.ico}</span><div><b>${b.name}</b><span class="muted">${b.desc}</span></div></div>`).join('')}</div>
    </div>
    <div class="section">
      <div class="card" id="data-card" style="margin-bottom:16px">
        <h3>Your Data</h3>
        <p class="small" id="sync-line" style="margin-top:0">${syncLineHTML()}</p>
        <p class="muted small" style="margin-top:0">${syncState().user ? 'Your scripts and progress are saved on this device and in your account, so they follow you everywhere. Back Up still makes an extra copy you can keep.' : 'Your data is saved in this browser only. It will be lost if you clear your browser\'s data, use a different browser, or switch devices. This is normal — it\'s not a bug. Use <b>Back Up</b> to save a copy you can keep or restore on another device.'}</p>
        <div class="row">
          <button class="btn primary" id="backup"><i class="fa-solid fa-download" aria-hidden="true"></i> Back Up</button>
          <button class="btn" id="restore"><i class="fa-solid fa-upload" aria-hidden="true"></i> Restore</button>
          <input type="file" id="restore-file" accept=".json,application/json" hidden>
          <span class="spacer"></span>
          ${installButtonHTML()}
        </div>
        <div class="small muted" style="margin-top:8px">${profile.lastBackup ? `Last backup: ${new Date(profile.lastBackup).toLocaleDateString()}` : 'No backup yet.'}${navigator.onLine ? '' : ' · You\'re offline — everything still works except Smart read and (in some browsers) Speaking.'}</div>
      </div>
      <div class="tip"><b>How Off Book works:</b> each line starts fully visible, then the app gradually takes words away — first-letter cues, missing words, then nothing but your cue. You say or type each line <b>word for word</b> and the app checks it automatically — stuck? Tap <b>Hint</b> for the next word. Lines you miss become <b>trouble spots</b> and come back twice as often until you nail them twice in a row.</div>
    </div>`;
  $app.querySelectorAll('.script-card').forEach(c => c.addEventListener('click', () => { location.hash = `#/script/${c.dataset.id}`; }));
  document.getElementById('add-card').onclick = () => { location.hash = '#/add'; };
  bindDataCard();
  document.getElementById('goal-btn').onclick = () => {
    modal.open(`<h2>Daily goal</h2><p class="muted">How many line reviews do you want to do each day?</p>
      <div class="row">${[10, 20, 40, 60, 100].map(n => `<button class="btn ${n === profile.goal ? 'primary' : ''}" data-n="${n}">${n}</button>`).join('')}</div>`, (m) => {
      m.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { profile.goal = +b.dataset.n; saveProfile(); modal.close(); renderHome(); });
    });
  };
}

// ---------------------------------------------------------------- ADD SCRIPT
let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(`${BASE}/vendor/pdfjs/pdf.min.mjs`).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = `${BASE}/vendor/pdfjs/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsPromise;
}

// ---- Scanned pages & photos: text recognition runs right in the browser
const abs = (p) => new URL(`${BASE}${p}`, location.href).href;
let ocrWorkerPromise = null;
function getOcrWorker(onStatus) {
  if (!ocrWorkerPromise) {
    onStatus && onStatus('Getting the page reader ready (first time takes a few seconds)…');
    ocrWorkerPromise = import(abs('/vendor/tesseract/tesseract.esm.min.js'))
      .then(mod => (mod.default || mod).createWorker('eng', 1, {
        workerPath: abs('/vendor/tesseract/worker.min.js'),
        corePath: abs('/vendor/tesseract-core'),
        langPath: abs('/vendor/tesseract-lang'),
        workerBlobURL: false,
      }))
      .catch(e => { ocrWorkerPromise = null; throw e; });
  }
  return ocrWorkerPromise;
}
async function releaseOcr() {
  if (!ocrWorkerPromise) return;
  try { (await ocrWorkerPromise).terminate(); } catch { /* ignore */ }
  ocrWorkerPromise = null;
}

// Clean up a page image for better recognition: upscale small images, convert to high-contrast grayscale.
function prepCanvas(src, w, h) {
  const target = Math.min(2600, Math.max(1800, w));
  const scale = target / w;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.35 + 140)); // gentle contrast boost
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function ocrCanvas(canvas, onStatus) {
  const worker = await getOcrWorker(onStatus);
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  return { lines: ocrBlocksToLines(data.blocks), confidence: data.confidence || 0 };
}

async function extractPdf(file, onProgress, onStatus, scanInfo) {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false, enableScripting: false }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const textChars = tc.items.reduce((a, it) => a + (it.str ? it.str.trim().length : 0), 0);
    if (textChars >= 40) {
      onStatus && onStatus(`Reading page ${i} of ${doc.numPages}…`);
      lines.push(...pdfItemsToLines(tc.items));
    } else {
      // No real text on this page — it's a scan or photo, so read it visually
      onStatus && onStatus(`Scanning page ${i} of ${doc.numPages}… (scanned pages take a few seconds each)`);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, 2000 / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      const r = await ocrCanvas(prepCanvas(canvas, canvas.width, canvas.height), onStatus);
      lines.push(...r.lines);
      scanInfo.pages++; scanInfo.conf += r.confidence;
    }
    page.cleanup && page.cleanup();
    onProgress && onProgress(i / doc.numPages);
  }
  return lines;
}

async function extractImages(files, onProgress, onStatus, scanInfo) {
  const lines = [];
  for (let i = 0; i < files.length; i++) {
    onStatus && onStatus(`Scanning page ${i + 1} of ${files.length}…`);
    let bmp;
    try { bmp = await createImageBitmap(files[i], { imageOrientation: 'from-image' }); }
    catch { throw new Error(`"${files[i].name}" couldn't be opened. Use JPG or PNG photos (iPhone HEIC photos can be exported as JPG).`); }
    const r = await ocrCanvas(prepCanvas(bmp, bmp.width, bmp.height), onStatus);
    bmp.close && bmp.close();
    lines.push(...r.lines);
    scanInfo.pages++; scanInfo.conf += r.confidence;
    onProgress && onProgress((i + 1) / files.length);
  }
  return lines;
}

function linesToText(lines) { return lines.map(l => (l.blank ? '' : l.text)).join('\n').replace(/\n{3,}/g, '\n\n'); }

function renderAdd() {
  const st = { step: 1, title: '', lines: null, text: '', parsed: null, mine: new Set(), busy: false, error: '' };
  const draw = () => {
    const stepNames = ['Upload', 'Choose your role', 'Check & save'];
    $app.innerHTML = `
      <a class="btn ghost sm" href="#/">← My Scripts</a>
      <h1 style="margin-top:12px">Add a script</h1>
      <div class="steps">${stepNames.map((n, i) => `<span class="step ${i + 1 === st.step ? 'on' : i + 1 < st.step ? 'done' : ''}">${i + 1}. ${n}</span>`).join('')}</div>
      ${st.error ? `<div class="error">${esc(st.error)}</div>` : ''}
      <div id="step"></div>`;
    const el = document.getElementById('step');
    if (st.step === 1) drawUpload(el); else if (st.step === 2) drawRole(el); else drawConfirm(el);
  };

  const drawUpload = (el) => {
    el.innerHTML = `
      <div class="card">
        <label class="field"><span>Script title</span><input type="text" id="title" placeholder="e.g. Our Town — Spring Production" value="${esc(st.title)}"></label>
        <div class="drop" id="drop">
          <div class="big-ico"><i class="fa-regular fa-file-lines" aria-hidden="true"></i></div>
          <div><b>Drop your script here</b> or click to choose</div>
          <div class="muted small">A PDF (typed or scanned), photos of the pages, or a text file. Select several photos at once for multiple pages.</div>
          <input type="file" id="file" accept=".pdf,.txt,application/pdf,text/plain,image/*" multiple hidden>
        </div>
        <div id="pdf-progress" class="hidden"><div class="progress-line"><span style="width:0%"></span></div><div class="muted small" id="pdf-msg">Reading your script…</div></div>
        <details style="margin-top:16px"><summary class="muted" style="cursor:pointer">Or paste the script text instead</summary>
          <textarea id="paste" placeholder="HAMLET: To be, or not to be..." style="margin-top:10px"></textarea>
          <button class="btn primary" id="paste-go" style="margin-top:10px">Use This Text</button>
        </details>
      </div>`;
    const drop = el.querySelector('#drop'), file = el.querySelector('#file');
    el.querySelector('#title').oninput = (e) => { st.title = e.target.value; };
    drop.onclick = () => file.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) handleFile([...e.dataTransfer.files]); };
    file.onchange = () => file.files.length && handleFile([...file.files]);
    el.querySelector('#paste-go').onclick = () => {
      const t = el.querySelector('#paste').value;
      if (t.trim().length < 40) { st.error = 'Paste a bit more of the script so we can find the characters.'; draw(); return; }
      st.lines = textToLines(t); st.text = t; afterExtract();
    };
  };

  const handleFile = async (files) => {
    st.error = '';
    files = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const isImg = (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i.test(f.name);
    const images = files.filter(isImg);
    const f = files.find(x => !isImg(x)) || files[0];
    if (!st.title) st.title = f.name.replace(/\.(pdf|txt|png|jpe?g|webp|heic)$/i, '').replace(/[_-]+/g, ' ');
    const pp = document.getElementById('pdf-progress'); pp.classList.remove('hidden');
    const bar = pp.querySelector('span'), msg = document.getElementById('pdf-msg');
    const onProgress = (r) => { bar.style.width = (r * 100) + '%'; };
    const onStatus = (t) => { msg.textContent = t; };
    const scanInfo = { pages: 0, conf: 0 };
    document.getElementById('drop').style.pointerEvents = 'none';
    try {
      if (images.length && images.length === files.length) {
        st.lines = await extractImages(images, onProgress, onStatus, scanInfo);
      } else if (/\.txt$/i.test(f.name) || f.type === 'text/plain') {
        st.lines = textToLines(await f.text());
      } else {
        st.lines = await extractPdf(f, onProgress, onStatus, scanInfo);
      }
      st.text = linesToText(st.lines);
      st.scan = scanInfo.pages ? { pages: scanInfo.pages, confidence: Math.round(scanInfo.conf / scanInfo.pages) } : null;
      if (st.text.replace(/\s/g, '').length < 60) {
        st.error = 'We couldn\'t make out any words. If it\'s a photo or scan, try a sharper, well-lit, straight-on image — or paste the script text below.';
        draw(); return;
      }
      afterExtract();
    } catch (e) {
      console.error(e);
      st.error = e.message && e.message.includes('couldn\'t be opened') ? e.message : 'That file couldn\'t be opened. Make sure it\'s a PDF or image that isn\'t password-protected.';
      draw();
    } finally { releaseOcr(); }
  };

  const afterExtract = () => {
    st.parsed = parseScript(st.lines);
    st.mine = new Set();
    st.error = '';
    st.step = 2; draw();
  };

  const smartRead = async (el) => {
    const chunks = [];
    const paras = st.text.split('\n');
    let cur = '';
    for (const p of paras) { if (cur.length + p.length > 7000 && cur) { chunks.push(cur); cur = ''; } cur += p + '\n'; }
    if (cur.trim()) chunks.push(cur);
    const box = el.querySelector('#smart-box');
    box.innerHTML = `<div class="progress-line"><span style="width:0%"></span></div><div class="muted small" id="smart-msg">Reading part 1 of ${chunks.length}…</div>`;
    const bar = box.querySelector('span'), msg = box.querySelector('#smart-msg');
    const results = new Array(chunks.length);
    let done = 0, failed = 0, next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const i = next++;
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          try { results[i] = (await api('/ai/parse', { method: 'POST', body: { text: chunks[i] } })).entries; ok = true; } catch (e) { if (attempt === 1) { failed++; results[i] = []; if (/not available/.test(e.message)) throw e; } }
        }
        done++; bar.style.width = (done / chunks.length * 100) + '%'; msg.textContent = `Read ${done} of ${chunks.length} parts…`;
      }
    };
    try {
      await Promise.all([worker(), worker(), worker()]);
    } catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
    const entries = [], scenes = [];
    let scene = -1;
    results.flat().forEach(e => {
      if (e.type === 'scene') { scenes.push({ title: e.text.slice(0, 80) }); scene = scenes.length - 1; entries.push({ ...e, scene }); }
      else entries.push({ ...e, scene, speaker: e.speaker ? e.speaker.replace(/\s*\(.*?\)\s*/g, ' ').trim() : undefined });
    });
    const parsed = finalize(entries, scenes);
    if (!parsed.characters.length) { box.innerHTML = '<div class="error">Smart read couldn\'t find any dialogue. Try a different file.</div>'; return; }
    st.parsed = parsed; st.mine = new Set();
    if (failed) toast('Mostly done', `${failed} part${failed === 1 ? '' : 's'} couldn't be read and were skipped.`, '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>');
    draw();
  };

  const drawRole = (el) => {
    const { characters, entries, scenes } = st.parsed;
    const nLines = entries.filter(e => e.type === 'line').length;
    el.innerHTML = `
      <div class="card">
        <h2>Who are you playing?</h2>
        <p class="sub">We found <b>${characters.length}</b> characters, <b>${nLines}</b> lines and <b>${scenes.length}</b> scene${scenes.length === 1 ? '' : 's'}. Pick one or more roles (great for doubling).</p>
        ${characters.length ? `<div class="char-list">${characters.map(c => `<label class="char ${st.mine.has(c.name) ? 'on' : ''}"><input type="checkbox" value="${esc(c.name)}" ${st.mine.has(c.name) ? 'checked' : ''}><span class="n">${esc(titleCase(c.name))}</span><span class="c">${c.count} lines</span></label>`).join('')}</div>` : '<div class="empty">No characters found. Check that the script names each speaker, or paste the text instead.</div>'}
        ${st.scan ? `<div class="notice" style="margin-top:18px"><i class="fa-solid fa-camera" aria-hidden="true"></i> We scanned <b>${st.scan.pages}</b> page${st.scan.pages === 1 ? '' : 's'} (reading quality ${st.scan.confidence}%). Scans can misread a few words, so check the preview below. You can fix any line later in the <b>Edit Script</b> tab.</div>` : ''}
        <div class="tip" style="margin-top:18px">Names look wrong, or lines are missing? You can fix any line's wording or speaker after saving, from the script's <b>Edit Script</b> tab. (<b>Smart read</b>, which uses AI to re-read a script, is only in the online version.)</div>
        <h3 style="margin-top:22px">Preview</h3>
        <div class="script-view" id="preview"></div>
        <div class="row" style="margin-top:18px"><button class="btn" id="back">Back</button><span class="spacer"></span><button class="btn primary big" id="next" ${st.mine.size ? '' : 'disabled'}>Continue</button></div>
      </div>`;
    const drawPreview = () => {
      el.querySelector('#preview').innerHTML = entries.slice(0, 160).map(e => entryHTML(e, st.mine)).join('') + (entries.length > 160 ? '<div class="sv-entry muted">…</div>' : '');
    };
    drawPreview();
    el.querySelectorAll('.char input').forEach(cb => cb.onchange = () => {
      cb.checked ? st.mine.add(cb.value) : st.mine.delete(cb.value);
      cb.parentElement.classList.toggle('on', cb.checked);
      el.querySelector('#next').disabled = !st.mine.size;
      drawPreview();
    });
    el.querySelector('#back').onclick = () => { st.step = 1; draw(); };
    el.querySelector('#next').onclick = () => { st.step = 3; draw(); };
  };

  const drawConfirm = (el) => {
    const mine = st.parsed.entries.filter(e => e.type === 'line' && st.mine.has(e.speaker));
    const words = mine.reduce((a, l) => a + l.text.split(/\s+/).length, 0);
    const days = Math.max(3, Math.ceil(mine.length / 15));
    el.innerHTML = `
      <div class="card">
        <h2>Ready to rehearse</h2>
        <div class="grid cols-4" style="margin:16px 0">
          <div class="stat"><b>${mine.length}</b><span>lines to learn</span></div>
          <div class="stat"><b>${words.toLocaleString()}</b><span>words</span></div>
          <div class="stat"><b>${st.parsed.scenes.length}</b><span>scenes</span></div>
          <div class="stat"><b>~${days} days</b><span>at 15 new lines/day</span></div>
        </div>
        <label class="field"><span>Script title</span><input type="text" id="title" value="${esc(st.title || 'Untitled script')}"></label>
        <p class="muted small">You can fix any line's wording or speaker later from the script's <b>Edit Script</b> tab.</p>
        <div class="row" style="margin-top:12px"><button class="btn" id="back">Back</button><span class="spacer"></span><button class="btn primary big" id="save">Save &amp; Start Learning</button></div>
      </div>`;
    el.querySelector('#title').oninput = (e) => { st.title = e.target.value; };
    el.querySelector('#back').onclick = () => { st.step = 2; draw(); };
    el.querySelector('#save').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        const { id } = await api('/scripts', { method: 'POST', body: { title: st.title, data: st.parsed, myCharacters: [...st.mine] } });
        confetti(80);
        location.hash = `#/script/${id}`;
      } catch (err) { st.error = err.message; draw(); }
    };
  };
  draw();
}

function entryHTML(e, mineSet, editable = false) {
  const mine = e.type === 'line' && mineSet.has(e.speaker);
  const cls = `sv-entry ${e.type} ${mine ? 'mine' : ''} ${editable ? 'editable' : ''}`;
  if (e.type === 'scene') return `<div class="${cls}" data-id="${e.id}">${esc(e.text)}</div>`;
  if (e.type === 'dir') return `<div class="${cls}" data-id="${e.id}">${esc(e.text)}</div>`;
  return `<div class="${cls}" data-id="${e.id}"><div class="who">${esc(e.speaker)}</div>${esc(e.text)}</div>`;
}

// ---------------------------------------------------------------- SCRIPT DASHBOARD
const saveProgress = debounce((script) => api(`/scripts/${script.id}/progress`, { method: 'PUT', body: { progress: script.progress } }).catch(() => toast('Not saved', 'Your latest progress could not be saved. Check your connection.', '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>')), 1500);

async function loadScript(id) {
  if (current.script && current.script.id === id) return current.script;
  const s = await api(`/scripts/${id}`);
  current.script = s;
  return s;
}

const MODES = [
  { id: 'auto', name: 'Smart Mix', desc: 'Adapts to how well you know each line' },
  { id: 'learn', name: 'Learn', desc: 'Read it 3×, then say it from memory' },
  { id: 'fade', name: 'Fade Out', desc: 'Fill in the missing words' },
  { id: 'letters', name: 'First Letters', desc: 'Only the first letter of each word' },
  { id: 'recall', name: 'Cue Only', desc: 'Just your cue — full test' },
];
const SR_CTOR = window.SpeechRecognition || window.webkitSpeechRecognition;
const CAN_LISTEN = !!SR_CTOR;
let prefs = { mode: 'auto', speak: false, context: true, input: CAN_LISTEN ? 'speak' : 'type' };

let activeEditor = null;
function flushEditor() { if (activeEditor) { const e = activeEditor; activeEditor = null; e.flush().catch(() => {}); } }

async function renderScript(id, tab = 'scenes') {
  flushEditor();
  const script = await loadScript(id);
  const st = stats(script);
  const lines = myLines(script);
  const troubleCount = st.trouble;
  $app.innerHTML = `
    <a class="btn ghost sm" href="#/">← My Scripts</a>
    <div class="card" style="margin-top:12px">
      <div class="dash-head">
        ${ring(st.pct, 110, 10, 24)}
        <div>
          <h1 style="margin-bottom:4px">${esc(script.title)}</h1>
          <div class="muted">Playing <b>${script.myCharacters.map(c => esc(titleCase(c))).join(', ') || '—'}</b> · <button class="btn ghost sm" id="roles" style="padding:2px 6px">Change</button></div>
          <div class="mastery-bar">${st.counts.map((c, i) => c ? `<span style="width:${(c / st.total) * 100}%;background:var(--m${i})" title="${MASTERY[i]}: ${c}"></span>` : '').join('')}</div>
          <div class="legend">${MASTERY.map((m, i) => `<span><i style="background:var(--m${i})"></i>${m} ${st.counts[i]}</span>`).join('')}</div>
        </div>
        <div class="row" style="flex-direction:column;align-items:stretch">
          <button class="btn primary big" id="smart"><i class="fa-solid fa-play" aria-hidden="true"></i> ${st.due ? `Review ${Math.min(st.due, 25)} Lines` : 'Practice'}</button>
          <button class="btn ${troubleCount ? '' : 'ghost'}" id="trouble" ${troubleCount ? '' : 'disabled'}><i class="fa-solid fa-bullseye" aria-hidden="true"></i> Drill ${troubleCount} Trouble Spot${troubleCount === 1 ? '' : 's'}</button>
        </div>
      </div>
      <div class="grid cols-4" style="margin-top:20px">
        <div class="stat"><b>${st.total}</b><span>your lines</span></div>
        <div class="stat"><b>${st.offBook}</b><span>off book</span></div>
        <div class="stat"><b>${st.due}</b><span>ready to review</span></div>
        <div class="stat"><b style="color:${troubleCount ? 'var(--danger)' : 'inherit'}">${troubleCount}</b><span>trouble spots</span></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Practice style</h3>
      <div class="modes" id="modes">${MODES.map(m => `<button class="mode ${prefs.mode === m.id ? 'on' : ''}" data-m="${m.id}"><b>${m.name}</b><span>${m.desc}</span></button>`).join('')}</div>
      <h3 style="margin-top:16px">Answer by</h3>
      <div class="modes" id="inputs" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
        <button class="mode ${prefs.input === 'speak' ? 'on' : ''}" data-i="speak" ${CAN_LISTEN ? '' : 'disabled title="Speaking needs Chrome, Edge or Safari"'}><b><i class="fa-solid fa-microphone" aria-hidden="true"></i> Speaking</b><span>${CAN_LISTEN ? 'Hands-free: moves on when you get it right' : 'Needs Chrome, Edge or Safari'}</span></button>
        <button class="mode ${prefs.input === 'type' ? 'on' : ''}" data-i="type"><b><i class="fa-regular fa-keyboard" aria-hidden="true"></i> Typing</b><span>Moves on as soon as it\'s right</span></button>
      </div>
      <div class="row" style="margin-top:12px;gap:18px">
        <label class="toggle"><input type="checkbox" id="speak" ${prefs.speak ? 'checked' : ''}> Read cue lines aloud</label>
        <label class="toggle"><input type="checkbox" id="context" ${prefs.context ? 'checked' : ''}> Show stage directions</label>
      </div>
    </div>

    <div class="tabs">
      ${[['scenes', 'Scenes'], ['trouble', `Trouble Spots${troubleCount ? ` (${troubleCount})` : ''}`], ['map', 'Line Map'], ['script', 'Edit Script'], ['settings', 'Settings']].map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}
    </div>
    <div id="tab"></div>`;

  document.querySelectorAll('.tab').forEach(t => t.onclick = () => { history.replaceState(null, '', `#/script/${id}/${t.dataset.tab}`); renderScript(id, t.dataset.tab); });
  document.querySelectorAll('#modes .mode').forEach(b => b.onclick = () => { prefs.mode = b.dataset.m; savePrefs(); document.querySelectorAll('#modes .mode').forEach(x => x.classList.toggle('on', x === b)); });
  document.querySelectorAll('#inputs .mode').forEach(b => b.onclick = () => { if (b.disabled) return; prefs.input = b.dataset.i; savePrefs(); document.querySelectorAll('#inputs .mode').forEach(x => x.classList.toggle('on', x === b)); });
  document.getElementById('speak').onchange = (e) => { prefs.speak = e.target.checked; savePrefs(); };
  document.getElementById('context').onchange = (e) => { prefs.context = e.target.checked; savePrefs(); };
  document.getElementById('smart').onclick = () => startSession(script, { kind: 'smart' });
  document.getElementById('trouble').onclick = () => startSession(script, { kind: 'trouble' });
  document.getElementById('roles').onclick = () => editRoles(script);

  const el = document.getElementById('tab');
  if (tab === 'scenes') {
    el.innerHTML = `<div class="card" style="padding:4px 6px">${script.data.scenes.map((sc, i) => {
      const ls = lines.filter(l => l.scene === i);
      if (!ls.length) return '';
      const pct = ls.reduce((a, l) => a + (script.progress[l.id]?.mastery || 0), 0) / (ls.length * 5) * 100;
      const tr = ls.filter(l => script.progress[l.id]?.trouble).length;
      const ob = ls.filter(l => (script.progress[l.id]?.mastery || 0) >= 4).length;
      return `<div class="scene-row"><div><div class="t">${esc(sc.title || `Scene ${i + 1}`)}</div><div class="s">${ls.length} lines · ${ob} off book${tr ? ` · <span style="color:var(--danger)">${tr} trouble</span>` : ''}</div></div>
        <div><div class="mini-bar"><span style="width:${pct}%"></span></div><div class="s">${Math.round(pct)}% ready</div></div>
        <div class="row"><button class="btn sm" data-run="${i}">Run Scene</button></div></div>`;
    }).join('') || '<div class="empty">None of your lines were found. Check your role under "change".</div>'}
    <div class="scene-row"><div><div class="t">Full run-through</div><div class="s">Every one of your lines, in order</div></div><div></div><div><button class="btn sm" data-run="all">Run It All</button></div></div></div>`;
    el.querySelectorAll('[data-run]').forEach(b => b.onclick = () => startSession(script, b.dataset.run === 'all' ? { kind: 'all' } : { kind: 'scene', scene: +b.dataset.run }));
  } else if (tab === 'trouble') {
    const tl = lines.filter(l => script.progress[l.id] && (script.progress[l.id].trouble || script.progress[l.id].misses)).sort((a, b) => troubleRank(script.progress[b.id]) - troubleRank(script.progress[a.id]));
    el.innerHTML = tl.length ? `<div class="card" style="padding:4px 6px">${tl.map(l => {
      const p = script.progress[l.id]; const { cue } = cueFor(script, l);
      return `<div class="trouble-item"><div><div class="cue">${cue ? `Cue — ${esc(cue.speaker)}: “${esc(cue.text.slice(-80))}”` : 'Opening line'}</div><div class="txt">${esc(l.text)}</div>
        <div class="small muted">${p.trouble ? '<span class="tag trouble">Trouble</span>' : '<span class="tag done">Fixed</span>'} Missed ${p.misses}× · Shaky ${p.hards}× · ${p.attempts} tries</div></div>
        <button class="btn sm" data-line="${l.id}">Practice</button></div>`;
    }).join('')}</div>` : '<div class="card empty">No trouble spots yet. Any line you miss or find shaky will show up here and come back more often.</div>';
    el.querySelectorAll('[data-line]').forEach(b => b.onclick = () => startSession(script, { kind: 'lines', ids: [b.dataset.line] }));
  } else if (tab === 'map') {
    el.innerHTML = `<div class="card"><p class="muted small" style="margin-top:0">Each square is one of your lines, in script order. Darker = better known. Red outline = trouble spot. Click one to practice it.</p>
      ${script.data.scenes.map((sc, i) => { const ls = lines.filter(l => l.scene === i); return ls.length ? `<div style="margin-bottom:12px"><div class="small" style="font-weight:600;margin-bottom:4px">${esc(sc.title)}</div><div class="linemap">${ls.map(l => { const p = script.progress[l.id]; return `<div class="cell ${p?.trouble ? 'trouble' : ''}" style="background:var(--m${p ? p.mastery : 0})" data-line="${l.id}" title="${esc(l.text.slice(0, 90))}"></div>`; }).join('')}</div></div>` : ''; }).join('')}
      <div class="legend">${MASTERY.map((m, i) => `<span><i style="background:var(--m${i})"></i>${m}</span>`).join('')}</div></div>`;
    el.querySelectorAll('[data-line]').forEach(b => b.onclick = () => showLine(script, b.dataset.line));
  } else if (tab === 'script') {
    activeEditor = renderEditor(el, script, {
      esc, toast, modal, confirmBox, titleCase,
      save: async (data, extra) => {
        await api(`/scripts/${script.id}`, { method: 'PUT', body: { data, ...extra } });
        const fresh = await api(`/scripts/${script.id}`);
        script.data = fresh.data; script.myCharacters = fresh.myCharacters;
      },
    });
  } else if (tab === 'settings') {
    el.innerHTML = `<div class="card">
      <label class="field"><span>Script title</span><div class="row"><input type="text" id="t" value="${esc(script.title)}" style="flex:1"><button class="btn" id="save-t">Save</button></div></label>
      <div class="row"><button class="btn" id="reset">Reset My Progress</button><button class="btn danger" id="del">Delete Script</button></div></div>`;
    el.querySelector('#save-t').onclick = async () => { script.title = el.querySelector('#t').value; await api(`/scripts/${id}`, { method: 'PUT', body: { title: script.title } }); toast('Saved', 'Title updated.', '<i class="fa-regular fa-circle-check" aria-hidden="true"></i>'); renderScript(id, 'settings'); };
    el.querySelector('#reset').onclick = () => confirmBox('Reset progress?', 'This clears your memorization progress for this script. Your XP and badges stay.', 'Reset', async () => { script.progress = {}; await api(`/scripts/${id}/progress`, { method: 'PUT', body: { progress: {}, replace: true } }); renderScript(id, 'scenes'); });
    el.querySelector('#del').onclick = () => confirmBox('Delete this script?', 'The script and all its progress will be removed. This can\'t be undone.', 'Delete', async () => { await api(`/scripts/${id}`, { method: 'DELETE' }); current.script = null; location.hash = '#/'; });
  }
}

function confirmBox(title, msg, okLabel, onOk) {
  modal.open(`<h2>${esc(title)}</h2><p class="muted">${esc(msg)}</p><div class="row"><span class="spacer"></span><button class="btn" id="c-no">Cancel</button><button class="btn primary" id="c-ok">${esc(okLabel)}</button></div>`, (m) => {
    m.querySelector('#c-no').onclick = modal.close;
    m.querySelector('#c-ok').onclick = async () => { modal.close(); await onOk(); };
  });
}

function editRoles(script) {
  const chosen = new Set(script.myCharacters);
  modal.open(`<h2>Your role${script.data.characters.length > 1 ? 's' : ''}</h2><p class="muted">Progress for each line is kept even if you switch roles.</p>
    <div class="char-list">${script.data.characters.map(c => `<label class="char ${chosen.has(c.name) ? 'on' : ''}"><input type="checkbox" value="${esc(c.name)}" ${chosen.has(c.name) ? 'checked' : ''}><span class="n">${esc(titleCase(c.name))}</span><span class="c">${c.count}</span></label>`).join('')}</div>
    <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="r-no">Cancel</button><button class="btn primary" id="r-ok">Save</button></div>`, (m) => {
    m.querySelectorAll('.char input').forEach(cb => cb.onchange = () => { cb.checked ? chosen.add(cb.value) : chosen.delete(cb.value); cb.parentElement.classList.toggle('on', cb.checked); });
    m.querySelector('#r-no').onclick = modal.close;
    m.querySelector('#r-ok').onclick = async () => {
      if (!chosen.size) { toast('Pick at least one role', '', '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'); return; }
      script.myCharacters = [...chosen];
      await api(`/scripts/${script.id}`, { method: 'PUT', body: { myCharacters: script.myCharacters } });
      modal.close(); renderScript(script.id);
    };
  });
}

function editEntry(script, entryId) {
  const e = script.data.entries.find(x => x.id === entryId);
  if (!e) return;
  const names = script.data.characters.map(c => c.name);
  modal.open(`<h2>Edit ${e.type === 'line' ? 'line' : 'direction'}</h2>
    ${e.type === 'line' ? `<label class="field"><span>Spoken by</span><input type="text" id="sp" list="names" value="${esc(e.speaker)}"><datalist id="names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>` : ''}
    <label class="field"><span>Text</span><textarea id="tx">${esc(e.text)}</textarea></label>
    <div class="row"><button class="btn danger" id="e-del">Remove</button>${e.type === 'dir' ? '<button class="btn" id="e-tl">Make This a Line</button>' : '<button class="btn" id="e-td">Make This a Direction</button>'}<span class="spacer"></span><button class="btn" id="e-no">Cancel</button><button class="btn primary" id="e-ok">Save</button></div>`, (m) => {
    const save = async () => {
      script.data = { ...script.data, entries: script.data.entries.filter(x => !x._del) };
      const res = await api(`/scripts/${script.id}`, { method: 'PUT', body: { data: script.data } });
      current.script = null;
      const fresh = await loadScript(script.id);
      modal.close(); renderScript(fresh.id, 'script');
      return res;
    };
    m.querySelector('#e-no').onclick = modal.close;
    m.querySelector('#e-ok').onclick = async () => {
      e.text = m.querySelector('#tx').value.trim();
      if (e.type === 'line') e.speaker = m.querySelector('#sp').value.trim().toUpperCase() || e.speaker;
      if (e.type === 'line' && script.progress[e.id]) { /* wording changed: keep progress but flag for review */ script.progress[e.id].due = Date.now(); await saveProgress.flush(script); }
      await save();
    };
    m.querySelector('#e-del').onclick = async () => { e._del = true; await save(); };
    const tl = m.querySelector('#e-tl'); if (tl) tl.onclick = async () => { const sp = prompt('Who says this line?', names[0] || ''); if (!sp) return; e.type = 'line'; e.speaker = sp.trim().toUpperCase(); e.text = m.querySelector('#tx').value.trim(); await save(); };
    const td = m.querySelector('#e-td'); if (td) td.onclick = async () => { e.type = 'dir'; delete e.speaker; e.text = m.querySelector('#tx').value.trim(); await save(); };
  });
}

function showLine(script, lineId) {
  const l = script.data.entries.find(e => e.id === lineId);
  const p = script.progress[lineId];
  const { cue } = cueFor(script, l);
  modal.open(`<div class="cue-box"><div class="who">${cue ? esc(cue.speaker) : 'Opening'}</div><div class="cue-text">${cue ? esc(cue.text) : '—'}</div></div>
    <div class="mine-box" style="margin-top:10px"><div class="who">${esc(l.speaker)}</div><div class="line-text" style="font-size:19px">${esc(l.text)}</div></div>
    <p class="muted small">${p ? `${MASTERY[p.mastery]} · ${p.attempts} tries · missed ${p.misses}× · next review ${p.due <= Date.now() ? 'now' : new Date(p.due).toLocaleDateString()}` : 'Not practiced yet'}</p>
    <div class="row"><span class="spacer"></span><button class="btn" id="l-no">Close</button><button class="btn primary" id="l-go">Practice This Line</button></div>`, (m) => {
    m.querySelector('#l-no').onclick = modal.close;
    m.querySelector('#l-go').onclick = () => { modal.close(); startSession(script, { kind: 'lines', ids: [lineId] }); };
  });
}

function savePrefs() { try { localStorage.setItem('offbook.prefs', JSON.stringify(prefs)); } catch { /* ignore */ } }
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('offbook.prefs') || '{}') }; } catch { /* ignore */ }
if (prefs.mode === 'type') prefs.mode = 'recall';
if (prefs.input === 'speak' && !CAN_LISTEN) prefs.input = 'type';

// ---------------------------------------------------------------- PRACTICE SESSION
let session = null;

function buildQueue(script, cfg) {
  const lines = myLines(script);
  const P = script.progress;
  const now = Date.now();
  let q;
  if (cfg.kind === 'scene') q = lines.filter(l => l.scene === cfg.scene);
  else if (cfg.kind === 'all') q = lines;
  else if (cfg.kind === 'lines') q = lines.filter(l => cfg.ids.includes(l.id));
  else if (cfg.kind === 'trouble') q = lines.filter(l => P[l.id]?.trouble).sort((a, b) => troubleRank(P[b.id]) - troubleRank(P[a.id])).slice(0, 25);
  else {
    // Smart review: trouble first, then overdue reviews, then a few new lines — all played in script order
    const due = lines.filter(l => P[l.id] && P[l.id].due <= now).sort((a, b) => troubleRank(P[b.id]) - troubleRank(P[a.id]) || P[a.id].due - P[b.id].due);
    const fresh = lines.filter(l => !P[l.id]);
    const picked = [...due.slice(0, 18)];
    picked.push(...fresh.slice(0, Math.max(5, 25 - picked.length)));
    if (!picked.length) picked.push(...lines.slice().sort((a, b) => (P[a.id]?.due || 0) - (P[b.id]?.due || 0)).slice(0, 15));
    const order = new Map(lines.map((l, i) => [l.id, i]));
    q = picked.slice(0, 25).sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  return q.map(l => ({ line: l, requeued: 0 }));
}

function startSession(script, cfg) {
  const queue = buildQueue(script, cfg);
  if (!queue.length) { toast('Nothing to practice', 'No lines matched. Try another scene.', '<i class="fa-regular fa-circle-question" aria-hidden="true"></i>'); return; }
  const labels = { smart: 'Smart review', trouble: 'Trouble spots', all: 'Full run-through', lines: 'Line drill', scene: script.data.scenes[cfg.scene]?.title || 'Scene' };
  session = { scriptId: script.id, cfg, label: labels[cfg.kind], queue, i: 0, unique: new Set(queue.map(q => q.line.id)).size, results: {}, combo: 0, bestCombo: 0, xp: 0, misses: 0, startMastery: stats(script).pct, fixed: 0 };
  const target = `#/practice/${script.id}`;
  if (location.hash === target) router(); else location.hash = target;
}

function modeFor(p) {
  if (prefs.mode !== 'auto') return prefs.mode;
  let m = p ? p.mastery : 0;
  if (p && p.trouble) m = Math.max(0, m - 1);
  return ['learn', 'fade', 'letters', 'fade', 'recall', 'recall'][m];
}

function seeded(seed) { let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function tokenize(text) { return text.split(/(\s+)/).filter(Boolean); }

function fadeHTML(text, frac, seed) {
  const rnd = seeded(seed);
  return tokenize(text).map(tok => {
    if (/^\s+$/.test(tok)) return tok;
    const m = tok.match(/^([^\w']*)([\w'’\-]+)([^\w']*)$/);
    if (!m || rnd() >= frac) return esc(tok);
    return `${esc(m[1])}<span class="gap">${esc(m[2])}</span>${esc(m[3])}`;
  }).join('');
}

function lettersHTML(text) {
  // Keep the line breaks (song lyrics, poetry) — only shorten each word to its first letter
  const short = (line) => line.split(/\s+/).filter(Boolean).map(w => { const m = w.match(/^([^\w]*)([\w])[\w'’\-]*([^\w]*)$/); return m ? m[1] + m[2] + m[3] : w; }).join(' ');
  return `<span class="fl">${esc(text.split('\n').map(short).join('\n'))}</span>`;
}

function speak(text, rate = 1, onEnd) {
  if (!('speechSynthesis' in window)) { onEnd && onEnd(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  let done = false;
  const finish = () => { if (!done) { done = true; onEnd && onEnd(); } };
  u.onend = finish; u.onerror = finish;
  // Safety net in case the browser never fires onend
  setTimeout(finish, Math.min(20000, 1500 + text.split(/\s+/).length * 450 / rate));
  speechSynthesis.speak(u);
}

// ---- Speech recognition (listening to the actor)
// Keeps listening through pauses (you may need time to think). Restarts itself if the browser
// ends the session, and keeps what you've said so far until the line is right or you start over.
let listener = null;
function stopListening() { if (listener) { const l = listener; listener = null; l.stop(); } }
function startListening({ onText, onError, onIdle }) {
  stopListening();
  let base = '', current = '', stopped = false, rec = null, idleTimer = null, restarts = 0;
  const ctl = {
    get text() { return (base + ' ' + current).replace(/\s+/g, ' ').trim(); },
    reset() { base = ''; current = ''; onText(''); },
    stop() { stopped = true; clearTimeout(idleTimer); if (rec) { try { rec.abort(); } catch { /* */ } } },
    get active() { return !stopped; },
  };
  const bumpIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { ctl.stop(); if (listener === ctl) listener = null; onIdle && onIdle(); }, 90000); };
  const begin = () => {
    if (stopped) return;
    rec = new SR_CTOR();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      let t = '';
      for (let k = 0; k < ev.results.length; k++) t += ' ' + ev.results[k][0].transcript;
      current = t; restarts = 0; bumpIdle();
      onText(ctl.text);
    };
    rec.onerror = (e) => {
      if (stopped) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'network' || e.error === 'language-not-supported') { stopped = true; onError && onError(e.error); }
    };
    rec.onend = () => {
      if (stopped) return;
      base = ctl.text; current = '';
      // Browser ended the session (silence, time limit, network) — pick right back up
      if (++restarts > 8) { stopped = true; onError && onError('ended'); return; }
      setTimeout(begin, 150);
    };
    try { rec.start(); } catch { setTimeout(begin, 300); }
  };
  listener = ctl;
  bumpIdle();
  begin();
  return ctl;
}

async function renderPractice(id) {
  const script = await loadScript(id);
  if (!session || session.scriptId !== id) { location.hash = `#/script/${id}`; return; }
  drawCard(script);
}

const MODE_NAMES = { learn: 'Learn', fade: 'Fade Out', letters: 'First Letters', recall: 'Cue Only' };

function drawCard(script) {
  const s = session;
  if (s.i >= s.queue.length) return drawSummary(script);
  const item = s.queue[s.i];
  const line = item.line;
  const p = script.progress[line.id];
  const mode = modeFor(p);
  const { cue, dir } = cueFor(script, line);
  const done = Object.keys(s.results).length;
  const frac = mode === 'fade' ? ((p?.mastery || 0) >= 3 ? 0.75 : 0.45) : 0;
  const seed = line.id + ':' + (p?.attempts || 0);
  const useVoice = prefs.input === 'speak' && CAN_LISTEN;
  const scriptWords = line.text.split(/\s+/).filter(Boolean);
  const revealed = new Set(); // script word positions given away by hints
  const evalOpts = { speech: useVoice };

  $app.innerHTML = `
    <div class="practice">
      <div class="p-top">
        <button class="btn ghost sm" id="quit" title="End session" aria-label="End session"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        <div class="progress-line"><span style="width:${(done / s.unique) * 100}%"></span></div>
        <span class="small muted">${done}/${s.unique}</span>
        <span class="combo" id="combo">${s.combo >= 2 ? `<i class="fa-solid fa-fire" aria-hidden="true"></i> ${s.combo}×` : ''}</span>
        ${CAN_LISTEN ? `<button class="btn sm input-switch" id="switch-input" title="Change how you answer" aria-label="${useVoice ? 'Switch to typing' : 'Switch to speaking'}">${useVoice ? '<i class="fa-regular fa-keyboard" aria-hidden="true"></i><span class="sw-label"> Switch to Typing</span>' : '<i class="fa-solid fa-microphone" aria-hidden="true"></i><span class="sw-label"> Switch to Speaking</span>'}</button>` : ''}
      </div>
      <div class="stage">
        <span class="mode-pill">${MODE_NAMES[mode]}${p?.trouble ? ' · trouble spot' : ''}</span>
        <div class="small muted">${esc(script.data.scenes[line.scene]?.title || '')}</div>
        ${prefs.context && dir ? `<div class="ctx">${esc(dir.text)}</div>` : ''}
        <div class="cue-box"><div class="who">${cue ? esc(cue.speaker) + (script.myCharacters.includes(cue.speaker) ? ' (you)' : '') : 'Top of scene'} ${cue ? `<button class="speak-btn" id="say-cue" title="Hear cue" aria-label="Hear cue"><i class="fa-solid fa-volume-high" aria-hidden="true"></i></button>` : ''}</div><div class="cue-text">${cue ? esc(cue.text) : '<span class="muted">You speak first.</span>'}</div></div>
        <div class="mine-box" id="mine"></div>
        <div id="controls"></div>
      </div>
      <p class="hint" style="text-align:center;margin-top:10px">${useVoice ? 'Say your line out loud, word for word. Take your time — it moves on when you get it right.' : 'Type your line word for word. It moves on as soon as it\'s right.'}</p>
    </div>`;

  const mine = document.getElementById('mine'), controls = document.getElementById('controls');
  const who = `<div class="who">${esc(line.speaker)}</div>`;
  // Tracking for automatic grading
  let phase = 'prompt', hintClicks = 0, lastAttempt = '', hintNote = '', wrongTries = 0, peeked = 0, gaveUp = false, graded = false;
  let keyHandler = null, advanceTimer = null, lastWrongLen = 0;
  const cleanup = () => { stopListening(); clearTimeout(advanceTimer); document.removeEventListener('keydown', keyHandler); window.speechSynthesis?.cancel?.(); };
  window.addEventListener('hashchange', cleanup, { once: true });

  document.getElementById('quit').onclick = () => { cleanup(); if (Object.keys(s.results).length) drawSummary(script); else location.hash = `#/script/${script.id}`; };
  const sayCue = document.getElementById('say-cue');
  if (sayCue) sayCue.onclick = () => speak(cue.text);
  const sw = document.getElementById('switch-input');
  if (sw) sw.onclick = () => {
    if (phase === 'result') return;
    // Switch how you answer and restart this line in the new mode (choice is remembered)
    prefs.input = useVoice ? 'type' : 'speak'; savePrefs();
    cleanup(); drawCard(script);
    toast(prefs.input === 'type' ? 'Typing mode' : 'Speaking mode', prefs.input === 'type' ? 'Type your line and it moves on when it\'s right.' : 'Say your line out loud — take your time.', prefs.input === 'type' ? '<i class="fa-regular fa-keyboard" aria-hidden="true"></i>' : '<i class="fa-solid fa-microphone" aria-hidden="true"></i>');
  };

  // What's visible while you answer
  const promptHTML = () => {
    if (gaveUp) return `<div class="line-text">${esc(line.text)}</div>`;
    if (revealed.size > 0) {
      // Line skeleton: words you already have, hint words highlighted, blanks for the rest
      const { knownWords } = evaluate(line.text, lastAttempt, evalOpts);
      const wordHTML = (w, k) => revealed.has(k) && !knownWords[k] ? `<span class="hint-words">${esc(w)}</span>`
        : knownWords[k] ? `<span class="known">${esc(w)}</span>`
        : `<span class="blank" style="width:${Math.min(8, Math.max(1.6, w.replace(/[^\w']/g, '').length * 0.55))}em"></span>`;
      // Walk the words in order, keeping line and stanza breaks where they are
      let k = 0;
      const parts = line.text.split(/(\s+)/).filter(Boolean).map(tok => /^\s+$/.test(tok) ? (tok.includes('\n') ? tok.replace(/[^\n]/g, '') : ' ') : wordHTML(tok, k++));
      return `<div class="line-text skeleton">${parts.join('')}</div>${hintNote ? `<div class="small" style="margin-top:6px;color:var(--brand-dark)">${hintNote}</div>` : ''}`;
    }
    if (mode === 'fade') return `<div class="line-text">${fadeHTML(line.text, frac, seed)}</div>`;
    if (mode === 'letters') return `<div class="line-text">${lettersHTML(line.text)}</div>`;
    return `<div class="line-text muted" style="font-size:16px">Your line is hidden…</div>`;
  };
  const drawPrompt = () => {
    document.getElementById('prompt').innerHTML = promptHTML();
    mine.querySelectorAll('.gap').forEach(g => g.onclick = () => { if (!g.classList.contains('show')) { g.classList.add('show'); peeked++; } });
  };

  // Show what you said/typed, with wrong words marked
  const showFeedback = (attempt, r, final) => {
    const fb = document.getElementById('feedback');
    if (!attempt.trim()) { fb.innerHTML = ''; return; }
    const missing = Math.max(0, r.total - r.matched);
    fb.innerHTML = `<div class="said">${r.marks.map(m => `<span class="${!m.ok ? 'bad' : m.spell ? 'spell' : 'ok'}"${m.spell ? ` title="Spelling: ${esc(m.spell.replace(/[^\w'’-]/g, ''))}"` : ''}>${esc(m.w)}</span>`).join(' ')}</div>
      ${final ? `<div class="small" style="margin-top:6px;color:var(--brand-dark)">Not quite yet${missing ? ` — ${missing} word${missing === 1 ? '' : 's'} missing or different` : ' — some extra words'}. Try again, or tap <b>Hint</b>.</div>` : ''}`;
  };

  const tryAttempt = (attempt, final) => {
    if (phase !== 'answer') return;
    lastAttempt = attempt;
    const r = evaluate(line.text, attempt, evalOpts);
    if (r.correct) return success(attempt);
    showFeedback(attempt, r, final);
    if (revealed.size) { hintNote = ''; drawPrompt(); }
    if (final && attempt.trim()) wrongTries++;
    // When speaking: count a wrong try once you've said at least as many words as the line
    if (!final && useVoice && r.saidWords >= r.total && r.saidWords - lastWrongLen >= r.total) { wrongTries++; lastWrongLen = r.saidWords; }
  };

  const giveHint = () => {
    // Jump straight to your first mistake: never spend a hint on words you've already got right
    const ta = document.getElementById('typed');
    if (ta) lastAttempt = ta.value;
    const { knownWords } = evaluate(line.text, lastAttempt, evalOpts);
    const k = scriptWords.findIndex((_, i) => !knownWords[i] && !revealed.has(i));
    if (k === -1) {
      hintNote = 'You have every word — remove the extra or out-of-order words marked in red.';
      if (!revealed.size) { const fb = document.getElementById('feedback'); fb.insertAdjacentHTML('beforeend', `<div class="small" style="margin-top:6px;color:var(--brand-dark)">${hintNote}</div>`); hintNote = ''; }
      else drawPrompt();
      if (ta) ta.focus();
      return;
    }
    hintClicks++; hintNote = '';
    revealed.add(k);
    drawPrompt();
    const hb = document.getElementById('hint');
    hb.innerHTML = `<i class="fa-regular fa-lightbulb" aria-hidden="true"></i> Hint (${revealed.size} used)`;
    if (ta) ta.focus();
  };

  const showAnswer = () => {
    phase = 'answer';
    mine.innerHTML = `${who}<div id="prompt"></div><div id="feedback" style="margin-top:10px"></div>`;
    drawPrompt();
    const buttons = `<div class="row" style="margin-top:10px"><button class="btn" id="hint"><i class="fa-regular fa-lightbulb" aria-hidden="true"></i> Hint</button><span class="spacer"></span><button class="btn ghost" id="idk">Show Me the Line</button>${useVoice ? '<button class="btn ghost" id="restart" title="Clear what I\'ve said so far">Start Over</button>' : '<button class="btn primary" id="done">Check</button>'}</div>`;
    if (useVoice) {
      controls.innerHTML = `
        <div class="listen">
          <button class="mic-big" id="mic" title="Pause / resume listening" aria-label="Pause or resume listening"><i class="fa-solid fa-microphone" aria-hidden="true"></i></button>
          <div class="listen-status" id="lstatus">Getting ready…</div>
          <div class="heard" id="heard"></div>
        </div>${buttons}`;
      const mic = document.getElementById('mic'), status = document.getElementById('lstatus');
      const start = () => {
        mic.classList.add('on'); status.textContent = 'Listening… take your time';
        startListening({
          onText: (t) => { document.getElementById('heard').textContent = t; tryAttempt(t, false); },
          onIdle: () => { mic.classList.remove('on'); status.textContent = 'Mic paused. Tap the mic to keep going.'; },
          onError: (err) => {
            mic.classList.remove('on');
            status.innerHTML = err === 'ended' ? 'Listening stopped. Tap the mic to keep going.'
              : err === 'network' || err === 'language-not-supported' ? 'Speaking needs an internet connection in this browser. Tap <b>Switch to Typing</b> above to keep practicing offline.'
              : 'Microphone is blocked. Allow microphone access for this site, or switch to <b>Typing</b> on the script page.';
          },
        });
      };
      mic.onclick = () => {
        if (listener && listener.active) { stopListening(); mic.classList.remove('on'); status.textContent = 'Paused. Tap the mic to keep going.'; }
        else start();
      };
      document.getElementById('restart').onclick = () => { if (listener) listener.reset(); document.getElementById('heard').textContent = ''; document.getElementById('feedback').innerHTML = ''; lastWrongLen = 0; if (!listener) start(); };
      controls._start = start;
    } else {
      controls.innerHTML = `
        <textarea id="typed" placeholder="Type your line from memory…" style="min-height:96px;font-family:var(--body);font-size:18px" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="true"></textarea>${buttons}`;
      const ta = document.getElementById('typed');
      setTimeout(() => ta.focus(), 30);
      // Moves on the moment the line is right
      ta.addEventListener('input', () => { lastAttempt = ta.value; const r = evaluate(line.text, ta.value, evalOpts); if (r.correct) success(ta.value); else if (revealed.size) drawPrompt(); });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tryAttempt(ta.value, true); } });
      document.getElementById('done').onclick = () => tryAttempt(ta.value, true);
    }
    document.getElementById('hint').onclick = giveHint;
    document.getElementById('idk').onclick = () => {
      // Shows the line; you still say/type it once to lock it in and move on
      gaveUp = true; drawPrompt();
      const hb = document.getElementById('hint'); hb.disabled = true; hb.textContent = 'Full Line Shown';
      document.getElementById('idk').remove();
      document.getElementById('feedback').innerHTML = `<div class="small" style="color:var(--brand-text)">Read it, then ${useVoice ? 'say' : 'type'} it once to lock it in.</div>`;
      const ta = document.getElementById('typed'); if (ta) ta.focus();
    };
  };

  const beginAnswer = (afterCue) => {
    showAnswer();
    if (!useVoice) { if (afterCue && prefs.speak && cue) speak(cue.text); return; }
    // Read the cue first (if turned on) so the mic doesn't hear it, then listen
    if (afterCue && prefs.speak && cue) { document.getElementById('lstatus').textContent = 'Listen to your cue…'; speak(cue.text, 1, () => phase === 'answer' && !listener && controls._start()); }
    else setTimeout(() => phase === 'answer' && !listener && controls._start(), 250);
  };

  const gradeNow = () => {
    // Automatic grade — based on hints, retries and how much of the line was visible
    if (gaveUp || revealed.size >= Math.max(2, Math.ceil(scriptWords.length * 0.34))) return 0;
    if (hintClicks > 0 || wrongTries > 0 || peeked > 1) return 1;
    if (mode === 'recall' && !peeked) return 3;
    return 2;
  };

  // Misspellings don't cost you the line, but we point them out
  const spellNote = (attempt) => {
    if (useVoice) return '';
    const { misspelled } = evaluate(line.text, attempt, evalOpts);
    if (!misspelled.length) return '';
    const clean = (w) => esc(w.replace(/^[^\w'’]+|[^\w'’]+$/g, ''));
    return `<div class="small" style="margin-top:8px">Right words! Spelling check: ${misspelled.map(m => `<span class="spell">${clean(m.typed)}</span> → <b>${clean(m.correct)}</b>`).join(', ')}</div>`;
  };

  const success = (attempt) => {
    if (phase !== 'answer') return;
    phase = 'result';
    stopListening();
    const g = gradeNow();
    const G = GRADES[g];
    const detail = gaveUp ? 'after seeing the line' : [wrongTries ? `${wrongTries + 1} tries` : 'first try', hintClicks ? `${hintClicks} hint${hintClicks === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    mine.innerHTML = `${who}
      <div class="result-head"><span class="pill g${g}"><i class="fa-solid fa-check" aria-hidden="true"></i> ${G.label}</span><span class="muted small">${detail}</span></div>
      <div class="line-text">${esc(line.text)}</div>
      ${spellNote(attempt)}
      ${g === 2 && mode !== 'recall' && !hintClicks && !wrongTries ? '<div class="small muted" style="margin-top:6px">Some of the line was showing — get it from the cue alone to earn “Nailed it”.</div>' : ''}`;
    controls.innerHTML = `<div class="row"><span class="spacer"></span><span class="muted small" id="auto">Next line…</span><button class="btn primary" id="next">Next →</button></div>`;
    const next = () => { if (graded === 'moved') return; graded = 'moved'; cleanup(); s.i++; drawCard(script); };
    document.getElementById('next').onclick = next;
    record(g, document.getElementById('next'));
    // Give a little longer to read spelling notes
    const hasSpell = !useVoice && evaluate(line.text, attempt, evalOpts).misspelled.length > 0;
    advanceTimer = setTimeout(next, hasSpell ? 3500 : g >= 2 ? 1300 : 2200);
  };

  const record = (g, btn) => {
    const prev = script.progress[line.id];
    const wasTrouble = prev?.trouble;
    const { p: np, fixed } = applyGrade(prev, g);
    script.progress[line.id] = np;
    saveProgress(script);
    if (g >= 2) { s.combo++; s.bestCombo = Math.max(s.bestCombo, s.combo); } else s.combo = 0;
    const comboEl = document.getElementById('combo');
    if (comboEl) { comboEl.innerHTML = s.combo >= 2 ? `<i class="fa-solid fa-fire" aria-hidden="true"></i> ${s.combo}×` : ''; comboEl.classList.add('pop'); setTimeout(() => comboEl.classList.remove('pop'), 200); }
    if (g === 0) s.misses++;
    const xp = GRADES[g].xp + (g >= 2 ? Math.min(10, Math.max(0, s.combo - 1)) : 0) + (wasTrouble && g >= 2 ? 5 : 0);
    s.xp += xp; addXP(xp, btn);
    if (fixed) { s.fixed++; profile.fixed++; toast('Trouble spot fixed!', 'Two clean runs in a row.', '<i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i>'); if (profile.fixed >= 5) award('fixer'); }
    if (s.combo >= 10) award('combo10');
    if (s.combo > profile.bestCombo) profile.bestCombo = s.combo;
    if (s.combo && s.combo % 5 === 0) toast(`${s.combo}× combo!`, 'You\'re in the zone.', '<i class="fa-solid fa-bolt" aria-hidden="true"></i>');
    recordReview();
    if (!(line.id in s.results) || g < s.results[line.id]) s.results[line.id] = g;
    // Lines you struggled with come back later in the same session
    if (g === 0 && item.requeued < 2) s.queue.splice(Math.min(s.queue.length, s.i + 4), 0, { line, requeued: item.requeued + 1 });
    else if (g === 1 && item.requeued < 1) s.queue.splice(Math.min(s.queue.length, s.i + 7), 0, { line, requeued: item.requeued + 1 });
  };

  keyHandler = (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    if (phase === 'result') { e.preventDefault(); document.getElementById('next')?.click(); }
    else if (phase === 'learn') { e.preventDefault(); document.getElementById('go')?.click(); }
  };
  document.addEventListener('keydown', keyHandler);

  if (mode === 'learn') {
    phase = 'learn';
    let reps = 0;
    mine.innerHTML = `${who}<div class="line-text">${esc(line.text)}</div>`;
    const drawReps = () => {
      controls.innerHTML = `<div class="row"><div class="reps">${[0, 1, 2].map(i => `<i class="${i < reps ? 'on' : ''}"></i>`).join('')}</div><span class="muted small">Read it aloud with your cue, 3 times</span><span class="spacer"></span>
        <button class="btn ghost sm" id="hear" aria-label="Hear the line"><i class="fa-solid fa-volume-high" aria-hidden="true"></i></button><button class="btn" id="rep">I Said It (${reps}/3)</button><button class="btn primary" id="go">Hide It &amp; Test Me →</button></div>`;
      document.getElementById('hear').onclick = () => speak(line.text, 0.95);
      document.getElementById('rep').onclick = () => { reps = Math.min(3, reps + 1); drawReps(); };
      document.getElementById('go').onclick = () => beginAnswer(false);
    };
    drawReps();
    if (prefs.speak && cue) setTimeout(() => speak(cue.text), 250);
  } else {
    beginAnswer(true);
  }
}

function drawSummary(script) {
  const s = session;
  const ids = Object.keys(s.results);
  const counts = [0, 0, 0, 0];
  ids.forEach(id => counts[s.results[id]]++);
  const after = stats(script);
  const clean = ids.length ? (counts[2] + counts[3]) / ids.length : 0;
  if (ids.length) {
    award('first');
    if (ids.length >= 8 && counts[0] === 0) award('perfect');
    // Scene mastered?
    const lines = myLines(script);
    const scenesTouched = new Set(ids.map(id => script.data.entries.find(e => e.id === id)?.scene));
    scenesTouched.forEach(sc => { const ls = lines.filter(l => l.scene === sc); if (ls.length && ls.every(l => (script.progress[l.id]?.mastery || 0) >= 4)) award('scene'); });
    if (lines.length && lines.every(l => (script.progress[l.id]?.mastery || 0) >= 4)) award('offbook');
    const bonus = 15 + Math.round(clean * 15);
    s.xp += bonus; addXP(bonus);
    if (clean >= 0.8) confetti();
  }
  saveProgress.flush(script); saveProfile.flush();
  const shaky = ids.filter(id => s.results[id] <= 1).map(id => script.data.entries.find(e => e.id === id)).filter(Boolean);
  const headline = clean >= 0.9 ? 'Bravo!' : clean >= 0.7 ? 'Strong rehearsal' : clean >= 0.4 ? 'Good work — it\'s sinking in' : 'Every rep counts';
  $app.innerHTML = `
    <div class="practice">
      <div class="card summary">
        <div class="muted small">${esc(s.label)} complete</div>
        <div class="big">${headline}</div>
        <div class="sum-stats">
          <div class="stat"><b>${ids.length}</b><span>lines practiced</span></div>
          <div class="stat"><b>${Math.round(clean * 100)}%</b><span>clean</span></div>
          <div class="stat"><b>+${s.xp}</b><span>XP earned</span></div>
          <div class="stat"><b>${s.bestCombo}×</b><span>best combo</span></div>
        </div>
        <p>Script readiness <b>${Math.round(s.startMastery)}% → ${Math.round(after.pct)}%</b>${s.fixed ? ` · fixed <b>${s.fixed}</b> trouble spot${s.fixed === 1 ? '' : 's'}` : ''}</p>
        <div class="mastery-bar" style="max-width:420px;margin:10px auto">${after.counts.map((c, i) => c ? `<span style="width:${(c / after.total) * 100}%;background:var(--m${i})"></span>` : '').join('')}</div>
      </div>
      ${shaky.length ? `<div class="card" style="margin-top:14px"><h3>Lines to watch</h3><p class="muted small" style="margin-top:0">These are now trouble spots and will come back sooner.</p>${shaky.map(l => `<div class="trouble-item"><div class="txt">${esc(l.text)}</div></div>`).join('')}</div>` : ''}
      <div class="row" style="justify-content:center;margin-top:18px">
        <a class="btn" href="#/script/${script.id}">Back to Script</a>
        ${shaky.length ? '<button class="btn" id="again-shaky">Drill These Again</button>' : ''}
        <button class="btn primary" id="again">Keep Going <i class="fa-solid fa-play" aria-hidden="true"></i></button>
      </div>
      <div class="tip" style="margin-top:20px">Tip: short sessions spread through the day work better than one long cram. Try another round tonight — sleep helps lock lines in.</div>
    </div>`;
  const cfg = s.cfg;
  session = null;
  document.getElementById('again').onclick = () => startSession(script, cfg.kind === 'lines' ? { kind: 'smart' } : cfg);
  const as = document.getElementById('again-shaky'); if (as) as.onclick = () => startSession(script, { kind: 'lines', ids: shaky.map(l => l.id) });
}

window.addEventListener('beforeunload', () => { if (current.script) saveProgress.flush(current.script); saveProfile.flush(); });

// ---------------------------------------------------------------- offline: backup, install, service worker
function backupNotice() {
  const days = profile.lastBackup ? (Date.now() - profile.lastBackup) / DAY : Infinity;
  if (!profile.reviews || days < 7 || syncState().user) return '';
  return `<div class="notice"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> It's been ${profile.lastBackup ? 'a while since your last backup' : 'a while and you haven\'t backed up yet'}. Your progress lives only in this browser — tap <b>Back Up</b> below to keep a copy safe.</div>`;
}

let installPrompt = null;
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installButtonHTML() {
  if (isStandalone()) return '<span class="tag done"><i class="fa-solid fa-check" aria-hidden="true"></i> Installed</span>';
  if (installPrompt) return '<button class="btn" id="install"><i class="fa-solid fa-mobile-screen" aria-hidden="true"></i> Install App</button>';
  return '<button class="btn ghost" id="install-help"><i class="fa-regular fa-circle-question" aria-hidden="true"></i> How to Install</button>';
}
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if ((location.hash || '#/') === '#/') renderHome(); });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Installed!', 'Off Book is on your home screen and works offline.', '<i class="fa-solid fa-check" aria-hidden="true"></i>'); });

function bindDataCard() {
  document.getElementById('data-card').addEventListener('click', (e) => { if (e.target.closest('#dc-signin')) openAccount(); });
  document.getElementById('backup').onclick = async () => {
    try {
      const data = await exportAll();
      profile.lastBackup = Date.now(); data.profile = { ...profile }; saveProfile.flush();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const name = `off-book-backup-${todayKey()}.json`;
      const file = new File([blob], name, { type: 'application/json' });
      // Phones: use the share sheet (Save to Files, AirDrop, email…). Computers: download the file.
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) {
        try { await navigator.share({ files: [file], title: 'Off Book backup' }); } catch { /* cancelled */ }
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      }
      toast('Backup saved', `${data.scripts.length} script${data.scripts.length === 1 ? '' : 's'} and all your progress.`, '<i class="fa-solid fa-download" aria-hidden="true"></i>');
      renderHome();
    } catch (e) { toast('Backup failed', e.message, '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'); }
  };
  const fileIn = document.getElementById('restore-file');
  document.getElementById('restore').onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; if (!f) return;
    try {
      const { added, updated } = await importAll(JSON.parse(await f.text()));
      current.script = null;
      profile = normalizeProfile(await api('/profile'));
      renderPlayer();
      toast('Restored', `${added} script${added === 1 ? '' : 's'} added, ${updated} updated.`, '<i class="fa-solid fa-upload" aria-hidden="true"></i>');
      confetti(60); renderHome();
    } catch (e) { toast('Couldn\'t restore', e instanceof SyntaxError ? 'That file isn\'t an Off Book backup.' : e.message, '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>'); }
  };
  const ib = document.getElementById('install');
  if (ib) ib.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; renderHome(); };
  const ih = document.getElementById('install-help');
  if (ih) ih.onclick = () => modal.open(`<h2>Install Off Book</h2>
    ${isIOS() ? '<p><b>iPhone / iPad (Safari):</b> tap the <b>Share</b> button <i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i>, then <b>Add to Home Screen</b>.</p>' : ''}
    <p><b>Android (Chrome):</b> tap the <b>⋮</b> menu, then <b>Install app</b> or <b>Add to Home screen</b>.</p>
    <p><b>Mac or PC (Chrome or Edge):</b> click the install icon at the right end of the address bar, or open the browser menu and choose <b>Install Off Book</b>.</p>
    <p><b>Mac (Safari):</b> choose <b>File → Add to Dock</b>.</p>
    <p class="muted small">After installing, open it once while online. When you see “Ready to use offline”, it works anywhere — no internet needed.</p>
    <div class="row"><span class="spacer"></span><button class="btn primary" id="ih-ok">Got It</button></div>`, (m) => { m.querySelector('#ih-ok').onclick = modal.close; });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'offline-ready') {
      let shown = false; try { shown = localStorage.getItem('offbook.offlineReady') === e.data.version; } catch { /* */ }
      if (!shown) { toast('Ready to use offline', 'Off Book now works without internet on this device.', '<i class="fa-solid fa-wifi" aria-hidden="true"></i>'); try { localStorage.setItem('offbook.offlineReady', e.data.version); } catch { /* */ } }
    }
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'activated' && navigator.serviceWorker.controller) toast('Off Book updated', 'Close and reopen the app to use the newest version.', '<i class="fa-solid fa-rotate" aria-hidden="true"></i>');
      });
    });
  }).catch(() => { /* offline install not available (e.g. private browsing) */ });
  // Ask the browser not to clear this app's storage when space is low
  navigator.storage?.persist?.().catch(() => {});
}
window.addEventListener('online', () => { if ((location.hash || '#/') === '#/') renderHome(); });
window.addEventListener('offline', () => { if ((location.hash || '#/') === '#/') renderHome(); });

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    const [m, p] = await Promise.all([api('/me'), api('/profile')]);
    me = m; profile = normalizeProfile(p);
  } catch {
    me = { name: 'Guest', signedIn: false }; profile = normalizeProfile({});
  }
  renderPlayer();
  router();
  registerServiceWorker();
  initSync();
})();
