import "./streamPolyfill";
import { validateFile, validatePages } from "./logic";
let pdfWorker;
const MAX_IMAGES = 40,
  MAX_PER_PAGE = 6,
  MIN_SIDE = 90,
  TEXT_BATCH = 8,
  MAX_EDGE = 800; // figures are shown at card width; smaller = faster saves

/** Draws a pdf.js image object (ImageBitmap or raw pixels) to a JPEG data URL. */
function toJpeg(img) {
  const w = img?.width,
    h = img?.height;
  if (!w || !h || w < MIN_SIDE || h < MIN_SIDE) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0, out.width, out.height);
  else if (img.data && (img.kind === 2 || img.kind === 3)) {
    const full = document.createElement("canvas");
    full.width = w;
    full.height = h;
    const pixels = full.getContext("2d").createImageData(w, h);
    const src = img.data,
      step = img.kind === 3 ? 4 : 3;
    for (let i = 0, j = 0; j < pixels.data.length; i += step, j += 4) {
      pixels.data[j] = src[i];
      pixels.data[j + 1] = src[i + 1];
      pixels.data[j + 2] = src[i + 2];
      pixels.data[j + 3] = step === 4 ? src[i + 3] : 255;
    }
    full.getContext("2d").putImageData(pixels, 0, 0);
    ctx.drawImage(full, 0, 0, out.width, out.height);
  } else return null;
  const url = out.toDataURL("image/jpeg", 0.65);
  // Keep each image well under Firestore's 1 MB document limit.
  return url.length < 700_000
    ? { dataUrl: url, width: out.width, height: out.height }
    : null;
}

function objectFor(page, name) {
  const store = name.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    try {
      store.get(name, (obj) => {
        clearTimeout(timer);
        resolve(obj);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Pictures on a page, plus a page snapshot for vector-drawn diagrams. */
async function pageImages(pdfjs, page, pageIndex) {
  const { OPS } = pdfjs;
  const ops = await page.getOperatorList();
  const names = new Set();
  let paths = 0;
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat)
      names.add(ops.argsArray[i][0]);
    if (fn === OPS.constructPath) paths++;
  });
  const found = [];
  for (const name of names) {
    if (found.length >= MAX_PER_PAGE) break;
    const img = toJpeg(await objectFor(page, name));
    if (img) found.push({ ...img, page: pageIndex, kind: "image" });
  }
  if (!found.length && paths > 120) {
    // Many drawing operations and no pictures: probably a chart or diagram.
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      const snap = toJpeg({
        bitmap: canvas,
        width: canvas.width,
        height: canvas.height,
      });
      if (snap) found.push({ ...snap, page: pageIndex, kind: "page" });
    }
  }
  return found;
}

/**
 * Joins pdf.js text items into lines. PDFs store no leading spaces, so each
 * line's indentation is rebuilt from its x position; this keeps code
 * (Python blocks, nested loops) readable.
 */
function pageText(items) {
  const lines = [];
  let line = null;
  for (const item of items) {
    line ||= {
      x: item.str.trim() ? item.transform?.[4] : undefined,
      size: Math.abs(item.transform?.[0] || 0),
      text: "",
    };
    if (line.x === undefined && item.str.trim()) {
      line.x = item.transform?.[4];
      line.size = Math.abs(item.transform?.[0] || 0);
    }
    line.text += item.str + (item.hasEOL ? "\n" : " ");
    if (item.hasEOL) {
      lines.push(line);
      line = null;
    }
  }
  if (line) lines.push(line);
  const xs = lines.map((l) => l.x).filter((x) => typeof x === "number");
  const left = xs.length ? Math.min(...xs) : 0;
  return lines
    .map((l) => {
      const unit = (l.size || 10) * 0.55;
      const spaces =
        typeof l.x === "number" ? Math.round((l.x - left) / unit) : 0;
      // Ignore tiny offsets and centred text far from the margin.
      return (spaces >= 2 && spaces <= 40 ? " ".repeat(spaces) : "") + l.text;
    })
    .join("");
}

