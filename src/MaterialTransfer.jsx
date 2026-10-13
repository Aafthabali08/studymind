import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, ClipboardPaste, Copy, FileText, Folder, BookMarked, Scissors } from "lucide-react";
import Thinking from "./Thinking";
import {
  DEFAULT_OPTIONS,
  childrenOf,
  copyNode,
  descendants,
  loadNodes,
  loadUniOptions,
  moveNode,
  transferProblem,
} from "./university";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const scopeText = (s) => `${s.university} · ${s.degree} · Year ${s.year}`;
const same = (a, b) => a.university === b.university && a.degree === b.degree && String(a.year) === String(b.year);

/** University / degree / year pickers. */
function CoursePicker({ label, options, value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="mt-course" role="group" aria-label={label}>
      <label>
        University
        <select value={value.university} onChange={set("university")}>
          {options.universities.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
      <label>
        Degree
        <select value={value.degree} onChange={set("degree")}>
          {options.degrees.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <label>
        Year
        <select value={value.year} onChange={set("year")}>
          {options.years.map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const KindIcon = ({ node }) =>
  node.kind === "file" ? <FileText size={15} /> : node.kind === "subject" ? <BookMarked size={15} /> : <Folder size={15} />;

/** A course's subjects → folders → files, folders open on click. */
function Tree({ nodes, render, open, setOpen, parentId = null, depth = 0, filesToo = true }) {
  return (
    <ul className="mt-tree" role={depth ? "group" : "tree"}>
      {childrenOf(nodes, parentId)
        .filter((n) => filesToo || n.kind !== "file")
        .map((n) => {
          const kids = childrenOf(nodes, n.id).filter((k) => filesToo || k.kind !== "file");
          const isOpen = open.has(n.id);
          return (
            <li key={n.id} role="treeitem" aria-expanded={kids.length ? isOpen : undefined}>
              <div className="mt-row" style={{ paddingLeft: depth * 18 }}>
                {kids.length ? (
                  <button
                    className="mt-toggle"
                    aria-label={`${isOpen ? "Close" : "Open"} ${n.name}`}
                    onClick={() =>
                      setOpen((s) => {
                        const next = new Set(s);
                        next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                        return next;
                      })
                    }
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : (
                  <span className="mt-toggle" />
                )}
                {render(n)}
              </div>
              {kids.length > 0 && isOpen && (
                <Tree nodes={nodes} render={render} open={open} setOpen={setOpen} parentId={n.id} depth={depth + 1} filesToo={filesToo} />
              )}
            </li>
          );
        })}
    </ul>
  );
}

/**
 * Admin and supporter tool: pick a course and the subjects, units, folders and files to
 * move; choose Transfer (cut and paste) or Copy (copy and paste); pick the
 * course and the subject or folder to put them in; paste.
 */
export default function MaterialTransfer({ notify, initialFrom, onChanged }) {
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const first = {
    university: DEFAULT_OPTIONS.universities[0],
    degree: DEFAULT_OPTIONS.degrees[0],
    year: DEFAULT_OPTIONS.years[0],
  };
  const [from, setFrom] = useState(initialFrom || first);
  const [to, setTo] = useState(() => {
    const f = initialFrom || first;
    const next = DEFAULT_OPTIONS.years[DEFAULT_OPTIONS.years.indexOf(String(f.year)) + 1];
    return { ...f, year: next || f.year };
  });
  const [source, setSource] = useState(null); // nodes of "from"
  const [target, setTarget] = useState(null); // nodes of "to"
  const [picked, setPicked] = useState(new Set());
  const [mode, setMode] = useState("move");
  const [dest, setDest] = useState(null); // parent id in "to"; null = top level
  const [openFrom, setOpenFrom] = useState(new Set());
  const [openTo, setOpenTo] = useState(new Set());
  const [busy, setBusy] = useState("");

  useEffect(() => {
    loadUniOptions()
      .then(setOptions)
      .catch(() => {});
  }, []);
  const load = (scope, set) => {
    set(null);
    loadNodes(scope)
      .then(set)
      .catch(() => set([]));
  };
  useEffect(() => {
    setPicked(new Set());
    load(from, setSource);
  }, [from.university, from.degree, from.year]);
  useEffect(() => {
    setDest(null);
    load(to, setTarget);
  }, [to.university, to.degree, to.year]);

  // Picking a subject or folder brings everything inside it.
  const covered = useMemo(() => {
    const out = new Set();
    for (const id of picked) descendants(source || [], id).forEach((n) => out.add(n.id));
    return out;
  }, [picked, source]);
  const roots = [...picked].filter((id) => {
    const n = (source || []).find((x) => x.id === id);
    for (let p = n && source.find((x) => x.id === n.parentId); p; p = source.find((x) => x.id === p.parentId))
      if (picked.has(p.id)) return false;
    return Boolean(n);
  });
  const items = roots.map((id) => source.find((n) => n.id === id));
  const kinds = [...covered].map((id) => source.find((n) => n.id === id)?.kind);
  const contents = [
    ["subject", kinds.filter((k) => k === "subject").length],
    ["folder", kinds.filter((k) => k === "folder").length],
    ["file", kinds.filter((k) => k === "file").length],
  ]
    .filter(([, n]) => n)
    .map(([w, n]) => plural(n, w))
    .join(", ");
  const toggle = (n) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(n.id)) next.delete(n.id);
      else {
        next.add(n.id);
        // Children are now included through their parent.
        descendants(source, n.id)
          .slice(1)
          .forEach((d) => next.delete(d.id));
      }
      return next;
    });
  const allPicked = source?.length && childrenOf(source, null).every((n) => picked.has(n.id));

  // What stops the paste (shown, and the button disabled).
  const destName = dest ? target?.find((n) => n.id === dest)?.name : "the top level";
  const problem = !items.length
    ? "Pick what to transfer on the left."
    : target == null
      ? "Loading the destination…"
      : items.some((n) => n.kind === "file") && !dest
        ? "Files need a subject or folder: pick one on the right."
        : mode === "move"
          ? items.map((n) => transferProblem(source, n, { scope: to, parentId: dest })).find(Boolean) || null
          : same(from, to) && dest && covered.has(dest)
            ? "Pick a destination outside what you're copying."
            : null;

  async function run() {
    const where = `${scopeText(to)} › ${destName}`;
    if (mode === "move" && !window.confirm(`Transfer ${plural(items.length, "item")} (${contents}) to ${where}? They will leave ${scopeText(from)}.`))
      return;
    try {
      let done = 0;
      for (const n of items) {
        setBusy(`${mode === "move" ? "Transferring" : "Copying"} ${++done} of ${items.length}…`);
        const place = { scope: to, parentId: dest, parentName: dest ? destName : "" };
        if (mode === "move") await moveNode(source, n.id, place);
        else await copyNode(source, n.id, place);
      }
      notify(`${mode === "move" ? "Transferred" : "Copied"} ${plural(items.length, "item")} to ${where}.`);
      setPicked(new Set());
      load(from, setSource);
      load(to, setTarget);
      onChanged?.();
    } catch (e) {
      notify(
        e?.code === "permission-denied"
          ? "You don't have permission to change the library. Ask the admin if you should be a supporter."
          : e.message || "The transfer stopped. Check what moved and try again.",
      );
      load(from, setSource);
      load(to, setTarget);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="material-transfer">
      <div className="mt-grid">
        <section className="mt-side" aria-label="From">
          <span className="eyebrow">1 · FROM</span>
          <CoursePicker label="From course" options={options} value={from} onChange={setFrom} />
          <div className="mt-list">
            {source == null ? (
              <Thinking label="Loading materials…" lines={2} />
            ) : !source.length ? (
              <p className="fine">No materials in {scopeText(from)}.</p>
            ) : (
              <>
                <label className="mt-all">
                  <input
                    type="checkbox"
                    checked={Boolean(allPicked)}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(childrenOf(source, null).map((n) => n.id)))}
                  />
                  Select everything in Year {from.year}
                </label>
                <Tree
                  nodes={source}
                  open={openFrom}
                  setOpen={setOpenFrom}
                  render={(n) => {
                    const inherited = covered.has(n.id) && !picked.has(n.id);
                    return (
                      <label className={"mt-pick" + (covered.has(n.id) ? " on" : "")}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${n.name}`}
                          checked={covered.has(n.id)}
                          disabled={inherited || Boolean(busy)}
                          onChange={() => toggle(n)}
                        />
                        <KindIcon node={n} /> <span>{n.name}</span>
                        {n.kind === "file" && n.pageCount ? <small>{plural(n.pageCount, "page")}</small> : null}
                      </label>
                    );
                  }}
                />
              </>
            )}
          </div>
        </section>

        <section className="mt-middle" aria-label="Action">
          <span className="eyebrow">2 · HOW</span>
          <div className="segmented mt-mode" role="group" aria-label="Transfer or copy">
            <button aria-pressed={mode === "move"} className={mode === "move" ? "active" : ""} onClick={() => setMode("move")}>
              <Scissors size={14} /> Transfer
            </button>
            <button aria-pressed={mode === "copy"} className={mode === "copy" ? "active" : ""} onClick={() => setMode("copy")}>
              <Copy size={14} /> Copy
            </button>
          </div>
          <p className="fine">
            {mode === "move"
              ? "Cut and paste: they move to the destination and leave here."
              : "Copy and paste: copies go to the destination; these stay."}
          </p>
          <ArrowRight size={22} className="mt-arrow" aria-hidden="true" />
        </section>

        <section className="mt-side" aria-label="To">
          <span className="eyebrow">3 · TO</span>
          <CoursePicker label="To course" options={options} value={to} onChange={setTo} />
          <div className="mt-list">
            {target == null ? (
              <Thinking label="Loading destination…" lines={2} />
            ) : (
              <div role="radiogroup" aria-label="Put them in">
                <label className={"mt-pick" + (!dest ? " on" : "")}>
                  <input type="radio" name="mt-dest" checked={!dest} onChange={() => setDest(null)} />
                  <BookMarked size={15} /> <span>Top level (as subjects)</span>
                </label>
                <Tree
                  nodes={target}
                  open={openTo}
                  setOpen={setOpenTo}
                  filesToo={false}
                  render={(n) => (
                    <label className={"mt-pick" + (dest === n.id ? " on" : "")}>
                      <input
                        type="radio"
                        name="mt-dest"
                        aria-label={`Put them in ${n.name}`}
                        checked={dest === n.id}
                        disabled={same(from, to) && covered.has(n.id)}
                        onChange={() => setDest(n.id)}
                      />
                      <KindIcon node={n} /> <span>{n.name}</span>
                    </label>
                  )}
                />
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="mt-foot">
        <p className="mt-summary" role="status">
          {problem ||
            `${mode === "move" ? "Transfer" : "Copy"} ${plural(items.length, "item")} (${contents}) from ${scopeText(from)} to ${scopeText(to)} › ${destName}.`}
        </p>
        <button className="primary" disabled={Boolean(problem) || Boolean(busy)} onClick={run}>
          {mode === "move" ? <Scissors size={16} /> : <ClipboardPaste size={16} />}{" "}
          {busy || (mode === "move" ? "Transfer here" : "Paste copies here")}
        </button>
      </div>
    </div>
  );
}
