// University library: shared study material the admin organises per
// university, degree and year (subjects → folders such as "Unit 1" or
// "Important questions" → files). Every signed-in user can read it; only the
// admin can change it (firestore.rules). Layout:
//   uni/options                       universities, degrees, years (admin-edited)
//   uniNodes/{id}                     subject | folder | file, with its scope
//   uniNodes/{id}/parts/{n}           a file's extracted page text
//   uniNodes/{id}/images/{id}         a file's figures (JPEG, < 700 KB each)
//   uniNodes/{id}/blobs/{n}           the original file, base64 in < 1 MB chunks
//   users/{uid}/uniStudy/{id}         each user's own notes / question bank
import { firebase } from "./firebase";

export const DEFAULT_OPTIONS = {
  universities: ["GITAM VIZAG"],
  degrees: ["CSE CORE"],
  years: ["1", "2", "3", "4"],
};
/** Which exam a subject, folder or file is for. */
export const EXAMS = {
  both: "Regular & Supply",
  regular: "Regular",
  supply: "Supply",
};
export const FOLDER_SUGGESTIONS = [
  "Unit 1",
  "Unit 2",
  "Unit 3",
  "Unit 4",
  "Unit 5",
  "Important questions",
  "Previous papers",
  "Notes",
  "Lab",
];
// The original file is kept for "Open original" (Firestore documents are
// limited to 1 MiB, so it is split into chunks).
export const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
const BLOB_CHARS = 900_000;
const PART_CHARS = 300_000;

// ---- Pure helpers (also used by tests) ------------------------------------------
export const scopeKey = ({ university, degree, year }) =>
  [university, degree, year].join(" · ");

/** A node is shown for an exam filter when it (and every parent) fits it. */
export function examFits(node, filter) {
  return filter === "all" || !node.exam || node.exam === "both" || node.exam === filter;
}
export function visible(nodes, node, filter) {
  for (let n = node; n; n = nodes.find((x) => x.id === n.parentId))
    if (!examFits(n, filter)) return false;
  return true;
}

const KIND_ORDER = { subject: 0, folder: 1, file: 2 };
/** Children of a node (null = the scope's subjects), folders first, then A→Z
 * with "Unit 2" before "Unit 10". */
export function childrenOf(nodes, parentId, filter = "all") {
  return nodes
    .filter((n) => (n.parentId || null) === (parentId || null))
    .filter((n) => examFits(n, filter))
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
}

/** Subject → folder → … for breadcrumbs, from the top. */
export function pathOf(nodes, id) {
  const out = [];
  for (let n = nodes.find((x) => x.id === id); n; n = nodes.find((x) => x.id === n.parentId))
    out.unshift(n);
  return out;
}

/** Every node under (and including) a node. */
export function descendants(nodes, id) {
  const out = [];
  const walk = (pid) =>
    nodes.filter((n) => n.parentId === pid).forEach((n) => (out.push(n), walk(n.id)));
  const self = nodes.find((n) => n.id === id);
  if (self) out.push(self);
  walk(id);
  return out;
}

/** Name search across subjects, folders and files; every word must match the
 * node's name or its folder path ("unit 2 dbms" finds DBMS › Unit 2 files). */
export function searchNodes(nodes, query, filter = "all") {
  const words = String(query || "")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  return nodes
    .filter((n) => visible(nodes, n, filter))
    .map((n) => {
      const path = pathOf(nodes, n.id);
      const haystack = path.map((p) => p.name).join(" ").toLocaleLowerCase();
      if (!words.every((w) => haystack.includes(w))) return null;
      const own = n.name.toLocaleLowerCase();
      const score = words.filter((w) => own.includes(w)).length;
      return { node: n, path, score };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER[a.node.kind] - KIND_ORDER[b.node.kind] ||
        a.node.name.localeCompare(b.node.name, undefined, { numeric: true }),
    );
}

/** Adds or removes an option ("Add university"), trimmed and without repeats. */
export function editOptions(options, key, { add, remove } = {}) {
  let list = [...(options[key] || [])];
  if (add?.trim() && !list.some((x) => x.toLocaleLowerCase() === add.trim().toLocaleLowerCase()))
    list.push(add.trim());
  if (remove != null) list = list.filter((x) => x !== remove);
  if (key === "years") list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { ...options, [key]: list };
}

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

// ---- Options -----------------------------------------------------------------------
export async function loadUniOptions() {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDoc(f.doc(db, "uni", "options"));
  const saved = snap.exists() ? snap.data() : {};
  return {
    universities: saved.universities?.length ? saved.universities : DEFAULT_OPTIONS.universities,
    degrees: saved.degrees?.length ? saved.degrees : DEFAULT_OPTIONS.degrees,
    years: saved.years?.length ? saved.years : DEFAULT_OPTIONS.years,
  };
}
export async function saveUniOptions(options) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.setDoc(f.doc(db, "uni", "options"), {
    universities: options.universities,
    degrees: options.degrees,
    years: options.years,
    updatedAt: f.serverTimestamp(),
  });
}

