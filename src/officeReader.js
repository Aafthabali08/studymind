// Reads uploads that are not PDFs into the same shape as a PDF:
// { pages: [text…], images: [{ id, page, dataUrl, width, height }] }.
//   .pptx  one page per slide (text in reading order + speaker notes),
//          with each slide's pictures
//   .docx  headings, paragraphs, lists and tables, split into pages of
//          ~450 words at headings, with pictures where they appear
//   .doc / .ppt (97–2003)  best-effort text: these old binary formats can't
//          be fully parsed in the browser, so save as .docx / .pptx for
//          the best result
//   images  text read with OCR, and the image itself as a figure
// Everything runs in the browser; libraries load only when needed.
import { fileExtension } from "./logic";

const WORDS_PER_PAGE = 450;
const MIN_SIDE = 90; // skip icons and bullets
const MAX_IMAGES = 40;

// ---- Text helpers (pure, tested) -----------------------------------------------
const tidy = (t) =>
  String(t || "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Blocks of text → pages of about `words` words, breaking before headings. */
export function paginate(blocks, words = WORDS_PER_PAGE) {
  const pages = [];
  let cur = [],
    count = 0;
  const flush = () => {
    if (cur.length) pages.push(cur.join("\n\n"));
    cur = [];
    count = 0;
  };
  for (const block of blocks) {
    const text = tidy(block.text);
    if (!text) continue;
    const n = text.split(/\s+/).length;
    if (count && (count + n > words || (block.heading && count > words * 0.6))) flush();
    cur.push(text);
    count += n;
  }
  flush();
  return pages.length ? pages : [""];
}

/** Text of one PowerPoint slide (or notes) XML, paragraph by paragraph. */
export function slideText(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paras = [...doc.getElementsByTagNameNS("*", "p")].filter(
    (p) => p.namespaceURI?.includes("drawingml"),
  );
  return tidy(
    paras
      .map((p) =>
        [...p.getElementsByTagNameNS("*", "t")]
          .filter((t) => t.namespaceURI?.includes("drawingml"))
          .map((t) => t.textContent)
          .join(""),
      )
      .filter((t) => t.trim())
      .join("\n"),
  );
}

/** Relationship id → { type, target } from a .rels file. */
export function relations(xml) {
  const doc = new DOMParser().parseFromString(xml || "<Relationships/>", "application/xml");
  return Object.fromEntries(
    [...doc.getElementsByTagNameNS("*", "Relationship")].map((r) => [
      r.getAttribute("Id"),
      { type: r.getAttribute("Type") || "", target: r.getAttribute("Target") || "" },
    ]),
  );
}

/** "../media/image1.png" relative to "ppt/slides/slide1.xml" → "ppt/media/image1.png" */
export function resolvePath(from, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Best-effort text from a Word 97–2003 (.doc) or PowerPoint 97–2003 (.ppt)
 * file: their text is stored as UTF-16 or single-byte runs between binary
 * data. Formatting names and other noise are dropped.
 */
export function legacyText(buffer) {
  const bytes = new Uint8Array(buffer);
  const runs = [];
  const keep = (s) => {
    const t = s.replace(/[\r\v]+/g, "\n").replace(/[^\S\n]+/g, " ").trim();
    if (t.length < 4 || !/[A-Za-z]{3}/.test(t)) return;
    const letters = (t.match(/[A-Za-z]/g) || []).length;
    if (letters / t.length < 0.55) return;
    if (/^(Normal|Default Paragraph Font|Table Normal|No List|Title|Heading \d|Times New Roman|Arial|Calibri|Cambria|Symbol|Wingdings|Microsoft (Word|PowerPoint|Office).*|Root Entry|SummaryInformation|DocumentSummaryInformation|WordDocument|PowerPoint Document|Current User|Office Theme|Click to edit.*)$/i.test(t))
      return;
    runs.push(t);
  };
  // Text characters only: ASCII, Latin-1 letters and typographic punctuation
  // (binary data decodes to many other code points).
  const printable = (c) =>
    c === 10 || c === 13 || c === 11 || (c >= 32 && c < 127) || (c >= 160 && c <= 255) || (c >= 0x2010 && c <= 0x2027);
  // UTF-16LE runs.
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const c = bytes[i] | (bytes[i + 1] << 8);
    if (printable(c)) s += String.fromCharCode(c);
    else {
      if (s.length >= 4) keep(s);
      s = "";
    }
  }
  if (s.length >= 4) keep(s);
  // Single-byte (Windows-1252) runs, used for plain English text.
  if (runs.join(" ").split(/\s+/).length < 40) {
    s = "";
    for (const c of bytes) {
      if (c === 10 || c === 13 || (c >= 32 && c < 127)) s += String.fromCharCode(c);
      else {
        if (s.length >= 8) keep(s);
        s = "";
      }
    }
    if (s.length >= 8) keep(s);
  }
  const seen = new Set();
  return tidy(runs.filter((r) => !seen.has(r) && seen.add(r)).join("\n"));
}

// ---- Images ----------------------------------------------------------------------
/** A picture from inside a file → a compressed JPEG figure (or null). */
async function figure(blob, name) {
  if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(name)) return null; // EMF/WMF/SVG: skip
  try {
    const { compressImage } = await import("./imageUtils");
    const file = new File([blob], name, { type: blob.type || "image/png" });
    const img = await compressImage(file, { maxEdge: 800 });
    if (img.width < MIN_SIDE || img.height < MIN_SIDE) return null;
    return { dataUrl: img.dataUrl, width: img.width, height: img.height };
  } catch {
    return null;
  }
}

