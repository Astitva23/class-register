// ---------- helpers ----------
// Firebase Auth needs an email, so usernames are turned into a fake
// address behind the scenes: "priya" -> "priya@class.local"
const USERNAME_DOMAIN = "class.local";
const usernameToEmail = (u) => `${u.trim().toLowerCase()}@${USERNAME_DOMAIN}`;

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = () => {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
};

let currentUser = null; // { uid, name, username }
let viewYear, viewMonth; // 0-indexed month
let selectedDateKey = null;
let unsubAttendance = null;
let unsubNotes = null;

const $ = (id) => document.getElementById(id);

// ---------- tabs on the auth card ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const isLogin = btn.dataset.tab === "login";
    $("login-form").classList.toggle("hidden", !isLogin);
    $("signup-form").classList.toggle("hidden", isLogin);
    $("auth-error").classList.add("hidden");
  });
});

function showAuthError(msg) {
  $("auth-error").textContent = msg;
  $("auth-error").classList.remove("hidden");
}

// ---------- sign up ----------
$("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("signup-name").value.trim();
  const username = $("signup-username").value.trim();
  const password = $("signup-password").value;
  if (!name || !username || !password) return;

  try {
    const email = usernameToEmail(username);
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await db.collection("users").doc(cred.user.uid).set({
      name,
      username: username.toLowerCase(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    showAuthError(friendlyError(err));
  }
});

// ---------- log in ----------
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("login-username").value.trim();
  const password = $("login-password").value;
  if (!username || !password) return;
  try {
    await auth.signInWithEmailAndPassword(usernameToEmail(username), password);
  } catch (err) {
    showAuthError(friendlyError(err));
  }
});

function friendlyError(err) {
  const map = {
    "auth/email-already-in-use": "That username is already taken.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/invalid-email": "Usernames can only have letters, numbers, dots or underscores.",
    "auth/wrong-password": "Wrong username or password.",
    "auth/user-not-found": "Wrong username or password.",
    "auth/invalid-credential": "Wrong username or password.",
    "auth/too-many-requests": "Too many attempts — try again in a bit.",
  };
  return map[err.code] || err.message;
}

$("logout-btn").addEventListener("click", () => auth.signOut());

// ---------- auth state ----------
auth.onAuthStateChanged(async (user) => {
  if (user) {
    const snap = await db.collection("users").doc(user.uid).get();
    const profile = snap.exists ? snap.data() : { name: user.email, username: "" };
    currentUser = { uid: user.uid, name: profile.name, username: profile.username };

    $("auth-section").classList.add("hidden");
    $("app-section").classList.remove("hidden");
    $("user-badge").classList.remove("hidden");
    $("user-name").textContent = currentUser.name;

    const t = new Date();
    viewYear = t.getFullYear();
    viewMonth = t.getMonth();
    renderCalendar();
  } else {
    currentUser = null;
    $("auth-section").classList.remove("hidden");
    $("app-section").classList.add("hidden");
    $("user-badge").classList.add("hidden");
    closeDayPanel();
  }
});

// ---------- calendar ----------
$("prev-month").addEventListener("click", () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderCalendar();
});
$("next-month").addEventListener("click", () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
});

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

