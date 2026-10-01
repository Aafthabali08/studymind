// Question bank → PDF. Important or all predicted questions, for one category
// (a marks group or a question type) or all of them, with model answers,
// memory tricks and the document's figures placed with the question they
// belong to. jsPDF and the fonts load only when a PDF is made.
import { MARKS, groupByType } from "./ai/study";

// ---- What goes in the PDF ----------------------------------------------------
/** Categories to download: everything, each marks group, each question type. */
export function pdfCategories(bank) {
  const out = [{ id: "all", label: "All categories" }];
  for (const m of MARKS) {
    const list = bank?.[m] || [];
    if (!list.length) continue;
    out.push({ id: `m${m}`, label: `${m}-mark questions`, marks: m });
    for (const [type] of groupByType(list, m))
      out.push({
        id: `m${m}:${type}`,
        label: `${m} marks · ${type}`,
        marks: m,
        type,
      });
  }
  return out;
}

/** The questions for a category, grouped like the app: marks → type → items. */
export function selectQuestions(bank, { category = "all", importantOnly }) {
  const cat =
    pdfCategories(bank).find((c) => c.id === category) ||
    pdfCategories(bank)[0];
  return MARKS.filter((m) => cat.marks == null || cat.marks === m)
    .map((m) => ({
      marks: m,
      groups: groupByType(bank?.[m] || [], m)
        .filter(([type]) => cat.type == null || cat.type === type)
        .map(([type, items]) => [
          type,
          importantOnly ? items.filter((i) => i.q.important) : items,
        ])
        .filter(([, items]) => items.length),
    }))
    .filter((s) => s.groups.length);
}

export const countQuestions = (sections) =>
  sections.reduce(
    (n, s) => n + s.groups.reduce((k, [, items]) => k + items.length, 0),
    0,
  );

/** "Biology notes - 5-mark questions - Important questions.pdf" */
export function pdfFileName(docName, categoryLabel, importantOnly) {
  const base = String(docName || "Document").replace(/\.[a-z0-9]{2,5}$/i, "");
  return (
    [
      base,
      categoryLabel,
      importantOnly ? "Important questions" : "All predicted questions",
    ]
      .join(" - ")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() + ".pdf"
  );
}

// ---- Text the fonts can draw --------------------------------------------------
// The bundled DejaVu subset covers Latin, Greek, punctuation, arrows, maths
// and common symbols; emoji and other scripts are swapped or dropped.
const SWAPS = { "✅": "✓", "❌": "✗", "⭐": "★", "🌟": "★", "⚠️": "⚠", "💡": "" };
const COVERED =
  /[ -~ -ɏͰ-Ͽ -⁯⁰-⃏℀-⏿─-╿■-➿\n\t]/;
export function pdfText(text) {
  let t = String(text ?? "");
  for (const [from, to] of Object.entries(SWAPS)) t = t.split(from).join(to);
  return [...t].filter((ch) => COVERED.test(ch)).join("");
}

