// University library: shared study material the admin organises per
// university, degree and year (subjects → folders such as "Unit 1" or
// "Important questions" → files). Every signed-in user can read it; the admin
// and the supporters the admin picks can change it, and only the admin can
// delete (firestore.rules). Layout:
//   uni/options                       universities, degrees, years (admin-edited)
//   uniNodes/{id}                     subject | folder | file, with its scope
//   uniNodes/{id}/parts/{n}           a file's extracted page text
//   uniNodes/{id}/images/{id}         a file's figures (JPEG, < 700 KB each)
//   uniNodes/{id}/blobs/{n}           the original file, base64 in < 1 MB chunks
//   users/{uid}/uniStudy/{id}         each user's own notes / question bank
//   audit/{id}                        what a supporter changed (admin reads)
import { firebase } from "./firebase";
import { baseName, fileExtension } from "./logic";
import { fileKeywords } from "./uniSearch";
import { extractKeywords } from "./ai/text";

const MIMES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
export const mimeFor = (name) => MIMES[fileExtension(name)] || "application/octet-stream";
/** Opens in a browser tab (PDF, images, text); other files download. */
export const viewableInBrowser = (mime) => /^(application\/pdf|image\/|text\/)/.test(mime || "");

export const DEFAULT_OPTIONS = {
  universities: ["GITAM VIZAG"],
  degrees: ["CSE CORE"],
  years: ["1", "2", "3", "4", "5"],
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

// ---- Who is changing the library ---------------------------------------------------
// The admin, or a supporter (supporters/{uid}). A supporter's change is
// committed in one batch with an audit/{id} entry describing it; the rules
// refuse a supporter's change without its entry, so the log can't be skipped.
let actor = null; // { uid, email, name, supporter }
export function setLibraryActor(next) {
  actor = next && next.uid ? { ...next } : null;
}
export const libraryActor = () => actor;
export const AUDIT_ACTIONS = {
  add: "Added",
  upload: "Uploaded",
  rename: "Renamed",
  exam: "Changed exam",
  icon: "Changed icon",
  edit: "Edited",
  move: "Transferred",
  copy: "Copied",
  "move-course": "Moved a year",
  "swap-course": "Swapped years",
};
const clipText = (t, n) => String(t ?? "").slice(0, n);
export const courseText = (s) => `${s.university} · ${s.degree} · Year ${s.year}`;

/** The audit entry for a change (pure; `at` is added when it is written). */
export function auditEntry(who, { action, summary, course = "", items = [] }) {
  return {
    uid: who.uid,
    email: clipText(who.email, 200),
    name: clipText(who.name, 120),
    action: AUDIT_ACTIONS[action] ? action : "edit",
    summary: clipText(summary, 1000),
    course: clipText(course, 300),
    items: items.slice(0, 50).map((n) => ({ id: n.id, name: clipText(n.name, 120), kind: n.kind })),
    count: items.length,
  };
}

/**
 * Adds the audit entry to `batch` when a supporter is making the change, and
 * returns the fields the changed nodes carry: who changed them last (`by`)
 * and, for a supporter, the entry (`audit`).
 */
function stamp(f, db, batch, change) {
  if (!actor) return {};
  if (!actor.supporter) return { by: actor.uid };
  const ref = f.doc(f.collection(db, "audit"));
  batch.set(ref, { ...auditEntry(actor, change), at: f.serverTimestamp() });
  return { by: actor.uid, audit: ref.id };
}
function adminOnly(what) {
  if (actor?.supporter) throw new Error(`Only the admin can ${what}.`);
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
  adminOnly("edit the university, degree and year options");
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
  return snap.docs.map(toNode);
}
function toNode(d) {
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
    icon: x.icon || null,
    keywords: x.keywords || null,
  };
}

/** Every subject, folder and file of every course (for search). */
export async function loadAllNodes() {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const snap = await f.getDocs(f.collection(db, "uniNodes"));
  return snap.docs.map(toNode);
}

/**
 * Files uploaded before search keywords existed get them now (admin):
 * reads each one's text once and saves its keywords. Returns how many.
 */
