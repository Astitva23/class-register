// ---------- helpers ----------
const USERNAME_DOMAIN = "class.local";
const usernameToEmail = (u) => `${u.trim().toLowerCase()}@${USERNAME_DOMAIN}`;

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = () => {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
};

let currentUser = null; // { uid, name, username }
let viewYear, viewMonth;
let selectedDateKey = null;
let unsubAttendance = null;
let unsubEvents = null;

const $ = (id) => document.getElementById(id);

// ---------- auth tabs ----------
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
    "auth/email-already-in-use": "That User ID is already taken.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/invalid-email": "User IDs can only have letters, numbers, dots or underscores.",
    "auth/wrong-password": "Wrong User ID or password.",
    "auth/user-not-found": "Wrong User ID or password.",
    "auth/invalid-credential": "Wrong User ID or password.",
    "auth/too-many-requests": "Too many attempts — try again in a bit.",
  };
  return map[err.code] || err.message;
}

$("logout-btn").addEventListener("click", () => auth.signOut());

auth.onAuthStateChanged(async (user) => {
  if (user) {
    const snap = await db.collection("users").doc(user.uid).get();
    const profile = snap.exists ? snap.data() : { name: user.email, username: "" };
    currentUser = { uid: user.uid, name: profile.name, username: profile.username };

    $("auth-section").classList.add("hidden");
    $("app-section").classList.remove("hidden");
    $("user-badge").classList.remove("hidden");
    $("user-name").textContent = currentUser.username;

    const t = new Date();
    viewYear = t.getFullYear();
    viewMonth = t.getMonth();
    renderCalendar();
  } else {
    currentUser = null;
    $("auth-section").classList.remove("hidden");
    $("app-section").classList.add("hidden");
    $("user-badge").classList.add("hidden");
    closeDaySheet();
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

const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];

function renderCalendar() {
  $("month-label").textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
  const grid = $("calendar-grid");
  grid.innerHTML = "";

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    empty.className = "day-cell empty";
    grid.appendChild(empty);
  }

  // Draw every tile immediately — dots get filled in afterward once the
  // (async, sometimes slow or failing) summary fetch resolves, so a
  // Firestore hiccup never blanks the whole grid.
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(viewYear, viewMonth, d);
    const cell = document.createElement("div");
    cell.className = "day-cell" + (key === todayKey() ? " today" : "");
    cell.dataset.dateKey = key;
    cell.innerHTML = `<span class="day-num">${d}</span><span class="day-dots"></span>`;
    cell.addEventListener("click", () => openDaySheet(key));
    grid.appendChild(cell);
  }

  loadMonthDots();
}

async function loadMonthDots() {
  const monthPrefix = `${viewYear}-${pad(viewMonth + 1)}`;
  let summaries = {};
  try {
    summaries = await getMonthSummaries(monthPrefix);
  } catch (err) {
    // Most likely cause: Firestore needs a composite index for this query
    // the first time it runs. Check the browser console for a link to
    // create it — the tiles themselves still render fine either way.
    console.error("Could not load calendar summary dots:", err);
    return;
  }

  document.querySelectorAll(".day-cell[data-date-key]").forEach((cell) => {
    const s = summaries[cell.dataset.dateKey];
    if (!s) return;
    const dots = cell.querySelector(".day-dots");
    if (s.attending) dots.innerHTML += `<span class="dot dot-green"></span>`;
    if (s.notAttending) dots.innerHTML += `<span class="dot dot-red"></span>`;
    if (s.notSure) dots.innerHTML += `<span class="dot dot-yellow"></span>`;
    if (s.event) dots.innerHTML += `<span class="dot dot-event"></span>`;
  });
}

async function getMonthSummaries(monthPrefix) {
  const summaries = {};
  const attSnap = await db.collectionGroup("attendance")
    .where("dateKey", ">=", `${monthPrefix}-00`)
    .where("dateKey", "<=", `${monthPrefix}-99`)
    .get();
  attSnap.forEach((doc) => {
    const { dateKey: k, status } = doc.data();
    summaries[k] = summaries[k] || {};
    if (status === "attending") summaries[k].attending = true;
    if (status === "not_attending") summaries[k].notAttending = true;
    if (status === "not_sure") summaries[k].notSure = true;
  });

  const evSnap = await db.collectionGroup("events")
    .where("dateKey", ">=", `${monthPrefix}-00`)
    .where("dateKey", "<=", `${monthPrefix}-99`)
    .get();
  evSnap.forEach((doc) => {
    const k = doc.data().dateKey;
    summaries[k] = summaries[k] || {};
    summaries[k].event = true;
  });

  return summaries;
}

