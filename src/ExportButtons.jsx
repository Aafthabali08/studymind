import React, { useState } from "react";
import { Download } from "lucide-react";

/**
 * "Download notes: PDF · Word". `onExport(format)` makes and saves the file
 * and resolves with its name (or a message); errors are passed to `notify`.
 */
export default function ExportButtons({
  label,
  onExport,
  notify,
  disabled,
  className = "text-button",
}) {
  const [busy, setBusy] = useState(null);
  async function run(format) {
    setBusy(format);
    try {
      const done = await onExport(format);
      if (done) notify?.(done.startsWith("Downloaded") ? done : `Downloaded ${done}.`);
    } catch (e) {
      notify?.(e?.message || "The file could not be made.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <span className="export-buttons" role="group" aria-label={label}>
      <span className="export-label">
        <Download size={15} /> {label}
      </span>
      {[
        ["pdf", "PDF"],
        ["word", "Word"],
      ].map(([format, name]) => (
        <button
          key={format}
          className={className}
          disabled={disabled || Boolean(busy)}
          aria-label={`${label} as ${name}`}
          onClick={() => run(format)}
        >
          {busy === format ? "Making…" : name}
        </button>
      ))}
    </span>
  );
}