export async function indexFiles(nodes, onProgress) {
  const todo = nodes.filter((n) => n.kind === "file" && !n.keywords);
  let done = 0;
  for (const n of todo) {
    const { pages } = await loadUniFile(n.id);
    const keywords = fileKeywords(pages, extractKeywords);
    await updateNode(n.id, { keywords }, { action: "edit", summary: `Made “${n.name}” searchable by its content`, course: courseText(n), items: [n] });
    n.keywords = keywords;
    onProgress?.(++done, todo.length);
  }
  return todo.length;
}

/** A subject (parentId null) or a folder inside a subject or folder. */
export async function createNode({ scope, parentId = null, parentName = "", kind, name, exam = "both" }) {
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
  const batch = f.writeBatch(db);
  const by = stamp(f, db, batch, {
    action: "add",
    summary: `Added ${kind} “${node.name}”${parentName ? ` in “${parentName}”` : ""}`,
    course: courseText(scope),
    items: [{ id: ref.id, ...node }],
  });
  batch.set(ref, { ...node, ...by, createdAt: f.serverTimestamp() });
  await batch.commit();
  return { id: ref.id, ...node };
}

/** Changes a node's fields; `change` describes it for the audit log. */
export async function updateNode(id, patch, change = {}) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const batch = f.writeBatch(db);
  const by = stamp(f, db, batch, {
    action: change.action || "edit",
    summary: change.summary || `Edited ${Object.keys(patch).join(", ")}`,
    course: change.course || "",
    items: change.items || [{ id, name: patch.name || "", kind: "" }],
  });
  batch.update(f.doc(db, "uniNodes", id), { ...patch, ...by });
  await batch.commit();
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
export async function saveUniFile({ scope, parentId, parentName = "", exam = "both", file, pages, images = [] }) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const ref = f.doc(f.collection(db, "uniNodes"));
  const original = file.size <= MAX_ORIGINAL_BYTES ? await toBase64(file) : "";
  const chunks = [];
  for (let i = 0; i < original.length; i += BLOB_CHARS)
    chunks.push(original.slice(i, i + BLOB_CHARS));
  const node = {
    kind: "file",
    name: baseName(file.name),
    parentId,
    exam,
    university: scope.university,
    degree: scope.degree,
    year: String(scope.year),
    fileName: file.name,
    mime: file.type || mimeFor(file.name),
    size: file.size,
    pageCount: pages.length,
    imageCount: images.length,
    blobCount: chunks.length,
    // What the file is about, for search across courses.
    keywords: fileKeywords(pages, extractKeywords),
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
  const batch = f.writeBatch(db);
  const by = stamp(f, db, batch, {
    action: "upload",
    summary: `Uploaded “${file.name}” (${pages.length} page${pages.length === 1 ? "" : "s"})${parentName ? ` to “${parentName}”` : ""}`,
    course: courseText(scope),
    items: [{ id: ref.id, ...node }],
  });
  batch.set(ref, { ...node, ...by, createdAt: f.serverTimestamp() });
  await batch.commit();
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
  adminOnly("delete from the library");
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

// ---- Transfer (cut and paste) and copy -------------------------------------------------
// A subject, folder or file moves or is copied with everything inside it to
// another university / degree / year, at the top level (as a subject) or into
// a subject or folder there. A whole course can be moved, copied or swapped.
const sameScope = (a, b) =>
  a.university === b.university && a.degree === b.degree && String(a.year) === String(b.year);

/** Why a node can't go to a place (null when it can). */
export function transferProblem(nodes, node, { scope, parentId = null }) {
  if (!node) return "Choose what to transfer.";
  if (node.kind === "file" && !parentId) return "A file has to go inside a subject or folder.";
  if (sameScope(node, scope)) {
    if ((node.parentId || null) === (parentId || null)) return "It is already there.";
    if (parentId && descendants(nodes, node.id).some((n) => n.id === parentId))
      return "A folder can't be moved inside itself.";
  }
  return null;
}

/** At the top level a folder becomes a subject; inside, a subject becomes a folder. */
const kindAt = (node, isRoot, parentId) =>
  node.kind === "file" ? "file" : isRoot ? (parentId ? "folder" : "subject") : node.kind === "subject" ? "folder" : node.kind;
const scopeFields = (scope) => ({
  university: scope.university,
  degree: scope.degree,
  year: String(scope.year),
});

/** Updates that move a node (and everything inside) to a place. */
export function planMove(nodes, id, { scope, parentId = null }) {
  return descendants(nodes, id).map((n, i) => ({
    id: n.id,
    patch: {
      ...scopeFields(scope),
      kind: kindAt(n, i === 0, parentId),
      ...(i === 0 ? { parentId: parentId || null } : {}),
    },
  }));
}

/**
 * New nodes that copy a node (and everything inside) to a place. `newId`
 * makes ids; a copy next to its original is named "… (copy)".
 */
export function planCopy(nodes, id, { scope, parentId = null }, newId) {
  const all = descendants(nodes, id);
  const ids = Object.fromEntries(all.map((n) => [n.id, newId()]));
  const beside = sameScope(all[0], scope) && (all[0].parentId || null) === (parentId || null);
  return all.map((n, i) => ({
    from: n,
    id: ids[n.id],
    data: {
      kind: kindAt(n, i === 0, parentId),
      name: i === 0 && beside ? `${n.name} (copy)` : n.name,
      parentId: i === 0 ? parentId || null : ids[n.parentId],
      exam: n.exam || "both",
      ...scopeFields(scope),
      ...(n.icon ? { icon: n.icon } : {}),
      ...(n.kind === "file"
        ? {
            fileName: n.fileName || "",
            mime: n.mime || "",
            size: n.size || 0,
            pageCount: n.pageCount || 0,
            imageCount: n.imageCount || 0,
            blobCount: n.blobCount || 0,
            ...(n.keywords ? { keywords: n.keywords } : {}),
          }
        : {}),
    },
  }));
}

const BATCH_NODES = 400; // + one audit entry, under Firestore's 500 writes
const partOf = (i, total) => (total > BATCH_NODES ? ` (part ${i / BATCH_NODES + 1} of ${Math.ceil(total / BATCH_NODES)})` : "");

/** Applies updates in batches; each batch carries its own audit entry. */
async function commitUpdates(updates, change, nodes = []) {
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let i = 0; i < updates.length; i += BATCH_NODES) {
    const slice = updates.slice(i, i + BATCH_NODES);
    const batch = f.writeBatch(db);
    const by = stamp(f, db, batch, {
      ...change,
      summary: change.summary + partOf(i, updates.length),
      items: slice.map((u) => byId.get(u.id) || { id: u.id, name: "", kind: "" }),
    });
    slice.forEach(({ id, patch }) => batch.update(f.doc(db, "uniNodes", id), { ...patch, ...by }));
    await batch.commit();
  }
}
const placeText = ({ scope, parentName }) => `${courseText(scope)} › ${parentName || "the top level"}`;
const fromText = (nodes, node) => {
  const parents = pathOf(nodes, node.id).slice(0, -1).map((n) => n.name);
  return [courseText(node), ...parents].join(" › ");
};
const insideText = (all) => {
  const folders = all.filter((n) => n.kind !== "file").length - (all[0]?.kind !== "file" ? 1 : 0);
  const files = all.filter((n) => n.kind === "file").length - (all[0]?.kind === "file" ? 1 : 0);
  const parts = [folders && `${folders} folder${folders === 1 ? "" : "s"}`, files && `${files} file${files === 1 ? "" : "s"}`];
  return folders + files ? ` with ${parts.filter(Boolean).join(" and ")} inside` : "";
};

