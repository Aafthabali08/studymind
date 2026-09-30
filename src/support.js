// Profiles, feedback, support tickets, notifications and admin queries.
// Everything runs on the free Spark plan: no Cloud Functions; Firestore
// security rules decide who may read or write what (see firestore.rules).
//
//   users/{uid}                      profile (email, name, docCount, lastActive)
//   users/{uid}/notifications/{id}   messages from the admin (ticket updates)
//   users/{uid}/prefs/learning       what this user marked correct / wrong
//   feedback/{id}                    ✓ / ✗ feedback on AI output
//   tickets/{id}                     complaint box: status + message thread
//   tickets/{id}/attachments/{id}    optional pictures (compressed, ≤ ~450 KB)
//   app/guidance                     admin rules added to every Gemini prompt
import { firebase } from "./firebase";

export const ADMIN_EMAILS = ["aafthabali08@gmail.com"];
export const isAdminUser = (user) =>
  Boolean(
    user?.email &&
    user.emailVerified !== false &&
    ADMIN_EMAILS.includes(user.email.toLowerCase()),
  );

export const TICKET_STATUSES = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Fixed",
  closed: "Closed",
};
export const TICKET_CATEGORIES = [
  "Wrong or poor AI answer",
  "Upload or PDF problem",
  "Interview Studio",
  "Account or sign-in",
  "Feature request",
  "Other",
];
export const FEEDBACK_KINDS = {
  question: "Question bank",
  notes: "Notes",
  summary: "Summary",
  answer: "Ask document",
  chat: "Ask Gemini",
  interview: "Interview rating",
};

const clip = (t, n) => String(t ?? "").slice(0, n);
async function fs() {
  const { db, fns } = await firebase();
  return { db, f: fns.firestore };
}
const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
const withDates = (d) => {
  const data = d.data();
  return {
    id: d.id,
    ...data,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    lastActive: toDate(data.lastActive),
  };
};

// ---- Profiles -----------------------------------------------------------------
/** Creates or refreshes the signed-in user's profile (used by the admin page). */
export async function ensureProfile(user) {
  const { db, f } = await fs();
  const ref = f.doc(db, "users", user.uid);
  const snap = await f.getDoc(ref);
  await f.setDoc(
    ref,
    {
      email: user.email || "",
      emailLower: (user.email || "").toLowerCase(),
      name: user.displayName || "",
      photoURL: user.photoURL || "",
      lastActive: f.serverTimestamp(),
      ...(snap.exists() ? {} : { createdAt: f.serverTimestamp(), docCount: 0 }),
    },
    { merge: true },
  );
}
export async function setDocCount(uid, count) {
  const { db, f } = await fs();
  await f.setDoc(f.doc(db, "users", uid), { docCount: count }, { merge: true });
}
export async function changeDocCount(uid, delta) {
  const { db, f } = await fs();
  await f.setDoc(
    f.doc(db, "users", uid),
    { docCount: f.increment(delta) },
    { merge: true },
  );
}

// ---- Feedback & learning -------------------------------------------------------
/**
 * Records ✓/✗ feedback. It is saved for the admin, and "wrong" items become
 * part of the user's learning memory so Gemini avoids them next time.
 */
export async function sendFeedback(
  user,
  { kind, verdict, item, comment = "", docId = "", docName = "" },
) {
  const { db, f } = await fs();
  await f.addDoc(f.collection(db, "feedback"), {
    uid: user.uid,
    email: user.email || "",
    kind,
    verdict,
    item: clip(item, 1500),
    comment: clip(comment, 1000),
    docId,
    docName: clip(docName, 200),
    reviewed: false,
    createdAt: f.serverTimestamp(),
  });
  const ref = f.doc(db, "users", user.uid, "prefs", "learning");
  const snap = await f.getDoc(ref);
  const memory = snap.exists() ? snap.data() : { avoid: [], good: [] };
  const entry = clip(
    `${FEEDBACK_KINDS[kind] || kind}: ${item}${comment ? ` — user says: ${comment}` : ""}`,
    300,
  );
  const list = verdict === "wrong" ? "avoid" : "good";
  memory[list] = [
    entry,
    ...(memory[list] || []).filter((x) => x !== entry),
  ].slice(0, 25);
  await f.setDoc(ref, { ...memory, updatedAt: f.serverTimestamp() });
  return memory;
}
export async function loadLearning(uid) {
  const { db, f } = await fs();
  const snap = await f.getDoc(f.doc(db, "users", uid, "prefs", "learning"));
  return snap.exists() ? snap.data() : { avoid: [], good: [] };
}
export async function loadGuidance() {
  const { db, f } = await fs();
  const snap = await f.getDoc(f.doc(db, "app", "guidance"));
  return snap.exists() ? snap.data().rules || [] : [];
}
export async function saveGuidance(rules) {
  const { db, f } = await fs();
  await f.setDoc(f.doc(db, "app", "guidance"), {
    rules: rules
      .map((r) => clip(r, 300))
      .filter(Boolean)
      .slice(0, 40),
    updatedAt: f.serverTimestamp(),
  });
}

