// One AI API for the whole app. Every feature answers instantly with exact,
// page-cited text (extractive), then upgrades when a stronger engine is on:
//
//   instant – BM25 keyword retrieval + extractive summaries. No download.
//   local   – + MiniLM semantic search and a small open LLM, in a Web Worker.
//   remote  – + any OpenAI-compatible server running an open model
//             (Ollama, LM Studio, Groq, OpenRouter, vLLM…).
import { useSyncExternalStore } from "react";
import { MODELS } from "./models";
import {
  bm25Search,
  buildIndex,
  chunkPages,
  extractiveAnswer,
  fuseRankings,
  summarizeExtractive,
} from "./text";
import { GEMINI_MODEL, geminiAvailable, streamGemini } from "./gemini";

const KEY = "studymind-ai";
export const ENGINES = [
  {
    id: "gemini",
    label: "Gemini",
    detail: `Google's ${GEMINI_MODEL}: reads whole documents, page images and diagrams, and writes detailed notes, answers and mark-wise question banks.`,
  },
  {
    id: "fast",
    label: "Instant",
    detail:
      "Keyword retrieval and extractive summaries. No download, works offline, quotes your document exactly.",
  },
  {
    id: "local",
    label: "On-device open model",
    detail: `Adds semantic search (${MODELS.embed.split("/")[1]}) and written answers from ${MODELS.generate.split("/")[1]}. One-time ~400 MB download, cached; your files never leave this device.`,
  },
  {
    id: "remote",
    label: "Your model server",
    detail:
      "Any OpenAI-compatible endpoint running an open model, such as Ollama (llama3.2), LM Studio, Groq or OpenRouter. Fastest and strongest.",
  },
];
const DEFAULTS = {
  engine: geminiAvailable() ? "gemini" : "fast",
  baseUrl: "http://localhost:11434/v1",
  model: "llama3.2",
  apiKey: "",
};

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    // Only keep a saved engine the user picked themselves; otherwise use the
    // best available default (Gemini once a key is configured).
    if (!saved.chosen) delete saved.engine;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

let state = {
  settings: readSettings(),
  embed: "idle",
  generate: "idle",
  progress: null,
  error: "",
};
const listeners = new Set();
function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
export const getAIState = () => state;
export function useAI() {
  return useSyncExternalStore(subscribe, getAIState, getAIState);
}

export function updateSettings(patch) {
  const settings = {
    ...state.settings,
    ...patch,
    ...("engine" in patch ? { chosen: true } : {}),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* Settings still apply for this session. */
  }
  const changed = settings.engine !== state.settings.engine;
  set({ settings, error: "" });
  if (!changed) return;
  if (settings.engine === "local") preloadModels();
  else if (settings.engine === "remote")
    call("load", { kind: "embed" }).catch(() => {});
}

// ---- Worker plumbing -------------------------------------------------------
let worker,
  seq = 0;
const pending = new Map();
const controllers = new Set();

function getWorker() {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") return (worker = null);
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
  } catch {
    return (worker = null);
  }
  worker.onmessage = ({ data }) => {
    if (data.type === "status")
      return set({
        [data.kind]: data.status,
        progress: data.status === "loading" ? state.progress : null,
        error: data.message || "",
      });
    if (data.type === "progress")
      return set({ progress: { kind: data.kind, value: data.progress } });
    const job = pending.get(data.id);
    if (!job) return;
    if (data.type === "token") return job.onToken?.(data.text);
    pending.delete(data.id);
    if (data.type === "error") job.reject(new Error(data.message));
    else job.resolve(data.result);
  };
  worker.onerror = (e) => set({ error: e.message || "The AI worker stopped." });
  return worker;
}

function call(type, data = {}, onToken) {
  const w = getWorker();
  if (!w)
    return Promise.reject(
      new Error("This browser cannot run on-device models."),
    );
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onToken, type });
    w.postMessage({ id, type, ...data });
  });
}

export function preloadModels() {
  call("load", { kind: "embed" })
    .then(() => call("load", { kind: "generate" }))
    .catch(() => {});
}

/** Stop any answer or summary currently being written. */
export function cancelGeneration() {
  for (const [id, job] of pending)
    if (job.type === "generate")
      worker?.postMessage({ type: "abort", target: id });
  controllers.forEach((c) => c.abort());
}

