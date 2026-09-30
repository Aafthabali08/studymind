import { it, expect, vi } from "vitest";
import { readDocument, downloadText } from "../src/documents";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({
    recognize: vi.fn(async () => ({
      data: { text: "Photo-\nsynthesis makes   sugar.\n\n\n\nEnd" },
    })),
    terminate: vi.fn(async () => {}),
  })),
}));
vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
  OPS: {
    paintImageXObject: 85,
    paintInlineImageXObject: 86,
    paintImageXObjectRepeat: 88,
  },
}));
it("splits TXT form feeds without changing page indexes", async () => {
  const file = {
    name: "notes.txt",
    size: 10,
    text: async () => "First\f\fThird",
  };
  expect(await readDocument(file)).toEqual(["First", "", "Third"]);
});
it("rejects whitespace-only TXT", async () =>
  expect(
    readDocument({ name: "empty.txt", size: 2, text: async () => " \n" }),
  ).rejects.toThrow(/No readable text/));
it("extracts PDF text, preserves line breaks and blank pages, and releases resources", async () => {
  const cleanup = vi.fn(),
    destroy = vi.fn();
  getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: 2,
      getPage: async (i) => ({
        getTextContent: async () => ({
          items:
            i === 1 ? [{ str: "Heading", hasEOL: true }, { str: "Body" }] : [],
        }),
        cleanup,
      }),
    }),
    destroy,
  });
  expect(
    await readDocument({
      name: "book.pdf",
      size: 10,
      arrayBuffer: async () => new ArrayBuffer(1),
    }),
  ).toEqual(["Heading\nBody ", ""]);
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(destroy).toHaveBeenCalledOnce();
  expect(GlobalWorkerOptions.workerSrc).toContain("pdf.worker.min.mjs");
  expect(getDocument).toHaveBeenCalledWith(
    expect.objectContaining({ isEvalSupported: false }),
  );
});
it.each([
  ["PasswordException", "password protected"],
  ["InvalidPDFException", "not a valid PDF"],
])("normalizes %s and cleans up", async (name, message) => {
  const destroy = vi.fn();
  getDocument.mockReturnValue({
    promise: Promise.reject(Object.assign(Error("raw"), { name })),
    destroy,
  });
  await expect(
    readDocument({
      name: "bad.pdf",
      size: 10,
      arrayBuffer: async () => new ArrayBuffer(1),
    }),
  ).rejects.toThrow(message);
  expect(destroy).toHaveBeenCalledOnce();
});
it("creates a downloadable file with exact content and revokes its URL", async () => {
  vi.useFakeTimers();
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  downloadText("Test body", "notes.md");
  expect(click).toHaveBeenCalledOnce();
  const blob = URL.createObjectURL.mock.calls.at(-1)[0];
  expect(blob.size).toBe(9);
  expect(blob.type).toBe("text/plain;charset=utf-8");
  expect(document.querySelector("a[download]")).toBeNull();
  vi.runAllTimers();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
});

it("reads scanned PDFs with OCR and reports progress", async () => {
  const { createWorker } = await import("tesseract.js");
  const page = () => ({
    getTextContent: async () => ({ items: [] }), // no text layer: scanned
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  });
  getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 2, getPage: async () => page() }),
    destroy: vi.fn(),
  });
  const progress = [];
  const pages = await readDocument(
    { name: "scan.pdf", size: 10, arrayBuffer: async () => new ArrayBuffer(1) },
    { onProgress: (p) => progress.push(`${p.done}/${p.total}`) },
  );
  expect(pages).toEqual([
    "Photosynthesis makes sugar.\n\nEnd",
    "Photosynthesis makes sugar.\n\nEnd",
  ]);
  expect(progress).toEqual(["0/2", "1/2", "2/2"]);
  expect(createWorker).toHaveBeenCalledWith("eng");
});

it("keeps the OCR engine for the next scanned file instead of starting it again", async () => {
  const { createWorker } = await import("tesseract.js");
  const page = () => ({
    getTextContent: async () => ({ items: [] }),
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  });
  getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage: async () => page() }),
    destroy: vi.fn(),
  });
  const file = { name: "scan.pdf", size: 10, arrayBuffer: async () => new ArrayBuffer(1) };
  await readDocument(file);
  const started = createWorker.mock.calls.length;
  await readDocument(file);
  await readDocument(file);
  expect(createWorker.mock.calls.length).toBe(started); // reused, not restarted
});