// ---- Tickets (complaint box) -----------------------------------------------------
/**
 * Pictures are stored one per document in tickets/{id}/attachments, written
 * after the ticket exists so the security rules can check who owns it.
 * `images` are compressed { dataUrl, width, height, name } objects.
 */
async function saveAttachments(f, db, ticketRef, from, images = []) {
  const ids = images.map(
    () => f.doc(f.collection(ticketRef, "attachments")).id,
  );
  if (!images.length) return ids;
  const batch = f.writeBatch(db);
  images.forEach((img, n) =>
    batch.set(f.doc(ticketRef, "attachments", ids[n]), {
      from,
      dataUrl: img.dataUrl,
      width: img.width || 0,
      height: img.height || 0,
      name: clip(img.name, 120),
      createdAt: f.serverTimestamp(),
    }),
  );
  await batch.commit();
  return ids;
}

export async function createTicket(
  user,
  { subject, category, message, images = [] },
) {
  const { db, f } = await fs();
  const now = new Date().toISOString();
  const ref = f.doc(f.collection(db, "tickets"));
  await f.setDoc(ref, {
    uid: user.uid,
    email: user.email || "",
    name: user.displayName || "",
    subject: clip(subject, 140),
    category,
    status: "open",
    messages: [
      { from: "user", text: clip(message, 3000), at: now, attachments: [] },
    ],
    unreadForAdmin: true,
    unreadForUser: false,
    createdAt: f.serverTimestamp(),
    updatedAt: f.serverTimestamp(),
  });
  if (images.length) {
    const ids = await saveAttachments(f, db, ref, "user", images);
    await f.updateDoc(ref, {
      messages: [
        { from: "user", text: clip(message, 3000), at: now, attachments: ids },
      ],
      updatedAt: f.serverTimestamp(),
    });
  }
  return ref.id;
}
export async function replyToTicket(ticket, from, text, images = []) {
  const { db, f } = await fs();
  const ref = f.doc(db, "tickets", ticket.id);
  const attachments = await saveAttachments(f, db, ref, from, images);
  const message = {
    from,
    text: clip(text, 3000),
    at: new Date().toISOString(),
    attachments,
  };
  await f.updateDoc(ref, {
    messages: [...(ticket.messages || []), message],
    updatedAt: f.serverTimestamp(),
    ...(from === "admin" ? { unreadForUser: true } : { unreadForAdmin: true }),
  });
  return message;
}
export async function myTickets(uid) {
  const { db, f } = await fs();
  // Single-field query (no composite index needed); newest first on the client.
  const snap = await f.getDocs(
    f.query(f.collection(db, "tickets"), f.where("uid", "==", uid)),
  );
  return snap.docs
    .map(withDates)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
/** Pictures attached to a ticket, by id. */
export async function loadAttachments(ticketId) {
  const { db, f } = await fs();
  const snap = await f.getDocs(
    f.collection(db, "tickets", ticketId, "attachments"),
  );
  return Object.fromEntries(
    snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]),
  );
}
export async function markTicketRead(ticket, who) {
  const { db, f } = await fs();
  await f.updateDoc(f.doc(db, "tickets", ticket.id), {
    [who === "admin" ? "unreadForAdmin" : "unreadForUser"]: false,
  });
}

// ---- Notifications (admin → user) ------------------------------------------------
export async function notifyUser(uid, { title, body, ticketId = "" }) {
  const { db, f } = await fs();
  await f.addDoc(f.collection(db, "users", uid, "notifications"), {
    title: clip(title, 140),
    body: clip(body, 600),
    ticketId,
    read: false,
    createdAt: f.serverTimestamp(),
  });
}
export async function myNotifications(uid) {
  const { db, f } = await fs();
  const snap = await f.getDocs(
    f.query(
      f.collection(db, "users", uid, "notifications"),
      f.orderBy("createdAt", "desc"),
      f.limit(30),
    ),
  );
  return snap.docs.map(withDates);
}
export async function markNotificationsRead(uid, ids) {
  const { db, f } = await fs();
  const batch = f.writeBatch(db);
  ids.forEach((id) =>
    batch.update(f.doc(db, "users", uid, "notifications", id), { read: true }),
  );
  await batch.commit();
}

