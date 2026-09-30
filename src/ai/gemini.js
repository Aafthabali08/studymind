// Gemini client. Two ways to connect:
//  1. VITE_GEMINI_API_KEY – a Gemini API key from Google AI Studio, called
//     directly from the browser. Restrict the key to your website's domain in
//     Google Cloud console → APIs & Services → Credentials, because anything in
//     a web bundle is visible to visitors.
//  2. VITE_GEMINI_VIA_FIREBASE=true – Firebase AI Logic. The key stays inside
//     Firebase, so nothing secret ships to the browser (recommended for prod).
import { firebase, firebaseEnabled } from "../firebase";
import { learningNotes } from "./memory";

// Google retires older models for new keys (gemini-2.5-flash is no longer
// available), so default to the current recommendation and fall back to other
// current models when one is busy or unavailable.
export const GEMINI_MODEL =
  import.meta.env.VITE_GEMINI_MODEL || "gemini-3.8-flash";
// Each model has its own free-tier quota. "gemini-flash-latest" is an alias of
// the newest flash model (it shares its quota), so it goes last.
const FALLBACK_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
];
const models = () => [...new Set([GEMINI_MODEL, ...FALLBACK_MODELS])];

// Models that just failed rest for a while so later requests go straight to a
// working one instead of waiting on the same error again.
const restingUntil = new Map();
function rest(model, seconds) {
  restingUntil.set(model, Date.now() + seconds * 1000);
}
/** Healthy models in preference order, then resting ones (soonest back first). */
function modelOrder() {
  const now = Date.now();
  const all = models();
  const healthy = all.filter((m) => !(restingUntil.get(m) > now));
  const resting = all
    .filter((m) => restingUntil.get(m) > now)
    .sort((a, b) => restingUntil.get(a) - restingUntil.get(b));
  return [...healthy, ...resting];
}
/** Google's "retry in 27s" hint (quota errors), else a sensible default. */
function retryAfter(hint, fallback) {
  const seconds = parseFloat(String(hint || "").match(/(\d+(?:\.\d+)?)\s*s/)?.[1]);
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 30), 3600) : fallback;
}
const switching = (next) =>
  setRetryStatus(
    `Gemini is busy (Google reports high demand). Switching to ${next}…`,
  );
const wait = (ms, signal) =>
  new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(id), resolve()));
  });
// Live retry status ("Gemini is busy, retrying…") for loading indicators.
let retryStatus = "";
const statusListeners = new Set();
function setRetryStatus(value) {
  retryStatus = value;
  statusListeners.forEach((l) => l(value));
}
export const getRetryStatus = () => retryStatus;
export function onRetryStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
/** 429/500/503: busy, try again. 404: model retired for this key, try another. */
const RETRYABLE = new Set([429, 500, 503]);
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
const VIA_FIREBASE = import.meta.env.VITE_GEMINI_VIA_FIREBASE === "true";

export const geminiMode = API_KEY
  ? "key"
  : VIA_FIREBASE && firebaseEnabled
    ? "firebase"
    : null;
export const geminiAvailable = () => Boolean(geminiMode);

/**
 * Shared message format:
 *   { role: "system" | "user" | "assistant", content: string | Part[] }
 *   Part = { text } | { image: base64, mime }
 */
function toGemini(messages) {
  // Every Gemini call also learns from user feedback and admin guidance.
  const system = (
    messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n") + learningNotes()
  ).trim();
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: (typeof m.content === "string"
        ? [{ text: m.content }]
        : m.content
      ).map((p) =>
        p.image
          ? { inlineData: { mimeType: p.mime || "image/jpeg", data: p.image } }
          : { text: p.text },
      ),
    }));
  return { system, contents };
}

