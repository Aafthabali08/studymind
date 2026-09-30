import React, { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

export const MAX_NAME = 120;

/**
 * A document name that can be renamed in place. Enter or ✓ saves, Escape or
 * ✕ cancels. Controlled (`editing` + `onEditingChange`) or self-managed.
 */
export default function EditableName({
  name,
  onRename,
  as: Heading = "h1",
  className = "",
  editing: controlled,
  onEditingChange,
  showButton = true,
}) {
  const [own, setOwn] = useState(false);
  const editing = controlled ?? own;
  const setEditing = (v) => (onEditingChange ? onEditingChange(v) : setOwn(v));
  const [value, setValue] = useState(name);
  const [error, setError] = useState("");
  const input = useRef(null);
  // Select the text as soon as the box opens (not a frame later, which could
  // swallow the first typed letter).
  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  function save(e) {
    e?.preventDefault();
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean) return setError("The name can't be empty.");
    if (clean.length > MAX_NAME)
      return setError(`Use at most ${MAX_NAME} characters.`);
    if (clean !== name) onRename(clean);
    setEditing(false);
  }

  if (!editing)
    return (
      <div className={"editable-name " + className}>
        <Heading>{name}</Heading>
        {showButton && (
          <button
            type="button"
            className="rename-button"
            aria-label={`Rename ${name}`}
            title="Rename"
            onClick={() => {
              setValue(name);
              setError("");
              setEditing(true);
            }}
          >
            <Pencil size={15} />
          </button>
        )}
      </div>
    );
  return (
    <form className={"rename-form " + className} onSubmit={save}>
      <input
        ref={input}
        aria-label="Document name"
        value={value}
        maxLength={MAX_NAME + 20}
        aria-invalid={Boolean(error)}
        onChange={(e) => {
          setValue(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setEditing(false);
          }
        }}
      />
      <button type="submit" className="icon-dark" aria-label="Save name">
        <Check size={16} />
      </button>
      <button
        type="button"
        className="rename-cancel"
        aria-label="Cancel rename"
        onClick={() => setEditing(false)}
      >
        <X size={16} />
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
