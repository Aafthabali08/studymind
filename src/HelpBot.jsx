import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles, Square, Trash2, X } from "lucide-react";
import Markdown from "./Markdown";
import Thinking from "./Thinking";
import {
  canGenerate,
  cancelGeneration,
  contextBudget,
  generate,
  getAIState,
  quickAnswer,
} from "./ai/engine";
import { geminiAvailable, imagePart } from "./ai/gemini";
import { loadChat, saveChat } from "./cloud";
import FeedbackButtons from "./FeedbackButtons";

const SYSTEM =
  "You are Ask Gemini, the help assistant inside StudyMind, a study app. You are given what the " +
  "student is looking at: the current screen, a document page (text and its images), or a whole " +
  "document. Answer using that context first and cite document pages as (p. N). If the context " +
  "does not contain the answer, say so briefly, then answer from general knowledge and label it " +
  "'General knowledge'. Explain clearly for a student. Format in Markdown: ## headings and ### " +
  "sub-headings for longer answers, short paragraphs, bullet points, tables for comparisons, and " +
  "fenced code blocks with a language tag (```python, ```java …) for any code.";

const SUGGESTIONS = {
  page: [
    "Explain this page simply",
    "What are the key points here?",
    "Make 2-mark questions from this page",
  ],
  document: [
    "Summarise the whole document",
    "What should I study first?",
    "Explain the hardest topic with an example",
  ],
  screen: [
    "What can I do on this screen?",
    "Explain what I'm looking at",
    "How do I get better questions?",
  ],
};

/**
 * Floating "Ask Gemini" assistant. It can read the current screen, the open
 * page (text + figures) or the whole document, like Gemini reading a web page.
 */
