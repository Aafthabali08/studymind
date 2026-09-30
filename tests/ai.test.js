import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  splitSentences,
  chunkPages,
  buildIndex,
  bm25Search,
  extractiveAnswer,
  summarizeExtractive,
  extractKeywords,
  fuseRankings,
} from "../src/ai/text";
import {
  parseResume,
  resumeQuestions,
  reviewAnswer,
  hasResumeContent,
} from "../src/ai/interview";
import {
  answerQuestion,
  canGenerate,
  quickAnswer,
  quickSummary,
  updateSettings,
} from "../src/ai/engine";
import { samples } from "./fixtures/samples";

const resumeText = readFileSync("tests/fixtures/resume.txt", "utf8");
const ai = samples[0];

describe("chunking", () => {
  it("splits sentences, headings and bullets", () =>
    expect(
      splitSentences("Title\n\nFirst one. Second one!\n• Bullet point"),
    ).toEqual(["Title", "First one.", "Second one!", "Bullet point"]));
  it("keeps page numbers, skips blank pages, and overlaps by one sentence", () => {
    const long = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i} has exactly seven words.`,
    ).join(" ");
    const chunks = chunkPages(["", long, "Short page."], { targetWords: 50 });
    expect(chunks.some((c) => c.page === 0)).toBe(false);
    expect(chunks.at(-1)).toMatchObject({ page: 2, text: "Short page." });
    const page1 = chunks.filter((c) => c.page === 1);
    expect(page1.length).toBeGreaterThan(3);
    page1.forEach((c) => expect(c.words).toBeLessThanOrEqual(57));
    const lastOfFirst = page1[0].text.split("\n").at(-1);
    expect(page1[1].text.startsWith(lastOfFirst)).toBe(true);
  });
});

describe("retrieval", () => {
  const index = buildIndex(chunkPages(ai.pages));
  it("ranks the page that answers the question first", () =>
    expect(bm25Search(index, "What is backpropagation?")[0].chunk.page).toBe(
      2,
    ));
  it("matches simple word forms", () =>
    expect(bm25Search(index, "heuristics")[0].chunk.page).toBe(1));
  it("returns verbatim sentences with their page, or null", () => {
    const answer = extractiveAnswer(
      index,
      "What does an admissible heuristic do?",
    );
    expect(answer.page).toBe(1);
    expect(ai.pages[1]).toContain(answer.text.split(". ")[0]);
    expect(extractiveAnswer(index, "photosynthesis chlorophyll")).toBeNull();
  });
  it("fuses rankings with weights", () => {
    const a = { chunk: { id: 1 } },
      b = { chunk: { id: 2 } };
    expect(
      fuseRankings(
        [
          [a, b],
          [b, a],
        ],
        2,
        [1, 2],
      )[0].chunk.id,
    ).toBe(2);
  });
});

describe("summaries and keywords", () => {
  it("quotes key sentences exactly, in reading order", () => {
    const summary = summarizeExtractive(ai.pages, { sentences: 4 });
    expect(summary).toHaveLength(4);
    summary.forEach((s) => expect(ai.pages[s.page]).toContain(s.text));
    const pages = summary.map((s) => s.page);
    expect([...pages].sort()).toEqual(pages);
  });
  it("summarises a single page with the right page number", () => {
    const summary = quickSummary(ai, 2, 2);
    expect(summary.length).toBeGreaterThan(0);
    summary.forEach((s) => expect(s.page).toBe(2));
  });
  it("finds meaningful terms, not stop words", () => {
    const words = extractKeywords(ai.pages.join("\n"));
    expect(words.join(" ")).toMatch(/learning|search|neural/);
    expect(words).not.toContain("the");
  });
});

describe("resume understanding", () => {
  const profile = parseResume(resumeText);
  it("extracts contact, skills, roles, projects and measurable claims", () => {
    expect(profile.name).toBe("Priya Sharma");
    expect(profile.email).toBe("priya.sharma@example.com");
    expect(profile.skills).toEqual(
      expect.arrayContaining(["React", "Docker", "FastAPI"]),
    );
    expect(profile.experience[0].title).toMatch(/Software Engineering Intern/);
    expect(profile.experience[0].points).toHaveLength(3);
    expect(profile.projects.map((p) => p.title)).toEqual([
      "StudyBuddy – AI flashcard generator",
      "Campus Events App",
    ]);
    expect(profile.metrics.join(" ")).toMatch(/40%/);
    expect(hasResumeContent(profile)).toBe(true);
  });
  it("asks questions grounded in the resume, honouring the count", () => {
    const qs = resumeQuestions(profile, "Frontend Developer", "Fresher", 6);
    expect(qs).toHaveLength(6);
    expect(qs[0]).toMatch(/Frontend Developer/);
    expect(qs.join(" ")).toMatch(/StudyBuddy/);
    expect(qs.join(" ")).toMatch(/Acme Analytics/);
    expect(qs.join(" ")).toMatch(/40%/);
    expect(qs.join(" ")).not.toMatch(/\.\"\./);
  });
  it("falls back to general questions without resume content", () => {
    const qs = resumeQuestions(
      parseResume("hello there"),
      "Designer",
      "Fresher",
      3,
    );
    expect(qs[0]).toMatch(/Tell me about yourself/);
    expect(() => resumeQuestions(profile, " ", "Fresher")).toThrow();
  });
});

describe("answer checklist", () => {
  it("flags short, filler-heavy, team-only answers", () => {
    const r = reviewAnswer(
      "Basically we um did it and we like shipped it, basically.",
    );
    expect(r.improvements.join(" ")).toMatch(/short/);
    expect(r.improvements.join(" ")).toMatch(/filler/);
    expect(r.improvements.join(" ")).toMatch(/"I" 0 times/);
  });
  it("recognises situation, action and result", () => {
    const answer =
      "During my internship at Acme, our sales dashboard took eight seconds to load and analysts complained every week. " +
      "I analysed the slow queries, I designed a Redis cache for the three heaviest endpoints and I wrote tests to make sure the numbers stayed correct. " +
      "As a result, response time dropped by 40% and the dashboard was used daily by 1,200 analysts. I learned to measure before optimising.";
    const r = reviewAnswer(answer);
    expect(r.strengths.length).toBeGreaterThanOrEqual(4);
    expect(r.improvements).toEqual([]);
  });
});

describe("engine", () => {
  afterEach(() => updateSettings({ engine: "fast" }));
  it("answers instantly with no model and persists settings", () => {
    expect(canGenerate()).toBe(false);
    expect(quickAnswer(ai, "What is backpropagation?").page).toBe(2);
    updateSettings({
      engine: "remote",
      baseUrl: "http://llm.test/v1",
      model: "llama",
    });
    expect(JSON.parse(localStorage.getItem("studymind-ai"))).toMatchObject({
      engine: "remote",
      model: "llama",
    });
    expect(canGenerate()).toBe(true);
  });
  it("streams a cited answer from an OpenAI-compatible server", async () => {
    updateSettings({
      engine: "remote",
      baseUrl: "http://llm.test/v1/",
      model: "llama",
      apiKey: "k",
    });
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Backprop uses "}}]}\n',
      'data: {"choices":[{"delta":{"content":"the chain rule [p. 3]."}}]}\n\ndata: [DONE]\n',
    ];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            chunks.length
              ? { done: false, value: new TextEncoder().encode(chunks.shift()) }
              : { done: true },
        }),
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const tokens = [];
    const res = await answerQuestion(ai, "What is backpropagation?", {
      onToken: (t) => tokens.push(t),
    });
    expect(res.text).toBe("Backprop uses the chain rule [p. 3].");
    expect(tokens).toHaveLength(2);
    expect(res.extract.page).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://llm.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer k");
    const body = JSON.parse(init.body);
    expect(body.messages[1].content).toMatch(/\[p\. 3\]/);
    vi.unstubAllGlobals();
  });
  it("keeps the extract when the model server is unreachable", async () => {
    updateSettings({
      engine: "remote",
      baseUrl: "http://llm.test/v1",
      model: "llama",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const res = await answerQuestion(ai, "What is backpropagation?");
    expect(res.text).toBeNull();
    expect(res.error).toMatch(/Could not reach/);
    expect(res.extract.page).toBe(2);
    vi.unstubAllGlobals();
  });
});
