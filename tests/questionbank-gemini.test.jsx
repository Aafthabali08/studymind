import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { samples } from "./fixtures/samples";

const { geminiJSON } = vi.hoisted(() => ({ geminiJSON: vi.fn() }));
vi.mock("../src/ai/gemini", async (orig) => ({
  ...(await orig()),
  geminiAvailable: () => true,
  geminiJSON,
}));
const { generateQuestionBank } = await import("../src/ai/study");
const { default: DocumentWorkspace } = await import("../src/DocumentWorkspace");
const { updateSettings } = await import("../src/ai/engine");

const doc = { ...samples[0], images: [] };
const marksOf = (messages) => Number(messages[0].content.match(/predictable (\d)-mark/)[1]);
const reply = (marks, extra = {}) => ({
  questions: [
    {
      question: `Explain topic for ${marks} marks.`,
      type: marks === 2 ? "Definition" : "Not a real type",
      important: true,
      answer: `Answer worth ${marks} marks.`,
      trick: "Trick",
      page: 99,
      ...extra,
    },
  ],
});
beforeEach(() => {
  geminiJSON.mockReset();
});
afterEach(() => updateSettings({ engine: "fast" }));

it("writes all three marks groups, normalising pages", async () => {
  geminiJSON.mockImplementation(async (messages) => reply(marksOf(messages)));
  const bank = await generateQuestionBank(doc, []);
  expect(geminiJSON).toHaveBeenCalledTimes(3);
  expect(bank.failed).toEqual([]);
  expect(bank[2][0]).toMatchObject({ type: "Definition", important: true, page: doc.pages.length - 1 });
  expect(bank[5][0].answer).toBe("Answer worth 5 marks.");
});

it("keeps a group's earlier questions when Gemini fails for it", async () => {
  geminiJSON.mockImplementation(async (messages) => {
    if (marksOf(messages) === 5) throw new Error("Gemini rate limit reached.");
    return reply(marksOf(messages));
  });
  const previous = { 5: [{ question: "Earlier AI question", answer: "x", page: 0 }] };
  const bank = await generateQuestionBank(doc, [], { previous });
  expect(bank.failed).toEqual([5]);
  expect(bank[5]).toBe(previous[5]);
  expect(bank[8][0].answer).toBe("Answer worth 8 marks.");
});

it("reports the error when every group fails", async () => {
  geminiJSON.mockRejectedValue(new Error("Today's free Gemini limit for this API key is used up."));
  await expect(generateQuestionBank(doc, [])).rejects.toThrow(/free Gemini limit/);
});

it("regenerates from the Questions tab with Gemini, whatever engine answers questions", async () => {
  updateSettings({ engine: "fast" });
  geminiJSON.mockImplementation(async (messages) => {
    if (marksOf(messages) === 8) throw new Error("busy");
    return reply(marksOf(messages));
  });
  const onStudy = vi.fn();
  const notify = vi.fn();
  const view = (study) => (
    <DocumentWorkspace doc={doc} initialTab="Questions" study={study} onStudy={onStudy} onBack={() => {}} notify={notify} />
  );
  const app = render(view({}));
  await userEvent.click(await screen.findByRole("button", { name: /Generate full question bank with Gemini/ }));
  await vi.waitFor(() => expect(onStudy).toHaveBeenCalled());
  const { bank } = onStudy.mock.calls.at(-1)[0];
  expect(bank.source).toBe("ai");
  expect(bank.failed).toBeUndefined();
  expect(bank[2][0].question).toBe("Explain topic for 2 marks.");
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/couldn't write the 8-mark questions/));

  // Edited questions are only replaced after the user confirms.
  app.rerender(view({ bank: { ...bank, source: "edited" } }));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  geminiJSON.mockClear();
  await userEvent.click(screen.getByRole("button", { name: /Regenerate with Gemini/ }));
  expect(confirm).toHaveBeenCalled();
  expect(geminiJSON).not.toHaveBeenCalled();
});
