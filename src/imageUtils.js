// Compresses photos/screenshots in the browser so they can be stored in
// Firestore on the free plan (each attachment stays well under 1 MB).
export const MAX_ATTACHMENTS = 3;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // original file limit
const TARGET_CHARS = 450_000; // data URL length ≈ bytes stored

export function validateImage(file) {
  if (
    !file ||
    (!/^image\//.test(file.type || "") &&
      !/\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(file.name || ""))
  )
    throw new Error("Attach an image (PNG, JPG, WEBP or GIF).");
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("Images must be smaller than 12 MB.");
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall back to <img> (e.g. HEIC in Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Resizes to at most `maxEdge` px and re-encodes as JPEG, lowering quality
 * (then size) until it fits. Returns { dataUrl, width, height, name }.
 */
export async function compressImage(file, { maxEdge = 1280 } = {}) {
  validateImage(file);
  const source = await decode(file).catch(() => {
    throw new Error(
      "This image could not be read. Try a PNG or JPG screenshot.",
    );
  });
  let edge = maxEdge;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, edge / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // screenshots with transparency stay readable
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= TARGET_CHARS)
        return {
          dataUrl,
          width: canvas.width,
          height: canvas.height,
          name: file.name || "image.jpg",
        };
    }
    edge = Math.round(edge * 0.75);
  }
  throw new Error(
    "This image is too detailed to attach. Try a smaller screenshot.",
  );
}

/** Images from a paste event (e.g. ⌘V of a screenshot). */
export function imagesFromClipboard(event) {
  return [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}
