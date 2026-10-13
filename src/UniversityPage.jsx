import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Atom,
  Award,
  BarChart3,
  Binary,
  BookMarked,
  BookOpen,
  Brain,
  Briefcase,
  Calculator,
  ChevronRight,
  ClipboardList,
  Code2,
  Cpu,
  Database,
  ArrowRightLeft,
  ClipboardPaste,
  Copy,
  Scissors,
  Download,
  Eye,
  FileImage,
  FileQuestion,
  FileText,
  FlaskConical,
  Folder,
  FolderPlus,
  Globe,
  GraduationCap,
  Languages,
  Layers,
  Lightbulb,
  Microscope,
  Network,
  Palette,
  PenTool,
  Pencil,
  Plus,
  Presentation,
  Scale,
  Search,
  Server,
  Settings2,
  Shield,
  Sigma,
  Star,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import Thinking from "./Thinking";
import { downloadBlob, readDocument, warmUpReader } from "./documents";
import { UPLOAD_ACCEPT, UPLOAD_HINT, validateFile } from "./logic";
import {
  DEFAULT_OPTIONS,
  EXAMS,
  FOLDER_SUGGESTIONS,
  childrenOf,
  createNode,
  deleteNodes,
  descendants,
  editOptions,
  loadNodes,
  loadOriginal,
  loadUniOptions,
  pathOf,
  saveUniFile,
  saveUniOptions,
  loadAllNodes,
  indexFiles,
  visible as visibleIn,
  updateNode,
  copyNode,
  moveNode,
  transferCourse,
  transferProblem,
} from "./university";
import { fileExtension } from "./logic";
import { smartSearch } from "./uniSearch";
import MaterialTransfer from "./MaterialTransfer";
import DocumentViewer from "./DocumentViewer";

const ALL_TTL = 5 * 60 * 1000; // the whole library is re-read at most every 5 minutes