/** Transfer (cut and paste). Returns the moved nodes as they are now. */
export async function moveNode(nodes, id, target) {
  const problem = transferProblem(nodes, nodes.find((n) => n.id === id), target);
  if (problem) throw new Error(problem);
  const updates = planMove(nodes, id, target);
  const all = descendants(nodes, id);
  await commitUpdates(
    updates,
    {
      action: "move",
      summary: `Transferred ${all[0].kind} “${all[0].name}”${insideText(all)} from ${fromText(nodes, all[0])} to ${placeText(target)}`,
      course: courseText(target.scope),
    },
    all,
  );
  const byId = Object.fromEntries(updates.map((u) => [u.id, u.patch]));
  return descendants(nodes, id).map((n) => ({ ...n, ...byId[n.id] }));
}

/** Copy (copy and paste), files with their text, figures and original. */
export async function copyNode(nodes, id, target, onProgress) {
  const node = nodes.find((n) => n.id === id);
  const problem = transferProblem(nodes, node, target);
  if (problem && problem !== "It is already there.") throw new Error(problem);
  const { db, fns } = await firebase();
  const f = fns.firestore;
  const plan = planCopy(nodes, id, target, () => f.doc(f.collection(db, "uniNodes")).id);
  let done = 0;
  // Each file's text, figures and original first; the new nodes last, so a
  // half-finished copy never shows.
  for (const item of plan) {
    if (item.from.kind === "file") {
      const ref = f.doc(db, "uniNodes", item.id);
      const src = f.doc(db, "uniNodes", item.from.id);
      const subs = await Promise.all(
        ["parts", "images", "blobs"].map(async (c) => [c, await f.getDocs(f.collection(src, c))]),
      );
      const writes = subs.flatMap(([c, snap]) => snap.docs.map((d) => [f.doc(ref, c, d.id), d.data()]));
      for (let i = 0; i < writes.length; i += 6) {
        const batch = f.writeBatch(db);
        writes.slice(i, i + 6).forEach(([r, data]) => batch.set(r, data));
        await batch.commit();
      }
    }
    onProgress?.(++done, plan.length);
  }
  const all = descendants(nodes, id);
  const summary = `Copied ${all[0].kind} “${all[0].name}”${insideText(all)} from ${fromText(nodes, all[0])} to ${placeText(target)}`;
  for (let i = 0; i < plan.length; i += BATCH_NODES) {
    const slice = plan.slice(i, i + BATCH_NODES);
    const batch = f.writeBatch(db);
    const by = stamp(f, db, batch, {
      action: "copy",
      summary: summary + partOf(i, plan.length),
      course: courseText(target.scope),
      items: slice.map((p) => ({ id: p.id, name: p.data.name, kind: p.data.kind })),
    });
    slice.forEach((p) => batch.set(f.doc(db, "uniNodes", p.id), { ...p.data, ...by, createdAt: f.serverTimestamp() }));
    await batch.commit();
  }
  return plan.map((p) => ({ id: p.id, ...p.data, hasOriginal: Boolean(p.data.blobCount) }));
}

