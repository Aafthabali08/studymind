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
async function as(email, appName = email) {
  const app = initializeApp({ apiKey: "demo-key", projectId: "demo-studymind", appId: "x" }, appName);
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

const scope = { university: "GITAM VIZAG", degree: "CSE CORE", year: "1" };
const subj = F.doc(F.collection(adm.db, "uniNodes"));
await check("student reads university options", true, () => F.getDoc(F.doc(stu.db, "uni", "options")));
await check("student edits university options", false, () => F.setDoc(F.doc(stu.db, "uni", "options"), { universities: ["X"] }));
await check("admin edits university options", true, () => F.setDoc(F.doc(adm.db, "uni", "options"), { universities: ["GITAM VIZAG"], degrees: ["CSE CORE"], years: ["1", "2", "3", "4"] }));
await check("admin adds a subject", true, () => F.setDoc(subj, { ...scope, kind: "subject", name: "DBMS", parentId: null, exam: "both" }));
await check("admin adds a node with a bad kind", false, () => F.setDoc(F.doc(F.collection(adm.db, "uniNodes")), { ...scope, kind: "virus", name: "x", exam: "both" }));
await check("admin sets a subject icon", true, () => F.updateDoc(subj, { icon: "📘" }));
await check("admin sets a 100-character icon", false, () => F.updateDoc(subj, { icon: "x".repeat(100) }));
await check("student changes a subject icon", false, () => F.updateDoc(F.doc(stu.db, "uniNodes", subj.id), { icon: "lab" }));
await check("student adds a subject", false, () => F.setDoc(F.doc(F.collection(stu.db, "uniNodes")), { ...scope, kind: "subject", name: "Hack", parentId: null, exam: "both" }));
await check("student lists subjects", true, () => F.getDocs(F.query(F.collection(stu.db, "uniNodes"), F.where("university", "==", scope.university), F.where("degree", "==", scope.degree), F.where("year", "==", scope.year))));
await check("admin adds file text", true, () => F.setDoc(F.doc(adm.db, "uniNodes", subj.id, "parts", "0"), { index: 0, pages: ["text"] }));
await check("student reads file text", true, () => F.getDocs(F.collection(stu.db, "uniNodes", subj.id, "parts")));
await check("student writes file text", false, () => F.setDoc(F.doc(stu.db, "uniNodes", subj.id, "parts", "1"), { index: 1, pages: ["x"] }));
await check("student renames a subject", false, () => F.updateDoc(F.doc(stu.db, "uniNodes", subj.id), { name: "Mine" }));
await check("student deletes a subject", false, () => F.deleteDoc(F.doc(stu.db, "uniNodes", subj.id)));
await check("student saves own notes on a shared file", true, () => F.setDoc(F.doc(stu.db, "users", stu.uid, "uniStudy", subj.id), { study: {} }));
await check("other user reads student's notes on it", false, () => F.getDoc(F.doc(oth.db, "users", stu.uid, "uniStudy", subj.id)));
await F.deleteDoc(F.doc(adm.db, "uniNodes", subj.id, "parts", "0"));
await check("admin deletes a subject", true, () => F.deleteDoc(subj));

// Supporters: library changes only together with their audit entry; no deletes.
const sup = await as(`supporter.${run}@example.com`);
/** A batch with an audit entry by `who` plus the writes `fill(batch, auditId)` adds. */
async function audited(who, fill, entry = {}) {
  const b = F.writeBatch(who.db);
  const a = F.doc(F.collection(who.db, "audit"));
  b.set(a, { uid: who.uid, email: "", name: "", action: "add", summary: "test", course: "", items: [], count: 0, at: F.serverTimestamp(), ...entry });
  fill(b, a.id);
  await b.commit();
  return a.id;
}
const node = (who, extra = {}) => ({ ...scope, kind: "subject", name: "Supported", parentId: null, exam: "both", by: who.uid, ...extra });
await check("student makes themselves a supporter", false, () => F.setDoc(F.doc(stu.db, "supporters", stu.uid), { uid: stu.uid }));
await check("admin adds a supporter with the wrong uid", false, () => F.setDoc(F.doc(adm.db, "supporters", sup.uid), { uid: stu.uid }));
await check("admin makes a user a supporter", true, () => F.setDoc(F.doc(adm.db, "supporters", sup.uid), { uid: sup.uid, email: "s", name: "S" }));
await check("supporter reads own role", true, () => F.getDoc(F.doc(sup.db, "supporters", sup.uid)));
await check("student reads the supporter's role", false, () => F.getDoc(F.doc(stu.db, "supporters", sup.uid)));
await check("student lists supporters", false, () => F.getDocs(F.collection(stu.db, "supporters")));
await check("admin lists supporters", true, () => F.getDocs(F.collection(adm.db, "supporters")));
const sSubj = F.doc(F.collection(sup.db, "uniNodes"));
let oldAudit = "";
await check("supporter adds a subject with its audit entry", true, async () => {
  oldAudit = await audited(sup, (b, id) => b.set(sSubj, node(sup, { audit: id })));
});
await check("supporter adds a subject without an audit entry", false, () => F.setDoc(F.doc(F.collection(sup.db, "uniNodes")), node(sup)));
await check("supporter reuses an old audit entry", false, () => F.setDoc(F.doc(F.collection(sup.db, "uniNodes")), node(sup, { audit: oldAudit })));
await check("supporter writes as someone else", false, () => audited(sup, (b, id) => b.set(F.doc(F.collection(sup.db, "uniNodes")), node(sup, { by: stu.uid, audit: id }))));
await check("supporter logs a change as someone else", false, () => audited(sup, (b, id) => b.set(F.doc(F.collection(sup.db, "uniNodes")), node(sup, { audit: id })), { uid: stu.uid }));
await check("supporter's audit entry with extra fields", false, () => audited(sup, (b, id) => b.set(F.doc(F.collection(sup.db, "uniNodes")), node(sup, { audit: id })), { hidden: true }));
await check("supporter's audit entry with a made-up time", false, () => audited(sup, (b, id) => b.set(F.doc(F.collection(sup.db, "uniNodes")), node(sup, { audit: id })), { at: F.Timestamp.fromMillis(Date.now() - 864e5) }));
await check("supporter's change with an invalid kind", false, () => audited(sup, (b, id) => b.set(F.doc(F.collection(sup.db, "uniNodes")), node(sup, { audit: id, kind: "virus" }))));
await check("supporter renames with its audit entry", true, () => audited(sup, (b, id) => b.update(F.doc(sup.db, "uniNodes", sSubj.id), { name: "Renamed", by: sup.uid, audit: id }), { action: "rename" }));
await check("supporter renames the admin's subject without an entry", false, () => F.updateDoc(F.doc(sup.db, "uniNodes", sSubj.id), { name: "Sneaky", by: sup.uid }));
await check("supporter moves a subject to Year 2 with its entry", true, () => audited(sup, (b, id) => b.update(F.doc(sup.db, "uniNodes", sSubj.id), { year: "2", by: sup.uid, audit: id }), { action: "move" }));
await check("supporter deletes a subject", false, () => F.deleteDoc(F.doc(sup.db, "uniNodes", sSubj.id)));
await check("supporter edits university options", false, () => F.setDoc(F.doc(sup.db, "uni", "options"), { universities: ["X"] }));
const sFile = F.doc(F.collection(sup.db, "uniNodes"));
await check("supporter writes a new file's text before its node", true, () => F.setDoc(F.doc(sup.db, "uniNodes", sFile.id, "parts", "0"), { index: 0, pages: ["t"] }));
await check("supporter writes into an unknown sub-collection", false, () => F.setDoc(F.doc(sup.db, "uniNodes", F.doc(F.collection(sup.db, "uniNodes")).id, "evil", "0"), { x: 1 }));
await check("supporter saves the new file's node with its entry", true, () => audited(sup, (b, id) => b.set(sFile, node(sup, { kind: "file", name: "Notes", parentId: sSubj.id, audit: id })), { action: "upload" }));
await check("supporter changes an existing file's text", false, () => F.setDoc(F.doc(sup.db, "uniNodes", sFile.id, "parts", "1"), { index: 1, pages: ["x"] }));
await check("supporter overwrites an existing file's text", false, () => F.setDoc(F.doc(sup.db, "uniNodes", sFile.id, "parts", "0"), { index: 0, pages: ["x"] }));
await check("supporter deletes a file's text", false, () => F.deleteDoc(F.doc(sup.db, "uniNodes", sFile.id, "parts", "0")));
await check("supporter reads the audit log", false, () => F.getDocs(F.collection(sup.db, "audit")));
await check("supporter edits their audit entry", false, () => F.updateDoc(F.doc(sup.db, "audit", oldAudit), { summary: "nothing" }));
await check("supporter deletes their audit entry", false, () => F.deleteDoc(F.doc(sup.db, "audit", oldAudit)));
await check("student writes an audit entry", false, () => audited(stu, () => {}));
await check("student makes an audited library change", false, () => audited(stu, (b, id) => b.set(F.doc(F.collection(stu.db, "uniNodes")), node(stu, { audit: id }))));
await check("admin reads the audit log", true, () => F.getDocs(F.query(F.collection(adm.db, "audit"), F.orderBy("at", "desc"), F.limit(500))));
await check("admin reads one supporter's log", true, () => F.getDocs(F.query(F.collection(adm.db, "audit"), F.where("uid", "==", sup.uid))));
await check("admin changes the library without an entry", true, () => F.updateDoc(F.doc(adm.db, "uniNodes", sSubj.id), { year: "1" }));
await check("admin suspends the supporter", true, () => F.setDoc(F.doc(adm.db, "bans", sup.uid), { type: "suspended", until: F.Timestamp.fromMillis(Date.now() + 3600_000) }));
await check("suspended supporter makes an audited change", false, () => audited(sup, (b, id) => b.update(F.doc(sup.db, "uniNodes", sSubj.id), { name: "X", by: sup.uid, audit: id })));
await check("admin lifts the supporter's suspension", true, () => F.deleteDoc(F.doc(adm.db, "bans", sup.uid)));
await check("admin removes the supporter", true, () => F.deleteDoc(F.doc(adm.db, "supporters", sup.uid)));
await check("former supporter makes an audited change", false, () => audited(sup, (b, id) => b.update(F.doc(sup.db, "uniNodes", sSubj.id), { name: "X", by: sup.uid, audit: id })));
await check("admin deletes the supporter's subject", true, async () => {
  await F.deleteDoc(F.doc(adm.db, "uniNodes", sFile.id, "parts", "0"));
  await F.deleteDoc(F.doc(adm.db, "uniNodes", sFile.id));
  await F.deleteDoc(F.doc(adm.db, "uniNodes", sSubj.id));
});

// Blocks and suspensions (bans/{uid}): enforced for every read and write.
await check("student blocks someone", false, () => F.setDoc(F.doc(stu.db, "bans", oth.uid), { type: "blocked", until: null }));
await check("admin suspends without an end time", false, () => F.setDoc(F.doc(adm.db, "bans", oth.uid), { type: "suspended", until: null }));
await check("admin suspends other user for an hour", true, () => F.setDoc(F.doc(adm.db, "bans", oth.uid), { type: "suspended", until: F.Timestamp.fromMillis(Date.now() + 3600_000), reason: "test" }));
await check("suspended user reads own ban", true, () => F.getDoc(F.doc(oth.db, "bans", oth.uid)));
await check("suspended user reads own documents", false, () => F.getDocs(F.collection(oth.db, "users", oth.uid, "documents")));
await check("suspended user writes own profile", false, () => F.setDoc(F.doc(oth.db, "users", oth.uid), { name: "x" }, { merge: true }));
await check("suspended user opens a ticket", false, () => F.setDoc(F.doc(F.collection(oth.db, "tickets")), { uid: oth.uid, status: "open" }));
await check("suspended user reads the university library", false, () => F.getDoc(F.doc(oth.db, "uni", "options")));
// Appeals come from the locked screen (a second client of the same user).
const locked = await as(`other.${run}@example.com`, "other-locked");
const appeal = (extra = {}) => ({
  uid: oth.uid,
  status: "open",
  appeal: true,
  subject: "Suspended account: please review",
  messages: [{ from: "user", text: "Please review", at: "now", attachments: [] }],
  ...extra,
});
const appealRef = F.doc(F.collection(locked.db, "tickets"));
await check("suspended user contacts the admin (appeal ticket)", true, () => F.setDoc(appealRef, appeal()));
await check("suspended user's appeal with two messages", false, () => F.setDoc(F.doc(F.collection(locked.db, "tickets")), appeal({ messages: [{ text: "a" }, { text: "b" }] })));
await check("suspended user's appeal as someone else", false, () => F.setDoc(F.doc(F.collection(locked.db, "tickets")), appeal({ uid: stu.uid })));
await check("suspended user's appeal already resolved", false, () => F.setDoc(F.doc(F.collection(locked.db, "tickets")), appeal({ status: "resolved" })));
await check("suspended user reads their appeal", false, () => F.getDoc(F.doc(locked.db, "tickets", appealRef.id)));
await check("suspended user adds to their appeal", false, () => F.updateDoc(F.doc(locked.db, "tickets", appealRef.id), { messages: [], unreadForAdmin: true }));
await check("suspended user adds a picture to their appeal", false, () => F.setDoc(F.doc(locked.db, "tickets", appealRef.id, "attachments", "p"), { dataUrl: img }));
await check("admin reads the appeal", true, () => F.getDoc(F.doc(adm.db, "tickets", appealRef.id)));
// Ended a minute ago: under load the emulator's request.time can lag the
// real clock by seconds.
await check("admin ends suspension", true, () => F.setDoc(F.doc(adm.db, "bans", oth.uid), { type: "suspended", until: F.Timestamp.fromMillis(Date.now() - 60_000) }));
await check("expired suspension: user reads own documents", true, () => F.getDocs(F.collection(oth.db, "users", oth.uid, "documents")));
await check("admin blocks other user", true, () => F.setDoc(F.doc(adm.db, "bans", oth.uid), { type: "blocked", until: null }));
await check("blocked user reads own documents", false, () => F.getDocs(F.collection(oth.db, "users", oth.uid, "documents")));
await check("blocked user deletes own ban", false, () => F.deleteDoc(F.doc(oth.db, "bans", oth.uid)));
await check("blocked user contacts the admin (appeal ticket)", true, () => F.setDoc(F.doc(F.collection(locked.db, "tickets")), appeal({ subject: "Blocked account: please review" })));
await check("admin reads a blocked user's profile", true, () => F.getDoc(F.doc(adm.db, "users", oth.uid)));
await check("admin unblocks other user", true, () => F.deleteDoc(F.doc(adm.db, "bans", oth.uid)));
await check("unblocked user reads own documents", true, () => F.getDocs(F.collection(oth.db, "users", oth.uid, "documents")));

await check("student deletes own picture", true, () => F.deleteDoc(F.doc(stu.db, "tickets", t.id, "attachments", "a1")));
await check("student deletes own feedback", true, () => F.deleteDoc(fb));
await check("other user deletes student's ticket", false, () => F.deleteDoc(F.doc(oth.db, "tickets", t.id)));
await F.deleteDoc(F.doc(adm.db, "tickets", t.id, "attachments", "a5"));
await check("student deletes own ticket", true, () => F.deleteDoc(t));

console.log(results.join("\n"));
const passed = results.filter((r) => r.startsWith("PASS")).length;
console.log(`\n${passed}/${results.length} rule checks passed`);
for (const x of [stu, oth, adm, sup, locked]) await deleteApp(x.app);
process.exit(passed === results.length ? 0 : 1);
