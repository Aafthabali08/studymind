import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Thinking from "./Thinking";
import { downloadBlob, readDocument, warmUpReader } from "./documents";
import { validateFile } from "./logic";
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
  searchNodes,
  updateNode,
} from "./university";

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
  const [editingOptions, setEditingOptions] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExam, setNewExam] = useState("both");
  const [uploads, setUploads] = useState([]);
  const [opening, setOpening] = useState(null);
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
    reload();
  }, [active, choice.university, choice.degree, choice.year]);

  const current = nodes.find((n) => n.id === folderId) || null;
  const path = current ? pathOf(nodes, current.id) : [];
  const items = childrenOf(nodes, folderId, exam);
  const results = useMemo(() => searchNodes(nodes, searched, exam), [nodes, searched, exam]);
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

  // ---- Opening -------------------------------------------------------------------
  async function open(node) {
    if (node.kind !== "file") {
      setFolderId(node.id);
      setSearched("");
      return;
    }
    setOpening(node.id);
    try {
      await onOpenFile(node, pathOf(nodes, node.id));
    } catch (e) {
      notify(e.message || "Could not open this file.");
    } finally {
      setOpening(null);
    }
  }
  async function openOriginal(node) {
    // Opened before the download finishes, so the browser allows the tab.
    const tab = window.open("", "_blank");
    try {
      const blob = await loadOriginal(node);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else downloadBlob(blob, node.fileName || `${node.name}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      notify(e.message || "Could not open the original file.");
    }
  }

  const card = (node, extra) => {
    const isFile = node.kind === "file";
    const c = isFile ? null : counts(node);
    const Icon = isFile ? FileText : node.kind === "subject" ? BookMarked : Folder;
    return (
      <li className={`uni-card ${node.kind}`} key={node.id}>
        <button
          className="uni-card-open"
          onClick={() => open(node)}
          disabled={opening === node.id}
          aria-label={`Open ${node.name}`}
        >
          <span className="uni-card-icon" aria-hidden="true">
            <Icon size={20} />
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
        {(isFile && node.hasOriginal) || admin ? (
          <div className="uni-card-actions">
            {isFile && node.hasOriginal && (
              <button className="text-button" onClick={() => openOriginal(node)} aria-label={`Open original ${node.name}`}>
                <ExternalLink size={14} /> Original
              </button>
            )}
            {admin && (
              <>
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
            <button className="text-button" onClick={() => setEditingOptions((v) => !v)}>
              <Settings2 size={15} /> Edit options
            </button>
          )}
        </div>
      </section>

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
          setSearched(query.trim());
        }}
      >
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="Search subjects, folders and files"
          value={query}
          placeholder="Search subjects, units, files…  e.g. DBMS unit 2"
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

      <section className="panel uni-browser" aria-label={where}>
        {searched ? (
          <>
            <div className="uni-head">
              <div>
                <span className="eyebrow">SEARCH · {where.toUpperCase()}</span>
                <h2>
                  {plural(results.length, "result")} for “{searched}”
                </h2>
              </div>
            </div>
            {results.length ? (
              <ul className="uni-grid">
                {results.map(({ node, path: p }) =>
                  card(node, p.length > 1 ? p.slice(0, -1).map((x) => x.name).join(" › ") : node.kind === "subject" ? "Subject" : undefined),
                )}
              </ul>
            ) : (
              <p className="uni-empty">Nothing matches. Try a subject name or “unit 1”.</p>
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
                  accept=".pdf,.txt"
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
