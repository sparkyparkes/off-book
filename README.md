# Off Book: Line Memorizer

A practice partner for actors. Upload a script, pick your role, and learn your lines word for word with fading cues, automatic checking, spaced review, and a plan that paces you to your off-book date.

**Live app:** https://sparkyparkes.github.io/off-book/

---

## Getting started

1. **Add a script:** upload a PDF (typed or scanned), photos of the pages, or a text file, or paste the text in.
2. **Pick your role:** choose one or more characters.
3. **Check the script:** fix anything the reader got wrong in the **Edit Script** tab.
4. **Set your plan:** in the **Plan** card, set an off-book date, and the app tells you how many new lines to learn each day.
5. **Tap Review:** the app picks what to practice.

Sign in with Google (top bar) to sync your scripts, progress, XP, and badges across devices. Without signing in, everything stays on that one device.

---

## How practice works

### Smart Mix (recommended)
New lines climb a ladder in one session. Each step takes away more help, and you finish by saying the whole line from memory.

| Step | You see |
|---|---|
| New | The full line, read once |
| 1 · Fade Out · Light | About 30% of words hidden |
| 2 · Fade Out · Heavy | About 65% of words hidden |
| 3 · First Letters | Only the first letter of each word |
| 4 · From Memory | Just your cue |

- Each step comes back a few cards later.
- A miss steps you back down one level.
- A line you learn today returns tomorrow to confirm it, then at growing intervals (spaced repetition).
- Lines you already know start higher on the ladder.
- **Trouble spots** start one step easier and come back more often.

### Long speeches and songs
Speeches over about 30 words are learned in **parts**, split at stanza breaks, then sentences. Each part climbs the ladder. A final **Putting it together** card tests the whole speech. If you miss a long speech later, the app drills the part where you went wrong first.

### Other practice styles
- **Learn:** read the line, then say it from memory.
- **Fade Out, First Letters, From Memory:** use one support level for every line.
- **Spot the Error:** one word in a line you know has been changed, and you tap it. These also appear automatically as quick reviews of older lines.
- **Pickups** (scene button): your lines from a scene in random order, from memory.
- **In Order** (scene button): put shuffled lines of an exchange back in order.
- **Run Scene / Run It All:** your lines in script order.

---

## Answering

- **Speaking:** the mic listens, waits through pauses, and moves on when the line is right. It needs Chrome, Edge, or Safari, plus internet in Chrome and Edge.
- **Typing:** the line is accepted as soon as it's right. If your last word might be unfinished, the app waits until you add a space, pause, or press Enter.
- **Switch to Typing / Switch to Speaking:** switch any time mid-line, and what you've entered so far is kept. Use this to fix words the mic misheard.

### What counts as correct
Lines must be **word for word** as written.

| Forgiven | Not forgiven |
|---|---|
| Punctuation and capitals | Contractions ("I am" ≠ "I'm") |
| Numbers ("5" = "five") | Missing, extra, or swapped words |
| Filler ("um", "uh") | A different form of the word ("check" ≠ "checked") |
| Misspellings of the right word when typing ("recieve", "rite"); a red squiggle shows the spelling | |
| Proper names the mic spells differently | |

### Hints
- **First tap:** the first letter of the next word you need.
- **Second tap:** the whole word.

Hints start at your first mistake, never on words you already have. **Show Me the Line** reveals everything, then you say or type it once to lock it in.

### Grades

| Grade | When |
|---|---|
| **Nailed It** | Right on the first try, from memory, no hints |
| **Got It** | Right with some of the line showing, or with one first-letter hint |
| **Close** | Needed more than one try or more hints. The line becomes a trouble spot. |
| **Missed It** | Needed much of the line, or used Show Me the Line |

---

## Plan (on each script's page)
- **Off-book date:** sets a daily new-line target, with a day or two left at the end for review. Missed days never count as progress; the target just recalculates.
- **New lines per session:** Auto, or a fixed number.
- **Review only:** adds no new lines.
- **Next up:** your next line to learn.

