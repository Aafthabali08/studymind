import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { fileName, inlineRuns, markdownBlocks } from "../src/exporters/blocks";
import { renderPdf } from "../src/exporters/pdf";
import { renderWord } from "../src/exporters/word";
import { markdownDocument } from "../src/exporters/index";

const fonts = Object.fromEntries(
  ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSansMono.ttf"].map((f) => [
    f,
    readFileSync(`public/fonts/${f}`).toString("base64"),
  ]),
);
const jpeg = `data:image/jpeg;base64,${readFileSync("tests/fixtures/figure.jpg").toString("base64")}`;
const images = [{ id: "f1", page: 1, dataUrl: jpeg, width: 120, height: 80, caption: "Layers" }];
const markdown = `# Neural networks
Intro with **bold**, *italic* and \`inline code\`.

## Training
### Backpropagation
#### Chain rule
1. Forward pass
2. Backward pass
   - compute ∂L/∂w
   - update weights
3. Repeat

> A quoted definition.

> 🧠 **Remember:** Forward, then backward.

\`\`\`python
for x, y in data:
    w -= lr * grad(x, y)
\`\`\`

| Term | Meaning |
|---|---|
| Gradient | slope → descent |
| Rate α | step ≤ 0.1 |

![Network](image:f1)

---
The end.`;
const blocks = [
  ...markdownDocument({ title: "Study notes", subtitle: "Detailed notes", meta: "3 pages", markdown }),
  { type: "question", n: 1, text: "Explain backpropagation.", meta: "5 marks · page 2", important: true },
  { type: "label", text: "Model answer" },
  { type: "p", text: "Line one\nLine two", plain: true },
  { type: "callout", label: "Memory trick", text: "**F**orward then **B**ack" },
];

describe("document model", () => {
  it("parses every markdown element into styled blocks", () => {
    const types = markdownBlocks(markdown).map((b) => (b.type === "h" ? `h${b.level}` : b.type));
    expect(types).toEqual([
      "h1", "p", "h2", "h3", "h4", "li", "li", "li", "li", "li", "quote", "callout", "code", "table", "image", "rule", "p",
    ]);
    const list = markdownBlocks(markdown).filter((b) => b.type === "li");
    expect(list.map((b) => [b.ordered, b.n, b.indent])).toEqual([
      [true, 1, 0], [true, 2, 0], [false, null, 1], [false, null, 1], [true, 3, 0],
    ]);
    expect(markdownBlocks(markdown).find((b) => b.type === "code")).toMatchObject({ lang: "python" });
    expect(markdownBlocks("## Intro", { shift: 1 })[0]).toMatchObject({ level: 3 });
  });
  it("splits inline bold, italic and code", () => {
    expect(inlineRuns("a **b *c*** `d` _e_ snake_case 2*3*4")).toEqual([
      { text: "a " },
      { text: "b ", bold: true },
      { text: "c", italic: true, bold: true },
      { text: " " },
      { text: "d", code: true },
      { text: " " },
      { text: "e", italic: true },
      { text: " snake_case 2*3*4" },
    ]);
  });
  it("names files safely", () => {
    expect(fileName(["Notes.pdf", "Page 1 summary"], "docx")).toBe("Notes - Page 1 summary.docx");
  });
});

describe("PDF", () => {
  it("draws every block with its text", async () => {
    const { pdf } = await renderPdf(blocks, { images, fonts, footer: "StudyMind · Notes" });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const file = await pdfjs.getDocument({ data: new Uint8Array(pdf.output("arraybuffer")) }).promise;
    let text = "";
    for (let i = 1; i <= file.numPages; i++)
      text += (await (await file.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + " ";
    text = text.replace(/\s+/g, " ");
    for (const part of [
      "Study notes", "Detailed notes", "Neural networks", "inline code", "Chain rule",
      "1. Forward pass", "compute ∂L/∂w", "A quoted definition.", "REMEMBER", "PYTHON",
      "w -= lr * grad(x, y)", "Gradient", "step ≤ 0.1", "Figure from page 2: Network",
      "Q1. Explain backpropagation.", "★ IMPORTANT", "MODEL ANSWER", "Line one Line two",
      "MEMORY TRICK", "Page 1 of",
    ])
      expect(text).toContain(part);
    expect(pdf.output()).toMatch(/\/Subtype \/Image/);
  });
});

describe("Word", () => {
  it("uses real Word styles for headings, lists, code, tables, quotes and figures", async () => {
    const { buffer } = await renderWord(blocks, { images, title: "Study notes", buffer: true });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml").async("string");
    const styles = await zip.file("word/styles.xml").async("string");
    const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const style of ["Title", "Heading1", "Heading2", "Heading3", "Heading4", "Code"])
      expect(xml).toContain(`<w:pStyle w:val="${style}"/>`);
    expect(styles).toContain('w:styleId="Code"');
    expect(xml).toMatch(/<w:numPr>/); // bullet and numbered lists
    expect(xml).toContain("<w:tbl>");
    expect(xml).toMatch(/w:rFonts w:ascii="Consolas"/); // inline code
    expect(xml).toMatch(/<w:b\/>/);
    expect(xml).toMatch(/<w:i\/>/);
    expect(xml).toContain('w:fill="FFF7E0"'); // callout box
    expect(Object.keys(zip.files).some((f) => f.startsWith("word/media/"))).toBe(true);
    for (const part of [
      "Neural networks", "Backpropagation", "for x, y in data:", "w -= lr * grad(x, y)",
      "Gradient", "Figure from page 2: Network", "Q1.", "Explain backpropagation.",
      "★ IMPORTANT", "MEMORY TRICK", "Line one", "Line two",
    ])
      expect(text).toContain(part);
    expect(await zip.file("word/footer1.xml").async("string")).toContain("PAGE");
  });
});
