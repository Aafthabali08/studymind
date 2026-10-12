import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { readFileSync } from "node:fs";
import {
  legacyText,
  paginate,
  readOffice,
  relations,
  resolvePath,
  slideText,
} from "../src/officeReader";
import { UPLOAD_ACCEPT, baseName, fileExtension, validateFile } from "../src/logic";

// Pictures are compressed with a canvas in the browser; here we only check
// that they are found and placed on the right page.
vi.mock("../src/imageUtils", () => ({
  compressImage: vi.fn(async (file) => ({ dataUrl: `data:image/jpeg;base64,${file.name}`, width: 400, height: 300 })),
}));
vi.mock("../src/documents", async (orig) => ({
  ...(await orig()),
  ocrImage: vi.fn(async () => "Photo of the whiteboard: Normal forms 1NF 2NF 3NF"),
}));

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const slide = (...paras) =>
  `<p:sld ${A}><p:cSld><p:spTree><p:sp><p:txBody>${paras
    .map((p) => `<a:p>${(Array.isArray(p) ? p : [p]).map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join("")}</a:p>`)
    .join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const rels = (list) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;
const png = readFileSync("tests/fixtures/figure.jpg");

async function pptx() {
  const zip = new JSZip();
  // Slide files are numbered out of order on purpose: the presentation's
  // own list decides the order.
  zip.file("ppt/presentation.xml", `<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", rels([["rId2", "slide", "slides/slide2.xml"], ["rId3", "slide", "slides/slide1.xml"]]));
  zip.file("ppt/slides/slide2.xml", slide("Unit 1: ER Model", ["An ", "entity", " is a real-world object."]));
  zip.file("ppt/slides/_rels/slide2.xml.rels", rels([["rId1", "image", "../media/image1.jpg"], ["rId2", "notesSlide", "../notesSlides/notesSlide1.xml"]]));
  zip.file("ppt/notesSlides/notesSlide1.xml", slide("Explain with the library example.", "1"));
  zip.file("ppt/slides/slide1.xml", slide("Cardinality", "One-to-one, one-to-many, many-to-many."));
  zip.file("ppt/slides/_rels/slide1.xml.rels", rels([["rId1", "image", "../media/image1.jpg"], ["rId9", "image", "../media/logo.emf"]]));
  zip.file("ppt/media/image1.jpg", png);
  zip.file("ppt/media/logo.emf", "x");
  return new File([await zip.generateAsync({ type: "uint8array" })], "ER model.pptx");
}

async function docxFile() {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Normalization", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun("Normalization removes "), new TextRun({ text: "redundancy", bold: true }), new TextRun(".")] }),
          new Paragraph({ text: "First normal form", bullet: { level: 0 } }),
          new Paragraph({ text: "Second normal form", bullet: { level: 0 } }),
          new Paragraph({ children: [new ImageRun({ type: "jpg", data: png, transformation: { width: 120, height: 80 } })] }),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph("Form")] }), new TableCell({ children: [new Paragraph("Rule")] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph("1NF")] }), new TableCell({ children: [new Paragraph("Atomic values")] })] }),
            ],
          }),
        ],
      },
    ],
  });
  return new File([await Packer.toBuffer(doc)], "Normalization.docx");
}

describe("accepted uploads", () => {
  it("accepts PDF, Word, PowerPoint, images and text files, and nothing else", () => {
    for (const name of ["a.pdf", "a.docx", "a.DOC", "a.pptx", "a.ppt", "a.txt", "a.md", "a.csv", "a.png", "a.jpg", "a.jpeg", "a.webp"])
      expect(() => validateFile(new File(["x"], name))).not.toThrow();
    expect(() => validateFile(new File(["x"], "a.exe"))).toThrow(/PDF, Word, PowerPoint/);
    expect(() => validateFile(new File([""], "a.pdf"))).toThrow(/empty/);
    expect(UPLOAD_ACCEPT).toContain(".pptx");
    expect(fileExtension("Unit 1.Notes.PPTX")).toBe("pptx");
    expect(baseName("Unit 1 notes.pptx")).toBe("Unit 1 notes");
  });
});

describe("PowerPoint", () => {
  it("reads one page per slide in presentation order, with speaker notes and each slide's pictures", async () => {
    const { pages, images } = await readOffice(await pptx(), { images: true });
    expect(pages).toEqual([
      "Unit 1: ER Model\nAn entity is a real-world object.\n\nSpeaker notes:\nExplain with the library example.",
      "Cardinality\nOne-to-one, one-to-many, many-to-many.",
    ]);
    // The same picture on two slides is kept once; EMF can't be shown.
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ page: 0, width: 400 });
  });
  it("parses slide XML, relationships and relative paths", () => {
    expect(slideText(slide("A", ["B", "C"]))).toBe("A\nBC");
    expect(relations(rels([["r1", "image", "../media/a.png"]]))).toEqual({
      r1: { type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", target: "../media/a.png" },
    });
    expect(resolvePath("ppt/slides/slide1.xml", "../media/a.png")).toBe("ppt/media/a.png");
  });
});

describe("Word", () => {
  it("reads headings, paragraphs, lists and tables, with pictures on their page", async () => {
    const { pages, images } = await readOffice(await docxFile(), { images: true });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Normalization\n\nNormalization removes redundancy.");
    expect(pages[0]).toContain("• First normal form\n• Second normal form");
    expect(pages[0]).toContain("Form | Rule\n1NF | Atomic values");
    expect(images).toHaveLength(1);
    expect(images[0].page).toBe(0);
  });
  it("splits long documents into pages of about 450 words, at headings", () => {
    const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const pages = paginate([
      { text: "Unit 1", heading: true },
      { text: words(300) },
      { text: "Unit 2", heading: true },
      { text: words(300) },
    ]);
    expect(pages).toHaveLength(2);
    expect(pages[1].startsWith("Unit 2")).toBe(true);
  });
});

describe("older formats and images", () => {
  it("pulls readable text out of a Word / PowerPoint 97–2003 file", async () => {
    const utf16 = (s) => {
      const out = new Uint8Array(s.length * 2);
      [...s].forEach((c, i) => (out[i * 2] = c.charCodeAt(0)));
      return out;
    };
    const junk = new Uint8Array(64).map((_, i) => (i * 37) % 7);
    const parts = [junk, utf16("Times New Roman"), junk, utf16("Database normalization reduces redundancy and improves integrity of the stored data."), junk, utf16("Functional dependencies decide which normal form a relation is in."), junk];
    const buffer = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      buffer.set(p, offset);
      offset += p.length;
    }
    const text = legacyText(buffer.buffer);
    expect(text).toContain("Database normalization reduces redundancy");
    expect(text).toContain("Functional dependencies decide");
    expect(text).not.toContain("Times New Roman");
    const { pages } = await readOffice(new File([buffer], "old notes.doc"));
    expect(pages.join(" ")).toContain("Functional dependencies");
    await expect(readOffice(new File([junk], "empty.ppt"))).rejects.toThrow(/save it as \.pptx/);
  });
  it("reads a photo with OCR and keeps the photo as a figure", async () => {
    const { pages, images } = await readOffice(new File([png], "board.jpg", { type: "image/jpeg" }), { images: true });
    expect(pages).toEqual(["Photo of the whiteboard: Normal forms 1NF 2NF 3NF"]);
    expect(images).toEqual([expect.objectContaining({ id: "img-1", page: 0 })]);
  });
});
