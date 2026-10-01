// Question bank → PDF or Word. Important or all predicted questions, for one
// category (a marks group or a question type) or all of them, with model
// answers, memory tricks and the document's figures placed with the question
// they belong to. Rendering is shared with every other download (exporters/).
import { MARKS, groupByType } from "./ai/study";
import { fileName, markdownBlocks } from "./exporters/blocks";
import { exportBlocks } from "./exporters/index";

export { inlineRuns, markdownBlocks, pdfText } from "./exporters/blocks";

// ---- What goes in the file ----------------------------------------------------
/** Categories to download: everything, each marks group, each question type. */
export function pdfCategories(bank) {
  const out = [{ id: "all", label: "All categories" }];
  for (const m of MARKS) {
    const list = bank?.[m] || [];
    if (!list.length) continue;
    out.push({ id: `m${m}`, label: `${m}-mark questions`, marks: m });
    for (const [type] of groupByType(list, m))
      out.push({ id: `m${m}:${type}`, label: `${m} marks · ${type}`, marks: m, type });
  }
  return out;
}

/** The questions for a category, grouped like the app: marks → type → items. */
export function selectQuestions(bank, { category = "all", importantOnly }) {
  const cats = pdfCategories(bank);
  const cat = cats.find((c) => c.id === category) || cats[0];
  return MARKS.filter((m) => cat.marks == null || cat.marks === m)
    .map((m) => ({
      marks: m,
      groups: groupByType(bank?.[m] || [], m)
        .filter(([type]) => cat.type == null || cat.type === type)
        .map(([type, items]) => [type, importantOnly ? items.filter((i) => i.q.important) : items])
        .filter(([, items]) => items.length),
    }))
    .filter((s) => s.groups.length);
}

export const countQuestions = (sections) =>
  sections.reduce((n, s) => n + s.groups.reduce((k, [, items]) => k + items.length, 0), 0);

const scopeLabel = (importantOnly) =>
  importantOnly == null ? null : importantOnly ? "Important questions" : "All predicted questions";

/** "Biology notes - 5-mark questions - Important questions.pdf" */
export function pdfFileName(docName, categoryLabel, importantOnly, ext = "pdf") {
  return fileName([docName || "Document", categoryLabel, scopeLabel(importantOnly)], ext);
}

/**
 * Figures for one question: the ones its answer shows (drawn in place), else
 * up to two from the page the question cites that the file hasn't shown yet,
 * so every diagram appears with a question it belongs to, once.
 */
export function figuresFor(q, images, shown = new Set()) {
  const ids = [...String(q.answer || "").matchAll(/\(image:([^)\s]+)\)/g)].map((m) => m[1]);
  if (ids.length) return { inline: true, ids, list: [] };
  return {
    inline: false,
    ids: [],
    list: images.filter((img) => img.page === q.page && img.dataUrl && !shown.has(img.id)).slice(0, 2),
  };
}

/** The document model for a selection (see exporters/blocks.js). */
export function questionBlocks({ doc, bank, category = "all", importantOnly = false, title }) {
  const images = doc.images || [];
  const cats = pdfCategories(bank);
  const cat = cats.find((c) => c.id === category) || cats[0];
  const sections = selectQuestions(bank, { category: cat.id, importantOnly });
  const count = countQuestions(sections);
  const scope = title || scopeLabel(importantOnly);
  const blocks = [
    { type: "title", text: String(doc.name || "Document").replace(/\.[a-z0-9]{2,5}$/i, "") },
    { type: "subtitle", text: title ? scope : `${scope} · ${cat.label}` },
    {
      type: "meta",
      text: `${count} question${count === 1 ? "" : "s"} with model answers · ${sections
        .map((s) => `${s.marks} marks`)
        .join(", ")} · ${new Date().toLocaleDateString()}`,
    },
  ];
  // Figures some answer shows are never borrowed by another question.
  const shown = new Set(
    sections.flatMap((s) =>
      s.groups.flatMap(([, items]) => items.flatMap(({ q }) => figuresFor(q, images).ids)),
    ),
  );
  let n = 0;
  sections.forEach(({ marks, groups }, si) => {
    if (si) blocks.push({ type: "pagebreak" });
    blocks.push({ type: "h", level: 1, text: `${marks}-mark questions` });
    for (const [type, items] of groups) {
      blocks.push({ type: "h", level: 2, text: type });
      for (const { q } of items) {
        n++;
        const [text, ...extra] = String(q.question || "").split("\n\n");
        blocks.push({
          type: "question",
          n,
          text,
          important: Boolean(q.important),
          meta: `${marks} marks · ${q.type || type} · page ${(q.page ?? 0) + 1}`,
        });
        if (extra.length) blocks.push(...markdownBlocks(extra.join("\n\n"), { shift: 2 }));
        blocks.push({ type: "label", text: "Model answer" });
        // An answer's "## Introduction" becomes a sub-heading under its question.
        blocks.push(...markdownBlocks(q.answer, { shift: 1 }));
        const figs = figuresFor(q, images, shown);
        figs.ids.forEach((id) => shown.add(id));
        for (const img of figs.list) {
          shown.add(img.id);
          blocks.push({ type: "image", img });
        }
        if (q.trick) blocks.push({ type: "callout", label: "Memory trick", text: q.trick });
        blocks.push({ type: "rule" });
      }
    }
  });
  return { blocks, count, cat, scope };
}

function prepare(options) {
  const { doc, importantOnly = false, title } = options;
  const built = questionBlocks(options);
  if (!built.count)
    throw new Error(
      importantOnly ? "There are no important questions in this category." : "There are no questions in this category.",
    );
  const name = title ? [doc.name, title] : [doc.name, built.cat.label, scopeLabel(importantOnly)];
  return { ...built, name, images: doc.images || [] };
}

/** Builds the PDF without saving it: { pdf, fileName, count } (tests). */
export async function buildQuestionPdf(options) {
  const { blocks, count, name, images } = prepare(options);
  const { renderPdf } = await import("./exporters/pdf");
  const file = fileName(name, "pdf");
  const { pdf } = await renderPdf(blocks, {
    images,
    fonts: options.fonts,
    title: file.replace(/\.pdf$/, ""),
    footer: `StudyMind · ${options.doc.name}`,
  });
  return { pdf, fileName: file, count };
}

/** Saves the questions as a PDF ("pdf") or Word document ("word"). */
export async function downloadQuestionPdf({ format = "pdf", ...options }) {
  const { blocks, count, name, images } = prepare(options);
  const file = await exportBlocks({ format, blocks, images, name, fonts: options.fonts });
  return { fileName: file, count };
}