// Gemini 3 models "think" before answering. "low" keeps everyday answers fast;
// notes and question banks ask for "medium". If a model rejects the setting,
// the request is repeated without it.
const generationConfig = ({
  maxTokens = 2048,
  json = false,
  temperature = 0.3,
  thinking = "low",
}) => ({
  temperature,
  // Thinking models spend part of the budget reasoning, so leave headroom.
  maxOutputTokens: maxTokens + 2048,
  ...(json ? { responseMimeType: "application/json" } : {}),
  ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
});
const withoutThinking = ({ thinkingConfig, ...config }) => config;
const rejectsThinking = (message) => /thinking/i.test(String(message || ""));
/** A model that has not started answering after this long is skipped. */
const FIRST_RESPONSE_MS = 15_000;

/** Streams text from Gemini; resolves with the full reply. */
export async function streamGemini(
  messages,
  { onToken, signal, maxTokens, json, temperature, thinking } = {},
) {
  if (!geminiMode)
    throw new Error(
      "Gemini is not configured. Add VITE_GEMINI_API_KEY to .env.local.",
    );
  const { system, contents } = toGemini(messages);
  let config = generationConfig({ maxTokens, json, temperature, thinking });
  let text = "";
  const emit = (piece) => {
    if (!piece) return;
    text += piece;
    onToken?.(piece);
  };
  if (geminiMode === "firebase") {
    // Firebase AI Logic: the Gemini key stays inside Firebase. Same retry and
    // model fallback as the direct API when Google is busy.
    const { app } = await firebase();
    const { getAI, getGenerativeModel, GoogleAIBackend } =
      await import("firebase/ai");
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    let lastError;
    const order = modelOrder();
    for (const [index, name] of order.entries()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) return text;
        try {
          const model = getGenerativeModel(ai, {
            model: name,
            generationConfig: config,
            ...(system ? { systemInstruction: system } : {}),
          });
          const result = await model.generateContentStream({ contents });
          for await (const chunk of result.stream) {
            if (signal?.aborted) break;
            emit(chunk.text());
          }
          restingUntil.delete(name);
          setRetryStatus("");
          return text;
        } catch (error) {
          lastError = error;
          if (text) throw error; // failed mid-stream: keep what was shown
          const message = String(error?.message || "");
          if (config.thinkingConfig && rejectsThinking(message)) {
            config = withoutThinking(config);
            attempt--;
            continue;
          }
          if (/404|not found/i.test(message)) {
            rest(name, 3600); // unavailable for this project: next model
            break;
          }
          const quota = /429|quota|rate limit|resource.exhausted/i.test(message);
          if (!quota && !/500|503|overloaded|unavailable|high demand/i.test(message))
            throw error;
          if (quota || attempt === 1 || order[index + 1]) {
            rest(name, quota ? retryAfter(message, 60) : 30);
            if (order[index + 1]) switching(order[index + 1]);
            break;
          }
          setRetryStatus(
            `Gemini is busy (Google reports high demand). Retrying ${name}…`,
          );
          await wait(1000, signal);
        }
      }
    }
    setRetryStatus("");
    throw new Error(
      /429/.test(String(lastError?.message))
        ? "Gemini rate limit reached. Wait a minute and try again."
        : "Gemini is busy right now (Google reports high demand). The built-in answer is shown; try again in a minute.",
    );
  }
  const body = () =>
    JSON.stringify({
      contents,
      generationConfig: config,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    });
  let res,
    lastError = null;
  // Rate limit (429): the quota is per model, so switch at once and rest this
  // one until Google says it resets. Overloaded (500/503): switch at once too
  // (one quick retry if it is the last model). Retired (404): switch.
  const order = modelOrder();
  outer: for (const [index, model] of order.entries()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) return (setRetryStatus(""), text);
      // Own controller per attempt: follows the caller's signal, and gives up
      // on a model that has not started answering in time.
      const controller = new AbortController();
      signal?.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
      let slow = false;
      const timer = setTimeout(() => {
        slow = true;
        controller.abort();
      }, FIRST_RESPONSE_MS);
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": API_KEY,
            },
            body: body(),
          },
        );
      } catch (error) {
        if (slow && !signal?.aborted) {
          res = null;
          lastError = { status: 503, detail: "No response in time." };
          rest(model, 30);
          if (order[index + 1]) switching(order[index + 1]);
          continue outer;
        }
        setRetryStatus("");
        if (error.name === "AbortError") return text;
        throw new Error("Could not reach Gemini. Check your connection.");
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) {
        restingUntil.delete(model);
        break outer;
      }
      let detail = "",
        hint = "";
      try {
        const error = (await res.json()).error;
        detail = error?.message || "";
        hint = error?.details?.find((d) => d.retryDelay)?.retryDelay || "";
      } catch {
        /* not JSON */
      }
      lastError = { status: res.status, detail };
      if (res.status === 400 && config.thinkingConfig && rejectsThinking(detail)) {
        config = withoutThinking(config);
        attempt--;
        continue; // same model, without the thinking setting
      }
      if (res.status === 404) {
        rest(model, 3600);
        continue outer; // retired model: next one
      }
      if (!RETRYABLE.has(res.status)) break outer; // bad key/request: stop
      // Retry an overloaded model only when it is the last one left.
      if (res.status === 429 || attempt === 1 || order[index + 1]) {
        rest(model, res.status === 429 ? retryAfter(hint || detail, 60) : 30);
        if (order[index + 1]) switching(order[index + 1]);
        continue outer;
      }
      setRetryStatus(
        `Gemini is busy (Google reports high demand). Retrying ${model}…`,
      );
      await wait(1000, signal);
    }
  }
  setRetryStatus("");
  if (!res?.ok) {
    const { status, detail } = lastError || {};
    throw new Error(
      status === 503 || status === 500
        ? "Gemini is busy right now (Google reports high demand). The built-in answer is shown; try again in a minute."
        : status === 429
          ? "Gemini rate limit reached. Wait a minute and try again."
          : status === 400 || status === 403
            ? `Gemini rejected the request: ${detail || "check your API key."}`
            : status === 404
              ? "No Gemini model is available for this key. Set VITE_GEMINI_MODEL in .env.local."
              : `Gemini returned ${status}. ${detail}`,
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const parts =
            JSON.parse(line.slice(5)).candidates?.[0]?.content?.parts || [];
          emit(
            parts
              .filter((p) => !p.thought)
              .map((p) => p.text || "")
              .join(""),
          );
        } catch {
          /* partial line */
        }
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  }
  return text;
}