// ---- Capabilities ----------------------------------------------------------
const workersAvailable = () => typeof Worker !== "undefined";
export const semanticEnabled = () =>
  !["fast", "gemini"].includes(state.settings.engine) &&
  state.embed !== "error" &&
  workersAvailable();
export function canGenerate() {
  const { engine, baseUrl, model } = state.settings;
  if (engine === "gemini") return geminiAvailable();
  if (engine === "remote") return Boolean(baseUrl && model);
  return engine === "local" && state.generate !== "error" && workersAvailable();
}

// ---- Documents -------------------------------------------------------------
const indexes = new Map();
export function docIndex(doc) {
  let entry = indexes.get(doc.id);
  if (!entry || entry.pages !== doc.pages) {
    const chunks = chunkPages(doc.pages);
    entry = {
      pages: doc.pages,
      chunks,
      index: buildIndex(chunks),
      vectors: null,
    };
    indexes.set(doc.id, entry);
  }
  return entry;
}

/** Embed a document's chunks once (in batches) so semantic search is instant. */
export function indexDocument(doc, onProgress) {
  const entry = docIndex(doc);
  entry.vectors ||= (async () => {
    const out = [];
    for (let i = 0; i < entry.chunks.length; i += 16) {
      const batch = entry.chunks.slice(i, i + 16).map((c) => c.text);
      out.push(...(await call("embed", { texts: batch })));
      onProgress?.(out.length, entry.chunks.length);
    }
    return out;
  })().catch((error) => {
    entry.vectors = null;
    throw error;
  });
  return entry.vectors;
}

const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);

