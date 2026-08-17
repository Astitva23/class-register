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
let unsubUpcoming = null;

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

    // Allowlist check — happens after auth succeeds but before the app is
    // shown. Rejected here AND enforced again in firestore.rules, so
    // someone bypassing this client-side check still can't read/write any
    // class data.
    let allowed = false;
    try {
      const allowSnap = await db.collection("allowlist").doc(profile.username).get();
      allowed = allowSnap.exists;
    } catch (err) {
      console.error("Could not check allowlist:", err);
    }

    if (!allowed) {
      await auth.signOut();
      showUnauthorized();
      return; // onAuthStateChanged fires again with user === null
    }

    currentUser = { uid: user.uid, name: profile.name, username: profile.username };

    $("auth-section").classList.add("hidden");
    $("app-section").classList.remove("hidden");
    $("user-badge").classList.remove("hidden");
    $("user-name").textContent = currentUser.username;

    const t = new Date();
    viewYear = t.getFullYear();
    viewMonth = t.getMonth();
    renderCalendar();
    listenUpcomingEvents();
  } else {
    currentUser = null;
    $("auth-section").classList.remove("hidden");
    $("app-section").classList.add("hidden");
    $("user-badge").classList.add("hidden");
    if (unsubUpcoming) unsubUpcoming();
    closeDaySheet();
  }
});

function showUnauthorized() {
  $("unauthorized-modal").classList.remove("hidden");
  $("unauthorized-backdrop").classList.remove("hidden");
}
function closeUnauthorized() {
  $("unauthorized-modal").classList.add("hidden");
  $("unauthorized-backdrop").classList.add("hidden");
}
$("unauthorized-close").addEventListener("click", closeUnauthorized);
$("unauthorized-backdrop").addEventListener("click", closeUnauthorized);

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
    if (s.extracurricular) {
      dots.innerHTML += `<span class="dot dot-event-glow event-dot-cross"></span>`;
    } else if (s.event) {
      dots.innerHTML += `<span class="dot dot-event-glow"></span>`;
    }
  });
}