/**
 * Parses a model's JSON even when it is slightly off: ```json fences, text
 * around it, unquoted keys, single-quoted strings, trailing commas, or a reply
 * cut off mid-way (the complete items before the cut are kept).
 */
export function parseLooseJSON(raw) {
  let text = String(raw ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch {
    /* repair below */
  }
  const start = text.search(/[[{]/);
  if (start < 0) throw new SyntaxError("No JSON found in the reply.");
  text = text.slice(start);
  const repair = (t) =>
    t
      .replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":') // unquoted keys
      .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, v) => `: ${JSON.stringify(v.replace(/\\'/g, "'"))}`)
      .replace(/,\s*([}\]])/g, "$1"); // trailing commas
  try {
    return JSON.parse(repair(text));
  } catch {
    /* maybe cut off */
  }
  // Cut off mid-way: keep everything up to the last complete object, then
  // close the brackets that are still open.
  for (let end = text.lastIndexOf("}"); end > 0; end = text.lastIndexOf("}", end - 1)) {
    const head = repair(text.slice(0, end + 1));
    const stack = [];
    let inString = false;
    for (let i = 0; i < head.length; i++) {
      const c = head[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
      else if (c === "}" || c === "]") stack.pop();
    }
    if (inString) continue;
    try {
      return JSON.parse(head + stack.reverse().join(""));
    } catch {
      /* try an earlier cut */
    }
  }
  throw new SyntaxError("Gemini's reply was not valid JSON.");
}

/** Asks for JSON and parses it, repairing small mistakes. */
export async function geminiJSON(messages, options = {}) {
  const text = await streamGemini(messages, { ...options, json: true });
  return parseLooseJSON(text);
}

/** "data:image/jpeg;base64,xxx" → { image, mime } part for Gemini. */
export function imagePart(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
  return match ? { image: match[2], mime: match[1] } : null;
}