/** Hybrid retrieval: keyword (BM25) fused with semantic (embedding) ranking. */
export async function retrieve(doc, query, k = 4) {
  const entry = docIndex(doc);
  const keyword = bm25Search(entry.index, query, 8);
  if (!semanticEnabled()) return keyword.slice(0, k);
  try {
    const [vectors, [q]] = await Promise.all([
      indexDocument(doc),
      call("embed", { texts: [query] }),
    ]);
    const semantic = vectors
      .map((v, i) => ({ chunk: entry.chunks[i], score: dot(v, q) }))
      .filter((r) => r.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    // Meaning outranks exact wording; chunks found by both rank highest.
    return fuseRankings([keyword, semantic], k, [1, 1.25]);
  } catch {
    return keyword.slice(0, k);
  }
}

/** Instant, verbatim answer from the document. */
export function quickAnswer(doc, question) {
  return extractiveAnswer(docIndex(doc).index, question);
}

const ANSWER_RULES =
  "You are StudyMind, a careful study assistant. Answer ONLY using the excerpts. " +
  "Cite pages like [p. 3] after each claim. If the excerpts do not contain the answer, " +
  'reply exactly: "The document does not cover this." Keep it under 120 words.';

/** Retrieval-augmented answer. Returns sources even when no LLM is enabled. */
export async function answerQuestion(doc, question, { onToken } = {}) {
  const ranked = await retrieve(doc, question, 4);
  if (!ranked.length) return null;
  const extract = extractiveAnswer(docIndex(doc).index, question, ranked);
  if (!canGenerate()) return { extract, text: null };
  const context = ranked
    .map((r) => `[p. ${r.chunk.page + 1}] ${r.chunk.text}`)
    .join("\n\n");
  try {
    const text = await generate(
      [
        { role: "system", content: ANSWER_RULES },
        {
          role: "user",
          content: `Excerpts:\n${context}\n\nQuestion: ${question}`,
        },
      ],
      { onToken, maxTokens: 260 },
    );
    return { extract, text: text.trim() };
  } catch (error) {
    // Keep the (semantic) extract even when the model is unavailable.
    return { extract, text: null, error: error.message };
  }
}

/** Instant key-sentence summary of the document or one page. */
export function quickSummary(doc, page = null, sentences = 6) {
  const pages =
    page == null ? doc.pages : doc.pages.map((p, i) => (i === page ? p : ""));
  return summarizeExtractive(pages, { sentences });
}

const words = (t) => (t.match(/\S+/g) || []).length;

/**
 * Written summary. Short text goes to the model whole; long text is first
 * condensed to its most central sentences (extract-then-abstract), which is
 * far faster than reading every chunk and keeps the model grounded.
 */
export async function generateSummary(
  doc,
  { page = null, onToken, onStage } = {},
) {
  const budget = contextBudget();
  const pages =
    page == null ? doc.pages : doc.pages.map((p, i) => (i === page ? p : ""));
  const total = pages.reduce((n, p) => n + words(p), 0);
  onStage?.(
    total > budget ? "Selecting the key passages…" : "Reading the text…",
  );
  const material =
    total > budget
      ? summarizeExtractive(pages, { sentences: Math.floor(budget / 24) })
          .map((s) => `[p. ${s.page + 1}] ${s.text}`)
          .join("\n")
      : pages
          .map((p, i) => (p.trim() ? `[p. ${i + 1}]\n${p.trim()}` : ""))
          .filter(Boolean)
          .join("\n\n");
  onStage?.("Writing your summary…");
  return generate(
    [
      {
        role: "system",
        content:
          "Summarize study material for a student using ONLY the text given. Format: one-sentence overview, " +
          "then 4-6 bullet points of key ideas each ending with its page like [p. 2], then a line 'Key terms:' " +
          "with 3-6 terms. Do not invent facts.",
      },
      { role: "user", content: material },
    ],
    { onToken, maxTokens: 380 },
  );
}

// ---- Generation backends ---------------------------------------------------
/** Long-context engines can read far more text per request. */
export const contextBudget = () =>
  ({ gemini: 120000, remote: 6000 })[state.settings.engine] || 1100;

async function viaGemini(messages, { onToken, maxTokens }) {
  const controller = new AbortController();
  controllers.add(controller);
  try {
    return await streamGemini(messages, {
      onToken,
      maxTokens,
      signal: controller.signal,
    });
  } finally {
    controllers.delete(controller);
  }
}
const textOnly = (messages) =>
  messages.map((m) => ({
    ...m,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content
            .map((p) => p.text)
            .filter(Boolean)
            .join("\n\n"),
  }));

/**
 * Writes with the chosen engine. `preferGemini` (Ask Gemini) always uses
 * Gemini when it is configured. If a model server or the on-device model
 * fails before writing anything, Gemini takes over when available.
 */
export async function generate(
  messages,
  { onToken, maxTokens = 320, preferGemini = false } = {},
) {
  const engine = state.settings.engine;
  if (engine === "gemini" || (preferGemini && geminiAvailable()))
    return viaGemini(messages, { onToken, maxTokens });
  let wrote = false;
  const track = (t) => {
    wrote = true;
    onToken?.(t);
  };
  try {
    if (engine === "remote")
      return await remoteChat(textOnly(messages), {
        onToken: track,
        maxTokens,
      });
    return await call(
      "generate",
      { messages: textOnly(messages), maxTokens },
      track,
    );
  } catch (error) {
    if (wrote || !geminiAvailable() || error?.name === "AbortError")
      throw error;
    return viaGemini(messages, { onToken, maxTokens });
  }
}

async function remoteChat(messages, { onToken, maxTokens }) {
  const { baseUrl, model, apiKey } = state.settings;
  const controller = new AbortController();
  controllers.add(controller);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok)
      throw new Error(
        `Model server returned ${res.status}. Check the URL, model name and key.`,
      );
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const payload = line.trim().replace(/^data:\s*/, "");
        if (
          !payload ||
          payload === "[DONE]" ||
          !line.trim().startsWith("data:")
        )
          continue;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            onToken?.(delta);
          }
        } catch {
          /* Ignore keep-alive or partial lines. */
        }
      }
    }
    return text;
  } catch (error) {
    if (error.name === "AbortError") return "";
    if (error instanceof TypeError)
      throw new Error(
        "Could not reach the model server. Check the URL and that it allows browser (CORS) requests.",
      );
    throw error;
  } finally {
    controllers.delete(controller);
  }
}

export async function testConnection() {
  const reply = await generate(
    [{ role: "user", content: "Reply with the single word: ready" }],
    {
      maxTokens: 8,
    },
  );
  if (!reply.trim()) throw new Error("The model returned an empty reply.");
  return reply.trim();
}