/**
 * A whole course to another one: "move" (cut and paste), "copy", or "swap"
 * (the two courses exchange their material). Returns counts.
 */
export async function transferCourse(from, to, mode, onProgress) {
  if (sameScope(from, to)) throw new Error("Choose a different university, degree or year.");
  const [mine, theirs] = await Promise.all([loadNodes(from), loadNodes(to)]);
  if (!mine.length && mode !== "swap") throw new Error("There is nothing to transfer in this course.");
  const subjects = mine.filter((n) => !n.parentId);
  if (mode === "copy") {
    let done = 0;
    for (const s of subjects) await copyNode(mine, s.id, { scope: to }, () => onProgress?.(++done));
    return { moved: 0, copied: mine.length, back: 0 };
  }
  const updates = [
    ...mine.map((n) => ({ id: n.id, patch: scopeFields(to) })),
    ...(mode === "swap" ? theirs.map((n) => ({ id: n.id, patch: scopeFields(from) })) : []),
  ];
  await commitUpdates(
    updates,
    mode === "swap"
      ? {
          action: "swap-course",
          summary: `Swapped all material of ${courseText(from)} (${mine.length} items) with ${courseText(to)} (${theirs.length} items)`,
          course: `${courseText(from)} ⇄ ${courseText(to)}`,
        }
      : {
          action: "move-course",
          summary: `Moved all material of ${courseText(from)} (${mine.length} items) to ${courseText(to)}`,
          course: courseText(to),
        },
    [...mine, ...theirs],
  );
  return { moved: mine.length, copied: 0, back: mode === "swap" ? theirs.length : 0 };
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
