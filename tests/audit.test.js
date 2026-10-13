// Supporters' library changes are written together with their audit entry
// (same batch); the admin's are not logged; supporters can't delete. Runs
// against a fake Firestore that records every batch.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ batches: [], writes: [], docs: {}, n: 0 }));
vi.mock("../src/firebase", () => {
  const ref = (path, type = "doc") => ({ path, type, id: path.split("/").at(-1) });
  const join = (base, segs) => [base.path, ...segs].filter(Boolean).join("/");
  const fake = {
    collection: (base, ...segs) => ref(join(base, segs), "col"),
    doc: (base, ...segs) => (base.type === "col" && !segs.length ? ref(`${base.path}/auto${++store.n}`) : ref(join(base, segs))),
    writeBatch: () => {
      const ops = [];
      return {
        set: (r, data) => ops.push(["set", r.path, data]),
        update: (r, data) => ops.push(["update", r.path, data]),
        delete: (r) => ops.push(["delete", r.path]),
        commit: async () => store.batches.push(ops),
      };
    },
    serverTimestamp: () => "TS",
    Timestamp: { fromDate: (d) => d },
    query: (col, ...clauses) => ({ ...col, clauses }),
    where: (field, op, value) => ({ field, value }),
    orderBy: () => ({}),
    limit: () => ({}),
    getDocs: async (q) => {
      const year = q.clauses?.find((c) => c.field === "year")?.value;
      const list = (store.docs[q.path] || []).filter((d) => !year || d.data.year === year);
      return { docs: list.map((d) => ({ id: d.id, ref: ref(`${q.path}/${d.id}`), data: () => d.data })) };
    },
    getDoc: async (r) => ({ exists: () => Boolean(store.docs[r.path]), data: () => store.docs[r.path] }),
    setDoc: async (r, data) => store.writes.push(["set", r.path, data]),
    updateDoc: async (r, data) => store.writes.push(["update", r.path, data]),
    deleteDoc: async (r) => store.writes.push(["delete", r.path]),
    addDoc: async (c, data) => store.writes.push(["add", c.path, data]),
  };
  return { firebase: async () => ({ db: ref("", "db"), fns: { firestore: fake } }), firebaseEnabled: true };
});

const uni = await import("../src/university");
const support = await import("../src/support");

const scope = { university: "GITAM VIZAG", degree: "CSE CORE", year: "1" };
const SUPPORTER = { uid: "sup1", email: "helper@college.edu", name: "Helper", supporter: true };
const ADMIN = { uid: "adm", email: "aafthabali08@gmail.com", name: "Admin", supporter: false };
const NODES = [
  { id: "dbms", kind: "subject", name: "DBMS", parentId: null, exam: "both", ...scope },
  { id: "u1", kind: "folder", name: "Unit 1", parentId: "dbms", exam: "both", ...scope },
  { id: "f1", kind: "file", name: "ER model", parentId: "u1", exam: "both", fileName: "ER model.pdf", blobCount: 1, pageCount: 3, ...scope },
];
/** The audit entry and the node writes of one batch. */
const split = (ops) => ({
  audit: ops.filter(([, path]) => path.startsWith("audit/")),
  nodes: ops.filter(([, path]) => path.startsWith("uniNodes/")),
});

beforeEach(() => {
  store.batches = [];
  store.writes = [];
  store.docs = {};
  store.n = 0;
  uni.setLibraryActor(null);
});

describe("audit entries", () => {
  it("describes who changed what, trimmed to what the rules accept", () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, name: `Item ${i}`, kind: "file", extra: "dropped" }));
    const e = uni.auditEntry(SUPPORTER, { action: "copy", summary: "x".repeat(1200), course: "GITAM", items });
    expect(Object.keys(e).sort()).toEqual(["action", "count", "course", "email", "items", "name", "summary", "uid"]);
    expect(e.summary).toHaveLength(1000);
    expect(e.items).toHaveLength(50);
    expect(e.items[0]).toEqual({ id: "n0", name: "Item 0", kind: "file" });
    expect(e.count).toBe(60);
    expect(uni.auditEntry(SUPPORTER, { action: "hack", summary: "s" }).action).toBe("edit");
  });
});

