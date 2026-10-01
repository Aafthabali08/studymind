import { afterEach, expect, it, vi } from "vitest";
import { liteSpeech } from "../src/ai/speech";

afterEach(() => vi.unstubAllGlobals());
const as = (userAgent, extra = {}) =>
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints: 0, ...extra });

it("treats phones and tablets as lite devices (Whisper tiny)", () => {
  as("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148");
  expect(liteSpeech()).toBe(true);
  as("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36");
  expect(liteSpeech()).toBe(true);
  // iPadOS reports a Mac user agent, but has a touch screen.
  as("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", { maxTouchPoints: 5 });
  expect(liteSpeech()).toBe(true);
  as("Mozilla/5.0 (Windows NT 10.0) Chrome/140", { deviceMemory: 4 });
  expect(liteSpeech()).toBe(true);
});

it("keeps Whisper base on laptops", () => {
  as("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140", { deviceMemory: 8 });
  expect(liteSpeech()).toBe(false);
});
