// Firestore persistence (free Spark plan). Layout, all private to the user:
//   users/{uid}/documents/{docId}            metadata + study (notes, question bank)
//   users/{uid}/documents/{docId}/images/{id} figures extracted from the PDF (JPEG)
//   users/{uid}/documents/{docId}/parts/{n}  extracted page text (≤ ~300k chars each)
//   users/{uid}/resumes/current              latest resume text
//   users/{uid}/interviews/{id}              practice sessions
import { firebase } from "./firebase";

const PART_CHARS = 300_000; // stays under Firestore's 1 MiB document limit

function partition(pages) {
  const parts = [[]];
  let size = 0;
  for (const page of pages) {
    if (size + page.length > PART_CHARS && parts.at(-1).length) {
      parts.push([]);
      size = 0;
    }
    parts.at(-1).push(page);
    size += page.length;
  }
  return parts;
}

export async function loadLibrary(uid) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDocs(
    f.query(
      f.collection(db, "users", uid, "documents"),
      f.orderBy("createdAt", "desc"),
    ),
  );
  return Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      const parts = await f.getDocs(
        f.query(f.collection(d.ref, "parts"), f.orderBy("index")),
      );
      return {
        id: d.id,
        name: data.name,
        file: data.file,
        category: data.category || "Your document",
        kind: data.kind || "Uploaded document",
        study: data.study || {},
        imageCount: data.imageCount || 0,
        pages: parts.docs.flatMap((p) => p.data().pages),
        cloud: true,
      };
    }),
  );
}

/** A new document id, created locally (no network round trip). */
export async function newDocumentId(uid) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  return f.doc(f.collection(db, "users", uid, "documents")).id;
}

/** Saves a document's metadata and page text (all in Firestore). */
export async function saveDocument(uid, doc, file, { id } = {}) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const ref = id
    ? f.doc(db, "users", uid, "documents", id)
    : f.doc(f.collection(db, "users", uid, "documents"));
  const batch = f.writeBatch(db);
  batch.set(ref, {
    name: doc.name,
    file: doc.file,
    category: doc.category,
    kind: doc.kind,
    pageCount: doc.pages.length,
    size: file?.size || 0,
    study: {},
    imageCount: doc.images?.length || 0,
    createdAt: f.serverTimestamp(),
  });
  partition(doc.pages).forEach((pages, index) =>
    batch.set(f.doc(ref, "parts", String(index)), { index, pages }),
  );
  await batch.commit();
  return { id: ref.id };
}

/** Notes and question banks for one document (`{ notes, bank }`). */
export async function saveStudy(uid, docId, study) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.updateDoc(f.doc(db, "users", uid, "documents", docId), {
    study: JSON.parse(JSON.stringify(study ?? {})), // drop undefined values
  });
}

/** Figures extracted from a PDF, one Firestore document each (≤ ~700 KB). */
export async function saveImages(uid, docId, images) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const col = f.collection(db, "users", uid, "documents", docId, "images");
  // Small batches, sent in parallel (each batch stays well under 10 MB).
  const batches = [];
  for (let i = 0; i < images.length; i += 6) {
    const batch = f.writeBatch(db);
    images.slice(i, i + 6).forEach((img, j) =>
      batch.set(f.doc(col, img.id), {
        page: img.page,
        order: i + j,
        dataUrl: img.dataUrl,
        width: img.width || 0,
        height: img.height || 0,
        kind: img.kind || "image",
        caption: img.caption || "",
      }),
    );
    batches.push(batch.commit());
  }
  await Promise.all(batches);
  await f.updateDoc(f.doc(db, "users", uid, "documents", docId), {
    imageCount: images.length,
  });
}

export async function loadImages(uid, docId) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDocs(
    f.query(
      f.collection(db, "users", uid, "documents", docId, "images"),
      f.orderBy("order"),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteDocument(uid, doc) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const ref = f.doc(db, "users", uid, "documents", doc.id);
  const [parts, images] = await Promise.all([
    f.getDocs(f.collection(ref, "parts")),
    f.getDocs(f.collection(ref, "images")),
  ]);
  const batch = f.writeBatch(db);
  parts.docs.forEach((p) => batch.delete(p.ref));
  images.docs.forEach((p) => batch.delete(p.ref));
  batch.delete(ref);
  await batch.commit();
}

export async function loadResume(uid) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDoc(f.doc(db, "users", uid, "resumes", "current"));
  return snap.exists() ? snap.data() : null;
}

export async function saveResume(uid, { fileName, text }) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.setDoc(f.doc(db, "users", uid, "resumes", "current"), {
    fileName,
    text,
    updatedAt: f.serverTimestamp(),
  });
}

export async function deleteResume(uid) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.deleteDoc(f.doc(db, "users", uid, "resumes", "current"));
}

export async function saveInterview(uid, session) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.addDoc(f.collection(db, "users", uid, "interviews"), {
    ...session,
    createdAt: f.serverTimestamp(),
  });
}

// ---- Study plan, Gemini chats and preferences ---------------------------------
//   users/{uid}/plans/current    multi-document study plan + completed days
//   users/{uid}/chats/{key}      help-bot conversation ("app" or a document id)
//   users/{uid}/prefs/main       theme and AI engine
async function readOne(uid, ...path) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDoc(f.doc(db, "users", uid, ...path));
  return snap.exists() ? snap.data() : null;
}
async function writeOne(uid, data, ...path) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.setDoc(f.doc(db, "users", uid, ...path), {
    ...JSON.parse(JSON.stringify(data)),
    updatedAt: f.serverTimestamp(),
  });
}
export const loadPlan = (uid) => readOne(uid, "plans", "current");
export const savePlan = (uid, plan) => writeOne(uid, plan, "plans", "current");
export const loadChat = (uid, key) => readOne(uid, "chats", key);
export const saveChat = (uid, key, messages) =>
  writeOne(uid, { messages: messages.slice(-40) }, "chats", key);
export const loadPrefs = (uid) => readOne(uid, "prefs", "main");
export const savePrefs = (uid, prefs) => writeOne(uid, prefs, "prefs", "main");

/** Renames a document in the library. */
export async function renameDocument(uid, docId, name) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.updateDoc(f.doc(db, "users", uid, "documents", docId), { name });
}
