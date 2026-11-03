# Off Book: Line Memorizer

Memorize your lines with progressive cueing, hints, automatic word-for-word checking, spaced review of trouble spots, and progress tracking.

- **Sign in with Google** to sync scripts, progress, XP and badges across your phone, tablet and computer.
- **Works offline.** Everything is saved on the device first and syncs when you're back online.
- **Installable.** Add it to your home screen, dock or Start menu.

## One-time setup

### 1. Publish the app (GitHub Pages)
Upload all of these files to a public repository, then go to **Settings → Pages → Deploy from a branch → main / (root)**.
Your link looks like `https://YOUR-USERNAME.github.io/off-book/`.

### 2. Turn on sign-in & sync (Firebase, free)
1. Go to <https://console.firebase.google.com> → **Create a project** (any name, e.g. `off-book`). Google Analytics is optional; you can turn it off.
2. **Add a web app:** on the project home, click the **Web** icon (`</>`), give it a nickname, and click **Register app**. Leave Firebase Hosting unchecked. Copy the `const firebaseConfig = { ... };` block it shows you.
3. **Google sign-in:** **Build → Authentication → Get started → Sign-in method → Google → Enable**, choose your support email, and click **Save**.
   Then open **Settings → Authorized domains → Add domain** and enter `YOUR-USERNAME.github.io`.
4. **Database:** **Build → Firestore Database → Create database**. Pick a location near you and start in **production mode**. If you're asked for an edition, choose **Standard**.
   Open the **Rules** tab, replace everything with the contents of `firestore.rules` from this repository, and click **Publish**.
5. **Connect the app:** in this GitHub repository, open `firebase-config.js`, click the **pencil** (Edit), replace the `const firebaseConfig = { ... };` block with yours, and click **Commit changes**.

Wait a minute, reload the app, and tap **Sign In** in the top bar.

> The values in `firebase-config.js` are designed to be public. Your data is protected by the security rules: only you, signed in with your Google account, can read or write it.

## Install on your devices

| Device | How |
|---|---|
| iPhone / iPad | Open the link in **Safari** → Share → **Add to Home Screen** |
| Android | Open the link in **Chrome** → ⋮ menu → **Install app** |
| Mac / PC | Open the link in **Chrome** or **Edge** → install icon in the address bar |
| Mac (Safari) | **File → Add to Dock** |

## Good to know
- Not signed in? Everything still works, but data stays on that device. **Back Up** and **Restore** move it manually.
- Speaking uses your browser's speech recognition, which needs internet in Chrome and Edge. Typing works everywhere.
- Smart Read (AI re-reading of scripts) isn't included in this version.
- **Updating:** replace the changed files, and change `VERSION` at the top of `sw.js` so installed copies pick up the update.

Bundled open-source libraries: Firebase JS SDK (Apache-2.0), PDF.js (Apache-2.0), Tesseract.js (Apache-2.0), Font Awesome Free (icons CC BY 4.0, fonts SIL OFL 1.1), Kameron and Hanken Grotesk (SIL OFL 1.1).
