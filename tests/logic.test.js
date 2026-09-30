import { describe, it, expect } from "vitest";
import {
  validateFile,
  validatePages,
  MAX_FILE_BYTES,
  makeFlashcards,
  interviewQuestions,
  formatTranscript,
  readTheme,
  saveTheme,
} from "../src/logic";
import { samples } from "./fixtures/samples";
describe("upload validation", () => {
  it.each(["a.pdf", "a.PDF", "notes.txt"])("accepts %s", (name) =>
    expect(() => validateFile({ name, size: 100 })).not.toThrow(),
  );
  it.each([
    { name: "evil.pdf.exe", size: 2 },
    { name: "empty.txt", size: 0 },
    { name: "big.pdf", size: MAX_FILE_BYTES + 1 },
    null,
  ])("rejects invalid or oversized uploads", (file) =>
    expect(() => validateFile(file)).toThrow(),
  );
  it("accepts the size boundary", () =>
    expect(() =>
      validateFile({ name: "ok.pdf", size: MAX_FILE_BYTES }),
    ).not.toThrow());
  it("rejects scanned or whitespace-only documents", () =>
    expect(() => validatePages(["", " \n"])).toThrow(/No readable text/));
  it("preserves blank pages for accurate citations", () =>
    expect(validatePages(["", "text"])).toEqual(["", "text"]));
});
describe("study tools", () => {
  it("cards preserve original citations across blank pages", () =>
    expect(makeFlashcards(["", "First fact. Second fact."])).toEqual([
      { prompt: expect.any(String), answer: "First fact.", page: 1 },
      { prompt: expect.any(String), answer: "Second fact.", page: 1 },
    ]));
  it("skips blank cards", () => expect(makeFlashcards([" \n"])).toEqual([]));
});
describe("interview and preferences", () => {
  it("uses both role and experience in guided prompts", () => {
    expect(interviewQuestions("Data Analyst", "Fresher")[1]).toMatch(
      /coursework/,
    );
    expect(interviewQuestions("Data Analyst", "5+ years")[2]).toMatch(
      /guided a team/,
    );
    expect(interviewQuestions("Data Analyst", "Fresher")[0]).toMatch(
      /Data Analyst/,
    );
  });
  it("rejects blank roles", () =>
    expect(() => interviewQuestions("  ", "Fresher")).toThrow());
  it("exports all answers including empty slots", () =>
    expect(
      formatTranscript(["Q1", "Q2"], { 0: "A1" }, "Engineer", "Fresher"),
    ).toMatch(/Q1\nA1\n\nQuestion 2: Q2\n\(No answer recorded\)/));
  it("falls back safely with unavailable storage", () => {
    const storage = {
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
    };
    expect(readTheme(storage)).toBe("light");
    expect(() => saveTheme(storage, "dark")).not.toThrow();
  });
  it("rejects invalid saved theme names", () =>
    expect(readTheme({ getItem: () => "<script>" })).toBe("light"));
});

import { bankFlashcards } from "../src/ai/study";
describe("flashcards from the question bank", () => {
  const bank = {
    2: [
      { question: "Define **multimedia**.", answer: "Multimedia combines text, audio and video. It is used on the web.", trick: "TAV", page: 0, important: true },
      { question: "What is encoding?", answer: "Encoding converts raw audio into a digital format.", page: 1 },
      { question: "What does this code do?\n\n```html\n<audio>\n```", answer: "Plays audio.", page: 2 },
    ],
    5: [
      { question: "Explain the EMBED element.", answer: "- The EMBED element displays external content such as plug-ins.\n- It has src, width and height.", page: 3 },
      { question: "Explain the VIDEO element.", answer: "The VIDEO element displays a video with controls.", page: 4 },
    ],
    8: [],
  };
  it("makes one plain-text card per question, skipping code questions", () => {
    const cards = bankFlashcards(bank);
    expect(cards).toHaveLength(4);
    expect(cards[0]).toMatchObject({ prompt: "Define multimedia.", trick: "TAV", marks: 2, page: 0 });
    expect(cards[0].answer).toMatch(/^Multimedia combines text/);
    expect(cards[2].answer).not.toMatch(/^-/);
  });
});
