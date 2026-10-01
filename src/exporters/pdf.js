// Blocks (see blocks.js) → a styled A4 PDF with jsPDF: title page header,
// four heading levels, paragraphs with bold / italic / inline code, nested
// bullet and numbered lists, quotes, highlighted callouts, shaded code
// snippets with their language, striped tables, figures with captions,
// question cards and page numbers. jsPDF and the fonts load on first use.
import { inlineRuns, pdfText } from "./blocks";

const FONT_FILES = {
  "DejaVuSans.ttf": ["DejaVu", "normal"],
  "DejaVuSans-Bold.ttf": ["DejaVu", "bold"],
  "DejaVuSans-Oblique.ttf": ["DejaVu", "italic"],
  "DejaVuSansMono.ttf": ["DejaVuMono", "normal"],
};
let fontCache;
export async function loadPdfFonts() {
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

// ---- Style sheet ----------------------------------------------------------------
const PAGE = { w: 210, h: 297, m: 18 };
const COLOR = {
  ink: [30, 32, 38],
  muted: [110, 114, 124],
  accent: [37, 99, 235],
  accentSoft: [232, 240, 254],
  star: [180, 120, 0],
  starSoft: [255, 247, 224],
  trick: [120, 72, 0],
  rule: [226, 228, 233],
  codeBg: [245, 246, 248],
  codeInk: [36, 41, 54],
  quoteBg: [247, 248, 250],
  tableHead: [236, 241, 250],
  tableZebra: [250, 251, 252],
};
const SIZE = { body: 10.5, small: 8.5, code: 8.6 };
const HEADING = {
  1: { size: 16, color: COLOR.ink, before: 5, after: 2, rule: true },
  2: { size: 13.5, color: COLOR.ink, before: 4, after: 1.5 },
  3: { size: 12, color: COLOR.accent, before: 3, after: 1 },
  4: { size: 11, color: [60, 64, 74], before: 2.5, after: 0.8 },
};
const lineHeight = (size) => size * 0.5;

class Writer {
  constructor(pdf, { images, footer }) {
    this.pdf = pdf;
    this.images = images || [];
    this.footer = footer;
    this.y = PAGE.m;
    this.width = PAGE.w - PAGE.m * 2;
    this.shown = new Set();
  }
  font(style = "normal", size = SIZE.body, color = COLOR.ink) {
    this.pdf.setFont(style === "code" ? "DejaVuMono" : "DejaVu", style === "code" ? "normal" : style);
    this.pdf.setFontSize(size);
    this.pdf.setTextColor(...color);
  }
  bottom() {
    return PAGE.h - PAGE.m - 8;
  }
  ensure(h) {
    if (this.y + h <= this.bottom()) return;
    this.pdf.addPage();
    this.y = PAGE.m;
  }
  gap(h) {
    this.y += h;
  }
  /** Wrapped rich text; returns the lines it drew. */
  runs(runs, { x = PAGE.m, width = this.width, size = SIZE.body, color = COLOR.ink, lh, bold, italic } = {}) {
    const line = lh || lineHeight(size);
    const styleOf = (r) =>
      r.code ? "code" : (r.bold || bold) && (r.italic || italic) ? "bold" : r.bold || bold ? "bold" : r.italic || italic ? "italic" : "normal";
    const pieces = [];
    for (const r of runs)
      for (const part of pdfText(r.text).split(/(\s+|\n)/))
        if (part) pieces.push({ ...r, text: part });
    const measure = (w) => {
      this.font(styleOf(w), w.code ? size * 0.92 : size, w.color || color);
      return this.pdf.getTextWidth(w.text);
    };
    let cur = [],
      curW = 0;
    const draw = () => {
      while (cur.length && !cur.at(-1).text.trim()) cur.pop();
      if (cur.length) {
        this.ensure(line);
        let cx = x;
        for (const w of cur) {
          const ww = measure(w);
          if (w.code && w.text.trim()) {
            this.pdf.setFillColor(...COLOR.codeBg);
            this.pdf.roundedRect(cx - 0.4, this.y + line * 0.12, ww + 0.8, line * 0.86, 0.6, 0.6, "F");
            this.font("code", size * 0.92, [170, 40, 70]);
          }
          this.pdf.text(w.text, cx, this.y + line * 0.75);
          cx += ww;
        }
      }
      this.y += line;
      cur = [];
      curW = 0;
    };
    for (const w of pieces) {
      if (w.text === "\n") {
        draw();
        continue;
      }
      if (!cur.length && !w.text.trim()) continue;
      let ww = measure(w);
      if (curW + ww > width && cur.length) {
        draw();
        if (!w.text.trim()) continue;
      }
      if (ww > width) {
        // A word longer than the line (URLs, long identifiers): split it.
        let chunk = "";
        for (const ch of w.text) {
          if (measure({ ...w, text: chunk + ch }) > width && chunk) {
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
    if (cur.length) draw();
  }
  text(str, opts) {
    this.runs([{ text: str }], opts);
  }
  rule(color = COLOR.rule, width = 0.25) {
    this.pdf.setDrawColor(...color);
    this.pdf.setLineWidth(width);
    this.pdf.line(PAGE.m, this.y, PAGE.w - PAGE.m, this.y);
  }
  /** A box (filled, optional left bar) drawn behind content written by `body`. */
  boxed({ fill, bar, pad = 3, x = PAGE.m, width = this.width }, body) {
    this.ensure(12);
    const page = this.pdf.getCurrentPageInfo().pageNumber;
    const top = this.y;
    this.y += pad;
    // Draw content first on a scratch pass to know the height: jsPDF has no
    // layering, so remember the drawing calls and replay after the box.
    const calls = [];
    const real = this.pdf.text.bind(this.pdf);
    const realRect = this.pdf.roundedRect.bind(this.pdf);
    this.pdf.text = (...a) => (calls.push(["text", a, this.pdf.getCurrentPageInfo().pageNumber, this.snap()]), this.pdf);
    this.pdf.roundedRect = (...a) => (calls.push(["roundedRect", a, this.pdf.getCurrentPageInfo().pageNumber, this.snap()]), this.pdf);
    try {
      body();
    } finally {
      this.pdf.text = real;
      this.pdf.roundedRect = realRect;
    }
    this.y += pad;
    const endPage = this.pdf.getCurrentPageInfo().pageNumber;
    // Background on each page the box spans.
    for (let p = page; p <= endPage; p++) {
      this.pdf.setPage(p);
      const y0 = p === page ? top : PAGE.m - 2;
      const y1 = p === endPage ? this.y : this.bottom() + 2;
      if (fill) {
        this.pdf.setFillColor(...fill);
        this.pdf.roundedRect(x, y0, width, y1 - y0, 1.6, 1.6, "F");
      }
      if (bar) {
        this.pdf.setFillColor(...bar);
        this.pdf.rect(x, y0, 1.1, y1 - y0, "F");
      }
    }
    for (const [fn, args, p, state] of calls) {
      this.pdf.setPage(p);
      this.restore(state);
      (fn === "text" ? real : realRect)(...args);
    }
    this.pdf.setPage(endPage);
  }
  snap() {
    const f = this.pdf.getFont();
    return {
      font: [f.fontName, f.fontStyle],
      size: this.pdf.getFontSize(),
      color: this.pdf.getTextColor(),
      fill: this.pdf.getFillColor(),
    };
  }
  restore(s) {
    this.pdf.setFont(...s.font);
    this.pdf.setFontSize(s.size);
    this.pdf.setTextColor(s.color);
    this.pdf.setFillColor(s.fill);
  }

  // ---- Blocks -------------------------------------------------------------------
  block(b) {
    const fn = this[`b_${b.type}`];
    if (fn) fn.call(this, b);
  }
  b_title(b) {
    this.runs([{ text: b.text, bold: true }], { size: 20, lh: 9 });
    this.gap(1);
  }
  b_subtitle(b) {
    this.runs([{ text: b.text, bold: true }], { size: 12, color: COLOR.accent });
  }
  b_meta(b) {
    this.runs([{ text: b.text }], { size: SIZE.small, color: COLOR.muted });
    this.gap(3);
    this.rule(COLOR.rule, 0.4);
    this.gap(5);
  }
  b_h(b) {
    const s = HEADING[b.level] || HEADING[4];
    this.gap(s.before);
    this.ensure(lineHeight(s.size) * 2 + 6);
    this.runs(inlineRuns(b.text).map((r) => ({ ...r, bold: true })), {
      size: s.size,
      color: s.color,
    });
    if (s.rule) {
      this.gap(0.8);
      this.rule(COLOR.accent, 0.5);
      this.gap(1.5);
    }
    this.gap(s.after);
  }
  b_p(b) {
    this.runs(b.plain ? [{ text: b.text }] : inlineRuns(b.text));
    this.gap(2.2);
  }
  b_li(b) {
    const x = PAGE.m + 2 + b.indent * 6;
    const marker = b.ordered ? `${b.n}.` : ["•", "◦", "▪"][b.indent] || "•";
    this.ensure(lineHeight(SIZE.body));
    this.font(b.ordered ? "bold" : "normal", SIZE.body, b.ordered ? COLOR.accent : COLOR.ink);
    this.pdf.text(marker, x, this.y + lineHeight(SIZE.body) * 0.75);
    this.runs(inlineRuns(b.text), { x: x + 6, width: this.width - (x + 6 - PAGE.m) });
    this.gap(0.9);
  }
  b_quote(b) {
    this.boxed({ fill: COLOR.quoteBg, bar: COLOR.accent }, () =>
      this.runs(inlineRuns(b.text), {
        x: PAGE.m + 5,
        width: this.width - 8,
        color: [60, 64, 74],
        italic: true,
      }),
    );
    this.gap(2.5);
  }
  b_callout(b) {
    this.boxed({ fill: COLOR.starSoft, bar: COLOR.star }, () => {
      this.runs([{ text: `${b.label.toUpperCase()}`, bold: true }], {
        x: PAGE.m + 5,
        size: 7.5,
        color: COLOR.star,
      });
      this.gap(0.5);
      this.runs(inlineRuns(b.text), {
        x: PAGE.m + 5,
        width: this.width - 8,
        size: 9.8,
        color: COLOR.trick,
      });
    });
    this.gap(2.5);
  }
  b_code(b) {
    const size = SIZE.code,
      lh = size * 0.47;
    this.font("code", size);
    const wrapped = pdfText(b.text)
      .replace(/\t/g, "    ")
      .split("\n")
      .flatMap((l) => (l ? this.pdf.splitTextToSize(l, this.width - 8) : [""]));
    let first = true;
    for (let i = 0; i < wrapped.length || first; ) {
      const head = first && b.lang ? 4.5 : 0;
      const room = Math.floor((this.bottom() - this.y - 6 - head) / lh);
      if (room < 3 && this.y > PAGE.m + 1) {
        this.pdf.addPage();
        this.y = PAGE.m;
        continue;
      }
      const part = wrapped.slice(i, i + Math.max(room, 1));
      const h = head + part.length * lh + 5;
      this.pdf.setFillColor(...COLOR.codeBg);
      this.pdf.setDrawColor(...COLOR.rule);
      this.pdf.setLineWidth(0.2);
      this.pdf.roundedRect(PAGE.m, this.y, this.width, h, 1.6, 1.6, "FD");
      if (head) {
        this.font("bold", 7, COLOR.muted);
        this.pdf.text(b.lang.toUpperCase(), PAGE.m + 4, this.y + 4);
      }
      this.font("code", size, COLOR.codeInk);
      part.forEach((l, k) =>
        this.pdf.text(l, PAGE.m + 4, this.y + head + 2.5 + lh * (k + 0.8)),
      );
      this.y += h + 2.5;
      i += part.length;
      first = false;
    }
  }
  b_table(b) {
    const cols = Math.max(...b.rows.map((r) => r.length));
    const cw = this.width / cols,
      size = 9,
      lh = size * 0.47;
    b.rows.forEach((row, r) => {
      const cells = Array.from({ length: cols }, (_, c) => {
        this.font(r === 0 ? "bold" : "normal", size);
        return this.pdf.splitTextToSize(
          pdfText(inlineRuns(row[c] || "").map((x) => x.text).join("")),
          cw - 4,
        );
      });
      const h = Math.max(...cells.map((c) => c.length)) * lh + 4;
      this.ensure(h);
      const fill = r === 0 ? COLOR.tableHead : r % 2 === 0 ? COLOR.tableZebra : null;
      if (fill) {
        this.pdf.setFillColor(...fill);
        this.pdf.rect(PAGE.m, this.y, this.width, h, "F");
      }
      this.pdf.setDrawColor(...COLOR.rule);
      this.pdf.setLineWidth(0.2);
      cells.forEach((lines, c) => {
        this.pdf.rect(PAGE.m + c * cw, this.y, cw, h);
        this.font(r === 0 ? "bold" : "normal", size, r === 0 ? COLOR.ink : [50, 54, 62]);
        lines.forEach((l, k) =>
          this.pdf.text(l, PAGE.m + c * cw + 2, this.y + 2 + lh * (k + 0.8)),
        );
      });
      this.y += h;
    });
    this.gap(3);
  }
  b_image(b) {
    const img = b.img || this.images.find((i) => i.id === b.id);
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
    this.ensure(h + 9);
    const x = PAGE.m + (this.width - w) / 2;
    try {
      const fmt = /^data:image\/png/.test(img.dataUrl) ? "PNG" : "JPEG";
      this.pdf.addImage(img.dataUrl, fmt, x, this.y, w, h);
      this.pdf.setDrawColor(...COLOR.rule);
      this.pdf.setLineWidth(0.2);
      this.pdf.rect(x, this.y, w, h);
    } catch {
      return;
    }
    this.y += h + 1.5;
    const label = b.caption || img.caption;
    const caption = `Figure from page ${img.page + 1}${label ? `: ${label}` : ""}`;
    // Centred under the figure (wrapped captions stay left-aligned).
    this.font("italic", SIZE.small, COLOR.muted);
    const cw = this.pdf.getTextWidth(pdfText(caption));
    const cx = cw < this.width - 20 ? PAGE.m + (this.width - cw) / 2 : PAGE.m + 10;
    this.runs([{ text: caption, italic: true }], {
      x: cx,
      width: this.width - 20,
      size: SIZE.small,
      color: COLOR.muted,
    });
    this.gap(2.5);
  }
  b_question(b) {
    this.ensure(26);
    this.gap(1);
    this.runs(
      [
        { text: `Q${b.n}.  `, bold: true, color: COLOR.accent },
        ...inlineRuns(b.text).map((r) => ({ ...r, bold: true })),
      ],
      { size: 11.8, lh: 6 },
    );
    if (b.meta || b.important) {
      this.runs(
        [
          ...(b.important ? [{ text: "★ IMPORTANT   ", bold: true }] : []),
          { text: b.meta || "" },
        ],
        { size: SIZE.small, color: b.important ? COLOR.star : COLOR.muted },
      );
    }
    this.gap(2);
  }
  b_label(b) {
    this.ensure(8);
    this.runs([{ text: b.text.toUpperCase(), bold: true }], {
      size: 7.5,
      color: COLOR.muted,
    });
    this.gap(1);
  }
  b_rule() {
    this.gap(1.5);
    this.ensure(4);
    this.rule();
    this.gap(4);
  }
  b_pagebreak() {
    if (this.y > PAGE.m + 1) {
      this.pdf.addPage();
      this.y = PAGE.m;
    }
  }
  finish() {
    const n = this.pdf.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      this.pdf.setPage(i);
      this.pdf.setDrawColor(...COLOR.rule);
      this.pdf.setLineWidth(0.2);
      this.pdf.line(PAGE.m, PAGE.h - 13.5, PAGE.w - PAGE.m, PAGE.h - 13.5);
      this.font("normal", 7.5, COLOR.muted);
      this.pdf.text(pdfText(this.footer).slice(0, 95), PAGE.m, PAGE.h - 9.5);
      this.pdf.text(`Page ${i} of ${n}`, PAGE.w - PAGE.m, PAGE.h - 9.5, {
        align: "right",
      });
    }
  }
}

/**
 * Renders blocks to a jsPDF document. `fonts` (base64 by file name) may be
 * passed in (tests); otherwise they are fetched from /fonts.
 */
export async function renderPdf(blocks, { images = [], footer = "StudyMind", title, fonts } = {}) {
  const [{ jsPDF }, files] = await Promise.all([
    import("jspdf"),
    fonts ? Object.entries(fonts) : loadPdfFonts(),
  ]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  for (const [file, data] of files) {
    if (!FONT_FILES[file]) continue;
    pdf.addFileToVFS(file, data);
    pdf.addFont(file, ...FONT_FILES[file]);
  }
  if (title) pdf.setProperties({ title, creator: "StudyMind" });
  const w = new Writer(pdf, { images, footer });
  for (const b of blocks) w.block(b);
  w.finish();
  return { pdf, writer: w };
}