// ---- Admin -----------------------------------------------------------------------
export async function adminUsers({ search = "" } = {}) {
  const { db, f } = await fs();
  const q = search.trim().toLowerCase();
  const col = f.collection(db, "users");
  const snap = await f.getDocs(
    q
      ? f.query(
          col,
          f.orderBy("emailLower"),
          f.where("emailLower", ">=", q),
          f.where("emailLower", "<=", q + ""),
          f.limit(50),
        )
      : f.query(col, f.orderBy("lastActive", "desc"), f.limit(100)),
  );
  return snap.docs.map(withDates);
}
export async function adminTickets() {
  const { db, f } = await fs();
  const snap = await f.getDocs(
    f.query(
      f.collection(db, "tickets"),
      f.orderBy("updatedAt", "desc"),
      f.limit(200),
    ),
  );
  return snap.docs.map(withDates);
}
export async function adminFeedback() {
  const { db, f } = await fs();
  const snap = await f.getDocs(
    f.query(
      f.collection(db, "feedback"),
      f.orderBy("createdAt", "desc"),
      f.limit(300),
    ),
  );
  return snap.docs.map(withDates);
}
export async function setTicketStatus(ticket, status, note = "") {
  const { db, f } = await fs();
  const messages = note.trim()
    ? [
        ...(ticket.messages || []),
        { from: "admin", text: clip(note, 3000), at: new Date().toISOString() },
      ]
    : ticket.messages || [];
  await f.updateDoc(f.doc(db, "tickets", ticket.id), {
    status,
    messages,
    unreadForUser: true,
    unreadForAdmin: false,
    updatedAt: f.serverTimestamp(),
  });
  await notifyUser(ticket.uid, {
    title: `Your ticket "${ticket.subject}" is now ${TICKET_STATUSES[status]}`,
    body: note.trim() || `Status changed to ${TICKET_STATUSES[status]}.`,
    ticketId: ticket.id,
  });
}
export async function markFeedbackReviewed(id, reviewed = true) {
  const { db, f } = await fs();
  await f.updateDoc(f.doc(db, "feedback", id), { reviewed });
}

// ---- Your data: download and delete (free plan, runs in the browser) ----------
const USER_COLLECTIONS = [
  "documents",
  "resumes",
  "interviews",
  "plans",
  "chats",
  "prefs",
  "notifications",
];
const DOC_SUBCOLLECTIONS = ["parts", "images"];

async function allDocs(f, ref) {
  return (await f.getDocs(ref)).docs;
}

/** Everything StudyMind stores for this user, as one JSON-ready object. */
export async function exportMyData(user) {
  const { db, f } = await fs();
  const out = {
    exportedAt: new Date().toISOString(),
    account: { email: user.email, name: user.displayName },
  };
  const profile = await f.getDoc(f.doc(db, "users", user.uid));
  out.profile = profile.exists() ? profile.data() : null;
  for (const name of USER_COLLECTIONS) {
    const docs = await allDocs(f, f.collection(db, "users", user.uid, name));
    out[name] = await Promise.all(
      docs.map(async (d) => {
        const item = { id: d.id, ...d.data() };
        if (name === "documents") {
          const parts = await allDocs(
            f,
            f.query(f.collection(d.ref, "parts"), f.orderBy("index")),
          );
          item.pages = parts.flatMap((p) => p.data().pages);
          item.figures = (
            await allDocs(f, f.collection(d.ref, "images"))
          ).length;
        }
        return item;
      }),
    );
  }
  out.tickets = (
    await allDocs(
      f,
      f.query(f.collection(db, "tickets"), f.where("uid", "==", user.uid)),
    )
  ).map((d) => ({ id: d.id, ...d.data() }));
  out.feedback = (
    await allDocs(
      f,
      f.query(f.collection(db, "feedback"), f.where("uid", "==", user.uid)),
    )
  ).map((d) => ({ id: d.id, ...d.data() }));
  // Firestore timestamps → ISO strings.
  return JSON.parse(
    JSON.stringify(out, (_, v) =>
      v && typeof v.toDate === "function" ? v.toDate().toISOString() : v,
    ),
  );
}

/** Deletes in batches of up to 400 writes (Firestore allows 500). */
async function deleteRefs(f, db, refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = f.writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** For security, deleting an account needs a sign-in within the last 5 minutes. */
export async function signedInRecently() {
  const { auth } = await firebase();
  const last = Date.parse(auth.currentUser?.metadata?.lastSignInTime || "");
  return Boolean(last) && Date.now() - last < 5 * 60 * 1000;
}

/**
 * Permanently deletes all of the user's data, then the sign-in account.
 * `onStep` reports progress for the UI.
 */
export async function deleteMyAccount(user, onStep) {
  const { db, auth, fns } = await firebase();
  const f = fns.firestore;
  const refs = [];
  onStep?.("Finding your data…");
  for (const name of USER_COLLECTIONS) {
    for (const d of await allDocs(
      f,
      f.collection(db, "users", user.uid, name),
    )) {
      if (name === "documents")
        for (const sub of DOC_SUBCOLLECTIONS)
          (await allDocs(f, f.collection(d.ref, sub))).forEach((x) =>
            refs.push(x.ref),
          );
      refs.push(d.ref);
    }
  }
  for (const t of await allDocs(
    f,
    f.query(f.collection(db, "tickets"), f.where("uid", "==", user.uid)),
  )) {
    (await allDocs(f, f.collection(t.ref, "attachments"))).forEach((x) =>
      refs.push(x.ref),
    );
    refs.push(t.ref);
  }
  (
    await allDocs(
      f,
      f.query(f.collection(db, "feedback"), f.where("uid", "==", user.uid)),
    )
  ).forEach((d) => refs.push(d.ref));
  onStep?.(`Deleting ${refs.length} items…`);
  await deleteRefs(f, db, refs);
  await f.deleteDoc(f.doc(db, "users", user.uid));
  onStep?.("Deleting your sign-in…");
  await fns.auth.deleteUser(auth.currentUser);
}
