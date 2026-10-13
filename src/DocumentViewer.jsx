import React, { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import Thinking from "./Thinking";
import { downloadBlob } from "./documents";
import { fileExtension } from "./logic";
import { loadOriginal, loadUniFile } from "./university";
import { phoneDevice } from "./ai/speech";

/**
 * PDF pages drawn with pdf.js. Phones get this instead of the browser's PDF
 * viewer, which Android Chrome doesn't show inside a page and iPhone Safari
 * often shows only page 1 of. Pages are drawn as they scroll into view.
 */
function PdfPages({ blob, title }) {
  const host = useRef(null);
  const pdfRef = useRef(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  // 1. Load the PDF.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { loadPdfjs } = await import("./documents");
        const pdfjs = await loadPdfjs();
        const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false }).promise;
        if (!live) return void pdf.destroy();
        pdfRef.current = pdf;
        setCount(pdf.numPages);
      } catch (e) {
        if (live) setError(e.message || "This PDF could not be shown.");
      }
    })();
    return () => {
      live = false;
      pdfRef.current?.destroy?.();
      pdfRef.current = null;
    };
  }, [blob]);
  // 2. Once the page slots are on screen, draw them: the first two now, the
  //    rest as they scroll into view.
  useEffect(() => {
    const pdf = pdfRef.current;
    if (!count || !pdf || !host.current) return;
    let live = true;
    const draw = async (slot) => {
      if (slot.dataset.drawn) return;
      slot.dataset.drawn = "1";
      const n = Number(slot.dataset.page);
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = ((slot.clientWidth || 360) / base.width) * Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      canvas.setAttribute("aria-label", `${title}, page ${n}`);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      if (live) slot.replaceChildren(canvas);
      page.cleanup();
    };
    const report = (e) => console.warn("Could not draw a PDF page:", e);
    const slots = [...host.current.querySelectorAll("[data-page]")];
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && draw(e.target).catch(report)),
      { root: host.current, rootMargin: "600px 0px" },
    );
    slots.forEach((el) => observer.observe(el));
    (async () => {
      for (const slot of slots.slice(0, 2)) await draw(slot).catch(report);
    })();
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [count, title]);
  if (error) return <p className="dv-message">{error}</p>;
  return (
    <div className="dv-scroll dv-pdf" ref={host}>
      {!count && <Thinking label="Drawing pages…" lines={2} />}
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="dv-pdf-page" data-page={i + 1}>
          <span className="fine">Page {i + 1}</span>
        </div>
      ))}
    </div>
  );
}

// ---- How each kind of file is shown ------------------------------------------------
/** "pdf" | "image" | "text" | "word" | "slides" | "pages" (extracted text). */
export function viewKind(fileName, mime = "") {
  const ext = fileExtension(fileName);
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (/^(png|jpe?g|webp|gif)$/.test(ext) || mime.startsWith("image/")) return "image";
  if (/^(txt|md|csv)$/.test(ext) || mime.startsWith("text/")) return "text";
  if (ext === "docx") return "word";
  if (ext === "pptx" || ext === "ppt") return "slides";
  return "pages"; // .doc and anything else: the text StudyMind read from it
}

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Keeps document HTML (from Word) safe to show: no scripts, handlers or script links. */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta, form").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src") && !/^(https?:|mailto:|#|data:image\/)/.test(value))
        el.removeAttribute(attr.name);
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  });
  return doc.body.innerHTML;
}

/** The pages (or slides) StudyMind read from a file, as HTML. */
export function pagesHtml(pages, images = [], label = "Page") {
  return pages
    .map(
      (text, i) =>
        `<section class="dv-page"><h2>${label} ${i + 1}</h2>${String(text || "")
          .split(/\n{2,}/)
          .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
          .join("")}${images
          .filter((img) => img.page === i && img.dataUrl)
          .map((img) => `<figure><img src="${escapeHtml(img.dataUrl)}" alt=""></figure>`)
          .join("")}</section>`,
    )
    .join("");
}