describe("a supporter's changes", () => {
  beforeEach(() => uni.setLibraryActor(SUPPORTER));

  it("adds a folder with its audit entry in the same batch", async () => {
    await uni.createNode({ scope, parentId: "dbms", parentName: "DBMS", kind: "folder", name: " Unit 3 " });
    expect(store.batches).toHaveLength(1);
    const { audit, nodes } = split(store.batches[0]);
    expect(audit).toHaveLength(1);
    const [, auditPath, entry] = audit[0];
    expect(entry).toMatchObject({
      uid: "sup1",
      email: "helper@college.edu",
      action: "add",
      summary: "Added folder “Unit 3” in “DBMS”",
      course: "GITAM VIZAG · CSE CORE · Year 1",
      count: 1,
      at: "TS",
    });
    expect(nodes[0][2]).toMatchObject({ name: "Unit 3", kind: "folder", by: "sup1", audit: auditPath.split("/")[1] });
  });

  it("renames with the old and new name in the log", async () => {
    await uni.updateNode("u1", { name: "Unit I" }, { action: "rename", summary: "Renamed folder “Unit 1” to “Unit I”", course: "C", items: [NODES[1]] });
    const { audit, nodes } = split(store.batches[0]);
    expect(audit[0][2]).toMatchObject({ action: "rename", summary: "Renamed folder “Unit 1” to “Unit I”" });
    expect(nodes).toEqual([["update", "uniNodes/u1", { name: "Unit I", by: "sup1", audit: audit[0][1].split("/")[1] }]]);
  });

  it("transfers a subject with everything inside, all stamped with one entry", async () => {
    await uni.moveNode(NODES, "dbms", { scope: { ...scope, year: "2" }, parentId: null });
    expect(store.batches).toHaveLength(1);
    const { audit, nodes } = split(store.batches[0]);
    const id = audit[0][1].split("/")[1];
    expect(audit[0][2]).toMatchObject({
      action: "move",
      summary: "Transferred subject “DBMS” with 1 folder and 1 file inside from GITAM VIZAG · CSE CORE · Year 1 to GITAM VIZAG · CSE CORE · Year 2 › the top level",
      count: 3,
    });
    expect(nodes.map(([op, path, d]) => [op, path, d.year, d.audit, d.by])).toEqual([
      ["update", "uniNodes/dbms", "2", id, "sup1"],
      ["update", "uniNodes/u1", "2", id, "sup1"],
      ["update", "uniNodes/f1", "2", id, "sup1"],
    ]);
  });

  it("copies a file's text and original first, then the new node with its entry", async () => {
    store.docs["uniNodes/f1/parts"] = [{ id: "0", data: { index: 0, pages: ["text"] } }];
    store.docs["uniNodes/f1/blobs"] = [{ id: "0", data: { index: 0, data: "AAAA" } }];
    const copies = await uni.copyNode(NODES, "f1", { scope: { ...scope, year: "3" }, parentId: "x9", parentName: "Unit 2" });
    expect(store.batches).toHaveLength(2);
    // 1: the copied parts and blobs (no audit needed: the new node doesn't exist yet).
    expect(store.batches[0].map(([, p]) => p)).toEqual([`uniNodes/${copies[0].id}/parts/0`, `uniNodes/${copies[0].id}/blobs/0`]);
    // 2: the node and its audit entry together.
    const { audit, nodes } = split(store.batches[1]);
    expect(audit[0][2]).toMatchObject({
      action: "copy",
      summary: "Copied file “ER model” from GITAM VIZAG · CSE CORE · Year 1 › DBMS › Unit 1 to GITAM VIZAG · CSE CORE · Year 3 › Unit 2",
    });
    expect(nodes[0][2]).toMatchObject({ name: "ER model", parentId: "x9", year: "3", by: "sup1", audit: audit[0][1].split("/")[1] });
  });

  it("uploads: pages and original first, the node and its entry last", async () => {
    const file = new File(["%PDF-1.4"], "Normal forms.pdf", { type: "application/pdf" });
    await uni.saveUniFile({ scope, parentId: "u1", parentName: "Unit 1", file, pages: ["1NF", "2NF"] });
    const last = split(store.batches.at(-1));
    expect(store.batches.slice(0, -1).flat().every(([, p]) => /\/(parts|blobs|images)\//.test(p))).toBe(true);
    expect(last.audit[0][2]).toMatchObject({ action: "upload", summary: "Uploaded “Normal forms.pdf” (2 pages) to “Unit 1”" });
    expect(last.nodes[0][2]).toMatchObject({ kind: "file", name: "Normal forms", by: "sup1" });
  });

  it("moves a large year in parts, each batch with its own entry", async () => {
    store.docs.uniNodes = Array.from({ length: 450 }, (_, i) => ({
      id: `n${i}`,
      data: { kind: "subject", name: `S${i}`, parentId: null, exam: "both", ...scope },
    }));
    await uni.transferCourse(scope, { ...scope, year: "4" }, "move");
    expect(store.batches).toHaveLength(2);
    const [a, b] = store.batches.map(split);
    expect(a.nodes).toHaveLength(400);
    expect(b.nodes).toHaveLength(50);
    expect(a.audit[0][2].summary).toBe("Moved all material of GITAM VIZAG · CSE CORE · Year 1 (450 items) to GITAM VIZAG · CSE CORE · Year 4 (part 1 of 2)");
    expect(b.audit[0][2].summary).toMatch(/\(part 2 of 2\)$/);
    expect(b.nodes.every(([, , d]) => d.audit === b.audit[0][1].split("/")[1])).toBe(true);
  });

  it("can't delete or edit the course options", async () => {
    await expect(uni.deleteNodes(NODES, "dbms")).rejects.toThrow("Only the admin can delete from the library.");
    await expect(uni.saveUniOptions({ universities: [], degrees: [], years: [] })).rejects.toThrow(/Only the admin/);
    expect(store.batches).toEqual([]);
    expect(store.writes).toEqual([]);
  });
});

describe("the admin's changes", () => {
  it("are not logged, only marked with who changed them", async () => {
    uni.setLibraryActor(ADMIN);
    await uni.createNode({ scope, kind: "subject", name: "OS" });
    await uni.moveNode(NODES, "u1", { scope, parentId: null });
    expect(store.batches.flat().some(([, p]) => p.startsWith("audit/"))).toBe(false);
    expect(store.batches[0][0][2]).toMatchObject({ name: "OS", by: "adm" });
    expect(store.batches[0][0][2].audit).toBeUndefined();
    await uni.deleteNodes(NODES, "f1"); // allowed
    expect(store.batches.at(-1)).toEqual([["delete", "uniNodes/f1"]]);
  });
});

describe("supporter role and appeals", () => {
  it("adds a supporter and tells them, but never the admin account", async () => {
    await expect(support.addSupporter({ id: "a", email: "AAFTHABALI08@gmail.com" })).rejects.toThrow(/admin account/);
    const s = await support.addSupporter({ id: "u7", email: "helper@college.edu", name: "Helper" });
    expect(s).toMatchObject({ uid: "u7", email: "helper@college.edu", name: "Helper" });
    expect(store.writes[0]).toEqual(["set", "supporters/u7", { uid: "u7", email: "helper@college.edu", name: "Helper", addedAt: "TS" }]);
    expect(store.writes[1]).toEqual(["add", "users/u7/notifications", expect.objectContaining({ title: "You're now a StudyMind supporter" })]);
    await support.removeSupporter({ id: "u7" });
    expect(store.writes[2]).toEqual(["delete", "supporters/u7"]);
    expect(store.writes[3][2].title).toBe("Your supporter access has ended");
  });

  it("knows who is a supporter", async () => {
    store.docs["supporters/u7"] = { uid: "u7" };
    expect(await support.loadSupporter("u7")).toBe(true);
    expect(await support.loadSupporter("u8")).toBe(false);
  });

  it("reads one supporter's log newest first", async () => {
    store.docs.audit = [
      { id: "a1", data: { uid: "u7", summary: "old", at: { toDate: () => new Date("2026-10-01") } } },
      { id: "a2", data: { uid: "u7", summary: "new", at: { toDate: () => new Date("2026-10-12") } } },
    ];
    expect((await support.adminAudit({ uid: "u7" })).map((a) => a.summary)).toEqual(["new", "old"]);
  });

  it("raises a one-message appeal ticket from the locked screen", async () => {
    const user = { uid: "u9", email: "x@y.com", displayName: "X" };
    await expect(support.appealTicket(user, { kind: "blocked" }, "   ")).rejects.toThrow("Write a message for the admin.");
    await support.appealTicket(user, { kind: "suspended" }, " Please review ");
    const [op, path, data] = store.writes[0];
    expect(op).toBe("set");
    expect(path).toMatch(/^tickets\//);
    expect(data).toMatchObject({
      uid: "u9",
      appeal: true,
      banKind: "suspended",
      status: "open",
      subject: "Suspended account: please review",
      messages: [expect.objectContaining({ from: "user", text: "Please review", attachments: [] })],
    });
    expect(data.messages).toHaveLength(1);
  });
});

describe("audit wording", () => {
  it("leaves out empty counts", async () => {
    uni.setLibraryActor(SUPPORTER);
    const nodes = NODES.filter((n) => n.id !== "u1").map((n) => (n.id === "f1" ? { ...n, parentId: "dbms" } : n));
    await uni.moveNode(nodes, "dbms", { scope: { ...scope, year: "2" }, parentId: null });
    expect(split(store.batches[0]).audit[0][2].summary).toMatch(/^Transferred subject “DBMS” with 1 file inside from /);
  });
});
