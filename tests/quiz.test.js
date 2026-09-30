import { it, expect, describe } from "vitest";
import { buildQuizSets, grade, normalizeGemini, quizMaterial, termFlashcards } from "../src/ai/quiz";
import { samples } from "./fixtures/samples";

const doc = samples[0];
const whole = doc.pages.join("\n").toLowerCase();

describe("quiz from the document", () => {
  it("builds 3 sets of 30 with 5 of each format", () => {
    const sets = buildQuizSets(doc, { seed: 3 });
    expect(sets).toHaveLength(3);
    const first = sets[0];
    expect(first).toHaveLength(30);
    const counts = first.reduce((a, q) => ((a[q.type] = (a[q.type] || 0) + 1), a), {});
    for (const t of ["mcq", "blank", "tf", "match", "term", "correct"]) expect(counts[t]).toBe(5);
  });

  it("only uses the document: every answer term and true statement is in the PDF", () => {
    for (const q of buildQuizSets(doc, { seed: 11 }).flat()) {
      if (q.type === "blank" || q.type === "term")
        expect(whole).toContain(q.options[q.answer].toLowerCase());
      if (q.type === "match") q.pairs.forEach((p) => expect(whole).toContain(p.term.toLowerCase()));
      // Every question is built from a real sentence of the document.
      if (q.source) expect(whole.replace(/\s+/g, " ")).toContain(q.source.toLowerCase().slice(0, 40));
      if (q.type === "tf" && q.answer === 0) expect(q.prompt).toContain(q.source.slice(0, 30));
      if (q.options) expect(new Set(q.options).size).toBe(q.options.length);
    }
  });

  it("has no repeated question inside a set or across the three sets", () => {
    const keys = buildQuizSets(doc, { seed: 5 }).flat().map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives new questions for a new seed and prefers unseen ones", () => {
    const a = buildQuizSets(doc, { seed: 1 });
    const seen = new Set(a.flat().map((q) => q.key));
    const b = buildQuizSets(doc, { seed: 2, avoid: seen });
    const fresh = b[0].filter((q) => !seen.has(q.key)).length;
    expect(fresh).toBeGreaterThan(b[0].length / 3);
    expect(buildQuizSets(doc, { seed: 1 })[0].map((q) => q.key)).toEqual(a[0].map((q) => q.key));
  });

  it("grades choices, true/false and partial matching", () => {
    const [set] = buildQuizSets(doc, { seed: 9 });
    const mc = set.find((q) => q.type === "mcq");
    expect(grade(mc, mc.answer)).toBe(1);
    expect(grade(mc, (mc.answer + 1) % 4)).toBe(0);
    expect(grade(mc, null)).toBe(0);
    const m = set.find((q) => q.type === "match");
    expect(grade(m, m.answer)).toBe(1);
    const half = [...m.answer];
    [half[0], half[1]] = [half[1], half[0]];
    expect(grade(m, half)).toBe(0.5);
  });

  it("finds real terms, not everyday words", () => {
    const { terms } = quizMaterial(doc);
    expect(terms).toEqual(expect.arrayContaining(["Machine learning", "Overfitting"]));
    expect(terms.map((t) => t.toLowerCase())).not.toContain("before");
  });

  it("keeps only well-formed Gemini questions grounded in the document", () => {
    const list = normalizeGemini(
      [
        { type: "blank", prompt: "_____ is a subset of AI.", options: ["Machine learning", "Overfitting", "AI", "Backpropagation"], answer: 0, page: 1 },
        { type: "blank", prompt: "x", options: ["Quantum teleportation", "a", "b", "c"], answer: 0 },
        { type: "tf", prompt: "Overfitting generalizes well.", answer: false },
        { type: "mcq", prompt: "?", options: ["a", "b"], answer: 0 },
        { type: "match", pairs: [{ term: "Overfitting", clue: "a" }, { term: "AI", clue: "b" }, { term: "Backpropagation", clue: "c" }, { term: "Machine learning", clue: "d" }] },
      ],
      doc,
    );
    expect(list.map((q) => q.type)).toEqual(["blank", "tf", "match"]);
    expect(list[1]).toMatchObject({ options: ["True", "False"], answer: 1 });
    expect(grade(list[2], list[2].answer)).toBe(1);
  });

  it("makes term flashcards when there is no question bank", () => {
    const cards = termFlashcards(doc);
    expect(cards.length).toBeGreaterThan(5);
    expect(cards[0].prompt).toMatch(/^What does the document say about “/);
  });
});

it("accepts Gemini terms whose main name is in the document (table rows split across lines)", () => {
  const table = { pages: ["Integrated Development PyCharm (Community IDE for Python\nEnvironment (IDE) Edition) features and tools. Git tracks code."] };
  const [q] = normalizeGemini(
    [{ type: "match", pairs: [
      { term: "PyCharm (Community Edition)", clue: "IDE for Python" },
      { term: "Git", clue: "tracks code" },
      { term: "Integrated Development Environment", clue: "IDE" },
      { term: "Kubernetes", clue: "not in the document" },
    ] }],
    table,
  );
  expect(q).toBeUndefined(); // one outside term rejects the whole question
  const [ok] = normalizeGemini(
    [{ type: "match", pairs: [
      { term: "PyCharm (Community Edition)", clue: "IDE for Python" },
      { term: "Git", clue: "tracks code" },
      { term: "Integrated Development Environment", clue: "IDE" },
    ] }],
    table,
  );
  expect(ok.pairs.map((p) => p.term)).toEqual(["PyCharm (Community Edition)", "Git", "Integrated Development Environment"]);
});

it("tops up a thin question bank with grounded 'What is X?' questions", async () => {
  const { withTermQuestions } = await import("../src/ai/quiz");
  const { buildQuestionBank } = await import("../src/ai/study");
  const table = {
    id: "t",
    name: "Tools",
    pages: [
      "Database MySQL Popular open-source relational database management system.\nVersion Control Git Distributed version control system to track code changes.\nAPI Testing Postman Tool to design, test and document APIs.\nRuntime Node.js JavaScript runtime built on Chrome's V8 engine.\nDo not share your password with anyone at the event.",
    ],
  };
  const bank = withTermQuestions(buildQuestionBank(table), table);
  const questions = bank[2].map((q) => q.question);
  expect(questions.length).toBeGreaterThanOrEqual(4);
  expect(questions.some((q) => /MySQL|Git|Postman|Node\.js/.test(q))).toBe(true);
  expect(questions.join(" ")).not.toMatch(/role of do not/i);
  for (const q of bank[2]) expect(q.answer.length).toBeGreaterThan(10);
});