## Tracking
- **Readiness ring and Line Map:** how well you know each line.
- **Trouble Spots tab:** lines you miss, with hints used. **Words to Watch** lists the wording you keep getting wrong, such as *You said "I am", script: "I'm"*.
- **Session summary:** lines practiced, new lines learned, and words to watch.
- **XP, levels, streaks, a daily goal, and badges.**

---

## Editing a script (Edit Script tab)
- **Tap any entry** to change its words or speaker, switch between Line, Stage direction, and Scene heading, move it, merge it with the next entry, or delete it. **Undo** reverses the last 50 changes.
- **Insert Above / Below:** adds a line, direction, or scene.
- **Line breaks:** press Return for a new line. Leave a blank line for a new stanza, which keeps song lyrics formatted like verse.
- **Stage directions inside a line:** put them in `[square brackets]`, or use **Add Direction**. They're shown while you practice but never tested.
- **Characters:** rename or merge characters everywhere.
- **Edit as Text:** edit the whole script as plain text. `# SCENE` starts a scene, `[direction]` is a stage direction, and `NAME: words` is a line. Lines underneath without a name continue the speech.

Edits keep your progress attached to each line.

---

## Your data
- **Not signed in:** data is saved in this browser only. It's lost if you clear browser data or switch browsers or devices. Use **Back Up** and **Restore** on the home screen to keep a copy or move it.
- **Signed in:** data is saved on the device and in your account, and syncs automatically. Other people who sign in get their own separate data.
- **Offline:** the app works without internet after the first visit. The exception is Speaking in Chrome and Edge, which needs internet.

## Install on your devices

| Device | How |
|---|---|
| iPhone / iPad | Open the link in **Safari** → Share → **Add to Home Screen** |
| Android | Open the link in **Chrome** → ⋮ menu → **Install app** |
| Mac / PC | Open the link in **Chrome** or **Edge** → install icon in the address bar |
| Mac (Safari) | **File → Add to Dock** |

On iPhone, tap the screen once per session before cue lines can be read aloud (an iOS rule).

---

## Maintenance

### Updating the app
1. Go to **https://github.com/sparkyparkes/off-book/upload/main**.
2. Drag in the updated files and click **Commit changes**.
3. Make sure `VERSION` at the top of `sw.js` has changed, so installed copies pick up the update. Updates from Claude already include this.
4. Never overwrite `firebase-config.js` with a blank copy.

### Sign-in and sync setup (Firebase, already done)
- **Settings:** `firebase-config.js` holds this project's Firebase settings. They're designed to be public.
- **Security rules:** the rules in `firestore.rules` (published in the Firebase console) only let each signed-in person read and write their own data.
- **New web address:** if the app ever moves to a different address, add it under **Firebase → Authentication → Settings → Authorized domains**.

### Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | Page and design (BambooHR green theme: Kameron SemiBold headings, Hanken Grotesk text) |
| `app.js` | Screens, practice sessions, and scoring flow |
| `plan.js` | Long-speech chunking, deadline pacing, Spot the Error |
| `scoring.js` | Word-for-word checking, spelling forgiveness, and wrong-word tracking |
| `parser.js` | Reads scripts: scenes, characters, lines, directions, and verse |
| `editor.js` | Script editor |
| `local-db.js` | On-device storage, backup, and restore |
| `sync.js` | Google sign-in and syncing |
| `firebase-config.js` | Firebase settings for this project |
| `firestore.rules` | Database security rules (copy of what's published in Firebase) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and installing |
| `vendor/` | Bundled libraries: PDF.js, Tesseract.js (scanning), Firebase, Font Awesome, fonts |

Bundled open-source libraries: Firebase JS SDK (Apache-2.0), PDF.js (Apache-2.0), Tesseract.js (Apache-2.0), Font Awesome Free (icons CC BY 4.0, fonts SIL OFL 1.1), Kameron and Hanken Grotesk (SIL OFL 1.1).
