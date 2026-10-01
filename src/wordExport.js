// A document's extracted text → Word (.docx): a title, then each page under
// its own heading with its paragraphs and the figures found on that page.
// Rendered by the shared exporters (same styles as every download).
import { fileName, textBlocks } from "./exporters/blocks";

/** "Biology notes.pdf" → "Biology notes - text.docx" */
export const wordFileName = (name) => fileName([name || "Document", "text"], "docx");

/** Page text → paragraphs (blank lines), each a list of lines. */
export const pageParagraphs = (text) =>
  textBlocks(text).map((b) => b.text.split("\n"));

/** The document model: title, then every page with its text and figures. */
export function documentBlocks(doc) {
  const images = doc.images || [];
  const blocks = [
    { type: "title", text: String(doc.name || "Document").replace(/\.[a-z0-9]{2,5}$/i, "") },
    { type: "subtitle", text: "Extracted text" },
    {
      type: "meta",
      text: `${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"} · exported from StudyMind · ${new Date().toLocaleDateString()}`,
    },
  ];
  doc.pages.forEach((text, i) => {
    blocks.push({ type: "h", level: 2, text: `Page ${i + 1}` });
    const paragraphs = textBlocks(text);
    blocks.push(
      ...(paragraphs.length
        ? paragraphs
        : [{ type: "p", text: "*No text on this page.*" }]),
    );
    for (const img of images.filter((x) => x.page === i && x.dataUrl))
      blocks.push({ type: "image", img });
  });
  return blocks;
}

/** Builds the Word document; resolves with { blob or buffer, fileName }. */
export async function documentToWord(doc, { buffer = false } = {}) {
  const { renderWord } = await import("./exporters/word");
  const title = String(doc.name || "Document").replace(/\.[a-z0-9]{2,5}$/i, "");
  const out = await renderWord(documentBlocks(doc), { images: doc.images || [], title, buffer });
  return { fileName: wordFileName(doc.name), ...(buffer ? { buffer: out.buffer } : { blob: out.blob }) };
}
