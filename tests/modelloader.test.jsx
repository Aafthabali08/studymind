import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";

let speech = {
  live: "ready",
  final: "loading",
  embed: "loading",
  progress: { live: 100, final: 40, embed: 60 },
  error: "",
};
vi.mock("../src/ai/speech", async (orig) => ({
  ...(await orig()),
  speechSupported: () => true,
  preloadSpeech: vi.fn(),
  useSpeech: () => speech,
}));
vi.mock("../src/documents", () => ({ downloadText: vi.fn() }));
const { default: InterviewStudio } = await import("../src/InterviewStudio");

it("shows a loading screen until all three open models are ready", () => {
  const app = render(<InterviewStudio active notify={vi.fn()} />);
  const loader = screen.getByRole("status", { name: "Loading Interview Studio" });
  expect(loader).toHaveTextContent("Loading your interview coach…");
  expect(loader).toHaveTextContent("Moonshine");
  expect(loader).toHaveTextContent("Ready");
  expect(loader).toHaveTextContent("40%");
  expect(screen.queryByRole("button", { name: /Start practice/ })).not.toBeInTheDocument();
  speech = { ...speech, final: "ready", embed: "ready", progress: { live: 100, final: 100, embed: 100 } };
  app.rerender(<InterviewStudio active notify={vi.fn()} />);
  expect(screen.queryByRole("status", { name: "Loading Interview Studio" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Start practice/ })).toBeInTheDocument();
});

it("lets the user continue by typing when a model cannot load", async () => {
  speech = { live: "ready", final: "error", embed: "ready", progress: { live: 100, embed: 100 }, error: "x" };
  render(<InterviewStudio active notify={vi.fn()} />);
  expect(screen.getByText("Voice models could not load.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Continue with typing" }));
  expect(screen.getByRole("button", { name: /Start practice/ })).toBeInTheDocument();
});
