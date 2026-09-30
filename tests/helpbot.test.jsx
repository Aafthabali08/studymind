import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, afterEach } from "vitest";
import HelpBot from "../src/HelpBot";
import { updateSettings } from "../src/ai/engine";
import * as cloud from "../src/cloud";
import { samples } from "./fixtures/samples";
vi.mock("../src/cloud", () => ({
  loadChat: vi.fn(async () => null),
  saveChat: vi.fn(async () => {}),
}));
afterEach(() => {
  updateSettings({ engine: "fast" });
  vi.unstubAllGlobals();
});
const doc = { ...samples[0], images: [] };

it("answers from the open page without a model and saves the chat", async () => {
  render(<HelpBot uid="u1" context={{ view: "Library", doc, page: 2 }} />);
  await userEvent.click(screen.getByRole("button", { name: "Ask Gemini" }));
  const bot = screen.getByRole("dialog", { name: "Ask Gemini" });
  expect(within(bot).getByRole("button", { name: "Page 3" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    within(bot).getByText(/page 3 of Artificial Intelligence/),
  ).toBeVisible();
  await userEvent.type(
    within(bot).getByLabelText("Ask Gemini a question"),
    "What is backpropagation?{Enter}",
  );
  expect(
    await within(bot).findByText(/Backpropagation computes gradients/),
  ).toBeVisible();
  expect(
    within(bot).getByText(/Exact extract from Artificial Intelligence, p\. 3/),
  ).toBeVisible();
  expect(cloud.saveChat).toHaveBeenCalledWith(
    "u1",
    "doc-ai",
    expect.any(Array),
  );
});

it("sends the visible screen as context to the model", async () => {
  document.body.innerHTML =
    "<main>Study plan · Day 1 Read Neural Networks</main>";
  const fetchMock = vi.fn(async () => ({
    ok: true,
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () =>
            sent
              ? { done: true }
              : ((sent = true),
                {
                  done: false,
                  value: new TextEncoder().encode(
                    'data: {"choices":[{"delta":{"content":"## Your plan\\nStart with day 1."}}]}\n',
                  ),
                }),
        };
      },
    },
  }));
  vi.stubGlobal("fetch", fetchMock);
  updateSettings({
    engine: "remote",
    baseUrl: "http://llm.test/v1",
    model: "m",
  });
  render(<HelpBot uid="u1" context={{ view: "Study plan" }} />, {
    container: document.body.appendChild(document.createElement("div")),
  });
  await userEvent.click(screen.getByRole("button", { name: "Ask Gemini" }));
  await userEvent.click(
    screen.getByRole("button", { name: "What can I do on this screen?" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Your plan" }),
  ).toBeVisible();
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  const user = body.messages.at(-1).content;
  expect(user).toContain("Current StudyMind screen: Study plan");
  expect(user).toContain("Day 1 Read Neural Networks");
  expect(user).toContain("Question: What can I do on this screen?");
  await waitFor(() =>
    expect(cloud.saveChat).toHaveBeenCalledWith("u1", "app", expect.any(Array)),
  );
});
