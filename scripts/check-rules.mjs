// Security-rules check against the local Firebase emulators:
//   npm run test:rules
// Creates throwaway accounts in the emulator (never the real project) and
// tries every allowed and forbidden action in firestore.rules.
import { randomBytes } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import * as F from "firebase/firestore";
const pw = randomBytes(12).toString("hex");
const AUTH = "http://127.0.0.1:9099";
// The admin account needs a verified email, which only the emulator's
// owner API can set.
async function verify(uid) {
  await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-studymind/accounts:update`,
    {
      method: "POST",
      headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ localId: uid, emailVerified: true }),
    },
  );
}
async function as(email) {
  const app = initializeApp({ apiKey: "demo-key", projectId: "demo-studymind", appId: "x" }, email);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = F.getFirestore(app); F.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const { user } = await createUserWithEmailAndPassword(auth, email, pw).catch(() =>
    signInWithEmailAndPassword(auth, email, pw),
  );
  await verify(user.uid);
  await user.getIdToken(true); // pick up email_verified
  return { app, db, uid: user.uid };
}
const results = [];
async function check(label, expectOk, fn) {
  let ok; let msg = "";
  try { await fn(); ok = true; } catch (e) { ok = false; msg = e.code || e.message; }
  results.push(`${ok === expectOk ? "PASS" : "FAIL"}  ${label}  (${ok ? "allowed" : "denied " + msg})`);
}
const run = randomBytes(3).toString("hex");
const stu = await as(`student.${run}@example.com`);
const oth = await as(`other.${run}@example.com`);
const adm = await as("aafthabali08@gmail.com");
const img = "data:image/jpeg;base64," + "A".repeat(1000);

await check("student reads own documents", true, () => F.getDocs(F.collection(stu.db, "users", stu.uid, "documents")));
await check("other user reads student's documents", false, () => F.getDocs(F.collection(oth.db, "users", stu.uid, "documents")));
await check("admin reads student's profile", true, () => F.getDoc(F.doc(adm.db, "users", stu.uid)));
await check("admin reads student's documents (private)", false, () => F.getDocs(F.collection(adm.db, "users", stu.uid, "documents")));
await check("other user reads student's profile", false, () => F.getDoc(F.doc(oth.db, "users", stu.uid)));
await check("admin lists all profiles", true, () => F.getDocs(F.collection(adm.db, "users")));
await check("student lists all profiles", false, () => F.getDocs(F.collection(stu.db, "users")));

const t = F.doc(F.collection(stu.db, "tickets"));
await check("student creates ticket", true, () => F.setDoc(t, { uid: stu.uid, status: "open", subject: "QA", messages: [] }));
await check("student creates ticket as someone else", false, () => F.setDoc(F.doc(F.collection(stu.db, "tickets")), { uid: oth.uid, status: "open" }));
await check("student creates ticket already 'resolved'", false, () => F.setDoc(F.doc(F.collection(stu.db, "tickets")), { uid: stu.uid, status: "resolved" }));
await check("student adds a message", true, () => F.updateDoc(t, { messages: [{ from: "user", text: "hi" }], unreadForAdmin: true }));
await check("student changes status", false, () => F.updateDoc(t, { status: "resolved" }));
await check("other user reads student's ticket", false, () => F.getDoc(F.doc(oth.db, "tickets", t.id)));
await check("student adds picture to own ticket", true, () => F.setDoc(F.doc(stu.db, "tickets", t.id, "attachments", "a1"), { dataUrl: img, from: "user" }));
await check("student adds non-image attachment", false, () => F.setDoc(F.doc(stu.db, "tickets", t.id, "attachments", "a2"), { dataUrl: "data:text/html;base64,AAA" }));
await check("student adds 800 KB picture", false, () => F.setDoc(F.doc(stu.db, "tickets", t.id, "attachments", "a3"), { dataUrl: "data:image/jpeg;base64," + "A".repeat(800000) }));
await check("other user adds picture to student's ticket", false, () => F.setDoc(F.doc(oth.db, "tickets", t.id, "attachments", "a4"), { dataUrl: img }));
await check("other user reads student's pictures", false, () => F.getDocs(F.collection(oth.db, "tickets", t.id, "attachments")));
await check("admin reads the picture", true, () => F.getDocs(F.collection(adm.db, "tickets", t.id, "attachments")));
await check("admin sets status", true, () => F.updateDoc(F.doc(adm.db, "tickets", t.id), { status: "in-progress", unreadForUser: true }));
await check("admin replies with picture", true, () => F.setDoc(F.doc(adm.db, "tickets", t.id, "attachments", "a5"), { dataUrl: img, from: "admin" }));
await check("admin notifies student", true, () => F.addDoc(F.collection(adm.db, "users", stu.uid, "notifications"), { text: "Ticket updated", read: false }));
await check("other user notifies student", false, () => F.addDoc(F.collection(oth.db, "users", stu.uid, "notifications"), { text: "spam" }));
await check("student reads notifications", true, () => F.getDocs(F.collection(stu.db, "users", stu.uid, "notifications")));

const fb = F.doc(F.collection(stu.db, "feedback"));
await check("student sends feedback", true, () => F.setDoc(fb, { uid: stu.uid, verdict: "wrong", kind: "answer", item: "x" }));
await check("student sends feedback as someone else", false, () => F.setDoc(F.doc(F.collection(stu.db, "feedback")), { uid: oth.uid }));
await check("other user reads student's feedback", false, () => F.getDoc(F.doc(oth.db, "feedback", fb.id)));
await check("admin lists feedback", true, () => F.getDocs(F.collection(adm.db, "feedback")));
await check("student edits own feedback", false, () => F.updateDoc(fb, { verdict: "correct" }));

await check("student reads AI guidance", true, () => F.getDoc(F.doc(stu.db, "app", "guidance")));
await check("student writes AI guidance", false, () => F.setDoc(F.doc(stu.db, "app", "guidance"), { rules: ["hack"] }));
await check("admin writes AI guidance", true, () => F.setDoc(F.doc(adm.db, "app", "guidance"), { rules: [] }));

await check("student deletes own picture", true, () => F.deleteDoc(F.doc(stu.db, "tickets", t.id, "attachments", "a1")));
await check("student deletes own feedback", true, () => F.deleteDoc(fb));
await check("other user deletes student's ticket", false, () => F.deleteDoc(F.doc(oth.db, "tickets", t.id)));
await F.deleteDoc(F.doc(adm.db, "tickets", t.id, "attachments", "a5"));
await check("student deletes own ticket", true, () => F.deleteDoc(t));

console.log(results.join("\n"));
const passed = results.filter((r) => r.startsWith("PASS")).length;
console.log(`\n${passed}/${results.length} rule checks passed`);
for (const x of [stu, oth, adm]) await deleteApp(x.app);
process.exit(passed === results.length ? 0 : 1);
