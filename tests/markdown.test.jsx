import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";
import Markdown from "../src/Markdown";
import { buildNotes, buildQuestionBank, detectLanguage } from "../src/ai/study";

const md = [
  "# Title",
  "## Section",
  "### Sub-section",
  "A paragraph with `inline` code.",
  "```python\ndef add(a, b):\n    return a + b\n```",
  "![A diagram](image:p1-1)",
  "![missing](image:nope)",
].join("\n\n");

it("renders headings, highlighted code with a copy button, and PDF figures", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  const onPage = vi.fn();
  render(
    <Markdown
      images={[{ id: "p1-1", page: 0, dataUrl: "data:image/jpeg;base64,AAA" }]}
      onPage={onPage}
    >
      {md}
    </Markdown>,
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Title" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 3, name: "Sub-section" }),
  ).toBeVisible();
  expect(screen.getByText("Python")).toBeVisible();
  expect(document.querySelector(".hljs-keyword").textContent).toBe("def");
  await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
  expect(writeText).toHaveBeenCalledWith("def add(a, b):\n    return a + b");
  const img = screen.getByRole("img", { name: "A diagram" });
  expect(img).toHaveAttribute("src", "data:image/jpeg;base64,AAA");
  expect(
    screen.queryByRole("img", { name: "missing" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "p. 1" }));
  expect(onPage).toHaveBeenCalledWith(0);
});

it("builds notes with code blocks and figures from a document", () => {
  const doc = {
    name: "Programming",
    pages: [
      "Loops in Python\n\nA loop repeats a block of code while a condition holds.\n\nfor i in range(3):\n    print(i)",
      "Functions\n\nA function is a named block of code that can be reused. Functions take parameters and return values.",
    ],
  };
  const notes = buildNotes(doc, [{ id: "p2-1", page: 1, dataUrl: "x" }]);
  expect(notes).toMatch(/^# Programming/);
  expect(notes).toContain("## 1. Loops in Python");
  expect(notes).toContain("```python\nfor i in range(3):\n    print(i)\n```");
  expect(notes).toContain("![Figure from page 2](image:p2-1)");
  const bank = buildQuestionBank(doc);
  expect(bank[2].map((q) => q.question)).toContain("Define function.");
  expect(detectLanguage("SELECT * FROM users;")).toBe("sql");
  expect(detectLanguage('System.out.println("hi");')).toBe("java");
});

it("opens figures full screen and closes them with the cross or Escape", async () => {
  render(
    <Markdown
      images={[{ id: "p1-1", page: 0, dataUrl: "data:image/jpeg;base64,AAA" }]}
    >
      {"![A diagram](image:p1-1)"}
    </Markdown>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "View full screen: A diagram" }),
  );
  const viewer = screen.getByRole("dialog", { name: "A diagram" });
  expect(viewer).toBeVisible();
  expect(screen.getByRole("button", { name: "Close figure" })).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Close figure" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "View full screen: A diagram" }),
  );
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
