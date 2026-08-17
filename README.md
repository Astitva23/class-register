# Class Register

A dark-themed site for your class: everyone signs in with their own User ID,
marks themselves Attending / Not Attending / Not Sure on a calendar, and adds
structured events to any date (category + subject, e.g. "Test — Physics").
Works from any device, anywhere — no app installs.

It's a static site (HTML/CSS/JS, no build step) backed by **Firebase**
(free tier is plenty for <30 users) for login and data storage. That's what
makes it deployable on GitHub Pages or Vercel, which can't run their own
server code.

## Files
- `index.html` — page structure
- `style.css` — dark theme styling
- `app.js` — all the logic (auth, calendar, attendance, events)
- `firebase-config.js` — **you edit this** with your Firebase project's keys
- `firestore.rules` — security rules, paste into the Firebase console

## If you already set up Firebase for an earlier version

A few things changed since earlier versions — redo these in the Firebase
console (everything else from before still stands):
1. **Firestore Rules tab** → replace with the current `firestore.rules`
   (adds an allowlist check on every collection) → Publish.
2. **Add your allowlist** — see "Restricting access to specific usernames"
   below. Do this *before* publishing the new rules, or existing students
   will briefly get locked out until you add them.
3. The first time the calendar loads after a change like this, Firestore may
   prompt for a new **composite index** (via a link in the browser console)
   — click it, click Create, wait ~1 minute, reload.

> If you'd already started on the Firebase Storage / Blaze-plan setup from a
> previous version of these instructions, you can ignore all of that —
> photos are now stored directly in Firestore instead (see "How photo notes
> work" below), so Storage isn't used and the free Spark plan is enough.

## 1. Create your Firebase project (~5 minutes, free) — first-time setup

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

That's the entire backend, all on Firebase's free Spark plan — no card
required, no server to run or maintain.

> **First-time index prompt:** the first time someone opens the calendar,
> Firestore may show an error in the browser console with a link to
> "create an index." This is expected — click the link, it opens the Firebase
> console with the index pre-filled, click **Create**, wait ~1 minute, then
> reload the site. You only need to do this once per index.

## 2. Restricting access to specific usernames

Only usernames you've explicitly approved can get past login/signup — anyone
else sees an "Unauthorized: access denied, contact admin" popup and is
signed back out immediately. You manage the allowed list by hand, directly
in the Firebase console (no code involved):

1. Firestore Database → **Data** tab → **Start collection** → name it
   exactly `allowlist`.
2. For each student you want to allow, add a document whose **Document ID**
   is their exact username, all lowercase (e.g. `mrwest`, `priya_s`) — the
   fields inside the document don't matter, you can leave it with a single
   placeholder field or add a `name` field for your own reference.
3. That's it — the site checks for a matching document on every login.

To revoke someone's access later, just delete their document from
`allowlist`. They won't be forced out of a session already in progress, but
they'll be blocked the next time they sign in.

This is enforced two ways: the popup is the friendly version students see,
but the actual permission check also lives in `firestore.rules` (via a
`isAllowed()` check on every collection) — so even someone poking around in
browser dev tools can't read or write class data without being on the list.

## 3. Try it locally first (optional but recommended)

You can't just double-click `index.html` (browsers block Firebase's requests
from `file://` URLs). Instead, from inside the `class-site` folder run any
simple static server, e.g. with Python:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Sign up a test account, mark a day, add
an event — confirm it all works before deploying.

## 4. Deploy

### Option A: Vercel (recommended)
1. Push the files to a GitHub repo.
2. Go to https://vercel.com → **Add New → Project** → import that repo.
3. Framework preset: **Other** (it's static files, no build command needed).
   Leave build/output settings blank → **Deploy**.
4. Vercel gives you a URL like `https://your-repo.vercel.app`. Share that.
   Future pushes to the repo redeploy automatically.

### Option B: GitHub Pages
1. Push these files to a GitHub repo (root or a `/docs` folder).
2. Repo → **Settings → Pages** → **Source: Deploy from a branch**, branch
   `main`, folder `/ (root)` (or `/docs`) → **Save**.
3. GitHub gives you a URL like `https://yourusername.github.io/repo-name/`.

## 5. Using it

- Add each classmate's username to `allowlist` first (see step 2), then send
  them the link. Each person clicks **Join the class**, picks the same User
  ID you allow-listed for them and any password, and enters their name.
- Tap a date tile → a panel slides up from the bottom showing:
  - **Important events** for that day (or "No events"), with an **Add Event**
    button that opens a form (Category, Subject dropdowns, and an Event Name
    box that appears only for the Extracurricular category).
  - **Daily notes** — three tabs (Physics / Chemistry / English) each holding
    a small photo grid. **+ Add Photo** opens the device's file picker: on
    phones that means a choice between Camera and Gallery, on a computer it
    opens a normal Browse dialog — that behavior comes for free from the
    browser, no extra code needed. Tapping a photo opens it full-size in a
    new tab.
  - **Your status** — Attending (green) / Not Attending (red) / Not Sure
    (yellow).
  - **Attendance status** — three columns listing who picked what, by User ID.
- Calendar dots summarize each date at a glance: green/red/yellow for
  attendance, blue for "has an event."

## How photo notes work (no paid plan needed)

Firebase now requires the paid Blaze plan just to turn on Cloud Storage for
new projects — so instead, photos are resized and compressed right in the
student's browser (down to whatever fits comfortably under Firestore's
1MB-per-document limit) and saved as part of the note document itself, no
separate storage service involved. This keeps the whole project on
Firebase's free Spark plan. The trade-off is photos are a bit lower
resolution than the original — plenty readable for a photo of notes or a
worksheet, but not archival quality.

## Notes & possible tweaks
- User IDs are stored lowercase and mapped internally to a fake email
  (`userid@class.local`) since Firebase's login system technically expects
  an email — nobody sees this, they just use their User ID.
- Anyone can edit their own attendance status and add/edit/delete their own
  events and photo notes, but not anyone else's — enforced by
  `firestore.rules`, not just the UI.
- Photos are auto-compressed client-side; if a photo genuinely can't be
  shrunk enough (very rare), the upload shows an error asking for a
  different photo instead of silently failing.
- Free Firebase tier (Spark plan) comfortably covers a class under 30 people
  — 1GiB of Firestore storage holds a large number of compressed note photos.
- Want a "teacher" role that can delete anyone's event or photo? Let me know
  and I can add that.
