import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";
import InterviewStudio from "../src/InterviewStudio";
import { readFileSync } from "node:fs";
import { downloadText } from "../src/documents";
import { readResume } from "../src/resume";
vi.mock("../src/documents", () => ({ downloadText: vi.fn() }));
vi.mock("../src/resume", () => ({ readResume: vi.fn() }));
const resumeText = readFileSync("tests/fixtures/resume.txt", "utf8");
const click = async (name) =>
  userEvent.click(screen.getByRole("button", { name, exact: true }));
async function setup() {
  const notify = vi.fn();
  const app = render(<InterviewStudio active notify={notify} />);
  await click("Start practice");
  return { notify, app };
}
it("preserves answers, invalidates stale feedback, completes, and exports all questions", async () => {
  await setup();
  expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "First answer",
  );
  await click("Review answer");
  expect(screen.getByText("A stronger answer structure")).toBeVisible();
  await userEvent.type(screen.getByLabelText("Your transcript"), " improved");
  expect(
    screen.queryByText("A stronger answer structure"),
  ).not.toBeInTheDocument();
  await click("Next question");
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "Second answer",
  );
  await click("Previous question");
  expect(screen.getByLabelText("Your transcript")).toHaveValue(
    "First answer improved",
  );
  await click("Next question");
  expect(screen.getByLabelText("Your transcript")).toHaveValue("Second answer");
  await click("Next question");
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "Third answer",
  );
  await click("Finish practice");
  expect(screen.getByText("SESSION COMPLETE")).toBeVisible();
  await click("Download full transcript");
  expect(downloadText).toHaveBeenCalledWith(
    expect.stringMatching(
      /First answer improved[\s\S]*Second answer[\s\S]*Third answer/,
    ),
    "interview-transcript.txt",
  );
  await click("Review my answers");
  expect(screen.getByLabelText("Your transcript")).toHaveValue(
    "First answer improved",
  );
});
it("handles unsupported voice input", async () => {
  const { notify } = await setup();
  await click("Answer with voice");
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("not available"));
  expect(screen.getByLabelText("Your transcript")).toBeEnabled();
});
it("catches recognition startup exceptions", async () => {
  window.SpeechRecognition = class {
    start() {
      throw Error("device");
    }
    stop() {}
  };
  const { notify } = await setup();
  await click("Answer with voice");
  expect(notify).toHaveBeenCalledWith(
    expect.stringContaining("Could not start"),
  );
  expect(screen.getByLabelText("Your transcript")).toBeEnabled();
});
it("appends recognized speech and ignores late events after navigation", async () => {
  let instance;
  window.SpeechRecognition = class {
    constructor() {
      instance = this;
    }
    start() {}
    stop() {}
  };
  const { app, notify } = await setup();
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "Existing words.",
  );
  await click("Answer with voice");
  expect(screen.getByLabelText("Your transcript")).toBeDisabled();
  act(() =>
    instance.onresult({ results: [[{ transcript: "New spoken words." }]] }),
  );
  expect(screen.getByLabelText("Your transcript")).toHaveValue(
    "Existing words. New spoken words.",
  );
  await click("Stop recording");
  await click("Next question");
  act(() => instance.onresult({ results: [[{ transcript: "Late result" }]] }));
  expect(screen.getByLabelText("Your transcript")).toHaveValue("");
  app.rerender(<InterviewStudio active={false} notify={notify} />);
  expect(screen.queryByLabelText("Your transcript")).not.toBeVisible();
});
it("reports permission denial and preserves typed answer", async () => {
  let instance;
  window.SpeechRecognition = class {
    constructor() {
      instance = this;
    }
    start() {}
    stop() {}
  };
  const { notify } = await setup();
  await userEvent.type(screen.getByLabelText("Your transcript"), "Keep this");
  await click("Answer with voice");
  act(() => instance.onerror({ error: "not-allowed" }));
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("denied"));
  expect(screen.getByLabelText("Your transcript")).toHaveValue("Keep this");
  expect(screen.getByLabelText("Your transcript")).toBeEnabled();
});
it("uses experience and resets a changed role", async () => {
  await setup();
  await userEvent.selectOptions(
    screen.getByLabelText("Experience"),
    "5+ years",
  );
  expect(screen.getByRole("button", { name: "Start practice" })).toBeEnabled();
  await click("Start practice");
  await userEvent.type(screen.getByLabelText("Your transcript"), "Answer");
  await userEvent.clear(
    screen.getByLabelText("What role are you applying for?"),
  );
  expect(screen.getByRole("button", { name: "Start practice" })).toBeDisabled();
  expect(screen.queryByLabelText("Your transcript")).not.toBeInTheDocument();
});