const MAX_OCR_PAGES = 80;
// No text layer, or only a stray page number ("Page 12"): fewer than 2 words.
const isBlank = (t) => ((t || "").match(/\p{L}{3,}/gu) || []).length < 2;

/**
 * Pages to OCR: every blank page when most of the document is blank (a
 * scanned PDF), otherwise only blank pages that contain a picture (a scanned
 * page inside a normal PDF). Title or separator pages are skipped.
 */
async function pagesNeedingOcr(pdf, pages, OPS) {
  const blank = pages
    .map((t, i) => (isBlank(t) ? i : -1))
    .filter((i) => i >= 0);
  if (!blank.length) return [];
  if (blank.length / pages.length > 0.5) return blank.slice(0, MAX_OCR_PAGES);
  const withPictures = [];
  for (const i of blank.slice(0, MAX_OCR_PAGES)) {
    try {
      const page = await pdf.getPage(i + 1);
      const ops = await page.getOperatorList();
      const pictures = [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageXObjectRepeat,
      ];
      if (ops.fnArray.some((fn) => pictures.includes(fn))) withPictures.push(i);
    } catch {
      /* not decodable: skip */
    }
  }
  return withPictures;
}

async function renderPage(page) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    // ~1700 px wide is plenty for OCR accuracy and ~30% less work than 2000.
    scale: Math.min(2, 1700 / base.width),
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return canvas;
}

