import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { pagesHtml, sanitizeHtml, standalonePage, viewKind } from "../src/DocumentViewer";

const api = vi.hoisted(() => ({ loadOriginal: vi.fn(), loadUniFile: vi.fn() }));
vi.mock("../src/university", async (orig) => ({ ...(await orig()), ...api }));
vi.mock("../src/documents", async (orig) => ({ ...(await orig()), downloadBlob: vi.fn() }));
const { default: DocumentViewer } = await import("../src/DocumentViewer");
const { downloadBlob } = await import("../src/documents");

describe("how files are shown", () => {
  it("picks a view for each file type", () => {
    expect(viewKind("a.pdf")).toBe("pdf");
    expect(viewKind("a.JPG")).toBe("image");
    expect(viewKind("a.md")).toBe("text");
    expect(viewKind("a.docx")).toBe("word");
    expect(viewKind("a.pptx")).toBe("slides");
    expect(viewKind("a.ppt")).toBe("slides");
    expect(viewKind("a.doc")).toBe("pages");
  });
  it("removes scripts, event handlers and script links from document HTML", () => {
    const html = sanitizeHtml('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:evil()">x</a><a href="https://gitam.edu">site</a><img src="data:image/png;base64,AA">');
    expect(html).not.toMatch(/script|onclick|javascript/);
    expect(html).toContain('href="https://gitam.edu"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('src="data:image/png;base64,AA"');
  });
  it("shows slides with their pictures and escapes their text", () => {
    const html = pagesHtml(["Intro <b>x</b>\n\nSecond", "Next"], [{ page: 1, dataUrl: "data:image/jpeg;base64,A" }], "Slide");
    expect(html).toContain("<h2>Slide 1</h2><p>Intro &lt;b&gt;x&lt;/b&gt;</p><p>Second</p>");
    expect(html).toContain('<h2>Slide 2</h2><p>Next</p><figure><img src="data:image/jpeg;base64,A"');
  });
  it("builds a new-tab page with Full screen, Download and Close", () => {
    const page = standalonePage({ title: "Unit 1 <notes>", kind: "pdf", url: "blob:x", fileName: "u1.pdf" });
    expect(page).toContain("<title>Unit 1 &lt;notes&gt;</title>");
    expect(page).toContain('<iframe class="dv-frame" src="blob:x"');
    expect(page).toMatch(/requestFullscreen[\s\S]*Full screen/);
    expect(page).toContain('download="u1.pdf">Download</a>');
    expect(page).toContain('onclick="window.close()">Close</button>');
  });
});

const pdf = { id: "f1", name: "Unit 1 notes", fileName: "Unit 1 notes.pdf", mime: "application/pdf", hasOriginal: true };
beforeEach(() => {
  api.loadOriginal.mockReset();
  api.loadUniFile.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:viewer");
});
afterEach(() => vi.restoreAllMocks());

it("shows a PDF inside StudyMind with full screen, new tab, download and close", async () => {
  api.loadOriginal.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
  const onClose = vi.fn();
  render(<DocumentViewer node={pdf} onClose={onClose} notify={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "View Unit 1 notes" });
  expect(await screen.findByTitle("Unit 1 notes")).toHaveAttribute("src", "blob:viewer");
  // Full screen (the browser's, or filling the window when it has none).
  await userEvent.click(screen.getByRole("button", { name: "Full screen" }));
  expect(dialog).toHaveClass("full");
  await userEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
  expect(dialog).not.toHaveClass("full");
  // New tab: a page of its own with the same toolbar.
  const tab = { location: { href: "" } };
  vi.spyOn(window, "open").mockReturnValue(tab);
  await userEvent.click(screen.getByRole("button", { name: "Open in new tab" }));
  expect(window.open).toHaveBeenCalledWith("", "_blank");
  expect(tab.location.href).toBe("blob:viewer");
  const page = await URL.createObjectURL.mock.calls.at(-1)[0].text();
  expect(page).toContain("Full screen");
  expect(page).toContain("window.close()");
  await userEvent.click(screen.getByRole("button", { name: "Download" }));
  expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "Unit 1 notes.pdf");
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();
});

it("shows a Word file with its formatting", async () => {
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: "ER Model", heading: HeadingLevel.HEADING_1 }), new Paragraph({ children: [new TextRun({ text: "Entities", bold: true }), new TextRun(" are objects.")] })] }] });
  const buffer = await Packer.toBuffer(doc);
  api.loadOriginal.mockResolvedValue(new Blob([buffer]));
  render(<DocumentViewer node={{ id: "w", name: "ER notes", fileName: "ER notes.docx", hasOriginal: true }} onClose={vi.fn()} notify={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "ER Model" }, { timeout: 4000 })).toBeVisible();
  expect(screen.getByText("Entities").tagName).toBe("STRONG");
});

it("shows PowerPoint slide by slide, and the read text when there is no original", async () => {
  api.loadOriginal.mockResolvedValue(new Blob(["pptx"]));
  api.loadUniFile.mockResolvedValue({ pages: ["Unit 1: ER Model", "Cardinality"], images: [] });
  const { unmount } = render(<DocumentViewer node={{ id: "s", name: "ER slides", fileName: "ER slides.pptx", hasOriginal: true }} onClose={vi.fn()} notify={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "Slide 2" })).toBeVisible();
  expect(screen.getByText("Cardinality")).toBeVisible();
  unmount();
  const notify = vi.fn();
  render(<DocumentViewer node={{ id: "big", name: "Big scan", fileName: "Big scan.pdf", hasOriginal: false }} onClose={vi.fn()} notify={notify} />);
  expect(await screen.findByText(/original isn't stored/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Download" }));
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/over 15 MB/));
});
