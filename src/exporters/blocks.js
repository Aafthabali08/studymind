// One document model for every PDF and Word download. Markdown (answers,
// notes, summaries, reports) is parsed into blocks; question banks and
// interview reports add their own block types. pdf.js and word.js render the
// same blocks, so both formats share the same structure and styles.
//
// Blocks:
//   title, subtitle, meta          document header
//   h { level 1-4 }                headings and sub-headings
//   p { text }                     paragraph (inline **bold**, *italic*, `code`;
//                                  "\n" is a line break)
//   li { ordered, n, indent }      list item
//   quote, callout { label }       quotation / highlighted box (memory tricks)
//   code { lang, text }            code snippet
//   table { rows }                 first row is the header
//   image { img, caption }         figure from the uploaded file
//   question { n, text, meta, important }
//   label { text }                 small caps label ("MODEL ANSWER")
//   rule                           divider

// ---- Characters the PDF fonts can draw --------------------------------------
// The bundled DejaVu subset covers Latin, Greek, punctuation, arrows, maths
// and common symbols; emoji and other scripts are swapped or dropped.
const SWAPS = {
  "✅": "✓",
  "❌": "✗",
  "⭐": "★",
  "🌟": "★",
  "⚠️": "⚠",
  "💡": "",
  "🧠": "",
  "📌": "",
};
const COVERED =
  /[ -~ -ɏͰ-Ͽ -⁯⁰-⃏℀-⏿─-╿■-➿\n\t]/;
export function pdfText(text) {
  let t = String(text ?? "");
  for (const [from, to] of Object.entries(SWAPS)) t = t.split(from).join(to);
  return [...t].filter((ch) => COVERED.test(ch)).join("");
}

// ---- Inline markdown ----------------------------------------------------------
/** Inline markdown → runs of { text, bold, italic, code }. */
export function inlineRuns(md) {
  const text = String(md ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const runs = [];
  // **bold**, __bold__, `code`, *italic*, _italic_ (not inside words).
  const re =
    /(\*\*|__)(.+?)\1(?![*_])|`([^`]+)`|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)/g;
  let last = 0,
    m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[3] != null) runs.push({ text: m[3], code: true });
    else if (m[2] != null)
      // Italic inside bold: **a *b* c** → bold runs, b also italic.
      for (const r of inlineRuns(m[2])) runs.push({ ...r, bold: true });
    else runs.push({ text: m[4] ?? m[5], italic: true });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text);
}

// ---- Block markdown -----------------------------------------------------------
/**
 * Markdown → blocks. `shift` pushes headings down (an answer's "## Intro"
 * sits under its question).
 */
export function markdownBlocks(md, { shift = 0 } = {}) {
  const lines = String(md ?? "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let para = [];
  const counters = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("```")) {
      flush();
      const lang = t.slice(3).trim().split(/\s+/)[0] || "";
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++)
        code.push(lines[i]);
      blocks.push({ type: "code", lang, text: code.join("\n").replace(/\s+$/, "") });
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
      counters.length = 0;
      continue;
    }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({
        type: "h",
        level: Math.min(4, h[1].length + shift),
        text: h[2].replace(/\s*#+\s*$/, ""),
      });
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
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const indent = Math.min(2, Math.floor(li[1].replace(/\t/g, "  ").length / 2));
      const ordered = /\d/.test(li[2]);
      counters.length = indent + 1;
      counters[indent] = ordered ? (counters[indent] || 0) + 1 : 0;
      blocks.push({
        type: "li",
        ordered,
        n: ordered ? counters[indent] : null,
        indent,
        text: li[3],
      });
      continue;
    }
    if (t.startsWith(">")) {
      flush();
      const quote = [t.replace(/^>\s?/, "")];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith(">"))
        quote.push(lines[++i].trim().replace(/^>\s?/, ""));
      const text = quote.join(" ");
      // "> 🧠 **Remember:** …" / "> **Memory trick:** …" are callouts.
      const call = text.match(/^(?:🧠\s*)?\*\*(Remember|Memory trick|Note|Tip|Key point)s?:?\*\*:?\s*(.*)$/i);
      blocks.push(
        call
          ? { type: "callout", label: call[1], text: call[2] }
          : { type: "quote", text },
      );
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}

/** Plain text (paragraphs separated by blank lines) → blocks, keeping lines. */
export function textBlocks(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .map((l) => l.trimEnd())
        .filter((l) => l.trim())
        .join("\n"),
    )
    .filter(Boolean)
    .map((text) => ({ type: "p", text, plain: true }));
}

/** Safe file name: "<name> - <part> - <part>.ext" */
export function fileName(parts, ext) {
  return (
    parts
      .filter(Boolean)
      // The document's own extension ("Notes.pdf") is dropped.
      .map((p, i) => (i ? String(p) : String(p).replace(/\.[a-z0-9]{2,5}$/i, "")))
      .join(" - ")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() + `.${ext}`
  );
}