/** Joins words split across lines and tidies OCR spacing. */
export function cleanOcrText(text) {
  return (text || "")
    .replace(/(\p{L})-\n(\p{L})/gu, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- OCR (Tesseract.js, free, in the browser) ---------------------------------
// Workers are kept for a minute after use, so several scanned files in a row
// (or one after another) don't pay the ~4 s start-up each time.
const OCR_IDLE_MS = 60_000;
let ocrPool = [],
  ocrIdleTimer,
  tesseract;
const ocrParallel = () => {
  const cores = navigator.hardwareConcurrency || 2;
  return cores >= 8 ? 3 : cores >= 4 ? 2 : 1;
};
async function ocrWorkers(count) {
  clearTimeout(ocrIdleTimer);
  // Loaded once and shared. Tesseract.js is CommonJS: named exports may only
  // exist on `default`.
  if (!tesseract) {
    tesseract = import("tesseract.js");
    tesseract.catch(() => (tesseract = null));
  }
  const mod = await tesseract;
  const createWorker = mod.createWorker || mod.default?.createWorker;
  while (ocrPool.length < count) {
    const worker = createWorker("eng");
    worker.catch(() => (ocrPool = ocrPool.filter((w) => w !== worker)));
    ocrPool.push(worker);
  }
  return Promise.all(ocrPool.slice(0, count));
}
function releaseOcrWorkers() {
  clearTimeout(ocrIdleTimer);
  ocrIdleTimer = setTimeout(() => {
    const pool = ocrPool;
    ocrPool = [];
    pool.forEach((w) => w.then((x) => x.terminate()).catch(() => {}));
  }, OCR_IDLE_MS);
}

/** OCR of the given pages, in parallel; progress is reported per page. */
async function ocrPages(pdf, pages, indexes, onProgress) {
  const total = indexes.length;
  let done = 0;
  onProgress?.({ stage: "ocr", done, total });
  const workers = await ocrWorkers(Math.min(total, ocrParallel()));
  const queue = [...indexes];
  try {
    await Promise.all(
      workers.map(async (worker) => {
        while (queue.length) {
          const i = queue.shift();
          const page = await pdf.getPage(i + 1);
          const canvas = await renderPage(page);
          const { data } = await worker.recognize(canvas);
          pages[i] = cleanOcrText(data.text);
          page.cleanup();
          onProgress?.({ stage: "ocr", done: ++done, total });
        }
      }),
    );
  } finally {
    releaseOcrWorkers();
  }
}

/** pdf.js with its worker, loaded once and shared by every upload. */
let pdfjsReady;
function loadPdfjs() {
  pdfjsReady ||= import("pdfjs-dist").then((pdfjs) => {
    if (typeof Worker !== "undefined") {
      // One shared worker that loads the Safari stream polyfill before pdf.js.
      pdfWorker ||= new Worker(new URL("./pdf.worker.js", import.meta.url), {
        type: "module",
      });
      pdfjs.GlobalWorkerOptions.workerPort = pdfWorker;
    } else {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
    }
    return pdfjs;
  });
  pdfjsReady.catch(() => (pdfjsReady = null));
  return pdfjsReady;
}

/**
 * Loads the PDF reader ahead of time (after sign-in, or when the upload
 * window opens) so the first upload starts instantly.
 */
export function warmUpReader() {
  loadPdfjs().catch(() => {});
}

/**
 * Reads a PDF or TXT file. Returns the page texts, or `{ pages, images }` when
 * `images: true` (figures are extracted from PDFs only).
 */
export async function readDocument(
  file,
  { images: withImages = false, onText, onProgress, ocr = true } = {},
) {
  validateFile(file);
  if (/\.txt$/i.test(file.name)) {
    const pages = validatePages((await file.text()).split(/\f/));
    return withImages ? { pages, images: [] } : pages;
  }
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
  });
  try {
    const pdf = await task.promise;
    const count = pdf.numPages;
    // Phase 1 – text. Ask for 8 pages at a time so the worker is never idle
    // waiting for the next request; order is preserved by index.
    const pages = new Array(count);
    for (let start = 1; start <= count; start += TEXT_BATCH) {
      const batch = [];
      for (let i = start; i < Math.min(start + TEXT_BATCH, count + 1); i++)
        batch.push(
          pdf.getPage(i).then(async (page) => {
            pages[i - 1] = pageText((await page.getTextContent()).items);
            if (!withImages) page.cleanup();
          }),
        );
      await Promise.all(batch);
      if (count > TEXT_BATCH)
        onProgress?.({
          stage: "text",
          done: Math.min(start + TEXT_BATCH - 1, count),
          total: count,
        });
    }
    // Phase 1b – OCR for scanned pages (pages without a text layer).
    if (ocr) {
      // Start the OCR engine while pages are checked (it takes a few seconds).
      if (pages.some(isBlank))
        ocrWorkers(1)
          .then(releaseOcrWorkers)
          .catch(() => {});
      const scanned = await pagesNeedingOcr(pdf, pages, pdfjs.OPS || {});
      if (scanned.length) await ocrPages(pdf, pages, scanned, onProgress);
    }
    validatePages(pages);
    if (!withImages) return pages;
    // The document can open now; figures follow in the background.
    onText?.(pages);
    // Phase 2 – figures.
    const images = [],
      seen = new Set(); // logos and headers repeat on every page: keep one
    for (let i = 1; i <= count && images.length < MAX_IMAGES; i++) {
      const page = await pdf.getPage(i);
      try {
        for (const img of await pageImages(pdfjs, page, i - 1)) {
          if (images.length >= MAX_IMAGES || seen.has(img.dataUrl)) continue;
          seen.add(img.dataUrl);
          images.push({ id: `p${i}-${images.length + 1}`, ...img });
        }
      } catch {
        /* A figure that cannot be decoded should not block the text. */
      }
      page.cleanup();
    }
    return { pages, images };
  } catch (error) {
    if (error.name === "PasswordException")
      throw new Error(
        "This PDF is password protected. Upload an unlocked copy.",
      );
    if (error.name === "InvalidPDFException")
      throw new Error(
        "This PDF could not be read. It may be damaged or not a valid PDF.",
      );
    throw error;
  } finally {
    await task.destroy();
  }
}
export function downloadText(text, name) {
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), name);
}
/** Saves a Blob (e.g. a Word document) under the given file name. */
export function downloadBlob(blob, name) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