/** Inline markdown → runs of { text, bold, code }. */
export function inlineRuns(md) {
  const text = String(md || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const runs = [];
  const re = /(\*\*|__)(.+?)\1|`([^`]+)`/g;
  let last = 0,
    m;
  const plain = (s) => s.replace(/(^|[^*\w])[*_]([^*_]+)[*_]/g, "$1$2");
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: plain(text.slice(last, m.index)) });
    runs.push(m[3] != null ? { text: m[3], code: true } : { text: plain(m[2]), bold: true });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: plain(text.slice(last)) });
  return runs
    .map((r) => ({ ...r, text: pdfText(r.text) }))
    .filter((r) => r.text);
}

/** Block-level markdown → headings, paragraphs, lists, quotes, code, tables, figures. */
export function markdownBlocks(md) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("```")) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++)
        code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const img = t.match(/^!\[([^\]]*)\]\(image:([^)\s]+)\)$/);
    if (img) {
      flush();
      blocks.push({ type: "image", id: img[2], caption: img[1] });
      continue;
    }
    if (!t) {
      flush();
      continue;
    }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ type: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (t.startsWith("|")) {
      flush();
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      i--;
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    const li = t.match(/^([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      blocks.push({
        type: "li",
        marker: /\d/.test(li[1]) ? li[1].replace(")", ".") : "•",
        indent: Math.min(2, Math.floor((line.match(/^\s*/)[0].length || 0) / 2)),
        text: li[2],
      });
      continue;
    }
    if (t.startsWith(">")) {
      flush();
      blocks.push({ type: "quote", text: t.replace(/^>\s?/, "") });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flush();
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}

/**
 * Figures for one question: the ones its answer shows (drawn in place), else
 * up to two from the page the question cites that the PDF hasn't shown yet,
 * so every diagram appears with a question it belongs to, once.
 */
export function figuresFor(q, images, shown = new Set()) {
  const ids = [...String(q.answer || "").matchAll(/\(image:([^)\s]+)\)/g)].map(
    (m) => m[1],
  );
  if (ids.length) return { inline: true, list: [] };
  return {
    inline: false,
    list: images
      .filter((img) => img.page === q.page && img.dataUrl && !shown.has(img.id))
      .slice(0, 2),
  };
}

// ---- Fonts --------------------------------------------------------------------
const FONT_FILES = {
  "DejaVuSans.ttf": ["DejaVu", "normal"],
  "DejaVuSans-Bold.ttf": ["DejaVu", "bold"],
  "DejaVuSansMono.ttf": ["DejaVuMono", "normal"],
};
let fontCache;
async function loadFonts() {
  fontCache ||= Promise.all(
    Object.keys(FONT_FILES).map(async (file) => {
      const res = await fetch(`${import.meta.env.BASE_URL || "/"}fonts/${file}`);
      if (!res.ok) throw new Error("The PDF fonts could not be loaded.");
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return [file, btoa(bin)];
    }),
  ).catch((error) => {
    fontCache = null;
    throw error;
  });
  return fontCache;
}

// ---- Layout -------------------------------------------------------------------
const PAGE = { w: 210, h: 297, m: 18 };
const INK = [32, 32, 32],
  MUTED = [110, 110, 110],
  ACCENT = [47, 123, 245],
  STAR = [196, 140, 0];

class Writer {
  constructor(pdf, { title, footer }) {
    this.pdf = pdf;
    this.y = PAGE.m;
    this.shown = new Set();
    this.title = title;
    this.footer = footer;
    this.width = PAGE.w - PAGE.m * 2;
  }
  font(kind = "normal", size = 10.5, color = INK) {
    const [family, style] =
      kind === "code" ? ["DejaVuMono", "normal"] : ["DejaVu", kind === "bold" ? "bold" : "normal"];
    this.pdf.setFont(family, style);
    this.pdf.setFontSize(size);
    this.pdf.setTextColor(...color);
  }
  ensure(h) {
    if (this.y + h <= PAGE.h - PAGE.m - 8) return;
    this.pdf.addPage();
    this.y = PAGE.m;
  }
  gap(h) {
    this.y += h;
  }
  /** Wrapped rich text (bold / code runs) at x, with a line height. */
  runs(runs, { x = PAGE.m, width = this.width, size = 10.5, color = INK, lh } = {}) {
    const line = lh || size * 0.48;
    const words = [];
    for (const r of runs)
      for (const part of r.text.split(/(\s+)/))
        if (part) words.push({ ...r, text: part });
    let cur = [],
      curW = 0;
    const measure = (w) => {
      this.font(w.code ? "code" : w.bold ? "bold" : "normal", w.code ? size * 0.92 : size, color);
      return this.pdf.getTextWidth(w.text);
    };
    const draw = () => {
      while (cur.length && !cur.at(-1).text.trim()) cur.pop();
      if (!cur.length) return;
      this.ensure(line);
      let cx = x;
      for (const w of cur) {
        const ww = measure(w);
        this.pdf.text(w.text, cx, this.y + line * 0.75);
        cx += ww;
      }
      this.y += line;
      cur = [];
      curW = 0;
    };
    for (const w of words) {
      if (!cur.length && !w.text.trim()) continue;
      let ww = measure(w);
      if (curW + ww > width && cur.length) draw();
      if (!cur.length && !w.text.trim()) continue;
      // A single word longer than the line: split it.
      if (ww > width) {
        let chunk = "";
        for (const ch of w.text) {
          if (measure({ ...w, text: chunk + ch }) > width) {
            cur.push({ ...w, text: chunk });
            draw();
            chunk = "";
          }
          chunk += ch;
        }
        w.text = chunk;
        ww = measure(w);
      }
      cur.push(w);
      curW += ww;
    }
    draw();
  }
  text(str, opts = {}) {
    this.runs([{ text: pdfText(str), bold: opts.bold }], opts);
  }
  rule(color = [225, 225, 225]) {
    this.pdf.setDrawColor(...color);
    this.pdf.setLineWidth(0.2);
    this.pdf.line(PAGE.m, this.y, PAGE.w - PAGE.m, this.y);
  }
  image(img, caption) {
    if (!img?.dataUrl) return;
    this.shown.add(img.id);
    const ratio = (img.height || 1) / (img.width || 1);
    // About 150 dpi, so small figures aren't blown up and blurred.
    let w = Math.min(this.width, 140, Math.max(45, (img.width || 600) * 0.17)),
      h = w * ratio;
    if (h > 100) {
      h = 100;
      w = h / ratio;
    }
    this.ensure(h + 8);
    const x = PAGE.m + (this.width - w) / 2;
    try {
      const fmt = /^data:image\/png/.test(img.dataUrl) ? "PNG" : "JPEG";
      this.pdf.addImage(img.dataUrl, fmt, x, this.y, w, h);
      this.pdf.setDrawColor(225, 225, 225);
      this.pdf.rect(x, this.y, w, h);
    } catch {
      return;
    }
    this.y += h + 1.5;
    this.text(caption, { size: 8.5, color: MUTED });
    this.gap(2);
  }
  code(text) {
    const lines = pdfText(text).split("\n");
    const size = 8.6,
      lh = size * 0.46;
    this.font("code", size);
    const wrapped = lines.flatMap((l) =>
      l ? this.pdf.splitTextToSize(l.replace(/\t/g, "  "), this.width - 6) : [""],
    );
    for (let i = 0; i < wrapped.length; ) {
      const room = Math.max(1, Math.floor((PAGE.h - PAGE.m - 8 - this.y - 4) / lh));
      if (room < 2) {
        this.pdf.addPage();
        this.y = PAGE.m;
        continue;
      }
      const part = wrapped.slice(i, i + room);
      const h = part.length * lh + 4;
      this.pdf.setFillColor(244, 244, 246);
      this.pdf.roundedRect(PAGE.m, this.y, this.width, h, 1.5, 1.5, "F");
      this.font("code", size, [40, 40, 60]);
      part.forEach((l, k) => this.pdf.text(l, PAGE.m + 3, this.y + 2 + lh * (k + 0.8)));
      this.y += h + 2;
      i += part.length;
    }
  }
  table(rows) {
    const cols = Math.max(...rows.map((r) => r.length));
    const cw = this.width / cols,
      size = 9,
      lh = size * 0.46;
    rows.forEach((row, r) => {
      const cells = Array.from({ length: cols }, (_, c) => {
        this.font(r === 0 ? "bold" : "normal", size);
        return this.pdf.splitTextToSize(
          pdfText(inlineRuns(row[c] || "").map((x) => x.text).join("")),
          cw - 3,
        );
      });
      const h = Math.max(...cells.map((c) => c.length)) * lh + 3;
      this.ensure(h);
      if (r === 0) {
        this.pdf.setFillColor(240, 243, 250);
        this.pdf.rect(PAGE.m, this.y, this.width, h, "F");
      }
      this.pdf.setDrawColor(220, 220, 220);
      cells.forEach((lines, c) => {
        this.pdf.rect(PAGE.m + c * cw, this.y, cw, h);
        this.font(r === 0 ? "bold" : "normal", size);
        lines.forEach((l, k) =>
          this.pdf.text(l, PAGE.m + c * cw + 1.5, this.y + 1.5 + lh * (k + 0.8)),
        );
      });
      this.y += h;
    });
    this.gap(3);
  }
  markdown(md, images) {
    for (const b of markdownBlocks(md)) {
      if (b.type === "h") {
        const size = b.level <= 2 ? 12 : 11;
        this.gap(1.5);
        this.ensure(size * 1.2);
        this.runs(inlineRuns(b.text).map((r) => ({ ...r, bold: true })), { size });
        this.gap(1);
      } else if (b.type === "p") {
        this.runs(inlineRuns(b.text));
        this.gap(2);
      } else if (b.type === "li") {
        const x = PAGE.m + 2 + b.indent * 5;
        this.ensure(5);
        this.font("normal");
        const top = this.y;
        this.pdf.text(b.marker, x, top + 10.5 * 0.48 * 0.75);
        this.runs(inlineRuns(b.text), { x: x + 5, width: this.width - (x + 5 - PAGE.m) });
        this.gap(0.8);
      } else if (b.type === "quote") {
        const top = this.y;
        this.runs(inlineRuns(b.text), {
          x: PAGE.m + 5,
          width: this.width - 5,
          color: [70, 70, 70],
        });
        this.pdf.setDrawColor(...ACCENT);
        this.pdf.setLineWidth(0.8);
        this.pdf.line(PAGE.m + 1.5, top, PAGE.m + 1.5, this.y);
        this.gap(2);
      } else if (b.type === "code") this.code(b.text);
      else if (b.type === "table") this.table(b.rows);
      else if (b.type === "image") {
        const img = images.find((i) => i.id === b.id);
        this.image(
          img,
          `Figure${img ? ` from page ${img.page + 1}` : ""}${b.caption ? `: ${b.caption}` : ""}`,
        );
      }
    }
  }
  finish() {
    const n = this.pdf.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.pdf.setPage(i);
      this.font("normal", 8, MUTED);
      this.pdf.text(this.footer, PAGE.m, PAGE.h - 10);
      this.pdf.text(`Page ${i} of ${n}`, PAGE.w - PAGE.m, PAGE.h - 10, {
        align: "right",
      });
    }
  }
}

/**
 * Builds the PDF. Returns { pdf, fileName, count }. `fonts` (base64 by file
 * name) can be passed in; otherwise they are fetched from /fonts.
 */
export async function buildQuestionPdf({
  doc,
  bank,
  category = "all",
  importantOnly = false,
  fonts,
}) {
  const images = doc.images || [];
  const cat =
    pdfCategories(bank).find((c) => c.id === category) ||
    pdfCategories(bank)[0];
  const sections = selectQuestions(bank, { category: cat.id, importantOnly });
  const count = countQuestions(sections);
  if (!count)
    throw new Error(
      importantOnly
        ? "There are no important questions in this category."
        : "There are no questions in this category.",
    );
  const [{ jsPDF }, files] = await Promise.all([
    import("jspdf"),
    fonts ? Object.entries(fonts) : loadFonts(),
  ]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  for (const [file, data] of files) {
    pdf.addFileToVFS(file, data);
    pdf.addFont(file, ...FONT_FILES[file]);
  }
  const fileName = pdfFileName(doc.name, cat.label, importantOnly);
  const scope = importantOnly ? "Important questions" : "All predicted questions";
  pdf.setProperties({
    title: fileName.replace(/\.pdf$/, ""),
    subject: `${scope} with model answers`,
    creator: "StudyMind",
  });
  const w = new Writer(pdf, {
    footer: pdfText(`StudyMind · ${doc.name}`).slice(0, 90),
  });

  // Cover header.
  w.font("bold", 18);
  w.text(doc.name.replace(/\.[a-z0-9]{2,5}$/i, ""), { size: 18, bold: true, lh: 8 });
  w.gap(1);
  w.text(`${scope} · ${cat.label}`, { size: 12, color: ACCENT, bold: true });
  w.text(
    `${count} question${count === 1 ? "" : "s"} with model answers · ${sections
      .map((s) => `${s.marks} marks`)
      .join(", ")} · ${new Date().toLocaleDateString()}`,
    { size: 9, color: MUTED },
  );
  w.gap(3);
  w.rule();
  w.gap(5);

  let n = 0;
  for (const { marks, groups } of sections) {
    w.ensure(30);
    w.text(`${marks}-mark questions`, { size: 15, bold: true, lh: 7 });
    w.gap(2);
    for (const [type, items] of groups) {
      w.ensure(24);
      w.text(type.toUpperCase(), { size: 9, color: ACCENT, bold: true });
      w.gap(2);
      for (const { q } of items) {
        n++;
        const [title, ...extra] = String(q.question || "").split("\n\n");
        w.ensure(22);
        w.runs(
          [
            { text: `Q${n}. `, bold: true },
            ...inlineRuns(title).map((r) => ({ ...r, bold: true })),
          ],
          { size: 11.5 },
        );
        w.runs(
          [
            ...(q.important ? [{ text: "★ Important · ", bold: true }] : []),
            { text: `${marks} marks · ${q.type || type} · p. ${(q.page ?? 0) + 1}` },
          ],
          { size: 8.5, color: q.important ? STAR : MUTED },
        );
        w.gap(1.5);
        if (extra.length) w.markdown(extra.join("\n\n"), images);
        w.text("MODEL ANSWER", { size: 8, color: MUTED, bold: true });
        w.gap(1);
        w.markdown(q.answer, images);
        const figs = figuresFor(q, images, w.shown);
        for (const img of figs.list)
          w.image(img, `Figure from page ${img.page + 1}${img.caption ? `: ${img.caption}` : ""}`);
        if (q.trick) {
          w.gap(1.5);
          w.ensure(12);
          w.runs(
            [{ text: "Memory trick: ", bold: true }, ...inlineRuns(q.trick)],
            { size: 9.5, color: [90, 60, 0] },
          );
        }
        w.gap(3);
        w.rule([235, 235, 235]);
        w.gap(4);
      }
    }
  }
  w.finish();
  return { pdf, fileName, count };
}

/** Builds the PDF and saves it with its file name. */
export async function downloadQuestionPdf(options) {
  const { pdf, fileName, count } = await buildQuestionPdf(options);
  pdf.save(fileName);
  return { fileName, count };
}
