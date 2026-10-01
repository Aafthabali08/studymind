import React, { useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  countQuestions,
  downloadQuestionPdf,
  pdfCategories,
  pdfFileName,
  selectQuestions,
} from "./questionPdf";

/**
 * Download the question bank as a PDF or Word document: important or all predicted questions,
 * for one category (marks group or question type) or all of them. Figures
 * from the uploaded file go with the questions they belong to.
 */
export default function QuestionPdfPanel({
  doc,
  bank,
  notify,
  importantOnly = false,
  marks = "all",
}) {
  const categories = useMemo(() => pdfCategories(bank), [bank]);
  const [scope, setScope] = useState(importantOnly ? "important" : "all");
  const [category, setCategory] = useState(
    marks === "all" ? "all" : `m${marks}`,
  );
  const [format, setFormat] = useState("pdf");
  const [busy, setBusy] = useState(false);
  const cat = categories.find((c) => c.id === category) || categories[0];
  const important = scope === "important";
  const count = countQuestions(
    selectQuestions(bank, { category: cat.id, importantOnly: important }),
  );
  const fileName = pdfFileName(
    doc.name,
    cat.label,
    important,
    format === "word" ? "docx" : "pdf",
  );

  async function download() {
    setBusy(true);
    try {
      const done = await downloadQuestionPdf({
        format,
        doc,
        bank,
        category: cat.id,
        importantOnly: important,
      });
      notify?.(
        `Downloaded ${done.fileName} (${done.count} question${done.count === 1 ? "" : "s"}).`,
      );
    } catch (e) {
      notify?.(e.message || "The file could not be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pdf-panel" aria-label="Download questions">
      <div className="pdf-panel-fields">
        <label>
          Questions
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="important">★ Important questions</option>
            <option value="all">All predicted questions</option>
          </select>
        </label>
        <label>
          Category
          <select
            value={cat.id}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.marks && c.type ? `   ${c.label}` : c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="pdf">PDF</option>
            <option value="word">Word (.docx)</option>
          </select>
        </label>
      </div>
      <div className="pdf-panel-foot">
        <small title={fileName}>
          {count
            ? `${count} question${count === 1 ? "" : "s"} with answers and figures · ${fileName}`
            : important
              ? "No important questions in this category yet."
              : "No questions in this category yet."}
        </small>
        <button
          className="primary"
          disabled={busy || !count}
          onClick={download}
        >
          <Download size={16} />{" "}
          {busy
            ? `Making ${format === "word" ? "Word file" : "PDF"}…`
            : `Download ${format === "word" ? "Word" : "PDF"}`}
        </button>
      </div>
    </section>
  );
}