/**
 * A page of its own for "Open in new tab": the file with the same toolbar
 * (Full screen, Download, Close).
 */
export function standalonePage({ title, kind, url, html, text, fileName }) {
  const body =
    kind === "pdf"
      ? `<iframe class="dv-frame" src="${escapeHtml(url)}" title="${escapeHtml(title)}"></iframe>`
      : kind === "image"
        ? `<div class="dv-scroll dv-center"><img class="dv-image" src="${escapeHtml(url)}" alt="${escapeHtml(title)}"></div>`
        : kind === "text"
          ? `<div class="dv-scroll"><pre class="dv-text">${escapeHtml(text)}</pre></div>`
          : `<div class="dv-scroll"><article class="dv-doc">${html}</article></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#1b1c20;color:#1e2026}
.dv-bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:10px 16px;background:#111216;color:#f2f2f2}
.dv-bar strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
.dv-bar button,.dv-bar a{border:1px solid #3a3b42;background:#1f2026;color:#f2f2f2;border-radius:10px;padding:7px 12px;font:inherit;font-size:13px;cursor:pointer;text-decoration:none}
.dv-bar button:hover,.dv-bar a:hover{background:#2c2d35}
.dv-main{height:calc(100% - 54px);padding:16px}
.dv-frame{width:100%;height:100%;border:0;border-radius:12px;background:#fff}
.dv-scroll{height:100%;overflow:auto;border-radius:12px;background:#fff;padding:28px}
.dv-center{display:grid;place-items:center;background:#25262c}
.dv-image{max-width:100%;max-height:100%;object-fit:contain}
.dv-text{white-space:pre-wrap;font:14px/1.6 ui-monospace,Menlo,Consolas,monospace;margin:0}
.dv-doc{max-width:860px;margin:0 auto;line-height:1.65;font-size:16px}
.dv-doc img{max-width:100%;height:auto}.dv-doc table{border-collapse:collapse}.dv-doc td,.dv-doc th{border:1px solid #ddd;padding:6px 8px}
.dv-page{padding:0 0 24px;margin:0 0 24px;border-bottom:1px solid #e5e5e5}.dv-page h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6e727c}
figure{margin:16px 0;text-align:center}
@media (max-width:600px){.dv-main{padding:8px}.dv-scroll{padding:16px}.dv-bar{flex-wrap:wrap}}
</style></head><body>
<div class="dv-bar"><strong>${escapeHtml(title)}</strong>
<button onclick="document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()">Full screen</button>
${url ? `<a href="${escapeHtml(url)}" download="${escapeHtml(fileName)}">Download</a>` : ""}
<button onclick="window.close()">Close</button></div>
<div class="dv-main">${body}</div></body></html>`;
}

/**
 * Shows the original of a university file inside StudyMind, with Full
 * screen, Open in new tab, Download and Close (Esc also closes).
 */
