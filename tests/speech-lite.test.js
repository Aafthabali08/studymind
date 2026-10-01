import { afterEach, expect, it, vi } from "vitest";
import { liteSpeech, speechKinds, transcribe } from "../src/ai/speech";

afterEach(() => vi.unstubAllGlobals());
const as = (userAgent, extra = {}) =>
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints: 0, ...extra });

it("skips Whisper on phones, where it can crash the tab", async () => {
  as("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
  expect(liteSpeech()).toBe(true);
  expect(speechKinds()).toEqual(["live", "embed"]);
  expect(await transcribe(new Float32Array(16000), { quality: "final" })).toBeNull();
  as("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36");
  expect(liteSpeech()).toBe(true);
  as("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", { maxTouchPoints: 5 });
  expect(liteSpeech()).toBe(true);
});

it("loads all three models on laptops", () => {
  as("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140", { deviceMemory: 8 });
  expect(liteSpeech()).toBe(false);
  expect(speechKinds()).toEqual(["live", "embed", "final"]);
});