it("reads a resume, asks questions about it, and can remove it", async () => {
  vi.mocked(readResume).mockResolvedValue(resumeText);
  const notify = vi.fn();
  render(<InterviewStudio active notify={notify} />);
  await userEvent.upload(
    screen.getByLabelText("Choose resume file"),
    new File(["resume"], "priya.pdf", { type: "application/pdf" }),
  );
  expect(await screen.findByText("priya.pdf")).toBeVisible();
  expect(screen.getByText("React")).toBeVisible();
  expect(notify).toHaveBeenCalledWith(
    expect.stringMatching(/Resume read: .*2 projects, 1 role found/),
  );
  expect(screen.getByLabelText("Practice format")).toHaveValue("resume");
  expect(screen.getByLabelText("Number of questions")).toHaveValue(5);
  await click("Start practice");
  expect(screen.getByText("QUESTION 1 OF 5")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: /Walk me through your resume/ }),
  ).toBeVisible();
  await userEvent.type(screen.getByLabelText("Your transcript"), "My answer");
  await click("Next question");
  expect(screen.getByRole("heading", { name: /StudyBuddy/ })).toBeVisible();
  await click("Remove resume");
  expect(screen.queryByText("priya.pdf")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Practice format")).toHaveValue("behavioral");
  expect(screen.queryByLabelText("Your transcript")).not.toBeInTheDocument();
});
it("reports unreadable resumes", async () => {
  vi.mocked(readResume).mockRejectedValue(
    Error("Choose a PDF, DOCX or TXT resume."),
  );
  const notify = vi.fn();
  render(<InterviewStudio active notify={notify} />);
  await userEvent.upload(
    screen.getByLabelText("Choose resume file"),
    new File(["x"], "resume.pdf"),
  );
  await vi.waitFor(() =>
    expect(notify).toHaveBeenCalledWith("Choose a PDF, DOCX or TXT resume."),
  );
  expect(screen.getByRole("button", { name: /Add your resume/ })).toBeEnabled();
});
it("shows an instant STAR checklist on review", async () => {
  await setup();
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "We basically um did it, like, we shipped it.",
  );
  await click("Review answer");
  expect(screen.getByText(/Instant rating/)).toBeVisible();
  expect(screen.getByText(/Your answer is short/)).toBeVisible();
  expect(screen.getByText(/filler words detected/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Get AI coaching/ }),
  ).not.toBeInTheDocument();
});

