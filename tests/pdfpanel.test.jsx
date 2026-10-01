import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import QuestionPdfPanel from "../src/QuestionPdfPanel";
import { downloadQuestionPdf } from "../src/questionPdf";
vi.mock("../src/questionPdf", async (orig) => ({
  ...(await orig()),
  downloadQuestionPdf: vi.fn(async ({ category, importantOnly }) => ({
    fileName: `x-${category}-${importantOnly}.pdf`,
    count: 1,
  })),
}));
const bank = {
  2: [
    { question: "Define AI.", answer: "A.", type: "Definition", page: 0, important: true },
    { question: "Define ML.", answer: "B.", type: "Definition", page: 0 },
  ],
  5: [{ question: "Explain search.", answer: "C.", type: "Explain", page: 1 }],
  8: [],
};
const doc = { id: "d", name: "Notes.pdf", pages: ["a", "b"], images: [] };

it("downloads important or all questions for the chosen category, named after the file", async () => {
  const notify = vi.fn();
  render(<QuestionPdfPanel doc={doc} bank={bank} notify={notify} marks={2} />);
  expect(screen.getByLabelText("Category")).toHaveValue("m2");
  expect(screen.getByText(/2 questions with answers and figures · Notes - 2-mark questions - All predicted questions\.pdf/)).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText("Questions"), "important");
  expect(screen.getByText(/1 question with answers and figures · Notes - 2-mark questions - Important questions\.pdf/)).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText("Category"), "m5");
  expect(screen.getByText("No important questions in this category yet.")).toBeVisible();
  expect(screen.getByRole("button", { name: /Download PDF/ })).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText("Questions"), "all");
  await userEvent.click(screen.getByRole("button", { name: /Download PDF/ }));
  expect(downloadQuestionPdf).toHaveBeenCalledWith(
    expect.objectContaining({ category: "m5", importantOnly: false, doc, bank }),
  );
  expect(notify).toHaveBeenCalledWith("Downloaded x-m5-false.pdf (1 question).");
});