const KEY = "studymind-university";
const readChoice = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
};
const FILTERS = [
  ["all", "All"],
  ["regular", "Regular"],
  ["supply", "Supply"],
];
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Icons the admin can give a subject or folder ("icon": a key below, or any
// emoji). Without one, the name suggests it (Unit → layers, Lab → flask…).
export const ICONS = {
  folder: ["Folder", Folder],
  book: ["Book", BookOpen],
  subject: ["Subject", BookMarked],
  units: ["Units", Layers],
  star: ["Important", Star],
  question: ["Questions", FileQuestion],
  papers: ["Papers", ClipboardList],
  notes: ["Notes", PenTool],
  idea: ["Concepts", Lightbulb],
  code: ["Programming", Code2],
  binary: ["Computing", Binary],
  database: ["Database", Database],
  cpu: ["Hardware", Cpu],
  network: ["Networks", Network],
  server: ["Systems", Server],
  security: ["Security", Shield],
  ai: ["AI / ML", Brain],
  math: ["Maths", Sigma],
  calculator: ["Calculator", Calculator],
  chart: ["Statistics", BarChart3],
  physics: ["Physics", Atom],
  lab: ["Lab", FlaskConical],
  biology: ["Biology", Microscope],
  language: ["Language", Languages],
  law: ["Law / Ethics", Scale],
  business: ["Management", Briefcase],
  globe: ["General", Globe],
  design: ["Design", Palette],
  award: ["Award", Award],
  cap: ["Degree", GraduationCap],
};
export function autoIcon(node) {
  const n = String(node.name || "").toLowerCase();
  if (node.kind === "subject") return "subject";
  if (/important|imp\b/.test(n)) return "star";
  if (/unit|module|chapter/.test(n)) return "units";
  if (/previous|paper|pyq|exam/.test(n)) return "papers";
  if (/lab|practical/.test(n)) return "lab";
  if (/question|q ?& ?a|faq/.test(n)) return "question";
  if (/note/.test(n)) return "notes";
  return "folder";
}
/** The icon to draw for a node: its own, else one from its name or type. */
function NodeIcon({ node, size = 20 }) {
  if (node.kind === "file") {
    const ext = fileExtension(node.fileName);
    const Icon = /pptx?$/.test(ext) ? Presentation : /png|jpe?g|webp/.test(ext) ? FileImage : FileText;
    return <Icon size={size} />;
  }
  const own = node.icon;
  if (own && !ICONS[own]) return <span className="uni-emoji">{own}</span>;
  const Icon = ICONS[own || autoIcon(node)][1];
  return <Icon size={size} />;
}

/** Admin: pick a built-in icon or type any emoji for a subject or folder. */
function IconPicker({ node, onPick, onClose }) {
  const [emoji, setEmoji] = useState(node.icon && !ICONS[node.icon] ? node.icon : "");
  return (
    <div className="icon-picker" role="dialog" aria-label={`Icon for ${node.name}`}>
      <div className="icon-grid">
        {Object.entries(ICONS).map(([key, [label, Icon]]) => (
          <button
            key={key}
            className={(node.icon || autoIcon(node)) === key ? "active" : ""}
            aria-label={label}
            title={label}
            onClick={() => onPick(key)}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <form
        className="icon-emoji"
        onSubmit={(e) => {
          e.preventDefault();
          if (emoji.trim()) onPick(emoji.trim());
        }}
      >
        <input
          aria-label="Or type an emoji"
          placeholder="Or type an emoji, e.g. 📘"
          value={emoji}
          maxLength={8}
          onChange={(e) => setEmoji(e.target.value)}
        />
        <button className="secondary" disabled={!emoji.trim()}>
          Use
        </button>
      </form>
      <div className="icon-picker-foot">
        <button className="text-button" onClick={() => onPick(null)}>
          Automatic icon
        </button>
        <button className="text-button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Admin: edit the universities, degrees and years students can pick. */
function OptionsEditor({ options, onSave, onClose }) {
  const [draft, setDraft] = useState(options);
  const [inputs, setInputs] = useState({});
  const [saving, setSaving] = useState(false);
  const groups = [
    ["universities", "Universities", "e.g. GITAM Hyderabad"],
    ["degrees", "Degrees", "e.g. CSE AI & ML"],
    ["years", "Years", "e.g. 5"],
  ];
  return (
    <section className="panel uni-options" aria-label="University options">
      <div className="uni-options-head">
        <div>
          <span className="eyebrow">ADMIN · OPTIONS</span>
          <h3>What students can choose</h3>
        </div>
        <button className="icon-button" aria-label="Close options" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {groups.map(([key, label, hint]) => (
        <div className="uni-option-group" key={key}>
          <strong>{label}</strong>
          <div className="chips">
            {draft[key].map((v) => (
              <span className="chip removable" key={v}>
                {key === "years" ? `Year ${v}` : v}
                <button
                  aria-label={`Remove ${v}`}
                  disabled={draft[key].length === 1}
                  onClick={() => setDraft((d) => editOptions(d, key, { remove: v }))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <form
            className="uni-option-add"
            onSubmit={(e) => {
              e.preventDefault();
              setDraft((d) => editOptions(d, key, { add: inputs[key] }));
              setInputs((i) => ({ ...i, [key]: "" }));
            }}
          >
            <input
              aria-label={`Add to ${label}`}
              value={inputs[key] || ""}
              placeholder={hint}
              onChange={(e) => setInputs((i) => ({ ...i, [key]: e.target.value }))}
            />
            <button className="secondary" disabled={!inputs[key]?.trim()}>
              <Plus size={15} /> Add
            </button>
          </form>
        </div>
      ))}
      <div className="button-row">
        <button
          className="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(draft);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save options"}
        </button>
      </div>
    </section>
  );
}

function ExamBadge({ exam }) {
  if (!exam || exam === "both") return null;
  return <span className={`exam-badge exam-${exam}`}>{EXAMS[exam]}</span>;
}

/**
 * University library: pick university · degree · year (and Regular / Supply),
 * browse subjects → folders → files the admin added, search them, and open a
 * file to study it (with Gemini). The admin adds, renames and deletes
 * subjects, folders and files, uploads files, and edits the options.
 */
const ACTIONS = {
  move: ["Transfer", "Cut and paste: it moves there and leaves here."],
  copy: ["Copy", "Copy and paste: a copy goes there; this one stays."],
  swap: ["Swap", "The two courses exchange all their material."],
};

/**
 * Admin: transfer (cut and paste) or copy a subject, folder or file with
 * everything inside it, or a whole course, to another university / degree /
 * year, and (for one item) into a subject or folder there.
 */
function TransferDialog({ node, nodes, options, from, onClose, onDone, notify }) {
  const course = !node;
  const nextYear = options.years[options.years.indexOf(String(from.year)) + 1];
  const [action, setAction] = useState("move");
  const [target, setTarget] = useState({
    university: from.university,
    degree: from.degree,
    year: course ? nextYear || options.years.find((y) => y !== String(from.year)) || from.year : String(from.year),
  });
  const [parentId, setParentId] = useState(node && node.kind !== "subject" ? node.parentId : null);
  const [targetNodes, setTargetNodes] = useState(null);
  const [busy, setBusy] = useState("");
  const same =
    target.university === from.university && target.degree === from.degree && String(target.year) === String(from.year);
  useEffect(() => {
    let live = true;
    setTargetNodes(same ? nodes : null);
    if (!same)
      loadNodes(target)
        .then((list) => live && setTargetNodes(list))
        .catch(() => live && setTargetNodes([]));
    return () => {
      live = false;
    };
  }, [target.university, target.degree, target.year]);
  // Where it can go there: the top level, or any subject or folder.
  const inside = new Set(node && same ? descendants(nodes, node.id).map((n) => n.id) : []);
  const places = (targetNodes || [])
    .filter((n) => n.kind !== "file" && !inside.has(n.id))
    .map((n) => ({ id: n.id, label: pathOf(targetNodes, n.id).map((p) => p.name).join(" › ") }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  useEffect(() => {
    if (parentId && targetNodes && !places.some((p) => p.id === parentId)) setParentId(node?.kind === "file" ? places[0]?.id || null : null);
    if (!parentId && node?.kind === "file" && places.length) setParentId(places[0].id);
  }, [targetNodes]);
  const where = `${target.university} · ${target.degree} · Year ${target.year}`;
  const placeLabel = parentId ? places.find((p) => p.id === parentId)?.label : "the top level";
  const inner = node ? descendants(nodes, node.id).slice(1) : [];
  const what = node
    ? `“${node.name}”${inner.length ? ` and everything in it (${plural(inner.filter((n) => n.kind !== "file").length, "folder")}, ${plural(inner.filter((n) => n.kind === "file").length, "file")})` : ""}`
    : `all of ${from.university} · ${from.degree} · Year ${from.year} (${plural(nodes.length, "item")})`;
  const problem = course
    ? same
      ? "Choose a different university, degree or year."
      : null
    : action === "move"
      ? transferProblem(nodes, node, { scope: target, parentId })
      : node.kind === "file" && !parentId
        ? "A file has to go inside a subject or folder."
        : null;

  async function run() {
    if (course && action !== "copy") {
      const msg =
        action === "swap"
          ? `Swap all material between Year ${from.year} and ${where}?`
          : `Move ${what} to ${where}? It will no longer be in Year ${from.year}.`;
      if (!window.confirm(msg)) return;
    }
    setBusy("Working…");
    try {
      if (course) {
        const r = await transferCourse(from, target, action, (n) => setBusy(`Copied ${n}…`));
        notify(
          action === "swap"
            ? `Swapped: ${plural(r.moved, "item")} moved to ${where} and ${plural(r.back, "item")} came back.`
            : action === "copy"
              ? `Copied ${plural(r.copied, "item")} to ${where}.`
              : `Moved ${plural(r.moved, "item")} to ${where}.`,
        );
        onDone({ reload: true });
      } else if (action === "move") {
        const moved = await moveNode(nodes, node.id, { scope: target, parentId });
        notify(`Moved “${node.name}” to ${where} › ${placeLabel}.`);
        onDone({ moved, sameScope: same });
      } else {
        const copies = await copyNode(nodes, node.id, { scope: target, parentId }, (n, total) =>
          setBusy(`Copying ${n} of ${total}…`),
        );
        notify(`Copied “${node.name}” to ${where} › ${placeLabel}.`);
        onDone({ copies, sameScope: same });
      }
    } catch (e) {
      notify(e.message || "The transfer did not finish. Try again.");
      setBusy("");
    }
  }

  return (
    <div className="modal-backdrop transfer-backdrop" onClick={() => !busy && onClose()}>
      <section
        className="modal panel transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close" aria-label="Close transfer" disabled={Boolean(busy)} onClick={onClose}>
          <X size={18} />
        </button>
        <span className="eyebrow">ADMIN · {course ? "WHOLE COURSE" : node.kind.toUpperCase()}</span>
        <h2 id="transfer-title">{course ? "Transfer this course" : `Transfer or copy “${node.name}”`}</h2>
        <div className="segmented transfer-actions" role="group" aria-label="Action">
          {Object.entries(ACTIONS)
            .filter(([k]) => course || k !== "swap")
            .map(([k, [label]]) => (
              <button key={k} aria-pressed={action === k} className={action === k ? "active" : ""} onClick={() => setAction(k)}>
                {label}
              </button>
            ))}
        </div>
        <p className="fine">{ACTIONS[action][1]}</p>
        <div className="transfer-fields">
          <label>
            University
            <select value={target.university} onChange={(e) => setTarget((t) => ({ ...t, university: e.target.value }))}>
              {options.universities.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label>
            Degree
            <select value={target.degree} onChange={(e) => setTarget((t) => ({ ...t, degree: e.target.value }))}>
              {options.degrees.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select value={target.year} onChange={(e) => setTarget((t) => ({ ...t, year: e.target.value }))}>
              {options.years.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </label>
          {!course && (
            <label className="transfer-place">
              Put it in
              <select
                value={parentId || ""}
                disabled={!targetNodes}
                onChange={(e) => setParentId(e.target.value || null)}
              >
                {node.kind !== "file" && <option value="">Top level (as a subject)</option>}
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="transfer-summary" role="status">
          {targetNodes == null
            ? "Loading the target course…"
            : problem ||
              `${ACTIONS[action][0]} ${what} ${action === "swap" ? "with" : "to"} ${where}${course ? "" : ` › ${placeLabel}`}.`}
        </p>
        <div className="button-row">
          <button className="primary" disabled={Boolean(problem) || Boolean(busy) || targetNodes == null} onClick={run}>
            <ArrowRightLeft size={16} /> {busy || `${ACTIONS[action][0]} now`}
          </button>
          <button className="secondary" disabled={Boolean(busy)} onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

export default function UniversityPage({ active, admin, notify, onOpenFile }) {
  const saved = readChoice();
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [choice, setChoice] = useState({
    university: saved?.university || DEFAULT_OPTIONS.universities[0],
    degree: saved?.degree || DEFAULT_OPTIONS.degrees[0],
    year: saved?.year || DEFAULT_OPTIONS.years[0],
  });
  const [exam, setExam] = useState(saved?.exam || "all");
  const [nodes, setNodes] = useState([]);
  const [status, setStatus] = useState("idle"); // loading | ready | error
  const [folderId, setFolderId] = useState(null);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [searchIn, setSearchIn] = useState("all"); // all | course
  const [library, setLibrary] = useState({ nodes: null, at: 0, status: "idle" });
  const [indexing, setIndexing] = useState("");
  const pendingFolder = useRef(null); // a folder to open once its course loads
  const [editingOptions, setEditingOptions] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExam, setNewExam] = useState("both");
  const [uploads, setUploads] = useState([]);
  const [opening, setOpening] = useState(null);
  const [iconFor, setIconFor] = useState(null); // node id with the picker open
  const [transfer, setTransfer] = useState(null); // { node } or { course: true }
  // Cut / Copy → go anywhere (any course, any folder) → Paste here.
  const [clip, setClip] = useState(null); // { mode: "move" | "copy", node, from }
  const [pasting, setPasting] = useState("");
  const [moving, setMoving] = useState(false); // the Transfer materials panel
  const [viewing, setViewing] = useState(null); // a file shown in the viewer
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef(null);
  const loadToken = useRef(0);

  useEffect(() => {
    if (!active) return;
    loadUniOptions()
      .then((o) => {
        setOptions(o);
        // Keep the saved choice when it still exists, else the first option.
        setChoice((c) => ({
          university: o.universities.includes(c.university) ? c.university : o.universities[0],
          degree: o.degrees.includes(c.degree) ? c.degree : o.degrees[0],
          year: o.years.includes(String(c.year)) ? String(c.year) : o.years[0],
        }));
      })
      .catch(() => {});
  }, [active]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...choice, exam }));
    } catch {
      /* the choice still applies for this visit */
    }
  }, [choice, exam]);

  function reload() {
    const token = ++loadToken.current;
    loadedFor.current = `${choice.university}|${choice.degree}|${choice.year}`;
    setStatus("loading");
    loadNodes(choice)
      .then((list) => {
        if (token !== loadToken.current) return;
        setNodes(list);
        setStatus("ready");
        // Opened from a search result in another course.
        if (pendingFolder.current && list.some((n) => n.id === pendingFolder.current))
          setFolderId(pendingFolder.current);
        pendingFolder.current = null;
      })
      .catch(() => token === loadToken.current && setStatus("error"));
  }
  // Load when the course changes (or on first visit); coming back from a
  // file keeps the folder you were in.
  const loadedFor = useRef("");
  useEffect(() => {
    const key = `${choice.university}|${choice.degree}|${choice.year}`;
    if (!active || loadedFor.current === key) return;
    loadedFor.current = key;
    setFolderId(null);
    setSearched("");
    setNodes([]); // the old course's cards must not stay clickable
    reload();
  }, [active, choice.university, choice.degree, choice.year]);

  const current = nodes.find((n) => n.id === folderId) || null;
  // A folder that isn't in this course (moved away, or another course
  // loaded): back to the subjects.
  useEffect(() => {
    if (status === "ready" && folderId && !current) setFolderId(null);
  }, [status, folderId, current]);
  const path = current ? pathOf(nodes, current.id) : [];
  const items = childrenOf(nodes, folderId, exam);
  // Search: every university, degree and year (or just this course).
  function loadLibrary(force = false) {
    if (!force && library.nodes && Date.now() - library.at < ALL_TTL) return;
    setLibrary((l) => ({ ...l, status: "loading" }));
    loadAllNodes()
      .then((list) => setLibrary({ nodes: list, at: Date.now(), status: "ready" }))
      .catch(() => setLibrary((l) => ({ ...l, status: "error" })));
  }
  // Anything the admin changes here shows in the next search.
  useEffect(() => {
    setLibrary((l) => (l.nodes ? { ...l, at: 0 } : l));
  }, [nodes]);
  const pool = searchIn === "all" ? library.nodes || [] : nodes;
  const found = useMemo(
    () =>
      smartSearch(pool, searched, {
        filter: exam,
        course: choice,
        visible: (n, f) => visibleIn(pool, n, f),
      }),
    [pool, searched, exam, choice],
  );
  const results = found.results;
  const unindexed = admin && library.nodes ? library.nodes.filter((n) => n.kind === "file" && !n.keywords).length : 0;
  const sameCourse = (n) =>
    n.university === choice.university && n.degree === choice.degree && String(n.year) === String(choice.year);
  const courseOf = (n) => `${n.university} · ${n.degree} · Year ${n.year}`;
  const resultLine = (node, p) =>
    [
      !sameCourse(node) && courseOf(node),
      p.length > 1 ? p.slice(0, -1).map((x) => x.name).join(" › ") : node.kind === "subject" ? "Subject" : null,
    ]
      .filter(Boolean)
      .join(" — ");
  function runSearch(q) {
    setSearched(q);
    if (q && searchIn === "all") loadLibrary();
  }
  const counts = (node) => {
    const inside = descendants(nodes, node.id).slice(1);
    return {
      folders: inside.filter((n) => n.kind === "folder").length,
      files: inside.filter((n) => n.kind === "file").length,
    };
  };
  const where = `${choice.university} · ${choice.degree} · Year ${choice.year}`;

  // ---- Admin actions -----------------------------------------------------------
  async function addNode(name) {
    const clean = (name ?? newName).trim();
    if (!clean) return;
    try {
      const node = await createNode({
        scope: choice,
        parentId: folderId,
        kind: folderId ? "folder" : "subject",
        name: clean,
        exam: newExam,
      });
      setNodes((n) => [...n, node]);
      setNewName("");
      notify(`${folderId ? "Folder" : "Subject"} "${clean}" added.`);
    } catch (e) {
      notify(e.message || "Could not add it. Check that you are signed in as the admin.");
    }
  }
  async function rename(node) {
    const name = window.prompt(`Rename "${node.name}" to:`, node.name)?.trim();
    if (!name || name === node.name) return;
    try {
      await updateNode(node.id, { name });
      setNodes((all) => all.map((n) => (n.id === node.id ? { ...n, name } : n)));
    } catch (e) {
      notify(e.message || "Could not rename it.");
    }
  }
  async function changeExam(node, value) {
    try {
      await updateNode(node.id, { exam: value });
      setNodes((all) => all.map((n) => (n.id === node.id ? { ...n, exam: value } : n)));
    } catch (e) {
      notify(e.message || "Could not change it.");
    }
  }
  async function setIcon(node, icon) {
    setIconFor(null);
    try {
      await updateNode(node.id, { icon: icon || null });
      setNodes((all) => all.map((n) => (n.id === node.id ? { ...n, icon: icon || null } : n)));
    } catch (e) {
      notify(e.message || "Could not change the icon.");
    }
  }
  async function remove(node) {
    const { folders, files } = counts(node);
    const inside = folders + files ? ` and everything in it (${plural(folders, "folder")}, ${plural(files, "file")})` : "";
    if (!window.confirm(`Delete "${node.name}"${inside}? Students will no longer see it.`)) return;
    try {
      const gone = new Set(await deleteNodes(nodes, node.id));
      setNodes((all) => all.filter((n) => !gone.has(n.id)));
      if (gone.has(folderId)) setFolderId(node.parentId);
      notify(`"${node.name}" deleted.`);
    } catch (e) {
      notify(e.message || "Could not delete it.");
    }
  }
  async function uploadFiles(list) {
    const files = Array.from(list || []);
    if (fileInput.current) fileInput.current.value = "";
    if (!files.length || !folderId) return;
    const parentId = folderId,
      scope = { ...choice },
      examTag = newExam;
    const queue = files.map((file) => ({ id: crypto.randomUUID(), name: file.name, file, status: "waiting", message: "Waiting…" }));
    setUploads((u) => [...u.filter((x) => x.status !== "done"), ...queue]);
    const set = (id, patch) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    for (const item of queue) {
      try {
        validateFile(item.file);
        set(item.id, { status: "reading", message: "Reading pages…" });
        const read = await readDocument(item.file, {
          images: true,
          onProgress: ({ stage, done, total }) =>
            set(item.id, {
              message: stage === "ocr" ? `OCR page ${Math.min(done + 1, total)} of ${total}…` : `Reading page ${done} of ${total}…`,
            }),
        });
        const pages = Array.isArray(read) ? read : read.pages;
        const images = (!Array.isArray(read) && read.images) || [];
        set(item.id, { status: "saving", message: "Saving for everyone…" });
        const node = await saveUniFile({ scope, parentId, exam: examTag, file: item.file, pages, images });
        setNodes((n) => [...n, node]);
        set(item.id, {
          status: "done",
          message: `${plural(pages.length, "page")}${images.length ? ` · ${plural(images.length, "figure")}` : ""}${node.hasOriginal ? "" : " · original too large to keep (over 15 MB)"}`,
        });
      } catch (e) {
        set(item.id, { status: "error", message: e.message || "Could not upload this file." });
      }
    }
  }

  // ---- Cut, copy and paste ---------------------------------------------------------
  function clipTo(node, mode) {
    setClip({ mode, node, from: { university: node.university, degree: node.degree, year: String(node.year) } });
    notify(
      `${mode === "move" ? "Cut" : "Copied"} “${node.name}”. Go to any course or folder and press Paste here.`,
    );
  }
  const pasteHere = { scope: choice, parentId: folderId || null };
  const pasteProblem = !clip
    ? null
    : searched
      ? "Close the search and open a course or folder to paste."
      : clip.node.kind === "file" && !folderId
        ? "Open a subject or folder to paste a file into it."
        : clip.mode === "move"
          ? transferProblem(
              sameCourse(clip.node) ? nodes : [clip.node],
              clip.node,
              pasteHere,
            )
          : null;
  async function paste() {
    if (!clip || pasteProblem) return;
    setPasting(clip.mode === "move" ? "Moving…" : "Copying…");
    try {
      // The source course as it is now (it may have changed since the cut).
      const source = sameCourse(clip.node) ? nodes : await loadNodes(clip.from);
      if (!source.some((n) => n.id === clip.node.id))
        throw new Error(`“${clip.node.name}” is no longer there. Cut or copy it again.`);
      const placeName = current ? current.name : "the top level";
      if (clip.mode === "move") {
        const moved = await moveNode(source, clip.node.id, pasteHere);
        const ids = new Set(moved.map((n) => n.id));
        setNodes((all) => [...all.filter((n) => !ids.has(n.id)), ...moved]);
        notify(`Moved “${clip.node.name}” to ${where} › ${placeName}.`);
        setClip(null);
      } else {
        const copies = await copyNode(source, clip.node.id, pasteHere, (n, total) =>
          setPasting(`Copying ${n} of ${total}…`),
        );
        setNodes((all) => [...all, ...copies]);
        notify(`Pasted a copy of “${clip.node.name}” in ${where} › ${placeName}.`);
      }
    } catch (e) {
      notify(e.message || "Could not paste here.");
    } finally {
      setPasting("");
    }
  }

  // ---- Opening -------------------------------------------------------------------
  async function open(node) {
    const other = node.university && !sameCourse(node);
    if (node.kind !== "file") {
      if (other) {
        // A folder in another course: switch to it, then open the folder.
        pendingFolder.current = node.id;
        setChoice({ university: node.university, degree: node.degree, year: String(node.year) });
      } else setFolderId(node.id);
      setSearched("");
      return;
    }
    setOpening(node.id);
    try {
      await onOpenFile(node, pathOf(other ? library.nodes || [] : nodes, node.id));
    } catch (e) {
      notify(e.message || "Could not open this file.");
    } finally {
      setOpening(null);
    }
  }
  /** Downloads the original file with its own name. */
  async function openOriginal(node) {
    try {
      downloadBlob(await loadOriginal(node), node.fileName || node.name);
    } catch (e) {
      notify(e.message || "Could not download the original file.");
    }
  }


  const card = (node, extra) => {
    const isFile = node.kind === "file";
    // Admin tools act on the course shown; results from others are read-only.
    const editable = admin && (!node.university || sameCourse(node));
    const c = isFile ? null : counts(node);
    return (
      <li
        className={`uni-card ${node.kind}` + (clip?.mode === "move" && clip.node.id === node.id ? " is-cut" : "")}
        key={node.id}
      >
        <button
          className="uni-card-open"
          onClick={() => open(node)}
          disabled={opening === node.id}
          aria-label={`Open ${node.name}`}
        >
          <span className="uni-card-icon" aria-hidden="true">
            <NodeIcon node={node} />
          </span>
          <span className="uni-card-text">
            <strong>{node.name}</strong>
            <small>
              {extra ||
                (isFile
                  ? [node.pageCount && plural(node.pageCount, "page"), node.imageCount && plural(node.imageCount, "figure")]
                      .filter(Boolean)
                      .join(" · ") || "File"
                  : c.folders + c.files
                    ? [c.folders && plural(c.folders, "folder"), c.files && plural(c.files, "file")].filter(Boolean).join(" · ")
                    : "Empty")}
            </small>
          </span>
          <ExamBadge exam={node.exam} />
          {opening === node.id ? <span className="fine">Opening…</span> : <ChevronRight size={16} aria-hidden="true" />}
        </button>
        {isFile || editable ? (
          <div className="uni-card-actions">
            {isFile && (
              <>
                <button className="text-button" onClick={() => setViewing(node)} aria-label={`View ${node.name}`}>
                  <Eye size={14} /> View
                </button>
                {node.hasOriginal && (
                  <button className="text-button" onClick={() => openOriginal(node)} aria-label={`Download ${node.name}`}>
                    <Download size={14} /> Download
                  </button>
                )}
              </>
            )}
            {editable && (
              <>
                <button
                  className={"text-button clip-button" + (clip?.node.id === node.id && clip.mode === "move" ? " active" : "")}
                  aria-label={`Cut ${node.name}`}
                  title="Cut (transfer): paste it in another course or folder"
                  onClick={() => clipTo(node, "move")}
                >
                  <Scissors size={14} /> Cut
                </button>
                <button
                  className={"text-button clip-button" + (clip?.node.id === node.id && clip.mode === "copy" ? " active" : "")}
                  aria-label={`Copy ${node.name}`}
                  title="Copy: paste copies anywhere"
                  onClick={() => clipTo(node, "copy")}
                >
                  <Copy size={14} /> Copy
                </button>
                <select
                  aria-label={`Exam for ${node.name}`}
                  value={node.exam || "both"}
                  onChange={(e) => changeExam(node, e.target.value)}
                >
                  {Object.entries(EXAMS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {!isFile && (
                  <button
                    className="icon-button"
                    aria-label={`Change icon for ${node.name}`}
                    aria-expanded={iconFor === node.id}
                    onClick={() => setIconFor((id) => (id === node.id ? null : node.id))}
                  >
                    <Palette size={14} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Transfer or copy ${node.name}`}
                  title="Send to another course or folder…"
                  onClick={() => setTransfer({ node })}
                >
                  <ArrowRightLeft size={14} />
                </button>
                <button className="icon-button" aria-label={`Rename ${node.name}`} onClick={() => rename(node)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button" aria-label={`Delete ${node.name}`} onClick={() => remove(node)}>
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ) : null}
        {editable && iconFor === node.id && (
          <IconPicker node={node} onPick={(icon) => setIcon(node, icon)} onClose={() => setIconFor(null)} />
        )}
      </li>
    );
  };

  return (
    <div hidden={!active}>
      <section className="page-title">
        <div className="eyebrow">UNIVERSITY SPECIFIC</div>
        <h1>Your university library.</h1>
        <p>Subjects, unit-wise material and important questions for your course. Open any file to study it with Gemini.</p>
      </section>

      <section className="panel uni-select" aria-label="Choose your course">
        <div className="uni-select-fields">
          <label>
            University
            <select value={choice.university} onChange={(e) => setChoice((c) => ({ ...c, university: e.target.value }))}>
              {options.universities.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label>
            Degree
            <select value={choice.degree} onChange={(e) => setChoice((c) => ({ ...c, degree: e.target.value }))}>
              {options.degrees.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select value={choice.year} onChange={(e) => setChoice((c) => ({ ...c, year: e.target.value }))}>
              {options.years.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="uni-select-foot">
          <div className="segmented" role="group" aria-label="Exam">
            {FILTERS.map(([v, l]) => (
              <button key={v} aria-pressed={exam === v} className={exam === v ? "active" : ""} onClick={() => setExam(v)}>
                {l}
              </button>
            ))}
          </div>
          {admin && (
            <span className="uni-select-admin">
              <button className="text-button" aria-expanded={moving} onClick={() => setMoving((v) => !v)}>
                <ArrowRightLeft size={15} /> Transfer materials
              </button>
              <button className="text-button" onClick={() => setTransfer({ course: true })} disabled={status !== "ready"}>
                <ArrowRightLeft size={15} /> Swap or move this year
              </button>
              <button className="text-button" onClick={() => setEditingOptions((v) => !v)}>
                <Settings2 size={15} /> Edit options
              </button>
            </span>
          )}
        </div>
      </section>

      {viewing && <DocumentViewer node={viewing} notify={notify} onClose={() => setViewing(null)} />}

      {admin && moving && (
        <section className="panel uni-options" aria-label="Transfer materials">
          <div className="uni-options-head">
            <div>
              <span className="eyebrow">ADMIN · TRANSFER MATERIALS</span>
              <h3>Cut and paste, or copy and paste, between courses</h3>
            </div>
            <button className="icon-button" aria-label="Close transfer materials" onClick={() => setMoving(false)}>
              <X size={16} />
            </button>
          </div>
          <MaterialTransfer notify={notify} initialFrom={choice} onChanged={reload} />
        </section>
      )}

      {admin && transfer && (
        <TransferDialog
          node={transfer.node || null}
          nodes={nodes}
          options={options}
          from={choice}
          notify={notify}
          onClose={() => setTransfer(null)}
          onDone={({ moved, copies, sameScope, reload: again }) => {
            setTransfer(null);
            if (again) return reload();
            if (moved) {
              const ids = new Set(moved.map((n) => n.id));
              setNodes((all) => (sameScope ? all.map((n) => moved.find((m) => m.id === n.id) || n) : all.filter((n) => !ids.has(n.id))));
              if (!sameScope && ids.has(folderId)) setFolderId(null);
            }
            if (copies && sameScope) setNodes((all) => [...all, ...copies]);
          }}
        />
      )}

      {admin && editingOptions && (
        <OptionsEditor
          options={options}
          onClose={() => setEditingOptions(false)}
          onSave={async (next) => {
            try {
              await saveUniOptions(next);
              setOptions(next);
              setEditingOptions(false);
              notify("Options saved. Students see them right away.");
            } catch (e) {
              notify(e.message || "Could not save the options.");
            }
          }}
        />
      )}

      <form
        className="uni-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query.trim());
        }}
      >
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="Search subjects, folders and files"
          value={query}
          placeholder="Search every course: subjects, units, topics…  e.g. dbms unit 2"
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) setSearched("");
          }}
        />
        {searched && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setSearched("");
            }}
          >
            <X size={15} />
          </button>
        )}
        <button className="primary">Search</button>
      </form>
      <div className="segmented uni-search-scope" role="group" aria-label="Search in">
        {[
          ["all", "All courses"],
          ["course", "This course"],
        ].map(([v, l]) => (
          <button
            key={v}
            aria-pressed={searchIn === v}
            className={searchIn === v ? "active" : ""}
            onClick={() => {
              setSearchIn(v);
              if (v === "all" && searched) loadLibrary();
            }}
          >
            {l}
          </button>
        ))}
      </div>

      <section
        className={"panel uni-browser" + (dragging ? " dragging" : "")}
        aria-label={where}
        onDragEnter={(e) => {
          if (!admin || !Array.from(e.dataTransfer?.types || []).includes("Files")) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (admin && Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          if (--dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(e) => {
          if (!admin) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!folderId || searched)
            return notify("Open a subject or folder first, then drop the files into it.");
          uploadFiles(e.dataTransfer.files);
        }}
      >
        {dragging && (
          <div className="uni-drop" aria-hidden="true">
            <UploadCloud size={30} />
            <strong>
              {folderId && !searched ? `Drop to upload to “${current?.name}”` : "Open a subject or folder to upload"}
            </strong>
            <small>{UPLOAD_HINT}</small>
          </div>
        )}
        {admin && clip && (
          <div className={`clip-bar ${clip.mode}`} role="region" aria-label="Clipboard">
            <span className="clip-what">
              {clip.mode === "move" ? <Scissors size={15} /> : <Copy size={15} />}
              <span>
                <strong>
                  {clip.mode === "move" ? "Cut" : "Copied"} “{clip.node.name}”
                </strong>
                <small>
                  from {clip.from.university} · {clip.from.degree} · Year {clip.from.year}
                  {pasteProblem ? ` · ${pasteProblem}` : ` · paste into ${current ? `“${current.name}”` : `the top level of Year ${choice.year}`}`}
                </small>
              </span>
            </span>
            <span className="clip-actions">
              <button className="primary" disabled={Boolean(pasteProblem) || Boolean(pasting)} onClick={paste}>
                <ClipboardPaste size={15} /> {pasting || "Paste here"}
              </button>
              <button className="text-button" disabled={Boolean(pasting)} onClick={() => setClip(null)}>
                Cancel
              </button>
            </span>
          </div>
        )}
        {searched ? (
          <>
            <div className="uni-head">
              <div>
                <span className="eyebrow">
                  SEARCH · {searchIn === "all" ? "ALL COURSES" : where.toUpperCase()}
                </span>
                <h2>
                  {plural(results.length, "result")} for “{searched}”
                </h2>
              </div>
              {unindexed > 0 && (
                <button
                  className="text-button"
                  disabled={Boolean(indexing)}
                  onClick={async () => {
                    setIndexing("Reading files…");
                    try {
                      const n = await indexFiles(library.nodes, (done, total) => setIndexing(`Reading ${done} of ${total}…`));
                      setLibrary((l) => ({ ...l, nodes: [...l.nodes] }));
                      notify(`Search now looks inside ${plural(n, "more file")}.`);
                    } catch (e) {
                      notify(e.message || "Could not update search.");
                    } finally {
                      setIndexing("");
                    }
                  }}
                >
                  <Search size={14} /> {indexing || `Search inside ${plural(unindexed, "older file")}`}
                </button>
              )}
            </div>
            {searchIn === "all" && library.status === "loading" && !library.nodes ? (
              <Thinking label="Searching every course…" lines={2} />
            ) : searchIn === "all" && library.status === "error" && !library.nodes ? (
              <p className="uni-empty">
                Search could not load the library.{" "}
                <button className="text-button" onClick={() => loadLibrary(true)}>
                  Try again
                </button>
              </p>
            ) : (
              <>
                {results.length > 0 && (
                  <ul className="uni-grid">{results.map(({ node, path: p }) => card(node, resultLine(node, p)))}</ul>
                )}
                {found.related.length > 0 && (
                  <>
                    <h3 className="uni-related">
                      {results.length ? "Related" : "No exact match. Closest topics:"}
                    </h3>
                    <ul className="uni-grid">{found.related.map(({ node, path: p }) => card(node, resultLine(node, p)))}</ul>
                  </>
                )}
                {!results.length && !found.related.length && (
                  <p className="uni-empty">
                    Nothing matches. Try a subject (e.g. “dbms”), a unit (“unit 2”) or a topic (“normalization”).
                  </p>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div className="uni-head">
              <div>
                <nav className="uni-crumbs" aria-label="Folder path">
                  <button onClick={() => setFolderId(null)} aria-current={folderId ? undefined : "page"}>
                    Subjects
                  </button>
                  {path.map((n) => (
                    <React.Fragment key={n.id}>
                      <ChevronRight size={14} aria-hidden="true" />
                      <button onClick={() => setFolderId(n.id)} aria-current={n.id === folderId ? "page" : undefined}>
                        {n.name}
                      </button>
                    </React.Fragment>
                  ))}
                </nav>
                <h2>{current ? current.name : where}</h2>
              </div>
            </div>

            {admin && (
              <div className="uni-admin" aria-label="Admin tools">
                <form
                  className="uni-admin-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addNode();
                  }}
                >
                  <input
                    aria-label={folderId ? "New folder name" : "New subject name"}
                    value={newName}
                    placeholder={folderId ? "New folder, e.g. Unit 1" : "New subject, e.g. DBMS"}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <select aria-label="Exam for new items" value={newExam} onChange={(e) => setNewExam(e.target.value)}>
                    {Object.entries(EXAMS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <button className="secondary" disabled={!newName.trim()}>
                    <FolderPlus size={15} /> {folderId ? "Add folder" : "Add subject"}
                  </button>
                  {folderId && (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        warmUpReader();
                        fileInput.current?.click();
                      }}
                    >
                      <Upload size={15} /> Upload files
                    </button>
                  )}
                </form>
                {folderId && (
                  <p className="fine uni-drop-hint">
                    <UploadCloud size={14} /> Drag and drop files anywhere on this panel, or use Upload files. {UPLOAD_HINT}, up to 25 MB each.
                  </p>
                )}
                {folderId && (
                  <div className="chips" aria-label="Quick folders">
                    {FOLDER_SUGGESTIONS.filter((s) => !items.some((n) => n.name.toLocaleLowerCase() === s.toLocaleLowerCase())).map((s) => (
                      <button key={s} className="chip" onClick={() => addNode(s)}>
                        <Plus size={12} /> {s}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  multiple
                  accept={UPLOAD_ACCEPT}
                  aria-label="Choose files to upload"
                  onChange={(e) => uploadFiles(e.target.files)}
                />
                {uploads.length > 0 && (
                  <ul className="uni-uploads" aria-label="Uploads">
                    {uploads.map((u) => (
                      <li key={u.id} className={u.status}>
                        <strong>{u.name}</strong>
                        <small>{u.message}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {status === "loading" ? (
              <Thinking label="Loading your course…" lines={3} />
            ) : status === "error" ? (
              <p className="uni-empty">
                The library could not be loaded. Check your connection and{" "}
                <button className="text-button" onClick={reload}>
                  try again
                </button>
                .
              </p>
            ) : items.length ? (
              <ul className="uni-grid">{items.map((n) => card(n))}</ul>
            ) : (
              <p className="uni-empty">
                {folderId
                  ? admin
                    ? "This folder is empty. Add folders like Unit 1 or upload files."
                    : "Nothing here yet."
                  : admin
                    ? "No subjects yet for this course. Add the first one above."
                    : "No subjects have been added for this course yet. Check back soon."}
                {exam !== "all" && " Showing " + EXAMS[exam] + " material only."}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
