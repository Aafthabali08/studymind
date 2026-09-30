import { readDocument } from "./documents";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export function validateResumeFile(file) {
  if (!file || !/\.(pdf|txt|docx)$/i.test(file.name))
    throw new Error("Choose a PDF, DOCX or TXT resume.");
  if (file.size > MAX_RESUME_BYTES)
    throw new Error("Please choose a resume smaller than 10 MB.");
  if (!file.size) throw new Error("This resume file is empty.");
}

/** Extracts plain text from a resume, preserving line breaks for section detection. */
export async function readResume(file) {
  validateResumeFile(file);
  let text;
  if (/\.docx$/i.test(file.name)) {
    const mod = await import("mammoth");
    const mammoth = mod.default || mod;
    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    text = result.value;
  } else {
    text = (await readDocument(file)).join("\n");
  }
  text = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.split(/\s+/).length < 20)
    throw new Error(
      "Too little text was found. Upload a text-based resume, not a scanned image.",
    );
  return text;
}
