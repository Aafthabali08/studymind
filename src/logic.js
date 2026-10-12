export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** File types that can be uploaded and read (see documents.js / officeReader.js). */
export const UPLOAD_TYPES = {
  pdf: "PDF",
  docx: "Word",
  doc: "Word 97–2003",
  pptx: "PowerPoint",
  ppt: "PowerPoint 97–2003",
  txt: "Text",
  md: "Markdown",
  csv: "CSV",
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
  webp: "Image",
};
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");
export const UPLOAD_HINT = "PDF, Word, PowerPoint, images, TXT, Markdown or CSV";
export const fileExtension = (name) =>
  (String(name || "").match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();
/** "Unit 1 notes.pptx" → "Unit 1 notes" */
export const baseName = (name) => String(name || "").replace(/\.[a-z0-9]{1,5}$/i, "");
export function validateFile(file) {
  if (!file || !UPLOAD_TYPES[fileExtension(file.name)])
    throw new Error(`Choose a ${UPLOAD_HINT} file.`);
  if (file.size > MAX_FILE_BYTES)
    throw new Error("Please choose a file smaller than 25 MB.");
  if (!file.size)
    throw new Error("This file is empty. Choose a file with readable text.");
}
export function validatePages(pages) {
  if (!pages.some((p) => p.trim()))
    throw new Error(
      "No readable text was found, even with OCR. Try a clearer scan or a text-based PDF.",
    );
  return pages;
}
export function makeFlashcards(pages) {
  return pages.flatMap((text, page) =>
    text
      .split(/(?<=[.!?])\s+|\n{2,}/u)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((answer) => ({
        prompt: `Recall the key idea: ${answer.split(/\s+/).slice(0, 5).join(" ")}…`,
        answer,
        page,
      })),
  );
}
export function interviewQuestions(role, experience) {
  const name = role.trim();
  if (!name) throw new Error("Enter the role you want to practice for.");
  const project =
    experience === "Fresher"
      ? "a coursework, personal, or internship project"
      : "a professional project";
  return [
    `Tell me about yourself and why you are interested in a ${name} role.`,
    `Describe ${project} relevant to ${name}. What was your contribution and the result?`,
    experience === "5+ years"
      ? `As a ${name}, how have you guided a team through a difficult technical decision?`
      : `How would you approach an unfamiliar problem as a ${name}?`,
  ];
}
export function formatTranscript(questions, answers, role, experience) {
  return (
    `${role} — ${experience}\n\n` +
    questions
      .map(
        (q, i) =>
          `Question ${i + 1}: ${q}\n${answers[i]?.trim() || "(No answer recorded)"}`,
      )
      .join("\n\n")
  );
}
export function readTheme(storage) {
  try {
    return storage.getItem("studymind-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
export function saveTheme(storage, theme) {
  try {
    storage.setItem("studymind-theme", theme);
  } catch {
    /* Theme still works if storage is unavailable. */
  }
}
export function initialTheme() {
  try {
    return readTheme(window.localStorage);
  } catch {
    return "light";
  }
}
