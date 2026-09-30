import React from "react";
import { render, screen, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, afterEach } from "vitest";
import Thinking from "../src/Thinking";
import DocumentWorkspace from "../src/DocumentWorkspace";
import { updateSettings } from "../src/ai/engine";
import { samples } from "./fixtures/samples";
vi.mock("../src/documents", () => ({ downloadText: vi.fn() }));
afterEach(() => {
  updateSettings({ engine: "fast" });
  vi.unstubAllGlobals();
});
it("counts seconds and adds a hint when the model is slow", () => {
  vi.useFakeTimers();
  render(<Thinking label="Writing…" detail="Reading" />);
  expect(screen.getByRole("status")).toHaveTextContent("Writing…");
  expect(screen.queryByText(/Still working/)).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(9000));
  expect(screen.getByText("9s")).toBeInTheDocument();
  expect(screen.getByText(/Still working/)).toBeInTheDocument();
});
it("shows the loading animation until the AI answer streams in", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Backprop [p. 3]."}}]}\n',
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await gate;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () =>
              chunks.length
                ? {
                    done: false,
                    value: new TextEncoder().encode(chunks.shift()),
                  }
                : { done: true },
          }),
        },
      };
    }),
  );
  updateSettings({
    engine: "remote",
    baseUrl: "http://llm.test/v1",
    model: "m",
  });
  render(
    <DocumentWorkspace
      doc={samples[0]}
      notes={{}}
      onNotes={() => {}}
      onBack={() => {}}
      notify={() => {}}
    />,
  );
  await userEvent.type(
    screen.getByLabelText("Search document"),
    "What is backpropagation?{Enter}",
  );
  const chat = document.querySelector(".chat-pair");
  expect(within(chat).getByText("AI is reading your document…")).toBeVisible();
  await act(async () => release());
  expect(await within(chat).findByText("Backprop [p. 3].")).toBeVisible();
  expect(
    within(chat).queryByText("AI is reading your document…"),
  ).not.toBeInTheDocument();
});
