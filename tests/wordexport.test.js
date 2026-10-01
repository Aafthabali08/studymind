import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { expect, it } from "vitest";
import { documentToWord, pageParagraphs, wordFileName } from "../src/wordExport";

const jpeg = `data:image/jpeg;base64,${readFileSync("tests/fixtures/figure.jpg").toString("base64")}`;

it("names the Word file after the document", () => {
  expect(wordFileName("Neural Networks.pdf")).toBe("Neural Networks - text.docx");
  expect(wordFileName("a/b:c.docx")).toBe("a b c - text.docx");
});

it("splits page text into paragraphs of lines", () => {
  expect(pageParagraphs("Title\n\nLine one\nLine two\n\n\n  \nEnd")).toEqual([
    ["Title"],
    ["Line one", "Line two"],
    ["End"],
  ]);
});

it("writes every page's text under its heading, with that page's figures", async () => {
  const doc = {
    name: "Neural Networks.pdf",
    pages: ["Intro text\n\nα and β → γ", "", "Backpropagation uses the chain rule."],
    images: [{ id: "f", page: 2, dataUrl: jpeg, width: 120, height: 80, caption: "Layers" }],
  };
  const { buffer, fileName } = await documentToWord(doc, { buffer: true });
  expect(fileName).toBe("Neural Networks - text.docx");
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  expect(text).toContain("Neural Networks");
  expect(text).toMatch(/Page 1 .*Intro text .*α and β → γ .*Page 2 .*No text on this page\. .*Page 3 .*Backpropagation uses the chain rule\. .*Figure from page 3: Layers/);
  expect(Object.keys(zip.files).some((f) => f.startsWith("word/media/"))).toBe(true);
});
