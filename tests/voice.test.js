import { it, expect } from "vitest";
import { VoiceMeter } from "../src/voice";

const speech = (sec) =>
  Array.from({ length: sec * 10 }, (_, i) => 0.08 + (i % 3) * 0.01);
const silence = (sec) => Array.from({ length: sec * 10 }, () => 0.003);

it("measures speaking time, long pauses and steadiness from loudness samples", () => {
  const m = new VoiceMeter();
  m.samples = [
    ...silence(1),
    ...speech(10),
    ...silence(2),
    ...speech(8),
    ...silence(0.5 * 2),
    ...speech(5),
  ];
  const stats = m.stop();
  expect(stats.durationSec).toBeCloseTo(27, 0);
  expect(stats.speakingSec).toBeCloseTo(23, 0);
  expect(stats.pauses).toBe(1); // the 2 s gap; the 1 s gap is a normal breath
  expect(stats.longestPauseSec).toBe(2);
  expect(stats.steadiness).toBeGreaterThan(0.8);
});

it("releases the microphone if stopped before permission is granted", async () => {
  let resolve;
  const track = { stop: () => (track.stopped = true) };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => new Promise((r) => (resolve = r)) },
  });
  const m = new VoiceMeter();
  const started = m.start(() => {});
  expect(m.stop()).toBeNull();
  resolve({ getTracks: () => [track] });
  await started;
  expect(track.stopped).toBe(true);
});

it("still measures someone who talks without stopping", () => {
  const m = new VoiceMeter();
  m.samples = speech(20);
  const stats = m.stop();
  expect(stats.speakingSec).toBeCloseTo(20, 0);
  expect(stats.pauses).toBe(0);
});
