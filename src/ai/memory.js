// What Gemini should learn from: the signed-in user's ✓/✗ feedback and the
// admin's global guidance. Added to Gemini system prompts (free, no training).
let memory = { avoid: [], good: [], guidance: [] };

export function setLearning({ avoid, good, guidance } = {}) {
  memory = {
    avoid: avoid ?? memory.avoid,
    good: good ?? memory.good,
    guidance: guidance ?? memory.guidance,
  };
}

/** A short block for system prompts; empty when there is nothing to learn. */
export function learningNotes() {
  const parts = [];
  if (memory.guidance.length)
    parts.push(
      "Rules from the StudyMind team (always follow):\n" +
        memory.guidance
          .slice(0, 15)
          .map((r) => `- ${r}`)
          .join("\n"),
    );
  if (memory.avoid.length)
    parts.push(
      "This student marked these outputs as WRONG or unhelpful. Avoid repeating them and fix the kind of mistake:\n" +
        memory.avoid
          .slice(0, 10)
          .map((r) => `- ${r}`)
          .join("\n"),
    );
  if (memory.good.length)
    parts.push(
      "This student marked these as correct and helpful. Keep this style:\n" +
        memory.good
          .slice(0, 5)
          .map((r) => `- ${r}`)
          .join("\n"),
    );
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}