// Only events feed the calendar tile dots now — attendance is still tracked
// per-day in the bottom sheet, it just isn't summarized on the tiles anymore.
async function getMonthSummaries(monthPrefix) {
  const summaries = {};
  const evSnap = await db.collectionGroup("events")
    .where("dateKey", ">=", `${monthPrefix}-00`)
    .where("dateKey", "<=", `${monthPrefix}-99`)
    .get();
  evSnap.forEach((doc) => {
    const data = doc.data();
    const k = data.dateKey;
    summaries[k] = summaries[k] || {};
    summaries[k].event = true;
    if (data.category === "Extracurricular") summaries[k].extracurricular = true;
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

  document.querySelectorAll(".note-tab").forEach((b) => b.classList.remove("active"));
  document.querySelector('.note-tab[data-subject="Physics"]').classList.add("active");
  selectedNoteSubject = "Physics";
  setUploadStatus("");

  listenAttendance(key);
  listenEvents(key);
  listenDayNotes(key);
}

function closeDaySheet() {
  $("day-sheet").classList.add("hidden");
  $("sheet-backdrop").classList.add("hidden");
  if (unsubAttendance) unsubAttendance();
  if (unsubEvents) unsubEvents();
  if (unsubDayNotes) unsubDayNotes();
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
function eventLabel(data) {
  return data.eventName
    ? `${data.category} - ${data.eventName} (${data.subject})`
    : `${data.category} (${data.subject})`;
}

function appendSyllabusButtonIfNeeded(container, data) {
  if (data.category !== "C.T" || !data.syllabus) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "text-btn view-syllabus-btn";
  btn.textContent = "VIEW SYLLABUS";
  btn.addEventListener("click", () => openSyllabusModal(data));
  container.appendChild(btn);
}

function formatDateLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}`;
}

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
      li.innerHTML = `${escapeHtml(eventLabel(data))} - Added by ${escapeHtml(data.authorUsername)}`;
      appendSyllabusButtonIfNeeded(li, data);
      list.appendChild(li);
    });
  });
}

// Sidebar list of everyone's upcoming events, across all dates from today
// onward. Deliberately leaves out who added each one — that detail only
// shows in the per-day panel, not this summarized view.
function listenUpcomingEvents() {
  if (unsubUpcoming) unsubUpcoming();
  const ref = db.collectionGroup("events")
    .where("dateKey", ">=", todayKey())
    .orderBy("dateKey", "asc")
    .limit(25);

  unsubUpcoming = ref.onSnapshot((snap) => {
    const list = $("upcoming-events-list");
    list.innerHTML = "";
    if (snap.empty) {
      list.innerHTML = `<li class="empty-msg">No upcoming events</li>`;
      return;
    }
    snap.forEach((doc) => {
      const data = doc.data();
      const li = document.createElement("li");
      li.className = "upcoming-item" + (data.category === "Extracurricular" ? " upcoming-extracurricular" : "");
      li.innerHTML = `<span class="upcoming-date">${formatDateLabel(data.dateKey)}</span><span class="upcoming-label">${escapeHtml(eventLabel(data))}</span>`;
      appendSyllabusButtonIfNeeded(li.querySelector(".upcoming-label"), data);
      list.appendChild(li);
    });
  }, (err) => {
    // Same likely cause as the calendar dots: a one-time Firestore index
    // prompt in the console the first time this query runs.
    console.error("Could not load upcoming events:", err);
  });
}

$("open-add-event").addEventListener("click", () => {
  $("event-form").reset();
  toggleCategoryFields();
  $("event-modal").classList.remove("hidden");
  $("event-modal-backdrop").classList.remove("hidden");
});

// "Event name" only appears for Extracurricular; "Syllabus" only for C.T.
function toggleCategoryFields() {
  const category = $("event-category").value;
  const isExtracurricular = category === "Extracurricular";
  const isCT = category === "C.T";

  $("event-name-field").classList.toggle("hidden", !isExtracurricular);
  $("event-name").required = isExtracurricular;
  if (!isExtracurricular) $("event-name").value = "";

  $("event-syllabus-field").classList.toggle("hidden", !isCT);
  $("event-syllabus").required = isCT;
  if (!isCT) $("event-syllabus").value = "";
}
$("event-category").addEventListener("change", toggleCategoryFields);

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
  const eventName = $("event-name").value.trim();
  const syllabus = $("event-syllabus").value.trim();
  if (!category || !subject || !selectedDateKey || !currentUser) return;
  if (category === "Extracurricular" && !eventName) return;
  if (category === "C.T" && !syllabus) return;

  const doc = {
    category,
    subject,
    dateKey: selectedDateKey,
    authorUsername: currentUser.username,
    authorUid: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (category === "Extracurricular") doc.eventName = eventName;
  if (category === "C.T") doc.syllabus = syllabus;

  await db.collection("days").doc(selectedDateKey).collection("events").add(doc);

  closeEventModal();
  renderCalendar();
});

// ---------- syllabus viewer ----------
function openSyllabusModal(data) {
  $("syllabus-title").textContent = `${data.subject} — ${formatDateLabel(data.dateKey)}`;
  $("syllabus-text").textContent = data.syllabus;
  $("syllabus-modal").classList.remove("hidden");
  $("syllabus-backdrop").classList.remove("hidden");
}
function closeSyllabusModal() {
  $("syllabus-modal").classList.add("hidden");
  $("syllabus-backdrop").classList.add("hidden");
}
$("close-syllabus").addEventListener("click", closeSyllabusModal);
$("syllabus-backdrop").addEventListener("click", closeSyllabusModal);

// ---------- daily notes (photo uploads) ----------
let selectedNoteSubject = "Physics";
let allDayNotes = []; // cached docs for the currently open day, filtered client-side by tab
let unsubDayNotes = null;

document.querySelectorAll(".note-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".note-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedNoteSubject = btn.dataset.subject;
    renderNotePhotoGrid();
  });
});

function listenDayNotes(key) {
  if (unsubDayNotes) unsubDayNotes();
  const ref = db.collection("days").doc(key).collection("dailyNotes").orderBy("createdAt", "asc");
  unsubDayNotes = ref.onSnapshot((snap) => {
    allDayNotes = snap.docs.map((doc) => doc.data());
    renderNotePhotoGrid();
  });
}

function renderNotePhotoGrid() {
  const grid = $("notes-photo-grid");
  grid.innerHTML = "";
  const filtered = allDayNotes.filter((n) => n.subject === selectedNoteSubject);

  if (filtered.length === 0) {
    grid.innerHTML = `<span class="empty-msg">No ${selectedNoteSubject} notes yet</span>`;
    return;
  }

  filtered.forEach((n) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "note-photo-item";
    item.innerHTML = `<img src="${n.imageData}" alt="${escapeHtml(n.subject)} note" loading="lazy" />
      <span class="photo-meta">${escapeHtml(n.authorUsername)}</span>`;
    item.addEventListener("click", () => openLightbox(n));
    grid.appendChild(item);
  });
}

function openLightbox(note) {
  $("lightbox-img").src = note.imageData;
  const filename = `${note.subject}-${note.dateKey}.jpg`.replace(/\s+/g, "_");
  $("lightbox-download").href = note.imageData;
  $("lightbox-download").setAttribute("download", filename);
  $("photo-lightbox").classList.remove("hidden");
  $("lightbox-backdrop").classList.remove("hidden");
}

function closeLightbox() {
  $("photo-lightbox").classList.add("hidden");
  $("lightbox-backdrop").classList.add("hidden");
}
$("close-lightbox").addEventListener("click", closeLightbox);
$("lightbox-backdrop").addEventListener("click", closeLightbox);

$("note-photo-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = ""; // allow picking the same file(s) again later
  if (files.length === 0 || !selectedDateKey || !currentUser) return;

  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) {
    setUploadStatus("Please choose image files.");
    return;
  }

  let uploaded = 0;
  let failed = 0;
  for (const file of images) {
    setUploadStatus(
      images.length > 1
        ? `Uploading ${uploaded + failed + 1} of ${images.length} to ${selectedNoteSubject}...`
        : `Compressing and uploading to ${selectedNoteSubject}...`
    );
    try {
      const imageData = await compressImageToDataUrl(file);
      await db.collection("days").doc(selectedDateKey).collection("dailyNotes").add({
        subject: selectedNoteSubject,
        imageData,
        dateKey: selectedDateKey,
        authorUsername: currentUser.username,
        authorUid: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      uploaded++;
    } catch (err) {
      console.error(err);
      failed++;
    }
  }

  if (failed === 0) {
    setUploadStatus("");
  } else {
    setUploadStatus(`Uploaded ${uploaded} of ${images.length} — ${failed} failed (too large or unreadable).`);
  }
});

// Firestore documents are capped at ~1MB, and there's no paid Storage
// service here — so photos are resized/compressed in the browser and
// saved as a data URL string right inside the note document. Tries a
// few shrinking passes until it fits comfortably under that cap.
const FIRESTORE_SAFE_CHAR_LIMIT = 700000; // leaves headroom under the 1MB doc cap

async function compressImageToDataUrl(file) {
  const img = await loadImage(file);
  const attempts = [
    { maxDim: 1000, quality: 0.7 },
    { maxDim: 800, quality: 0.6 },
    { maxDim: 600, quality: 0.5 },
    { maxDim: 450, quality: 0.4 },
    { maxDim: 320, quality: 0.35 },
  ];

  for (const { maxDim, quality } of attempts) {
    const dataUrl = drawToDataUrl(img, maxDim, quality);
    if (dataUrl.length <= FIRESTORE_SAFE_CHAR_LIMIT) return dataUrl;
  }
  throw new Error("That photo is too large even after compression — try a different one.");
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read that image."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function drawToDataUrl(img, maxDim, quality) {
  let { width, height } = img;
  if (width > height && width > maxDim) {
    height = Math.round(height * (maxDim / width));
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round(width * (maxDim / height));
    height = maxDim;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function setUploadStatus(msg) {
  const el = $("notes-upload-status");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
