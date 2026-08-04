# Class Register

A small site for your class: everyone signs in with their own username, marks
themselves present/absent on a calendar, and pins notes to any date ("Aug 18 —
physics test"). Works from any device, anywhere — no app installs.

It's a static site (HTML/CSS/JS, no build step) backed by **Firebase**
(free tier is plenty for <30 users) for login and data storage. That's what
makes it deployable on GitHub Pages or Vercel, which can't run their own
server code.

## Files
- `index.html` — the page structure
- `style.css` — styling
- `app.js` — all the logic (auth, calendar, attendance, notes)
- `firebase-config.js` — **you edit this** with your Firebase project's keys
- `firestore.rules` — security rules, paste into the Firebase console

## 1. Create your Firebase project (~5 minutes, free)

1. Go to https://console.firebase.google.com → **Add project** → give it any
   name → you can skip Google Analytics.
2. Once created, click the **Web** icon (`</>`) to register a web app. Give it
   a nickname, skip Firebase Hosting (we're using GitHub Pages/Vercel instead).
3. It will show you a `firebaseConfig` object. Copy those values into
   `firebase-config.js`, replacing the `REPLACE_ME` placeholders.
4. In the left sidebar: **Build → Authentication → Get started →
   Sign-in method → Email/Password → Enable → Save**.
5. In the left sidebar: **Build → Firestore Database → Create database** →
   pick a region close to you → start in **production mode**.
6. Go to the **Rules** tab of Firestore, delete what's there, and paste in
   the contents of `firestore.rules`, then **Publish**.

That's the entire backend. No server to run or maintain.

> **First-time index prompt:** the first time someone opens the calendar,
> Firestore may show an error in the browser console with a link to
> "create an index." This is expected — click the link, it opens the Firebase
> console with the index pre-filled, click **Create**, wait ~1 minute, then
> reload the site. You only need to do this once per index (it'll happen at
> most twice, since the app runs two of these lookups).

## 2. Try it locally first (optional but recommended)

You can't just double-click `index.html` (browsers block Firebase's requests
from `file://` URLs). Instead, from inside the `class-site` folder run any
simple static server, e.g. with Python:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Sign up a test account, mark a day,
add a note — confirm it all works before deploying.

## 3. Deploy

### Option A: GitHub Pages
1. Create a new GitHub repo and push these files to it (they can sit at the
   repo root, or in a `/docs` folder — just match what you pick below).
2. Repo → **Settings → Pages** → under "Build and deployment", set
   **Source: Deploy from a branch**, branch `main`, folder `/ (root)` (or
   `/docs`) → **Save**.
3. GitHub gives you a URL like `https://yourusername.github.io/repo-name/`
   within a minute or two. Share that link with your class.

### Option B: Vercel
1. Push the files to a GitHub repo (same as above).
2. Go to https://vercel.com → **Add New → Project** → import that repo.
3. Framework preset: **Other** (it's static files, no build command needed).
   Leave build/output settings blank → **Deploy**.
4. Vercel gives you a URL like `https://your-repo.vercel.app`. Share that.

Either option is free and auto-redeploys if you push more changes later.

## 4. Using it

- Send classmates the deployed link. Each person clicks **Join the class**,
  picks their own username/password, and enters their name.
- Anyone can click a date to mark themselves present/absent for that day and
  pin a note (test, submission, event, etc.) — visible to everyone.
- Dots on the calendar show at a glance whether a date has "present" marks,
  "absent" marks, or notes.

## Notes & possible tweaks
- Usernames are stored lowercase and mapped internally to a fake email
  (`username@class.local`) since Firebase's login system expects an email —
  nobody sees this, they just use their username.
- Anyone can currently edit their own attendance and post/edit/delete their
  own notes, but not anyone else's — enforced by `firestore.rules`, not just
  the UI.
- Free Firebase tier (Spark plan) supports far more reads/writes than a
  30-person class will generate, so this should stay free indefinitely for
  this use case.
- Want a class-wide "teacher" who can delete anyone's note? Let me know and
  I can add a simple role field for that.
