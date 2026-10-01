import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const preloadSpeech = vi.fn();
vi.mock("../src/ai/speech", async (orig) => ({
  ...(await orig()),
  speechSupported: () => true,
  preloadSpeech,
  useSpeech: () => ({ live: "idle", final: "idle", embed: "idle", progress: {}, error: "" }),
}));
vi.mock("../src/documents", () => ({ downloadText: vi.fn() }));
const { default: InterviewStudio } = await import("../src/InterviewStudio");

let instances, getUserMedia, ua;
beforeEach(() => {
  instances = [];
  ua = vi
    .spyOn(navigator, "userAgent", "get")
    .mockReturnValue("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36");
  window.webkitSpeechRecognition = class {
    constructor() {
      instances.push(this);
    }
    start() {}
    stop() {}
  };
  getUserMedia = vi.fn(() => Promise.reject(Error("should not be called")));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});
afterEach(() => {
  ua.mockRestore();
  delete window.webkitSpeechRecognition;
  delete navigator.mediaDevices;
  vi.useRealTimers();
});
const results = (...texts) => ({ results: texts.map((t) => [{ transcript: t }]) });

it("on phones, skips the on-device models and records with the browser's speech service", async () => {
  render(<InterviewStudio active notify={vi.fn()} />);
  // No model download or loading screen on a phone.
  expect(screen.queryByRole("status", { name: "Loading Interview Studio" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Start practice/ }));
  await userEvent.click(screen.getByRole("button", { name: "Answer with voice" }));
  expect(instances).toHaveLength(1);
  // The microphone is not opened a second time (it would stop recognition).
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(screen.getByText(/On phones your browser's own speech service/)).toBeVisible();

  act(() => instances[0].onresult(results("I built", "I built a dashboard")));
  expect(screen.getByLabelText("Your transcript")).toHaveValue("I built a dashboard");

  // Phones end recognition every few seconds: it carries on, keeping the text.
  vi.useFakeTimers();
  act(() => instances[0].onend());
  act(() => vi.advanceTimersByTime(1300));
  act(() => instances[1].onend());
  act(() => vi.advanceTimersByTime(300));
  vi.useRealTimers();
  expect(instances.length).toBeGreaterThanOrEqual(3);
  act(() => instances.at(-1).onresult(results("with React and Redis")));
  expect(screen.getByLabelText("Your transcript")).toHaveValue(
    "I built a dashboard with React and Redis",
  );
  expect(screen.getByRole("button", { name: "Stop recording" })).toBeVisible();

  // A dropped network blip does not stop the recording.
  act(() => instances.at(-1).onerror({ error: "network" }));
  expect(screen.getByRole("button", { name: "Stop recording" })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Stop recording" }));
  expect(screen.getByLabelText("Your transcript")).toBeEnabled();
  expect(screen.getByLabelText("Your transcript")).toHaveValue(
    "I built a dashboard with React and Redis",
  );
});

it("stops cleanly and keeps the transcript if the phone's speech service keeps ending", async () => {
  const notify = vi.fn();
  render(<InterviewStudio active notify={notify} />);
  await userEvent.click(screen.getByRole("button", { name: /Start practice/ }));
  await userEvent.type(screen.getByLabelText("Your transcript"), "Typed words");
  await userEvent.click(screen.getByRole("button", { name: "Answer with voice" }));
  vi.useFakeTimers();
  for (let k = 0; k < 6 && instances.length; k++) {
    act(() => instances.at(-1).onend());
    act(() => vi.advanceTimersByTime(300));
  }
  vi.useRealTimers();
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("stopped listening"));
  expect(screen.getByLabelText("Your transcript")).toBeEnabled();
  expect(screen.getByLabelText("Your transcript")).toHaveValue("Typed words");
});
