// Audio and transcript preprocessing for on-device speech recognition.
export const TARGET_RATE = 16000; // what Moonshine and Whisper expect

const TERMS = (
  "API|APIs|SQL|NoSQL|AWS|GCP|UI|UX|CSS|HTML|JSON|REST|GraphQL|CI/CD|GPU|CPU|AI|ML|NLP|LLM|LLMs|SDK|URL|HTTP|HTTPS|" +
  "JavaScript|TypeScript|Python|Java|React|Redux|Redis|Node.js|Next.js|Vue|Angular|Django|Flask|FastAPI|Docker|" +
  "Kubernetes|GitHub|GitLab|Git|PostgreSQL|MySQL|MongoDB|Firebase|TensorFlow|PyTorch|Kafka|Linux|Figma|Jira|OAuth|DevOps"
).split("|");

/** Downsamples to 16 kHz with a simple averaging low-pass filter. */
export function resample(samples, fromRate, toRate = TARGET_RATE) {
  if (fromRate === toRate) return Float32Array.from(samples);
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio),
      end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** Loudness (RMS) of each 30 ms frame. */
export function frameEnergy(audio, rate = TARGET_RATE, frameMs = 30) {
  const size = Math.max(1, Math.round((rate * frameMs) / 1000));
  const out = [];
  for (let i = 0; i < audio.length; i += size) {
    let sum = 0;
    const end = Math.min(audio.length, i + size);
    for (let j = i; j < end; j++) sum += audio[j] * audio[j];
    out.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return out;
}

/** Voice activity threshold: above the noise floor, below half the speech level. */
export function speechThreshold(energy) {
  if (!energy.length) return 0.01;
  const sorted = [...energy].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const loud = sorted[Math.floor(sorted.length * 0.9)] || 0;
  return Math.min(Math.max(0.008, floor * 3), Math.max(loud * 0.5, 0.008));
}

/**
 * Model-ready audio: silence trimmed from both ends (keeping 200 ms of room
 * tone) and gain normalised so quiet microphones are still understood.
 * Returns null when there is no speech at all.
 */
export function prepareAudio(audio, rate = TARGET_RATE) {
  if (!audio?.length) return null;
  const frameMs = 30;
  const energy = frameEnergy(audio, rate, frameMs);
  const threshold = speechThreshold(energy);
  const first = energy.findIndex((e) => e >= threshold);
  if (first < 0) return null;
  let last = energy.length - 1;
  while (last > first && energy[last] < threshold) last--;
  const frame = Math.round((rate * frameMs) / 1000);
  const pad = Math.round(rate * 0.2);
  const start = Math.max(0, first * frame - pad),
    end = Math.min(audio.length, (last + 1) * frame + pad);
  const trimmed = audio.slice(start, end);
  let peak = 0;
  for (const v of trimmed) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 && peak < 0.5 ? Math.min(0.9 / peak, 8) : 1;
  if (gain !== 1) for (let i = 0; i < trimmed.length; i++) trimmed[i] *= gain;
  return trimmed;
}

/** Seconds of trailing silence at the end of the audio. */
export function trailingSilence(audio, rate = TARGET_RATE) {
  const energy = frameEnergy(audio, rate, 30);
  const threshold = speechThreshold(energy);
  let n = 0;
  for (let i = energy.length - 1; i >= 0 && energy[i] < threshold; i--) n++;
  return (n * 30) / 1000;
}

/** Whether the audio contains at least `minSec` of speech. */
export function hasSpeech(audio, rate = TARGET_RATE, minSec = 0.3) {
  const energy = frameEnergy(audio, rate, 30);
  const threshold = Math.max(0.01, speechThreshold(energy));
  return energy.filter((e) => e >= threshold).length * 0.03 >= minSec;
}

/**
 * Cleans raw speech-to-text output: removes tags like [BLANK_AUDIO], collapses
 * stutters and repeated phrases (a common small-model artefact), fixes spacing
 * and capitalisation.
 */
export function cleanTranscript(text) {
  let t = (text || "")
    .replace(
      /\[[^\]]*\]|\([^)]*(music|noise|silence|inaudible|blank)[^)]*\)|\*[^*]*\*/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  // "the the", "40% 40%", "I think I think" → one copy.
  for (let n = 6; n >= 1; n--) {
    const re = new RegExp(
      `\\b((?:\\S+\\s+){${n - 1}}\\S+)(?:[\\s,]+\\1\\b)+`,
      "gi",
    );
    t = t.replace(re, "$1");
  }
  // "... 40% and 40% of the time." repeated tail after a finished clause
  t = t.replace(
    /\b(\S+(?:\s+\S+){0,3})\s+and\s+\1(\s+of the time)?(?=[.!?]?$)/i,
    "$1",
  );
  // Canonical casing for acronyms and technologies ("sql" → "SQL").
  for (const term of TERMS)
    t = t.replace(
      new RegExp(`\\b${term.replace(/[.+#]/g, "\\$&")}\\b`, "gi"),
      term,
    );
  t = t
    .replace(/\s+([,.!?;:])/g, "$1")
    // Space after punctuation, but keep "Node.js" / "e.g." intact.
    .replace(/([,!?;:])(?=[A-Za-z])/g, "$1 ")
    .replace(/\.(?=[A-Z][a-z])/g, ". ")
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}