// ---- Formats ---------------------------------------------------------------------
async function readPptx(file, withImages, onProgress) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const read = (path) => zip.file(path)?.async("string");
  // Slide order from the presentation, else by number.
  let slides = [];
  const pres = await read("ppt/presentation.xml");
  const presRels = relations(await read("ppt/_rels/presentation.xml.rels"));
  if (pres) {
    const doc = new DOMParser().parseFromString(pres, "application/xml");
    slides = [...doc.getElementsByTagNameNS("*", "sldId")]
      .map((el) => el.getAttribute("r:id") || el.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"))
      .map((id) => presRels[id]?.target)
      .filter(Boolean)
      .map((t) => resolvePath("ppt/presentation.xml", t));
  }
  if (!slides.length)
    slides = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => Number(a.match(/\d+/g).pop()) - Number(b.match(/\d+/g).pop()));
  if (!slides.length) throw new Error("No slides were found in this PowerPoint file.");
  const pages = [],
    images = [],
    seen = new Set();
  for (const [i, path] of slides.entries()) {
    onProgress?.({ stage: "text", done: i + 1, total: slides.length });
    const rels = relations(await read(path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels")));
    let text = slideText((await read(path)) || "");
    const notesRel = Object.values(rels).find((r) => r.type.endsWith("/notesSlide"));
    if (notesRel) {
      const notes = slideText((await read(resolvePath(path, notesRel.target))) || "")
        .split("\n")
        .filter((l) => !/^\d+$/.test(l.trim())) // slide number placeholder
        .join("\n");
      if (notes.trim()) text += `\n\nSpeaker notes:\n${notes}`;
    }
    pages.push(text);
    if (!withImages) continue;
    for (const rel of Object.values(rels)) {
      if (!rel.type.endsWith("/image") || images.length >= MAX_IMAGES) continue;
      const media = resolvePath(path, rel.target);
      if (seen.has(media)) continue; // logos on every slide: keep one
      seen.add(media);
      const blob = await zip.file(media)?.async("blob");
      const img = blob && (await figure(blob, media));
      if (img) images.push({ id: `s${i + 1}-${images.length + 1}`, page: i, ...img });
    }
  }
  return { pages, images };
}

async function readDocx(file, withImages) {
  const mod = await import("mammoth");
  const mammoth = mod.default || mod;
  const pictures = [];
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml(
    // The browser build reads arrayBuffer; the Node build (tests) a Buffer.
    typeof Buffer === "undefined" ? { arrayBuffer } : { buffer: Buffer.from(arrayBuffer) },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        if (!withImages || pictures.length >= MAX_IMAGES) return { src: "" };
        const b64 = await image.read("base64");
        const id = `w${pictures.length + 1}`;
        pictures.push({ id, contentType: image.contentType, b64 });
        return { src: `#${id}`, alt: id };
      }),
    },
  );
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const blocks = [];
  const walk = (el) => {
    for (const node of el.children) {
      const tag = node.tagName.toLowerCase();
      node.querySelectorAll("img").forEach((img) => {
        const id = img.getAttribute("src")?.replace(/^#/, "");
        if (id) blocks.push({ text: "", image: { id } });
      });
      if (/^h[1-6]$/.test(tag)) blocks.push({ text: node.textContent, heading: true });
      else if (tag === "ul" || tag === "ol")
        blocks.push({
          text: [...node.children].map((li, i) => `${tag === "ol" ? `${i + 1}.` : "•"} ${li.textContent.trim()}`).join("\n"),
        });
      else if (tag === "table")
        blocks.push({
          text: [...node.querySelectorAll("tr")]
            .map((tr) => [...tr.children].map((td) => td.textContent.trim()).join(" | "))
            .join("\n"),
        });
      else blocks.push({ text: node.textContent });
    }
  };
  walk(body);
  // Pages, and the page each picture falls on.
  const pages = [];
  let cur = [],
    count = 0;
  const pageOf = {};
  for (const b of blocks) {
    if (b.image) {
      pageOf[b.image.id] = pages.length;
      continue;
    }
    const text = tidy(b.text);
    if (!text) continue;
    const n = text.split(/\s+/).length;
    if (count && (count + n > WORDS_PER_PAGE || (b.heading && count > WORDS_PER_PAGE * 0.6))) {
      pages.push(cur.join("\n\n"));
      cur = [];
      count = 0;
    }
    cur.push(text);
    count += n;
  }
  if (cur.length) pages.push(cur.join("\n\n"));
  const images = [];
  for (const p of pictures) {
    const ext = (p.contentType.split("/")[1] || "png").replace("jpeg", "jpg");
    const bin = atob(p.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const img = await figure(new Blob([bytes], { type: p.contentType }), `${p.id}.${ext}`);
    if (img) images.push({ id: p.id, page: Math.min(pageOf[p.id] ?? 0, Math.max(0, pages.length - 1)), ...img });
  }
  return { pages: pages.length ? pages : [""], images };
}

async function readImage(file, withImages, onProgress) {
  onProgress?.({ stage: "ocr", done: 0, total: 1 });
  const { ocrImage } = await import("./documents");
  const text = await ocrImage(file);
  onProgress?.({ stage: "ocr", done: 1, total: 1 });
  const img = withImages ? await figure(file, file.name) : null;
  return { pages: [text], images: img ? [{ id: "img-1", page: 0, ...img }] : [] };
}

/** Reads any supported non-PDF upload. */
export async function readOffice(file, { images: withImages = false, onProgress } = {}) {
  const ext = fileExtension(file.name);
  if (ext === "pptx") return readPptx(file, withImages, onProgress);
  if (ext === "docx") return readDocx(file, withImages);
  if (ext === "doc" || ext === "ppt") {
    const text = legacyText(await file.arrayBuffer());
    if (text.split(/\s+/).length < 15)
      throw new Error(
        `Little text could be read from this old .${ext} file. Open it in ${ext === "doc" ? "Word" : "PowerPoint"} and save it as .${ext}x (or PDF), then upload that.`,
      );
    return { pages: paginate(text.split(/\n{2,}|\n/).map((t) => ({ text: t }))), images: [] };
  }
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return readImage(file, withImages, onProgress);
  // md / csv / txt
  return { pages: (await file.text()).split(/\f/), images: [] };
}