export default function HelpBot({ uid, context }) {
  const doc = context.doc;
  const [open, setOpen] = useState(false),
    [scope, setScope] = useState(doc ? "page" : "screen"),
    [messages, setMessages] = useState([]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false);
  const chatKey = doc ? `doc-${doc.cloudId || doc.id}` : "app";
  const listRef = useRef(null);
  const scopes = doc
    ? [
        ["page", `Page ${(context.page ?? 0) + 1}`],
        ["document", "Whole document"],
        ["screen", "This screen"],
      ]
    : [["screen", "This screen"]];

  useEffect(() => setScope(doc ? "page" : "screen"), [doc?.id]);
  // Each document (and the app) keeps its own saved conversation.
  useEffect(() => {
    setMessages([]);
    if (!uid) return;
    let live = true;
    loadChat(uid, chatKey)
      .then((saved) => live && saved?.messages && setMessages(saved.messages))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid, chatKey]);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  function contextFor(which) {
    const useImages = getAIState().settings.engine === "gemini";
    if (which === "screen") {
      const main = document.querySelector("main");
      // innerText = only what is visible on screen (like reading a web page).
      const text = (main?.innerText ?? main?.textContent ?? "").slice(0, 20000);
      return {
        label: `the ${context.view} screen`,
        text: `Current StudyMind screen: ${context.view}\n\nVisible content:\n${text}`,
        images: [],
      };
    }
    const images = doc.images || [];
    if (which === "page") {
      const p = context.page ?? 0;
      return {
        label: `page ${p + 1} of ${doc.name}`,
        text: `Document: ${doc.name}\n[Page ${p + 1} of ${doc.pages.length}]\n${doc.pages[p]}`,
        images: useImages ? images.filter((i) => i.page === p).slice(0, 6) : [],
      };
    }
    const budget = contextBudget() * 4;
    let text = `Document: ${doc.name} (${doc.pages.length} pages)`;
    for (const [i, p] of doc.pages.entries()) {
      const chunk = `\n\n[Page ${i + 1}]\n${p}`;
      if (text.length + chunk.length > budget) {
        text +=
          "\n\n[Remaining pages omitted: document is longer than the context limit.]";
        break;
      }
      text += chunk;
    }
    return {
      label: doc.name,
      text,
      images: useImages ? images.slice(0, 8) : [],
    };
  }

  async function ask(question) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const ctx = contextFor(scope);
    const history = messages
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.text }));
    const next = [...messages, { role: "user", text: q, scope: ctx.label }];
    setMessages([...next, { role: "assistant", text: "", pending: true }]);
    setBusy(true);
    const finish = (text, extra = {}) => {
      const done = [...next, { role: "assistant", text, ...extra }];
      setMessages(done);
      if (uid) saveChat(uid, chatKey, done).catch(() => {});
    };
    try {
      // Ask Gemini always uses Gemini when it is configured, whatever
      // engine is chosen for the rest of the app.
      const gemini = geminiAvailable();
      if (!gemini && !canGenerate()) {
        // No model: answer from the document itself, or explain how to turn Gemini on.
        const hit = doc && scope !== "screen" ? quickAnswer(doc, q) : null;
        finish(
          hit
            ? `> ${hit.text}\n\n*Exact extract from ${doc.name}, p. ${hit.page + 1}.* Add a Gemini API key for full explanations.`
            : "Gemini isn't turned on yet. Add `VITE_GEMINI_API_KEY` to `.env.local` and restart the app, then I can read this screen and explain it.",
          { fallback: true },
        );
        return;
      }
      const parts = [{ text: `Context (${ctx.label}):\n${ctx.text}` }];
      for (const img of ctx.images) {
        const part = imagePart(img.dataUrl);
        if (part) parts.push({ text: `Figure on page ${img.page + 1}:` }, part);
      }
      parts.push({ text: `Question: ${q}` });
      const content =
        gemini || getAIState().settings.engine === "gemini"
          ? parts
          : parts
              .map((p) => p.text)
              .filter(Boolean)
              .join("\n\n");
      let streamed = "";
      const text = await generate(
        [
          { role: "system", content: SYSTEM },
          ...history,
          { role: "user", content },
        ],
        {
          maxTokens: 2500,
          preferGemini: true,
          onToken: (t) => {
            streamed += t;
            setMessages([
              ...next,
              { role: "assistant", text: streamed, pending: true },
            ]);
          },
        },
      );
      finish(
        text.trim() || streamed || "No answer was returned. Please try again.",
      );
    } catch (e) {
      finish(`**Sorry — I couldn't answer.** ${e.message}`, { error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          className="helpbot-launch"
          onClick={() => setOpen(true)}
          aria-label="Ask Gemini"
        >
          <Sparkles size={18} /> <span>Ask Gemini</span>
        </button>
      )}
      {open && (
        <section className="helpbot" role="dialog" aria-label="Ask Gemini">
          <header className="helpbot-head">
            <strong>
              <Sparkles size={16} /> Ask Gemini
            </strong>
            <div>
              {messages.length > 0 && (
                <button
                  className="icon-button"
                  aria-label="Clear conversation"
                  onClick={() => {
                    setMessages([]);
                    if (uid) saveChat(uid, chatKey, []).catch(() => {});
                  }}
                >
                  <Trash2 size={15} />
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Close Ask Gemini"
                onClick={() => setOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
          </header>
          <div
            className="segmented helpbot-scope"
            role="group"
            aria-label="What Gemini can see"
          >
            {scopes.map(([value, label]) => (
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
          <div className="helpbot-body" ref={listRef} aria-live="polite">
            {!messages.length && (
              <div className="helpbot-empty">
                <p>
                  I can see{" "}
                  {scope === "screen"
                    ? "everything on this screen"
                    : scope === "page"
                      ? `page ${(context.page ?? 0) + 1} of ${doc.name}, including its figures`
                      : `all of ${doc.name}`}
                  . Ask me anything.
                </p>
                {SUGGESTIONS[scope].map((s) => (
                  <button key={s} className="chip" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="helpbot-user">
                  {m.text}
                  {m.scope && <small>Looking at {m.scope}</small>}
                </div>
              ) : m.pending && !m.text ? (
                <Thinking
                  key={i}
                  label="Gemini is reading…"
                  detail="Looking at your screen, page or document to answer."
                  lines={2}
                />
              ) : (
                <div
                  key={i}
                  className={"helpbot-answer" + (m.pending ? " streaming" : "")}
                >
                  <Markdown images={doc?.images || []}>{m.text}</Markdown>
                  {!m.pending && !m.error && !m.fallback && (
                    <FeedbackButtons
                      kind="chat"
                      item={`Q: ${messages[i - 1]?.text || ""}\nA: ${m.text.slice(0, 800)}`}
                      docId={doc?.cloudId || doc?.id || ""}
                      docName={doc?.name || context.view}
                      label="Helpful and correct?"
                    />
                  )}
                </div>
              ),
            )}
          </div>
          <form
            className="chat-form helpbot-form"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              aria-label="Ask Gemini a question"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                scope === "screen"
                  ? "Ask about this screen…"
                  : "Ask about this page or document…"
              }
            />
            {busy ? (
              <button
                type="button"
                className="icon-dark"
                aria-label="Stop"
                onClick={cancelGeneration}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                className="icon-dark"
                aria-label="Send"
                disabled={!input.trim()}
              >
                <ArrowRight size={18} />
              </button>
            )}
          </form>
        </section>
      )}
    </>
  );
}
