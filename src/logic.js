export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export function validateFile(file) {
  if (!file || !/\.(pdf|txt)$/i.test(file.name))
    throw new Error("Choose a PDF or TXT file.");
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
