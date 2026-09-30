import React, { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { MAX_ATTACHMENTS, compressImage } from "./imageUtils";

const PASTE_KEY =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "")
    ? "⌘V"
    : "Ctrl+V";

/**
 * Optional pictures for a message: pick, drop or paste (⌘V) up to 3 images.
 * Images are compressed right away so sending is quick.
 * Controlled: `images` = [{ dataUrl, width, height, name }].
 */
export default function AttachmentPicker({
  images,
  onChange,
  notify,
  disabled,
  hint = "Screenshots help us fix problems faster.",
}) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  async function add(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    const room = MAX_ATTACHMENTS - images.length;
    if (room <= 0)
      return notify(`You can attach up to ${MAX_ATTACHMENTS} pictures.`);
    if (list.length > room)
      notify(
        `Only the first ${room} picture${room === 1 ? "" : "s"} were added.`,
      );
    setBusy(true);
    const added = [];
    for (const file of list.slice(0, room)) {
      try {
        added.push(await compressImage(file));
      } catch (e) {
        notify(e.message);
      }
    }
    setBusy(false);
    if (added.length) onChange([...images, ...added]);
    if (input.current) input.current.value = "";
  }
  return (
    <div
      className="attachment-picker"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        add(e.dataTransfer.files);
      }}
    >
      {images.length > 0 && (
        <ul className="attachment-previews" aria-label="Attached pictures">
          {images.map((img, i) => (
            <li key={i}>
              <img src={img.dataUrl} alt={img.name || `Picture ${i + 1}`} />
              <button
                type="button"
                aria-label={`Remove ${img.name || `picture ${i + 1}`}`}
                onClick={() => onChange(images.filter((_, j) => j !== i))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {images.length < MAX_ATTACHMENTS && (
        <button
          type="button"
          className="text-button attach-button"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={16} />
          {busy
            ? "Preparing picture…"
            : images.length
              ? "Add another picture"
              : "Add a picture (optional)"}
        </button>
      )}
      <small className="attach-hint">
        {hint} Up to {MAX_ATTACHMENTS}, or paste one with {PASTE_KEY}.
      </small>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Choose pictures to attach"
        onChange={(e) => add(e.target.files)}
      />
    </div>
  );
}
