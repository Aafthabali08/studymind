import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildQuestionPdf,
  figuresFor,
  markdownBlocks,
  pdfCategories,
  pdfFileName,
  pdfText,
  selectQuestions,
} from "../src/questionPdf";

const fonts = Object.fromEntries(
  ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSansMono.ttf"].map((f) => [
    f,
    readFileSync(`public/fonts/${f}`).toString("base64"),
  ]),
);
const jpeg = `data:image/jpeg;base64,${readFileSync("tests/fixtures/figure.jpg").toString("base64")}`;
const doc = {
  id: "d1",
  name: "Neural Networks.pdf",
  pages: ["p1", "p2", "p3"],
  images: [
    { id: "img-1", page: 1, dataUrl: jpeg, width: 120, height: 80, caption: "Layers" },
    { id: "img-2", page: 2, dataUrl: jpeg, width: 120, height: 80 },
  ],
};
const bank = {
  2: [
    { question: "Define overfitting.", answer: "Overfitting is **memorising** noise (p. 3).", type: "Definitions", page: 2, important: true, trick: "Over = too much" },
    { question: "What is a neuron?", answer: "A unit that weighs inputs.", type: "Definitions", page: 0 },
  ],
  5: [
    {
      question: "Explain backpropagation with a diagram.",
      answer:
        "## Introduction\nIt uses the chain rule: ∂L/∂w → update, α ≤ 0.1.\n\n![Layers](image:img-1)\n\n| Step | Action |\n|---|---|\n| 1 | Forward |\n| 2 | Backward |\n\n```python\nw -= lr * grad\n```\n\n- Key point one\n- Key point two",
      type: "Explain",
      page: 1,
      important: true,
    },
  ],
  8: [
    { question: "Discuss training of neural networks.", answer: "Training repeats forward and backward passes.", type: "Discuss", page: 2 },
  ],
};

async function textOf(pdf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(pdf.output("arraybuffer"));
  const file = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  let text = "";
  for (let i = 1; i <= file.numPages; i++) {
    const page = await file.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((x) => x.str).join(" ") + "\n";
  }
  return { text: text.replace(/\s+/g, " "), pages: file.numPages };
}
const imageCount = (pdf) =>
  (pdf.output().match(/\/Subtype \/Image/g) || []).length;

describe("question bank PDF", () => {
  it("offers all, each marks group and each question type as categories", () => {
    expect(pdfCategories(bank).map((c) => c.label)).toEqual([
      "All categories",
      "2-mark questions",
      "2 marks · Definitions",
      "5-mark questions",
      "5 marks · Explain",
      "8-mark questions",
      "8 marks · Discuss",
    ]);
    expect(
      selectQuestions(bank, { category: "all", importantOnly: true }).map((s) => s.marks),
    ).toEqual([2, 5]);
  });

  it("names the file after the document, category and choice", () => {
    expect(pdfFileName("Neural Networks.pdf", "5-mark questions", true)).toBe(
      "Neural Networks - 5-mark questions - Important questions.pdf",
    );
    expect(pdfFileName("a/b:c.pdf", "All categories", false)).toBe(
      "a b c - All categories - All predicted questions.pdf",
    );
  });

  it("writes important questions with answers, tricks, tables, code and the figure the answer shows", async () => {
    const { pdf, fileName, count } = await buildQuestionPdf({
      doc,
      bank,
      category: "all",
      importantOnly: true,
      fonts,
    });
    expect(fileName).toBe("Neural Networks - All categories - Important questions.pdf");
    expect(count).toBe(2);
    const { text } = await textOf(pdf);
    expect(text).toContain("Important questions · All categories");
    expect(text).toContain("Define overfitting.");
    expect(text).toContain("memorising");
    expect(text).toContain("MEMORY TRICK Over = too much");
    expect(text).toContain("Explain backpropagation with a diagram.");
    expect(text).toContain("∂L/∂w → update, α ≤ 0.1");
    expect(text).toContain("Forward");
    expect(text).toContain("w -= lr * grad");
    expect(text).toContain("Figure from page 2: Layers");
    expect(text).not.toContain("What is a neuron?");
    expect(text).not.toContain("Discuss training");
    expect(text).toMatch(/Page 1 of \d/);
    // Backprop's own figure (page 2), and page 3's figure for overfitting,
    // which shows none of its own (both use one test image, stored once).
    expect(text).toContain("Figure from page 3");
    expect(imageCount(pdf)).toBe(1);
  });

  it("downloads one category with all predicted questions", async () => {
    const { pdf, fileName, count } = await buildQuestionPdf({
      doc,
      bank,
      category: "m2:Definitions",
      importantOnly: false,
      fonts,
    });
    expect(fileName).toBe(
      "Neural Networks - 2 marks · Definitions - All predicted questions.pdf",
    );
    expect(count).toBe(2);
    const { text } = await textOf(pdf);
    expect(text).toContain("What is a neuron?");
    expect(text).not.toContain("backpropagation");
  });

  it("explains an empty selection instead of making an empty PDF", async () => {
    await expect(
      buildQuestionPdf({ doc, bank, category: "m8", importantOnly: true, fonts }),
    ).rejects.toThrow(/no important questions/);
  });

  it("parses answer markdown and keeps only drawable characters", () => {
    expect(markdownBlocks("# T\n\ntext\n\n- a\n1. b\n\n> q\n\n![c](image:x)").map((b) => b.type)).toEqual([
      "h", "p", "li", "li", "quote", "image",
    ]);
    expect(pdfText("Brain 🧠 ✅ done ★")).toBe("Brain  ✓ done ★");
    expect(figuresFor(bank[5][0], doc.images)).toEqual({ inline: true, ids: ["img-1"], list: [] });
    expect(figuresFor(bank[2][1], doc.images).list).toHaveLength(0);
  });
});

it("names the complete question bank PDF with a title", async () => {
  const { fileName, count } = await buildQuestionPdf({
    doc,
    bank,
    category: "all",
    title: "Complete question bank",
    fonts,
  });
  expect(fileName).toBe("Neural Networks - Complete question bank.pdf");
  expect(count).toBe(4);
});