export default function DocumentViewer({ node, onClose, notify }) {
  const kind = viewKind(node.fileName, node.mime);
  const [state, setState] = useState({ status: "loading" });
  const [full, setFull] = useState(false);
  const box = useRef(null);
  const urlRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const blob = node.hasOriginal ? await loadOriginal(node) : null;
        let html = "",
          text = "";
        if (blob && kind === "text") text = await blob.text();
        else if (blob && kind === "word") {
          const mod = await import("mammoth");
          const mammoth = mod.default || mod;
          const arrayBuffer = await blob.arrayBuffer();
          const { value } = await mammoth.convertToHtml(
            // The browser build reads arrayBuffer; the Node build (tests) a Buffer.
            typeof Buffer === "undefined" ? { arrayBuffer } : { buffer: Buffer.from(arrayBuffer) },
          );
          html = sanitizeHtml(value);
        } else if (!blob || kind === "slides" || kind === "pages") {
          // Slides and older formats: the slides / pages StudyMind read.
          const { pages, images } = await loadUniFile(node.id);
          html = pagesHtml(pages, images, kind === "slides" ? "Slide" : "Page");
        }
        if (!live) return;
        const url = blob ? URL.createObjectURL(blob) : null;
        urlRef.current = url;
        setState({ status: "ready", blob, url, html, text });
      } catch (e) {
        if (live) setState({ status: "error", message: e.message || "This file could not be opened." });
      }
    })();
    return () => {
      live = false;
      // Kept a while: an "Open in new tab" page may still be using it.
      const url = urlRef.current;
      if (url) setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    };
  }, [node.id]);

  // Esc closes (after leaving full screen); the page behind doesn't scroll.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (document.fullscreenElement) return; // the browser leaves full screen first
      if (full) setFull(false);
      else onClose();
    };
    // Leaving the browser's full screen (Esc) leaves ours too.
    const onFs = () => !document.fullscreenElement && setFull(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      document.body.style.overflow = overflow;
    };
  }, [full, onClose]);

  // Fills the window at once, and asks the browser for true full screen
  // where it's allowed (phones and embedded browsers may not allow it).
  function toggleFull() {
    if (full) {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      setFull(false);
    } else {
      setFull(true);
      box.current?.requestFullscreen?.().catch(() => {});
    }
  }
  function download() {
    if (!state.blob) return notify?.("The original isn't stored for this file (it was over 15 MB).");
    downloadBlob(state.blob, node.fileName || node.name);
  }
  function openTab() {
    const tab = window.open("", "_blank");
    if (!tab) return notify?.("Allow pop-ups for StudyMind to open files in a new tab.");
    // Phones: the PDF itself, in the phone's own PDF viewer.
    if (kind === "pdf" && state.url && phoneDevice()) return void (tab.location.href = state.url);
    const page = standalonePage({ title: node.name, kind, url: state.url, html: state.html, text: state.text, fileName: node.fileName || node.name });
    tab.location.href = URL.createObjectURL(new Blob([page], { type: "text/html" }));
  }

  return (
    <div className="dv-backdrop" onClick={onClose}>
      <section
        ref={box}
        className={"dv-viewer panel" + (full ? " full" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={`View ${node.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dv-toolbar">
          <div className="dv-title">
            <strong>{node.name}</strong>
            <small>{node.fileName}</small>
          </div>
          <button className="icon-button" aria-label={full ? "Exit full screen" : "Full screen"} title="Full screen" onClick={toggleFull}>
            {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            className="icon-button"
            aria-label="Open in new tab"
            title="Open in new tab"
            disabled={state.status !== "ready"}
            onClick={openTab}
          >
            <ExternalLink size={16} />
          </button>
          <button className="icon-button" aria-label="Download" title="Download" disabled={state.status !== "ready"} onClick={download}>
            <Download size={16} />
          </button>
          <button className="icon-button" aria-label="Close viewer" title="Close (Esc)" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="dv-body">
          {state.status === "loading" ? (
            <Thinking label="Opening the document…" lines={3} />
          ) : state.status === "error" ? (
            <p className="dv-message">{state.message}</p>
          ) : kind === "pdf" && state.url ? (
            phoneDevice() ? (
              <PdfPages blob={state.blob} title={node.name} />
            ) : (
              <iframe className="dv-frame" src={state.url} title={node.name} />
            )
          ) : kind === "image" && state.url ? (
            <div className="dv-scroll dv-center">
              <img className="dv-image" src={state.url} alt={node.name} />
            </div>
          ) : kind === "text" && state.blob ? (
            <div className="dv-scroll">
              <pre className="dv-text">{state.text}</pre>
            </div>
          ) : (
            <div className="dv-scroll">
              {!state.blob && <p className="dv-note">The original isn't stored (over 15 MB), so this shows the text StudyMind read from it.</p>}
              <article className="dv-doc" dangerouslySetInnerHTML={{ __html: state.html }} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
