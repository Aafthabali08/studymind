// Main-thread API for the speech worker: model status (for the UI), live and
// final transcription, and embedding-based relevance scoring.
import { useSyncExternalStore } from "react";
import { cleanTranscript, prepareAudio } from "../audio";

let state = {
  live: "idle",
  final: "idle",
  embed: "idle",
  progress: {},
  error: "",
};
const listeners = new Set();
function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
export const getSpeechState = () => state;
export const useSpeech = () =>
  useSyncExternalStore(subscribe, getSpeechState, getSpeechState);

/** On-device speech needs workers, WebAssembly, a microphone and Web Audio. */
export const speechSupported = () =>
  typeof Worker !== "undefined" &&
  typeof WebAssembly !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  Boolean(
    typeof window !== "undefined" &&
    (window.AudioContext || window.webkitAudioContext),
  );

/**
 * Phones and low-memory devices: a mobile browser closes the tab once the
 * worker's memory grows too large, and Whisper base on top of Moonshine and
 * MiniLM is enough to do that. There the final transcript uses Whisper tiny.
 */
export const liteSpeech = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    navigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    // iPadOS reports itself as a Mac.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ||
    (navigator.deviceMemory > 0 && navigator.deviceMemory <= 4)
  );
};
/** A phone or tablet (not a low-memory laptop). */
export const phoneDevice = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    navigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
};
export const browserRecognition = () =>
  typeof window === "undefined"
    ? null
    : window.SpeechRecognition || window.webkitSpeechRecognition || null;
/**
 * Phones answer with the browser's own speech recognition: even with Whisper
 * tiny, running the open models on a phone fills its memory within seconds of
 * speaking, and the browser then reloads the tab. The built-in service needs
 * no model memory. Laptops keep the on-device models.
 */
export const phoneSpeech = () => phoneDevice() && Boolean(browserRecognition());

/**
 * Joins SpeechRecognition results into one transcript. Android Chrome repeats
 * earlier words in later results ("I built", "I built a dashboard"), so a
 * result that extends (or repeats) the previous one replaces it.
 */
export function joinRecognition(results) {
  const parts = [];
  for (const result of Array.from(results || [])) {
    const text = (result?.[0]?.transcript || "").trim();
    if (!text) continue;
    const prev = parts.at(-1)?.toLocaleLowerCase();
    const lower = text.toLocaleLowerCase();
    if (prev && lower.startsWith(prev)) parts[parts.length - 1] = text;
    else if (!prev || !prev.endsWith(lower)) parts.push(text);
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

let worker,
  seq = 0;
const pending = new Map();
function getWorker() {
  if (worker !== undefined) return worker;
  if (typeof Worker === "undefined") return (worker = null);
  try {
    worker = new Worker(new URL("./speech.worker.js", import.meta.url), {
      type: "module",
    });
  } catch {
    return (worker = null);
  }
  // The worker crashed (usually out of memory) and took its models with it:
  // fail them and every waiting call, so the studio falls back to the
  // browser's speech service instead of hanging.
  worker.onerror = (event) => {
    event.preventDefault?.();
    worker.terminate();
    worker = null;
    set({
      live: "error",
      final: "error",
      embed: "error",
      error: event.message || "The speech models stopped.",
    });
    for (const job of pending.values())
      job.reject(new Error("On-device speech stopped."));
    pending.clear();
  };
  worker.onmessage = ({ data }) => {
    if (data.type === "status")
      return set({
        [data.kind]: data.status,
        progress: {
          ...state.progress,
          [data.kind]:
            data.status === "ready" ? 100 : state.progress[data.kind] || 0,
        },
        error: data.message || state.error,
      });
    if (data.type === "progress")
      return set({
        progress: { ...state.progress, [data.kind]: data.progress },
      });
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.type === "error") job.reject(new Error(data.message));
    else job.resolve(data.result);
  };
  return worker;
}
function call(type, data = {}, transfer = []) {
  const w = getWorker();
  if (!w)
    return Promise.reject(new Error("On-device speech is not supported here."));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, type });
    w.postMessage({ id, type, lite: liteSpeech(), ...data }, transfer);
  });
}

/** Loads the models in order of need: live speech, scoring, final speech. */
let preloaded = false;
export function preloadSpeech() {
  if (preloaded || !speechSupported() || phoneSpeech()) return;
  preloaded = true;
  call("load", { kind: "live" })
    .then(() => call("load", { kind: "embed" }))
    .then(() => call("load", { kind: "final" }))
    .catch(() => {});
}

let liveBusy = false;
/**
 * Transcribes 16 kHz audio. "live" requests are dropped while one is running,
 * so the live transcript never falls behind; "final" requests always run.
 * Returns cleaned text, or null when skipped / no speech.
 */
export async function transcribe(audio, { quality = "live" } = {}) {
  const prepared = prepareAudio(audio);
  if (!prepared) return "";
  if (quality === "live") {
    if (liveBusy) return null;
    liveBusy = true;
  }
  try {
    const { text } = await call("transcribe", { audio: prepared, quality }, [
      prepared.buffer,
    ]);
    return cleanTranscript(text);
  } finally {
    if (quality === "live") liveBusy = false;
  }
}

const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
/**
 * 0–100 relevance of an answer to its question, from MiniLM cosine similarity
 * (≈0.15 unrelated … ≈0.6 clearly on topic). Null when the model is unavailable.
 */
export async function semanticRelevance(question, answer) {
  if (
    !speechSupported() ||
    phoneSpeech() ||
    !question?.trim() ||
    !answer?.trim()
  )
    return null;
  try {
    const [q, a] = await call("embed", { texts: [question, answer] });
    const sim = dot(q, a);
    return Math.round(Math.max(0, Math.min(1, (sim - 0.15) / 0.45)) * 100);
  } catch {
    return null;
  }
}