// ---- The tree ----------------------------------------------------------------------
/** Every subject, folder and file for one university · degree · year. */
export async function loadNodes({ university, degree, year }) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDocs(
    f.query(
      f.collection(db, "uniNodes"),
      f.where("university", "==", university),
      f.where("degree", "==", degree),
      f.where("year", "==", String(year)),
    ),
  );
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      kind: x.kind,
      name: x.name,
      parentId: x.parentId || null,
      exam: x.exam || "both",
      university: x.university,
      degree: x.degree,
      year: x.year,
      fileName: x.fileName || "",
      pageCount: x.pageCount || 0,
      imageCount: x.imageCount || 0,
      size: x.size || 0,
      hasOriginal: Boolean(x.blobCount),
      blobCount: x.blobCount || 0,
      mime: x.mime || "",
    };
  });
}

/** A subject (parentId null) or a folder inside a subject or folder. */
export async function createNode({ scope, parentId = null, kind, name, exam = "both" }) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const ref = f.doc(f.collection(db, "uniNodes"));
  const node = {
    kind,
    name: name.trim(),
    parentId,
    exam,
    university: scope.university,
    degree: scope.degree,
    year: String(scope.year),
  };
  await f.setDoc(ref, { ...node, createdAt: f.serverTimestamp() });
  return { id: ref.id, ...node };
}

export async function updateNode(id, patch) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.updateDoc(f.doc(db, "uniNodes", id), patch);
}

const toBase64 = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Saves an uploaded file: its page text and figures (for reading and for
 * Gemini) and, when small enough, the original for "Open original".
 */
export async function saveUniFile({ scope, parentId, exam = "both", file, pages, images = [] }) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const ref = f.doc(f.collection(db, "uniNodes"));
  const original = file.size <= MAX_ORIGINAL_BYTES ? await toBase64(file) : "";
  const chunks = [];
  for (let i = 0; i < original.length; i += BLOB_CHARS)
    chunks.push(original.slice(i, i + BLOB_CHARS));
  const node = {
    kind: "file",
    name: file.name.replace(/\.(pdf|txt)$/i, ""),
    parentId,
    exam,
    university: scope.university,
    degree: scope.degree,
    year: String(scope.year),
    fileName: file.name,
    mime: file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "text/plain"),
    size: file.size,
    pageCount: pages.length,
    imageCount: images.length,
    blobCount: chunks.length,
  };
  // The node is written last, so a half-finished upload never shows.
  const writes = [
    ...partition(pages).map((p, index) => [f.doc(ref, "parts", String(index)), { index, pages: p }]),
    ...images.map((img, order) => [
      f.doc(ref, "images", img.id),
      {
        page: img.page,
        order,
        dataUrl: img.dataUrl,
        width: img.width || 0,
        height: img.height || 0,
        caption: img.caption || "",
      },
    ]),
    ...chunks.map((data, index) => [f.doc(ref, "blobs", String(index)), { index, data }]),
  ];
  // Batches of a few documents (each up to ~1 MB) stay under the 10 MB limit.
  for (let i = 0; i < writes.length; i += 6) {
    const batch = f.writeBatch(db);
    writes.slice(i, i + 6).forEach(([r, data]) => batch.set(r, data));
    await batch.commit();
  }
  await f.setDoc(ref, { ...node, createdAt: f.serverTimestamp() });
  return { id: ref.id, ...node, hasOriginal: chunks.length > 0 };
}

/** Page text and figures of a file, for the document view. */
export async function loadUniFile(id) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const ref = f.doc(db, "uniNodes", id);
  const [parts, images] = await Promise.all([
    f.getDocs(f.query(f.collection(ref, "parts"), f.orderBy("index"))),
    f.getDocs(f.query(f.collection(ref, "images"), f.orderBy("order"))),
  ]);
  return {
    pages: parts.docs.flatMap((p) => p.data().pages),
    images: images.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

/** The original uploaded file as a Blob. */
export async function loadOriginal(node) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDocs(
    f.query(f.collection(db, "uniNodes", node.id, "blobs"), f.orderBy("index")),
  );
  const bin = atob(snap.docs.map((d) => d.data().data).join(""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: node.mime || "application/pdf" });
}

/** Deletes a node with everything inside it (folders, files and their data). */
export async function deleteNodes(nodes, id) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const all = descendants(nodes, id);
  const refs = [];
  for (const n of all) {
    const ref = f.doc(db, "uniNodes", n.id);
    if (n.kind === "file") {
      const subs = await Promise.all(
        ["parts", "images", "blobs"].map((c) => f.getDocs(f.collection(ref, c))),
      );
      subs.forEach((s) => s.docs.forEach((d) => refs.push(d.ref)));
    }
    refs.push(ref);
  }
  for (let i = 0; i < refs.length; i += 400) {
    const batch = f.writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  return all.map((n) => n.id);
}

// ---- Each user's study material for a shared file ------------------------------------
export async function loadUniStudy(uid, id) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDoc(f.doc(db, "users", uid, "uniStudy", id));
  return snap.exists() ? snap.data().study || {} : {};
}
export async function saveUniStudy(uid, id, study) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  await f.setDoc(f.doc(db, "users", uid, "uniStudy", id), {
    study: JSON.parse(JSON.stringify(study ?? {})),
    updatedAt: f.serverTimestamp(),
  });
}