// ---------- bottom sheet ----------
function openDaySheet(key) {
  selectedDateKey = key;
  const [y, m, d] = key.split("-").map(Number);
  $("sheet-date").textContent = `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
  $("day-sheet").classList.remove("hidden");
  $("sheet-backdrop").classList.remove("hidden");

  listenAttendance(key);
  listenEvents(key);
}

function closeDaySheet() {
  $("day-sheet").classList.add("hidden");
  $("sheet-backdrop").classList.add("hidden");
  if (unsubAttendance) unsubAttendance();
  if (unsubEvents) unsubEvents();
  selectedDateKey = null;
}
$("close-sheet").addEventListener("click", closeDaySheet);
$("sheet-backdrop").addEventListener("click", closeDaySheet);

// ---------- attendance ----------
function listenAttendance(key) {
  if (unsubAttendance) unsubAttendance();
  const ref = db.collection("days").doc(key).collection("attendance");
  unsubAttendance = ref.onSnapshot((snap) => {
    const attending = [], notAttending = [], notSure = [];
    let mine = null;

    snap.forEach((doc) => {
      const data = doc.data();
      if (doc.id === currentUser.uid) mine = data.status;
      if (data.status === "attending") attending.push(data.username);
      else if (data.status === "not_attending") notAttending.push(data.username);
      else if (data.status === "not_sure") notSure.push(data.username);
    });

    fillNameList("list-attending", attending);
    fillNameList("list-not-attending", notAttending);
    fillNameList("list-not-sure", notSure);

    $("mark-attending").classList.toggle("selected", mine === "attending");
    $("mark-not-attending").classList.toggle("selected", mine === "not_attending");
    $("mark-not-sure").classList.toggle("selected", mine === "not_sure");
  });
}

function fillNameList(listId, names) {
  const el = $(listId);
  el.innerHTML = "";
  if (names.length === 0) {
    el.innerHTML = `<li style="color:var(--text-dim);">—</li>`;
    return;
  }
  names.forEach((n) => {
    const li = document.createElement("li");
    li.textContent = n;
    el.appendChild(li);
  });
}

async function setMyStatus(status) {
  if (!currentUser || !selectedDateKey) return;
  await db.collection("days").doc(selectedDateKey).collection("attendance").doc(currentUser.uid).set({
    name: currentUser.name,
    username: currentUser.username,
    status,
    dateKey: selectedDateKey,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  renderCalendar();
}
$("mark-attending").addEventListener("click", () => setMyStatus("attending"));
$("mark-not-attending").addEventListener("click", () => setMyStatus("not_attending"));
$("mark-not-sure").addEventListener("click", () => setMyStatus("not_sure"));

// ---------- events ----------
function listenEvents(key) {
  if (unsubEvents) unsubEvents();
  const ref = db.collection("days").doc(key).collection("events").orderBy("createdAt", "asc");
  unsubEvents = ref.onSnapshot((snap) => {
    const list = $("events-list");
    list.innerHTML = "";
    if (snap.empty) {
      list.innerHTML = `<li class="empty-msg">No events</li>`;
      return;
    }
    snap.forEach((doc) => {
      const data = doc.data();
      const li = document.createElement("li");
      li.className = "event-item";
      const label = `${data.category} (${data.subject})`;
      li.innerHTML = `${escapeHtml(label)} - Added by ${escapeHtml(data.authorUsername)}`;
      list.appendChild(li);
    });
  });
}

$("open-add-event").addEventListener("click", () => {
  $("event-form").reset();
  $("event-modal").classList.remove("hidden");
  $("event-modal-backdrop").classList.remove("hidden");
});

function closeEventModal() {
  $("event-modal").classList.add("hidden");
  $("event-modal-backdrop").classList.add("hidden");
}
$("cancel-event").addEventListener("click", closeEventModal);
$("event-modal-backdrop").addEventListener("click", closeEventModal);

$("event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const category = $("event-category").value;
  const subject = $("event-subject").value;
  if (!category || !subject || !selectedDateKey || !currentUser) return;

  await db.collection("days").doc(selectedDateKey).collection("events").add({
    category,
    subject,
    dateKey: selectedDateKey,
    authorUsername: currentUser.username,
    authorUid: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  closeEventModal();
  renderCalendar();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
