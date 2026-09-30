import { it, expect } from "vitest";
import {
  resample,
  prepareAudio,
  trailingSilence,
  hasSpeech,
  cleanTranscript,
} from "../src/audio";

const tone = (sec, amp = 0.2, rate = 16000) =>
  Float32Array.from(
    { length: sec * rate },
    (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / rate),
  );
const quiet = (sec, rate = 16000) => new Float32Array(sec * rate).fill(0.001);
const join = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
};

it("resamples 48 kHz microphone audio to 16 kHz", () => {
  const out = resample(tone(1, 0.2, 48000), 48000);
  expect(out.length).toBe(16000);
  expect(Math.max(...out)).toBeGreaterThan(0.15);
});

it("trims silence, normalises quiet speech and ignores empty audio", () => {
  const prepared = prepareAudio(join(quiet(2), tone(1, 0.1), quiet(2)));
  expect(prepared.length / 16000).toBeGreaterThan(1);
  expect(prepared.length / 16000).toBeLessThan(1.6); // ~1 s speech + 0.2 s padding each side
  expect(Math.max(...prepared)).toBeGreaterThan(0.8); // gain raised for a quiet mic
  expect(prepareAudio(quiet(2))).toBeNull();
});

it("detects speech and trailing pauses for live segmenting", () => {
  const clip = join(tone(1), quiet(1));
  expect(hasSpeech(clip)).toBe(true);
  expect(hasSpeech(quiet(2))).toBe(false);
  expect(trailingSilence(clip)).toBeGreaterThan(0.9);
});

it("cleans speech-model output", () => {
  expect(
    cleanTranscript("[BLANK_AUDIO] i built the the dashboard ,and it worked"),
  ).toBe("I built the dashboard, and it worked.");
  expect(cleanTranscript("load time dropped by 40% and 40% of the time.")).toBe(
    "Load time dropped by 40%.",
  );
  expect(cleanTranscript("so yeah. i think i think it was fine")).toBe(
    "So yeah. I think it was fine.",
  );
  expect(cleanTranscript("   ")).toBe("");
});

it("fixes the casing of acronyms and technologies", () => {
  expect(
    cleanTranscript(
      "i profiled a slow api and wrote sql in node.js with redis",
    ),
  ).toBe("I profiled a slow API and wrote SQL in Node.js with Redis.");
});