async function renderCalendar() {
  $("month-label").textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`.toUpperCase();
  const grid = $("calendar-grid");
  grid.innerHTML = "";

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    empty.className = "day-cell empty";
    grid.appendChild(empty);
  }

  // Pull a lightweight summary (counts) for every day in the visible month.
  const monthPrefix = `${viewYear}-${pad(viewMonth + 1)}`;
  const summaries = await getMonthSummaries(monthPrefix);

  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(viewYear, viewMonth, d);
    const cell = document.createElement("div");
    cell.className = "day-cell" + (key === todayKey() ? " today" : "");
    cell.innerHTML = `<span class="day-num">${d}</span><span class="day-dots"></span>`;

    const s = summaries[key];
    const dots = cell.querySelector(".day-dots");
    if (s?.coming) dots.innerHTML += `<span class="dot dot-green"></span>`;
    if (s?.notComing) dots.innerHTML += `<span class="dot dot-red"></span>`;
    if (s?.notes) dots.innerHTML += `<span class="dot dot-note"></span>`;

    cell.addEventListener("click", () => openDayPanel(key));
    grid.appendChild(cell);
  }
}

// Reads attendance + notes counts for the visible month in two queries
// (rather than one per day) to keep this cheap on Firestore's free tier.
async function getMonthSummaries(monthPrefix) {
  const summaries = {};
  const attSnap = await db.collectionGroup("attendance")
    .where("dateKey", ">=", `${monthPrefix}-00`)
    .where("dateKey", "<=", `${monthPrefix}-99`)
    .get();
  attSnap.forEach((doc) => {
    const { dateKey: k, status } = doc.data();
    summaries[k] = summaries[k] || {};
    if (status === "coming") summaries[k].coming = true;
    if (status === "not_coming") summaries[k].notComing = true;
  });

  const noteSnap = await db.collectionGroup("notes")
    .where("dateKey", ">=", `${monthPrefix}-00`)
    .where("dateKey", "<=", `${monthPrefix}-99`)
    .get();
  noteSnap.forEach((doc) => {
    const k = doc.data().dateKey;
    summaries[k] = summaries[k] || {};
    summaries[k].notes = true;
  });

  return summaries;
}

// ---------- day panel ----------
function openDayPanel(key) {
  selectedDateKey = key;
  const [y, m, d] = key.split("-").map(Number);
  $("panel-date").textContent = `${MONTH_NAMES[m - 1]} ${d}, ${y}`.toUpperCase();
  $("day-panel").classList.remove("hidden");
  $("day-panel-backdrop").classList.remove("hidden");

  listenAttendance(key);
  listenNotes(key);
}

function closeDayPanel() {
  $("day-panel").classList.add("hidden");
  $("day-panel-backdrop").classList.add("hidden");
  if (unsubAttendance) unsubAttendance();
  if (unsubNotes) unsubNotes();
  selectedDateKey = null;
}
$("close-panel").addEventListener("click", closeDayPanel);
$("day-panel-backdrop").addEventListener("click", closeDayPanel);

function listenAttendance(key) {
  if (unsubAttendance) unsubAttendance();
  const ref = db.collection("days").doc(key).collection("attendance");
  unsubAttendance = ref.onSnapshot((snap) => {
    const list = $("attendance-list");
    list.innerHTML = "";
    let comingCount = 0, total = 0;
    let mine = null;

    snap.forEach((doc) => {
      const data = doc.data();
      total++;
      if (data.status === "coming") comingCount++;
      if (doc.id === currentUser.uid) mine = data.status;

      const li = document.createElement("li");
      const dotClass = data.status === "coming" ? "dot-green" : "dot-red";
      li.innerHTML = `<span class="status-dot ${dotClass}"></span> ${escapeHtml(data.name)}`;
      list.appendChild(li);
    });

    $("attend-count").textContent = total ? `(${comingCount} of ${total} responded)` : "";
    $("mark-coming").classList.toggle("selected", mine === "coming");
    $("mark-not-coming").classList.toggle("selected", mine === "not_coming");
  });
}

async function setMyStatus(status) {
  if (!currentUser || !selectedDateKey) return;
  await db.collection("days").doc(selectedDateKey).collection("attendance").doc(currentUser.uid).set({
    name: currentUser.name,
    status,
    dateKey: selectedDateKey,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  renderCalendar();
}
$("mark-coming").addEventListener("click", () => setMyStatus("coming"));
$("mark-not-coming").addEventListener("click", () => setMyStatus("not_coming"));

function listenNotes(key) {
  if (unsubNotes) unsubNotes();
  const ref = db.collection("days").doc(key).collection("notes").orderBy("createdAt", "asc");
  unsubNotes = ref.onSnapshot((snap) => {
    const list = $("notes-list");
    list.innerHTML = "";
    if (snap.empty) {
      list.innerHTML = `<li style="background:none;border:none;box-shadow:none;color:var(--ink-soft);transform:none;">No notes yet — add the first one.</li>`;
      return;
    }
    snap.forEach((doc) => {
      const data = doc.data();
      const li = document.createElement("li");
      const when = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString() : "";
      li.innerHTML = `${escapeHtml(data.text)}<span class="note-meta">— ${escapeHtml(data.authorName)} · ${when}</span>`;
      list.appendChild(li);
    });
  });
}

$("note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("note-text").value.trim();
  if (!text || !selectedDateKey || !currentUser) return;
  await db.collection("days").doc(selectedDateKey).collection("notes").add({
    text,
    dateKey: selectedDateKey,
    authorName: currentUser.name,
    authorUid: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  $("note-text").value = "";
  renderCalendar();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
