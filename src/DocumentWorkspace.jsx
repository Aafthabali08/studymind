import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Headphones,
  Layers,
  Play,
  Square,
  Sparkles,
  Check,
  Trash2,
  Settings2,
  Pencil,
  Eye,
  Maximize2,
  Minimize2,
  ChevronsUpDown,
} from "lucide-react";
import { makeFlashcards } from "./logic";
import QuizPanel from "./QuizPanel";
import useIdleValue from "./useIdleValue";
import { termFlashcards, withTermQuestions } from "./ai/quiz";
import { downloadBlob } from "./documents";
import { documentToWord } from "./wordExport";
import { downloadQuestionPdf } from "./questionPdf";
import ExportButtons from "./ExportButtons";
import { exportBlocks, markdownDocument } from "./exporters/index";
import { extractKeywords } from "./ai/text";
import Thinking from "./Thinking";
import EditableName from "./EditableName";
import QuestionPdfPanel from "./QuestionPdfPanel";
import FeedbackButtons from "./FeedbackButtons";
import Markdown, { Lightbox } from "./Markdown";
import {
  MARKS,
  buildNotes,
  bankFlashcards,
  buildQuestionBank,
  generateNotes,
  generateQuestionBank,
  groupByType,
} from "./ai/study";
import { geminiAvailable } from "./ai/gemini";
import {
  answerQuestion,
  canGenerate,
  cancelGeneration,
  generateSummary,
  indexDocument,
  quickAnswer,
  quickSummary,
  semanticEnabled,
  useAI,
} from "./ai/engine";
const EMPTY_BANK = { 2: [], 5: [], 8: [] };

