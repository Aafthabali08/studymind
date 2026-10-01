// Download any StudyMind content as a styled PDF or Word document.
import { downloadBlob } from "../documents";
import { fileName as nameFile, markdownBlocks } from "./blocks";

export const FORMATS = {
  pdf: { label: "PDF", ext: "pdf" },
  word: { label: "Word", ext: "docx" },
};

/**
 * Renders blocks in the chosen format and saves the file. `name` is the list
 * of file-name parts ("Notes.pdf", "Detailed notes"); resolves with the name.
 */
export async function exportBlocks({ format = "pdf", blocks, images = [], name, title, fonts }) {
  const file = nameFile(name, FORMATS[format]?.ext || "pdf");
  const docTitle = title || file.replace(/\.[a-z]+$/, "");
  if (format === "word") {
    const { renderWord } = await import("./word");
    const { blob } = await renderWord(blocks, { images, title: docTitle });
    downloadBlob(blob, file);
  } else {
    const { renderPdf } = await import("./pdf");
    const { pdf } = await renderPdf(blocks, { images, title: docTitle, footer: `StudyMind · ${docTitle}`, fonts });
    pdf.save(file);
  }
  return file;
}

/** Title + subtitle + meta header, then the markdown body. */
export function markdownDocument({ title, subtitle, meta, markdown }) {
  return [
    { type: "title", text: title },
    ...(subtitle ? [{ type: "subtitle", text: subtitle }] : []),
    { type: "meta", text: meta || `Exported from StudyMind · ${new Date().toLocaleDateString()}` },
    ...markdownBlocks(markdown),
  ];
}