it("asks deeper follow-ups when the user chooses Yes, rates answers and builds a report", async () => {
  await setup();
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "During my internship I built a dashboard with React and Redis caching. I reduced load time by 40% for 1,200 analysts.",
  );
  const pill = screen.getByRole("switch", { name: "Follow-up questions" });
  expect(pill).toHaveAttribute("aria-checked", "false");
  await userEvent.click(pill);
  expect(pill).toHaveAttribute("aria-checked", "true");
  await click("Next question");
  expect(screen.getByText(/Follow-up on “React”/)).toBeVisible();
  expect(screen.getByLabelText(/Deep dive 1 of [5-7]/)).toBeVisible();
  expect(screen.getByText(/QUESTION 1 OF 3 · FOLLOW-UP 1 OF [5-7]/)).toBeVisible();
  expect(
    screen.getByRole("heading", { name: /deeper on React/ }),
  ).toBeVisible();
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "um basically we did it",
  );
  await click("Review answer");
  expect(screen.getByText("Needs work")).toBeVisible();
  expect(screen.getByLabelText("Score breakdown")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "A stronger answer (STAR)" }),
  ).toBeVisible();
  // Saying No ends the deep dive: back to the main questions.
  await userEvent.click(
    screen.getByRole("switch", { name: "Follow-up questions" }),
  );
  await click("Next question");
  expect(screen.getByText(/QUESTION 2 OF 3$/)).toBeVisible();
  expect(screen.getByText(/Deep dive on “React”/)).toBeVisible();
  expect(
    screen.getByRole("switch", { name: "Follow-up questions" }),
  ).toHaveAttribute("aria-checked", "false");
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "A second answer about teamwork.",
  );
  await click("Next question");
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "A third answer about teamwork.",
  );
  await click("Finish practice");
  expect(screen.getByText("SESSION COMPLETE")).toBeVisible();
  expect(screen.getByLabelText(/Overall score \d+ out of 100/)).toBeVisible();
  expect(document.querySelectorAll(".report-item")).toHaveLength(4);
  expect(
    document.querySelector(".report-item.band-blue, .report-item.band-yellow"),
  ).not.toBeNull();
  expect(document.querySelector(".report-item.band-red")).not.toBeNull();
  expect(screen.getByText(/Answer with your voice next time/)).toBeVisible();
  await click("Download report");
  expect(downloadText).toHaveBeenCalledWith(
    expect.stringMatching(
      /# Interview report[\s\S]*Overall: \d+\/100[\s\S]*follow-up on React/,
    ),
    "interview-report.md",
  );
});
it("runs a full 5–7 question deep dive, then resumes the main questions automatically", async () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.99); // 7 follow-ups
  await setup();
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "In my final year project I built a booking app with Firebase for 300 students.",
  );
  await userEvent.click(
    screen.getByRole("switch", { name: "Follow-up questions" }),
  );
  const asked = new Set();
  for (let depth = 1; depth <= 7; depth++) {
    await click("Next question");
    expect(screen.getByText(`QUESTION 1 OF 3 · FOLLOW-UP ${depth} OF 7`)).toBeVisible();
    const q = document.querySelector(".interview-question h2").textContent;
    expect(q).toMatch(/Firebase/);
    expect(asked.has(q)).toBe(false); // every level asks something new
    asked.add(q);
    await userEvent.type(
      screen.getByLabelText("Your transcript"),
      `Answer ${depth}: I chose Firebase because our team of 3 had a deadline, and I measured 2 seconds load time.`,
    );
  }
  expect(screen.getByText("Deep dive complete")).toBeVisible();
  expect(
    screen.getByRole("switch", { name: "Follow-up questions" }),
  ).toBeDisabled();
  await click("Next question");
  expect(screen.getByText("QUESTION 2 OF 3")).toBeVisible();
  expect(screen.getByText(/Deep dive on “Firebase”/)).toBeVisible();
  // Yes again: a new deep dive on this answer.
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "I led a hackathon team and we used Docker to ship in 24 hours.",
  );
  await userEvent.click(
    screen.getByRole("switch", { name: "Follow-up questions" }),
  );
  await click("Next question");
  expect(screen.getByText("QUESTION 2 OF 3 · FOLLOW-UP 1 OF 7")).toBeVisible();
  expect(screen.getByText(/Follow-up on “Docker”/)).toBeVisible();
  random.mockRestore();
});
it("lets the user choose how many questions to be asked", async () => {
  render(<InterviewStudio active notify={vi.fn()} />);
  const input = screen.getByLabelText("Number of questions");
  await userEvent.clear(input);
  await userEvent.type(input, "7");
  await click("Start practice");
  expect(screen.getByText("QUESTION 1 OF 7")).toBeVisible();
  await userEvent.clear(screen.getByLabelText("Number of questions"));
  await userEvent.type(screen.getByLabelText("Number of questions"), "40");
  screen.getByLabelText("Number of questions").blur();
  await click("Start practice");
  expect(screen.getByText("QUESTION 1 OF 15")).toBeVisible();
});
it("can turn off follow-ups", async () => {
  render(<InterviewStudio active notify={vi.fn()} />);
  await userEvent.click(screen.getByLabelText(/Deeper follow-up questions/));
  await click("Start practice");
  await userEvent.type(
    screen.getByLabelText("Your transcript"),
    "During my internship I built a dashboard with React and Redis caching for the analysts team.",
  );
  expect(
    screen.queryByRole("switch", { name: "Follow-up questions" }),
  ).not.toBeInTheDocument();
  await click("Next question");
  expect(screen.queryByText(/Follow-up on/)).not.toBeInTheDocument();
});