const TABS = [
  "Ask document",
  "Summary",
  "Notes",
  "Questions",
  "Flashcards",
  "Quiz",
  "Read aloud",
];
function engineLabel(ai, indexing) {
  const { engine, model } = ai.settings;
  if (engine === "gemini")
    return "Gemini · reads the whole document · cites pages";
  if (engine === "fast")
    return "Instant search · exact quotes with page citations";
  if (ai.progress && ai[ai.progress.kind] === "loading")
    return `Downloading open model · ${ai.progress.value}%`;
  if (ai.generate === "error" || ai.embed === "error")
    return "AI model unavailable · using instant search";
  const index =
    indexing && indexing.done < indexing.total
      ? ` · indexing ${indexing.done}/${indexing.total}`
      : "";
  return `${engine === "remote" ? model : "On-device AI"} · answers cite pages${index}`;
}
export default function DocumentWorkspace({
  doc,
  initialTab = "Ask document",
  study = {},
  onStudy = () => {},
  onBack,
  onDelete,
  onRename,
  onOpenSettings,
  onPageChange,
  notify,
}) {
  const ai = useAI();
  const [tab, setTab] = useState(initialTab),
    [page, setPage] = useState(0),
    [question, setQuestion] = useState(""),
    [messages, setMessages] = useState([]),
    [card, setCard] = useState(0),
    [flipped, setFlipped] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [scope, setScope] = useState("document"),
    [summaries, setSummaries] = useState({}),
    [indexing, setIndexing] = useState(null),
    [editing, setEditing] = useState(false),
    [wide, setWide] = useState(false),
    [marks, setMarks] = useState(2),
    [openAnswers, setOpenAnswers] = useState({}),
    [importantOnly, setImportantOnly] = useState(false),
    [zoom, setZoom] = useState(null),
    [jobs, setJobs] = useState({}),
    [exporting, setExporting] = useState(null); // "word" while exporting
  const images = doc.images || [];
  // Built in idle time after the document opens, so opening never stutters
  // (≈150 ms of work for a 200-page PDF).
  const builtNotes = useIdleValue(
    () => buildNotes(doc, images),
    [doc.pages, images],
  );
  const builtBank = useIdleValue(
    () => withTermQuestions(buildQuestionBank(doc, images), doc),
    [doc.pages, images],
  );
  const notesReady = Boolean(study.notes) || builtNotes != null;
  const bankReady = Boolean(study.bank) || builtBank != null;
  const notesMd = study.notes?.markdown ?? builtNotes ?? "";
  const bank = study.bank || builtBank || EMPTY_BANK;
  const bankTotal = MARKS.reduce((n, m) => n + (bank[m] || []).length, 0);
  // Flashcards and quiz come from the question bank (real questions and
  // answers); tiny documents without a bank fall back to page recall.
  const cards = useMemo(() => {
      const fromBank = bankFlashcards(bank);
      if (fromBank.length >= 3) return fromBank;
      const fromTerms = termFlashcards(doc);
      return fromTerms.length >= 3
        ? fromTerms
        : makeFlashcards(doc.pages).map((c) => ({ ...c, source: true }));
    }, [bank, doc.pages]);
  // A new bank (e.g. from Gemini) restarts the deck.
  useEffect(() => {
    setCard(0);
    setFlipped(false);
  }, [cards]);
  const flashcard = cards[card] || cards[0];
  const bankImportant = MARKS.reduce(
    (n, m) => n + (bank[m] || []).filter((q) => q.important).length,
    0,
  );
  const visibleGroups = (marks === "all" ? MARKS : [marks])
    .map((m) => ({
      m,
      groups: groupByType(bank[m] || [], m)
        .map(([type, items]) => [
          type,
          importantOnly ? items.filter((i) => i.q.important) : items,
        ])
        .filter(([, items]) => items.length),
    }))
    .filter((g) => g.groups.length);
  // Number questions in the order they are shown (grouped by type).
  const displayNumber = {};
  visibleGroups.forEach(({ m, groups }) => {
    let n = 0;
    groups.forEach(([, items]) =>
      items.forEach(({ index }) => (displayNumber[`${m}-${index}`] = ++n)),
    );
  });
  const visibleKeys = visibleGroups.flatMap(({ m, groups }) =>
    groups.flatMap(([, items]) => items.map(({ index }) => `${m}-${index}`)),
  );
  const closeZoom = useCallback(() => setZoom(null), []);
  const pageImages = images.filter((i) => i.page === page);
  const setJob = (key, patch) =>
    setJobs((j) => ({
      ...j,
      [key]: {
        ...j[key],
        ...(typeof patch === "function" ? patch(j[key]) : patch),
      },
    }));
  async function writeNotes() {
    setEditing(false);
    setJob("notes", { status: "writing", text: "" });
    try {
      const text = await generateNotes(doc, images, {
        onToken: (t) =>
          setJob("notes", (prev) => ({ text: (prev?.text || "") + t })),
      });
      if (text.trim())
        onStudy({ notes: { markdown: text.trim(), source: "ai" } });
      setJob("notes", { status: "done", text: "" });
    } catch (e) {
      setJob("notes", { status: "error", text: "" });
      notify(e.message || "Detailed notes could not be written.");
    }
  }
  /** Word (.docx) copy of the extracted text, with each page's figures. */
  async function exportWord() {
    setExporting("word");
    try {
      const { blob, fileName } = await documentToWord(doc);
      downloadBlob(blob, fileName);
      notify(`Downloaded ${fileName}.`);
    } catch (e) {
      notify(e.message || "The Word file could not be made.");
    } finally {
      setExporting(null);
    }
  }
  async function writeBank() {
    if (
      study.bank?.source === "edited" &&
      !window.confirm(
        "Regenerating replaces the questions you edited with new ones from Gemini. Continue?",
      )
    )
      return;
    setJob("bank", { status: "writing" });
    try {
      const { failed, ...next } = await generateQuestionBank(doc, images, {
        previous: study.bank,
      });
      onStudy({ bank: { ...next, source: "ai" } });
      setOpenAnswers({});
      setJob("bank", { status: "done" });
      if (failed.length)
        notify(
          `Gemini couldn't write the ${failed.join(" and ")}-mark questions this time, so those keep their earlier questions. Try regenerating in a minute.`,
        );
    } catch (e) {
      setJob("bank", { status: "error" });
      notify(e.message || "The question bank could not be generated.");
    }
  }
  const sourceLabel = (s) =>
    s === "ai"
      ? "WRITTEN BY AI"
      : s === "edited"
        ? "EDITED BY YOU"
        : "BUILT FROM YOUR DOCUMENT";

  useEffect(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    return () => window.speechSynthesis?.cancel();
  }, [page, tab]);
  useEffect(() => cancelGeneration, [doc.id]);
  // Let the Ask Gemini help bot know which page is open.
  useEffect(() => onPageChange?.(page), [page]);
  // Build the semantic index in the background as soon as an AI engine is on.
  useEffect(() => {
    if (!semanticEnabled()) return setIndexing(null);
    let live = true;
    indexDocument(
      doc,
      (done, total) => live && setIndexing({ done, total }),
    ).catch(() => live && setIndexing(null));
    return () => {
      live = false;
    };
  }, [doc.id, ai.settings.engine]);
  const summaryKey = scope === "document" ? "document" : `page-${page}`;
  const keyPoints = useMemo(
    () =>
      quickSummary(
        doc,
        scope === "document" ? null : page,
        scope === "document" ? 6 : 3,
      ),
    [doc, scope, page],
  );
  const keywords = useMemo(
    () =>
      extractKeywords(
        scope === "document" ? doc.pages.join("\n") : doc.pages[page],
        8,
      ),
    [doc, scope, page],
  );
  const summary = summaries[summaryKey];
  function patchMessage(id, patch) {
    setMessages((all) =>
      all.map((m) =>
        m.id === id
          ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) }
          : m,
      ),
    );
  }
  async function writeSummary() {
    const key = summaryKey;
    const set = (patch) =>
      setSummaries((s) => ({
        ...s,
        [key]: {
          ...s[key],
          ...(typeof patch === "function" ? patch(s[key]) : patch),
        },
      }));
    set({ status: "writing", text: "", stage: "Starting…" });
    try {
      const text = await generateSummary(doc, {
        page: scope === "document" ? null : page,
        onStage: (stage) => set({ stage }),
        onToken: (t) =>
          set((prev) => ({ text: (prev?.text || "") + t, stage: "" })),
      });
      set((prev) => ({
        status: "done",
        text: text.trim() || prev?.text || "",
        stage: "",
      }));
    } catch (e) {
      set({ status: "error", stage: "" });
      notify(e.message || "The AI summary could not be written.");
    }
  }
  function speak() {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      notify(
        "Read aloud is unavailable in this browser. You can read the extracted text instead.",
      );
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(doc.pages[page]);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      notify("Playback could not start. Try another browser or voice.");
    };
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }
  function ask(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    // Instant verbatim answer first; AI retrieval and writing upgrade it.
    const id = crypto.randomUUID();
    const result = quickAnswer(doc, q);
    const upgrade = semanticEnabled() || canGenerate();
    setMessages((m) => [
      ...m,
      {
        id,
        question: q,
        result,
        ai: upgrade ? { status: "thinking", text: "" } : null,
      },
    ]);
    setQuestion("");
    if (!upgrade) return;
    answerQuestion(doc, q, {
      onToken: (t) =>
        patchMessage(id, (m) => ({
          ai: { status: "writing", text: (m.ai?.text || "") + t },
        })),
    })
      .then((res) =>
        patchMessage(id, (m) => ({
          result: res?.extract || m.result,
          ai: res?.text
            ? { status: "done", text: res.text, by: res.by }
            : res?.error
              ? { status: "error", text: "", error: res.error }
              : null,
        })),
      )
      .catch(() => patchMessage(id, { ai: null }));
  }
  const text = doc.pages[page];
  const lines = text.trim().split("\n");
  const title = lines.length > 1 ? lines[0] : `Page ${page + 1}`;
  const body = lines.length > 1 ? lines.slice(1).join("\n") : text;
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        <ChevronLeft size={16} />
        Back to library
      </button>
      <div className="section-heading">
        <div>
          <div className="eyebrow">
            YOUR DOCUMENT · {doc.pages.length}{" "}
            {doc.pages.length === 1 ? "PAGE" : "PAGES"}
          </div>
          <EditableName
            name={doc.name}
            className="document-title"
            onRename={(name) => onRename?.(doc, name)}
            showButton={Boolean(onRename)}
          />
        </div>
        <div className="heading-actions">
          {onDelete && (
            <button
              className="secondary"
              aria-label="Delete document"
              onClick={() => onDelete(doc)}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            className="secondary"
            disabled={exporting === "word"}
            onClick={exportWord}
          >
            <Download size={16} />
            {exporting === "word" ? "Making Word file…" : "Export to Word"}
          </button>
        </div>
      </div>
      <div
        className={
          "workspace" +
          (wide && ["Notes", "Questions"].includes(tab) ? " wide" : "")
        }
      >
        <section className="reader panel" aria-label="Document reader">
          <div className="reader-toolbar">
            <span>
              <FileText size={16} />
              Extracted text
            </span>
            <div>
              <button
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span aria-live="polite">
                {page + 1} / {doc.pages.length}
              </span>
              <button
                aria-label="Next page"
                disabled={page === doc.pages.length - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <article className="paper">
            <span className="eyebrow">STUDYMIND / READING ROOM</span>
            <h2>{title}</h2>
            <p>
              {body.trim() ||
                "No text was extracted on this page. It may contain only images."}
            </p>
            {pageImages.length > 0 && (
              <div className="page-figures">
                {pageImages.map((img, i) => (
                  <figure key={img.id}>
                    <button
                      className="md-zoom"
                      aria-label={`View full screen: figure ${i + 1} on page ${page + 1}`}
                      onClick={() =>
                        setZoom({
                          src: img.dataUrl,
                          alt:
                            img.caption || `Figure ${i + 1} · page ${page + 1}`,
                        })
                      }
                    >
                      <img
                        src={img.dataUrl}
                        alt={`Figure ${i + 1} on page ${page + 1}`}
                      />
                    </button>
                    <figcaption>
                      {img.caption || `Figure ${i + 1} · page ${page + 1}`}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <footer>{String(page + 1).padStart(2, "0")}</footer>
          </article>
        </section>
        <section className="assistant panel" aria-label="Study tools">
          <nav className="tabs" aria-label="Document tools">
            {TABS.map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          {tab === "Ask document" && (
            <>
              <div className="chat-body">
                <span className="assistant-icon">
                  <Sparkles size={22} />
                </span>
                <h2>Let's connect the dots.</h2>
                <p>Ask a question. Every answer points to its source page.</p>
                <button className="local-label" onClick={onOpenSettings}>
                  <Settings2 size={13} /> {engineLabel(ai, indexing)}
                </button>
                <div aria-live="polite">
                  {messages.map((m) => (
                    <div className="chat-pair" key={m.id}>
                      <div className="user-message">{m.question}</div>
                      <div className="source-message">
                        {m.ai?.text && (
                          <div className="ai-output">
                            <small>AI ANSWER · FROM YOUR DOCUMENT ONLY</small>
                            <div
                              className={
                                m.ai.status === "writing" ? "streaming" : ""
                              }
                            >
                              <Markdown images={images} onPage={setPage}>
                                {m.ai.text}
                              </Markdown>
                            </div>
                            {m.ai.status === "done" && m.ai.by && (
                              <small className="answer-by">
                                Written by {m.ai.by}
                              </small>
                            )}
                            {m.ai.status === "done" && (
                              <FeedbackButtons
                                kind="answer"
                                item={`${m.question}\n\n${m.ai.text.slice(0, 1000)}`}
                                docId={doc.cloudId || doc.id}
                                docName={doc.name}
                                label="Is this answer correct?"
                              />
                            )}
                          </div>
                        )}
                        {m.ai?.status === "error" && (
                          <p className="fine">
                            AI answer unavailable: {m.ai.error} Showing the best
                            extract instead.
                          </p>
                        )}
                        {m.ai && !m.ai.text && m.ai.status !== "error" && (
                          <Thinking
                            label={
                              canGenerate()
                                ? "AI is reading your document…"
                                : "Searching by meaning…"
                            }
                            detail="Finding the best passages, then writing an answer with page citations."
                          />
                        )}
                        {m.result ? (
                          <>
                            <small>
                              {m.ai?.text
                                ? "SOURCE EXTRACT"
                                : "EXTRACT FROM YOUR DOCUMENT"}
                            </small>
                            <p>{m.result.text}</p>
                            <div className="source-tags">
                              {m.result.sources.map((s) => (
                                <button
                                  key={s.page}
                                  className="tag"
                                  onClick={() => setPage(s.page)}
                                >
                                  Page {s.page + 1}
                                  <ArrowUpRight size={12} />
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          (!m.ai || m.ai.status === "error") && (
                            <p>
                              I could not find matching text in this document.
                              Try a specific concept or use the page reader.
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <form className="chat-form" onSubmit={ask}>
                <input
                  aria-label="Search document"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask anything about this document…"
                />
                <button
                  className="icon-dark"
                  aria-label="Search"
                  disabled={!question.trim()}
                >
                  <ArrowRight size={18} />
                </button>
              </form>
            </>
          )}
          {tab === "Summary" && (
            <div className="tool-content">
              <div className="eyebrow">
                KEY IDEAS ·{" "}
                {scope === "document" ? "WHOLE DOCUMENT" : `PAGE ${page + 1}`}
              </div>
              <h2>The short version.</h2>
              <div
                className="segmented"
                role="group"
                aria-label="Summary scope"
              >
                {[
                  ["document", "Whole document"],
                  ["page", "This page"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={scope === value}
                    className={scope === value ? "active" : ""}
                    onClick={() => setScope(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {keywords.length > 0 && (
                <div className="chips" aria-label="Key terms">
                  {keywords.map((k) => (
                    <span className="chip" key={k}>
                      {k}
                    </span>
                  ))}
                </div>
              )}
              {keyPoints.length ? (
                <ol className="key-points">
                  {keyPoints.map((k) => (
                    <li key={k.page + k.text}>
                      <span>{k.text}</span>
                      <button
                        className="tag"
                        aria-label={`Go to page ${k.page + 1}`}
                        onClick={() => setPage(k.page)}
                      >
                        p. {k.page + 1}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>There is not enough text here to summarise.</p>
              )}
              <p className="fine">
                Key sentences are quoted exactly from the document, so nothing
                is invented.
              </p>
              {summary?.text && (
                <div className="ai-output" aria-live="polite">
                  <small>AI SUMMARY</small>
                  <div
                    className={summary.status === "writing" ? "streaming" : ""}
                  >
                    <Markdown images={images} onPage={setPage}>
                      {summary.text}
                    </Markdown>
                  </div>

                  {summary.status === "done" && (
                    <FeedbackButtons
                      kind="summary"
                      item={summary.text.slice(0, 1200)}
                      docId={doc.cloudId || doc.id}
                      docName={doc.name}
                      label="Is this summary correct?"
                    />
                  )}
                </div>
              )}
              {scope === "document" && images.length > 0 && (
                <div className="figure-strip">
                  <small>FIGURES IN THIS DOCUMENT · {images.length}</small>
                  <div>
                    {images.map((img) => (
                      <button
                        key={img.id}
                        aria-label={`Figure on page ${img.page + 1}`}
                        onClick={() => setPage(img.page)}
                      >
                        <img src={img.dataUrl} alt="" loading="lazy" />
                        <span>p. {img.page + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {summary?.status === "writing" && !summary.text && (
                <Thinking
                  label="Writing your summary…"
                  detail={summary.stage || "Reading the text…"}
                  lines={4}
                />
              )}
              <div className="button-row">
                {canGenerate() ? (
                  summary?.status === "writing" ? (
                    <button className="secondary" onClick={cancelGeneration}>
                      <Square size={14} /> Stop writing
                    </button>
                  ) : (
                    <button
                      className="primary"
                      disabled={!keyPoints.length}
                      onClick={writeSummary}
                    >
                      <Sparkles size={16} />
                      {summary?.text
                        ? "Rewrite AI summary"
                        : "Write AI summary"}
                    </button>
                  )
                ) : (
                  <button className="secondary" onClick={onOpenSettings}>
                    <Sparkles size={16} /> Turn on AI for written summaries
                  </button>
                )}
                <ExportButtons
                  label="Download summary"
                  disabled={!keyPoints.length}
                  notify={notify}
                  onExport={(format) =>
                    exportBlocks({
                      format,
                      images,
                      name: [
                        doc.name,
                        scope === "document" ? "Summary" : `Page ${page + 1} summary`,
                      ],
                      blocks: markdownDocument({
                        title: doc.name.replace(/\.[a-z0-9]{2,5}$/i, ""),
                        subtitle:
                          scope === "document" ? "Summary" : `Page ${page + 1} summary`,
                        markdown: [
                          summary?.text || "",
                          "## Key sentences",
                          ...keyPoints.map((k) => `- ${k.text} *(p. ${k.page + 1})*`),
                          keywords.length ? `## Key terms\n\n${keywords.join(" · ")}` : "",
                        ]
                          .filter(Boolean)
                          .join("\n\n"),
                      }),
                    })
                  }
                />
              </div>
            </div>
          )}
          {tab === "Notes" && (
            <div className="tool-content">
              <div className="tool-head">
                <div>
                  <div className="eyebrow">
                    DETAILED NOTES · {sourceLabel(study.notes?.source)}
                  </div>
                  <h2>Your study notes.</h2>
                </div>
                <div className="tool-actions">
                  <button
                    className="secondary"
                    aria-pressed={editing}
                    disabled={jobs.notes?.status === "writing"}
                    onClick={() => setEditing((v) => !v)}
                  >
                    {editing ? <Eye size={15} /> : <Pencil size={15} />}
                    {editing ? "Preview" : "Edit"}
                  </button>
                  <button
                    className="secondary"
                    aria-label={wide ? "Exit wide view" : "Wide view"}
                    onClick={() => setWide((v) => !v)}
                  >
                    {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                </div>
              </div>
              {!notesReady && jobs.notes?.status !== "writing" ? (
                <Thinking label="Preparing your notes…" lines={4} slowHint="" />
              ) : jobs.notes?.status === "writing" ? (
                jobs.notes.text ? (
                  <div className="streaming notes-body">
                    <Markdown images={images} onPage={setPage}>
                      {jobs.notes.text}
                    </Markdown>
                  </div>
                ) : (
                  <Thinking
                    label="Writing detailed notes…"
                    detail="Reading every page and figure to build headings, explanations, examples and code."
                    lines={5}
                  />
                )
              ) : editing ? (
                <textarea
                  className="notes-editor"
                  aria-label="Editable notes"
                  value={notesMd}
                  onChange={(e) =>
                    onStudy({
                      notes: { markdown: e.target.value, source: "edited" },
                    })
                  }
                />
              ) : (
                <>
                  <div className="notes-body">
                    <Markdown images={images} onPage={setPage}>
                      {notesMd}
                    </Markdown>
                  </div>
                  <FeedbackButtons
                    kind="notes"
                    item={notesMd.slice(0, 1200)}
                    docId={doc.cloudId || doc.id}
                    docName={doc.name}
                    label="Are these notes correct and useful?"
                  />
                  <div className="bank-cta">
                    <span className="bank-cta-icon" aria-hidden="true">
                      📚
                    </span>
                    <div>
                      <strong>Complete question bank</strong>
                      <small>
                        {MARKS.map(
                          (m) => `${(bank[m] || []).length} × ${m} marks`,
                        ).join(" · ")}{" "}
                        · grouped by type · ★ {bankImportant} important · memory
                        tricks
                      </small>
                    </div>
                    <button
                      className="primary"
                      onClick={() => {
                        setMarks("all");
                        setTab("Questions");
                      }}
                    >
                      Open question bank <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              <p className="fine">
                {editing
                  ? "Markdown: # heading, ## section, ### sub-heading, - bullet, ``` code ```. Figures use ![caption](image:ID)."
                  : study.notes?.source === "ai"
                    ? "Written by AI from your document. Check important facts against the cited pages."
                    : "Built only from your document's own text, so nothing is invented."}
              </p>
              <div className="button-row">
                {canGenerate() ? (
                  jobs.notes?.status === "writing" ? (
                    <button className="secondary" onClick={cancelGeneration}>
                      <Square size={14} /> Stop writing
                    </button>
                  ) : (
                    <button className="primary" onClick={writeNotes}>
                      <Sparkles size={16} />
                      {study.notes?.source === "ai"
                        ? "Rewrite with AI"
                        : "Write detailed notes with AI"}
                    </button>
                  )
                ) : (
                  <button className="secondary" onClick={onOpenSettings}>
                    <Sparkles size={16} /> Turn on Gemini for fuller notes
                  </button>
                )}
                {study.notes && jobs.notes?.status !== "writing" && (
                  <button
                    className="text-button"
                    onClick={() => onStudy({ notes: null })}
                  >
                    Reset to built-in notes
                  </button>
                )}
                <ExportButtons
                  label="Download notes"
                  disabled={!notesMd.trim()}
                  notify={notify}
                  onExport={(format) =>
                    exportBlocks({
                      format,
                      images,
                      name: [doc.name, "Notes"],
                      blocks: markdownDocument({
                        title: doc.name.replace(/\.[a-z0-9]{2,5}$/i, ""),
                        subtitle: "Detailed study notes",
                        markdown: notesMd,
                      }),
                    })
                  }
                />
              </div>
            </div>
          )}
          {tab === "Questions" && (
            <div className="tool-content">
              <div className="tool-head">
                <div>
                  <div className="eyebrow">
                    QUESTION BANK · BY MARKS · {sourceLabel(study.bank?.source)}
                  </div>
                  <h2>Exam practice.</h2>
                </div>
                <div className="tool-actions">
                  <button
                    className="secondary"
                    aria-label={wide ? "Exit wide view" : "Wide view"}
                    onClick={() => setWide((v) => !v)}
                  >
                    {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                </div>
              </div>
              <div className="bank-stats" aria-label="Question bank summary">
                <div>
                  <strong>{bankTotal}</strong>
                  <small>questions</small>
                </div>
                {MARKS.map((m) => (
                  <div key={m}>
                    <strong>{(bank[m] || []).length}</strong>
                    <small>{m} marks</small>
                  </div>
                ))}
                <div className="stat-important">
                  <strong>★ {bankImportant}</strong>
                  <small>important</small>
                </div>
              </div>
              <div className="segmented marks" role="group" aria-label="Marks">
                {[...MARKS, "all"].map((m) => (
                  <button
                    key={m}
                    aria-pressed={marks === m}
                    className={marks === m ? "active" : ""}
                    onClick={() => setMarks(m)}
                  >
                    {m === "all" ? "All" : `${m} marks`}{" "}
                    <span className="count">
                      {m === "all" ? bankTotal : (bank[m] || []).length}
                    </span>
                  </button>
                ))}
              </div>
              <div className="bank-toolbar">
                <button
                  className={"chip" + (importantOnly ? " active" : "")}
                  aria-pressed={importantOnly}
                  onClick={() => setImportantOnly((v) => !v)}
                >
                  ★ Important only
                </button>
                {visibleKeys.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setOpenAnswers((o) => {
                        const allOpen = visibleKeys.every((k) => o[k]);
                        return {
                          ...o,
                          ...Object.fromEntries(
                            visibleKeys.map((k) => [k, !allOpen]),
                          ),
                        };
                      })
                    }
                  >
                    <ChevronsUpDown size={15} />
                    {visibleKeys.every((k) => openAnswers[k])
                      ? "Hide all answers"
                      : "Show all answers"}
                  </button>
                )}
              </div>
              {bankReady && bankTotal > 0 && (
                <QuestionPdfPanel
                  key={`${doc.id}-${study.bank?.source || "built"}`}
                  doc={doc}
                  bank={bank}
                  notify={notify}
                  importantOnly={importantOnly}
                  marks={marks}
                />
              )}
              <p className="fine marks-hint">
                {marks === 2
                  ? "Short answers: a precise definition plus key points."
                  : marks === 5
                    ? "Medium answers: introduction, key points, and an example, table, figure or code."
                    : marks === 8
                      ? "Long answers: introduction, detailed sections, diagrams or code, and a conclusion."
                      : "The complete question bank for this document: every marks group, grouped by question type."}
              </p>
              {!bankReady && jobs.bank?.status !== "writing" ? (
                <Thinking
                  label="Building your question bank…"
                  lines={4}
                  slowHint=""
                />
              ) : jobs.bank?.status === "writing" ? (
                <Thinking
                  label="Writing your question bank…"
                  detail="Creating every important 2, 5 and 8-mark question with model answers and memory tricks."
                  lines={5}
                />
              ) : visibleKeys.length ? (
                visibleGroups.map(({ m, groups }) => (
                  <section key={m} className="marks-section">
                    {marks === "all" && (
                      <h3 className="marks-heading">
                        {m}-mark questions
                        <span className="count">{(bank[m] || []).length}</span>
                      </h3>
                    )}
                    {groups.map(([type, items]) => (
                      <div className="q-group" key={type}>
                        <h4 className="q-group-title">
                          <span>{type}</span>
                          <span className="count">{items.length}</span>
                        </h4>
                        <ol className="question-list">
                          {items.map(({ q, index }) => {
                            const key = `${m}-${index}`;
                            return (
                              <QuestionCard
                                key={key}
                                q={q}
                                n={displayNumber[key]}
                                marks={m}
                                open={!!openAnswers[key]}
                                onToggle={() =>
                                  setOpenAnswers((o) => ({
                                    ...o,
                                    [key]: !o[key],
                                  }))
                                }
                                images={images}
                                onPage={setPage}
                                doc={doc}
                                verdict={
                                  study.qFeedback?.[q.question.slice(0, 80)]
                                }
                                onVerdict={(v) =>
                                  onStudy({
                                    qFeedback: {
                                      ...(study.qFeedback || {}),
                                      [q.question.slice(0, 80)]: v,
                                    },
                                  })
                                }
                              />
                            );
                          })}
                        </ol>
                      </div>
                    ))}
                  </section>
                ))
              ) : (
                <p>
                  {importantOnly
                    ? "No questions are marked important here yet."
                    : "No questions could be built from this document's text alone."}{" "}
                  {geminiAvailable()
                    ? "Generate the full bank with Gemini below."
                    : "Turn on Gemini to generate more."}
                </p>
              )}
              <div className="button-row">
                {/* Question banks always use Gemini, whatever engine answers. */}
                {geminiAvailable() ? (
                  <button
                    className="primary"
                    disabled={jobs.bank?.status === "writing"}
                    onClick={writeBank}
                  >
                    <Sparkles size={16} />
                    {study.bank?.source === "ai" ||
                    study.bank?.source === "edited"
                      ? "Regenerate with Gemini"
                      : "Generate full question bank with Gemini"}
                  </button>
                ) : (
                  <button className="secondary" onClick={onOpenSettings}>
                    <Sparkles size={16} /> Turn on Gemini for more questions
                  </button>
                )}
                {study.bank && (
                  <button
                    className="text-button"
                    onClick={() => onStudy({ bank: null })}
                  >
                    Reset to built-in questions
                  </button>
                )}
                <ExportButtons
                  label="Complete question bank"
                  disabled={!bankTotal}
                  notify={notify}
                  onExport={async (format) => {
                    const { fileName, count } = await downloadQuestionPdf({
                      format,
                      doc,
                      bank,
                      category: "all",
                      title: "Complete question bank",
                    });
                    return `Downloaded ${fileName} (${count} questions).`;
                  }}
                />
              </div>
            </div>
          )}
          {tab === "Flashcards" && (
            <div className="tool-content">
              {!flashcard ? (
                <p className="fine">
                  No flashcards yet: this document has too little text.
                </p>
              ) : (
                <>
                  <div className="eyebrow">
                    {flashcard.source ? "RECALL PRACTICE" : "FLASHCARDS"} ·{" "}
                    {card + 1} / {cards.length}
                    {flashcard.marks ? ` · ${flashcard.marks} MARKS` : ""}
                  </div>
                  <button
                    className={"flashcard" + (flipped ? " flipped" : "")}
                    aria-label={
                      flipped
                        ? "Hide flashcard answer"
                        : "Reveal flashcard answer"
                    }
                    aria-pressed={flipped}
                    onClick={() => setFlipped((v) => !v)}
                  >
                    <Layers size={25} />
                    {flipped ? (
                      <>
                        <p className="flashcard-answer">{flashcard.answer}</p>
                        {flashcard.trick && (
                          <p className="flashcard-trick">
                            🧠 {flashcard.trick}
                          </p>
                        )}
                      </>
                    ) : (
                      <h2>{flashcard.prompt}</h2>
                    )}
                    <small>
                      {flipped
                        ? flashcard.page != null
                          ? `Source: page ${flashcard.page + 1}`
                          : "From your question bank"
                        : flashcard.source
                          ? "Click to reveal the source text"
                          : "Answer in your head, then click to check"}
                    </small>
                  </button>
                </>
              )}
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={card === 0 || !cards.length}
                  onClick={() => {
                    setCard((c) => c - 1);
                    setFlipped(false);
                  }}
                >
                  <ChevronLeft size={17} />
                  Previous card
                </button>
                <button
                  className="primary"
                  disabled={!cards.length}
                  onClick={() => {
                    setCard((c) => (c + 1) % cards.length);
                    setFlipped(false);
                  }}
                >
                  {card === cards.length - 1 ? "Start again" : "Next card"}
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
          )}
          {tab === "Quiz" && (
            <div className="tool-content">
              <QuizPanel
                doc={doc}
                bank={bankReady ? bank : null}
                onPage={setPage}
                notify={notify}
                geminiOn={geminiAvailable() && canGenerate()}
              />
            </div>
          )}
          {tab === "Read aloud" && (
            <div className="tool-content">
              <Headphones size={34} />
              <h2>Give your eyes a break.</h2>
              <p>
                Listen to the text on page {page + 1} using your browser's
                voice.
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={!text.trim() || speaking}
                  onClick={speak}
                >
                  <Play size={17} />
                  {speaking ? "Reading…" : "Read this page"}
                </button>
                <button
                  className="secondary"
                  disabled={!speaking}
                  onClick={() => {
                    window.speechSynthesis?.cancel();
                    setSpeaking(false);
                  }}
                >
                  <Square size={15} />
                  Stop
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      <Lightbox image={zoom} onClose={closeZoom} />
    </>
  );
}

/** One exam question: type, importance, model answer and a memory trick. */
function QuestionCard({
  q,
  n,
  marks,
  open,
  onToggle,
  images,
  onPage,
  doc,
  verdict,
  onVerdict,
}) {
  // Code questions carry the snippet after the first paragraph.
  const [title, ...extra] = q.question.split("\n\n");
  return (
    <li
      className={
        "question-card" +
        (q.important ? " important" : "") +
        (verdict === "wrong" ? " marked-wrong" : "")
      }
    >
      <button className="question-head" aria-expanded={open} onClick={onToggle}>
        <span className="q-num">Q{n}</span>
        <span className="q-text">{title}</span>
        <span className="q-badges">
          {verdict === "wrong" && (
            <span className="badge-wrong">You marked this wrong</span>
          )}
          {q.important && <span className="badge-important">★ Important</span>}
          <span className="tag">{marks} marks</span>
        </span>
      </button>
      {extra.length > 0 && (
        <div className="q-extra">
          <Markdown>{extra.join("\n\n")}</Markdown>
        </div>
      )}
      {open && (
        <div className="answer">
          <div className="answer-meta">
            MODEL ANSWER · {(q.type || "Question").toUpperCase()} ·{" "}
            <button className="tag" onClick={() => onPage(q.page)}>
              p. {q.page + 1}
            </button>
          </div>
          <Markdown images={images} onPage={onPage}>
            {q.answer}
          </Markdown>
          {q.trick && (
            <div className="memory-trick">
              <span className="trick-icon" aria-hidden="true">
                🧠
              </span>
              <div>
                <small>MEMORY TRICK</small>
                <Markdown>{q.trick}</Markdown>
              </div>
            </div>
          )}
          <FeedbackButtons
            kind="question"
            item={`${q.question}\n\n${String(q.answer).slice(0, 600)}`}
            docId={doc?.cloudId || doc?.id}
            docName={doc?.name}
            initial={verdict || null}
            onVerdict={onVerdict}
            label="Is this question and answer correct?"
          />
        </div>
      )}
    </li>
  );
}
