import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPTIONS, planCopy, planMove, transferProblem } from "../src/university";

const y1 = { university: "GITAM VIZAG", degree: "CSE CORE", year: "1" };
const y2 = { ...y1, year: "2" };
const NODES = [
  { id: "dsa", kind: "subject", name: "DSA", parentId: null, exam: "both", icon: "code" },
  { id: "u1", kind: "folder", name: "Unit 1", parentId: "dsa", exam: "both" },
  { id: "u2", kind: "folder", name: "Unit 2", parentId: "dsa", exam: "supply" },
  { id: "f1", kind: "file", name: "Arrays", parentId: "u1", exam: "both", fileName: "Arrays.pdf", mime: "application/pdf", pageCount: 4, imageCount: 1, blobCount: 2, size: 900 },
  { id: "os", kind: "subject", name: "OS", parentId: null, exam: "both" },
].map((n) => ({ ...n, ...y1 }));

describe("transfer planning", () => {
  it("adds Year 5 to the default years", () => {
    expect(DEFAULT_OPTIONS.years).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("moves a subject with everything inside to another year", () => {
    const plan = planMove(NODES, "dsa", { scope: y2, parentId: null });
    expect(plan.map((p) => p.id)).toEqual(["dsa", "u1", "f1", "u2"]); // parents before children
    expect(plan[0].patch).toEqual({ university: "GITAM VIZAG", degree: "CSE CORE", year: "2", kind: "subject", parentId: null });
    expect(plan[2].patch).toEqual({ university: "GITAM VIZAG", degree: "CSE CORE", year: "2", kind: "file" });
  });
  it("turns a folder into a subject at the top level, and a subject into a folder inside another", () => {
    expect(planMove(NODES, "u1", { scope: y2, parentId: null })[0].patch.kind).toBe("subject");
    expect(planMove(NODES, "dsa", { scope: y1, parentId: "os" })[0].patch).toMatchObject({ kind: "folder", parentId: "os" });
  });
  it("copies with new ids, keeping the tree, icons and file details", () => {
    let n = 0;
    const plan = planCopy(NODES, "dsa", { scope: y2 }, () => `new${++n}`);
    expect(plan.map((p) => [p.id, p.data.parentId, p.data.name])).toEqual([
      ["new1", null, "DSA"],
      ["new2", "new1", "Unit 1"],
      ["new3", "new2", "Arrays"],
      ["new4", "new1", "Unit 2"],
    ]);
    expect(plan[0].data).toMatchObject({ year: "2", kind: "subject", icon: "code" });
    expect(plan[3].data.exam).toBe("supply");
    expect(plan[2].data).toMatchObject({ kind: "file", fileName: "Arrays.pdf", pageCount: 4, blobCount: 2 });
    expect(plan[2].from.id).toBe("f1");
    // A copy beside the original is named "(copy)".
    expect(planCopy(NODES, "u1", { scope: y1, parentId: "dsa" }, () => "x")[0].data.name).toBe("Unit 1 (copy)");
  });
  it("refuses impossible transfers", () => {
    const dsa = NODES[0];
    expect(transferProblem(NODES, dsa, { scope: y1, parentId: null })).toMatch(/already there/);
    expect(transferProblem(NODES, dsa, { scope: y1, parentId: "u1" })).toMatch(/inside itself/);
    expect(transferProblem(NODES, NODES[3], { scope: y2, parentId: null })).toMatch(/file has to go inside/);
    expect(transferProblem(NODES, dsa, { scope: y2, parentId: null })).toBeNull();
  });
});

// ---- The dialog ---------------------------------------------------------------------
const api = vi.hoisted(() => ({
  loadUniOptions: vi.fn(),
  loadNodes: vi.fn(),
  moveNode: vi.fn(),
  copyNode: vi.fn(),
  transferCourse: vi.fn(),
}));
vi.mock("../src/university", async (orig) => ({ ...(await orig()), ...api }));
vi.mock("../src/documents", () => ({ readDocument: vi.fn(), warmUpReader: vi.fn(), downloadBlob: vi.fn() }));
const { default: UniversityPage } = await import("../src/UniversityPage");

const Y2 = [{ id: "algo", kind: "subject", name: "Algorithms", parentId: null, exam: "both", ...y2 }];
beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.loadUniOptions.mockResolvedValue({ universities: ["GITAM VIZAG", "GITAM Hyderabad"], degrees: ["CSE CORE"], years: ["1", "2", "3", "4", "5"] });
  api.loadNodes.mockImplementation(async (scope) => (scope.year === "1" ? NODES : scope.year === "2" ? Y2 : []));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

const page = () => {
  const notify = vi.fn();
  render(<UniversityPage active admin notify={notify} onOpenFile={vi.fn()} />);
  return notify;
};

it("transfers (cuts) a subject to another year and it leaves this one", async () => {
  api.moveNode.mockImplementation(async (nodes, id) => nodes.filter((n) => ["dsa", "u1", "u2", "f1"].includes(n.id)).map((n) => ({ ...n, year: "2" })));
  const notify = page();
  await userEvent.click(await screen.findByRole("button", { name: "Transfer or copy DSA" }));
  const dialog = screen.getByRole("dialog", { name: "Transfer or copy “DSA”" });
  expect(within(dialog).getByRole("button", { name: "Transfer" })).toHaveAttribute("aria-pressed", "true");
  expect(within(dialog).getByRole("status")).toHaveTextContent(/already there/);
  await userEvent.selectOptions(within(dialog).getByLabelText("Year"), "2");
  expect(await within(dialog).findByRole("option", { name: "Algorithms" })).toBeInTheDocument();
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "Transfer “DSA” and everything in it (2 folders, 1 file) to GITAM VIZAG · CSE CORE · Year 2 › the top level.",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: /Transfer now/ }));
  expect(api.moveNode).toHaveBeenCalledWith(expect.any(Array), "dsa", { scope: expect.objectContaining({ year: "2" }), parentId: null });
  expect(notify).toHaveBeenCalledWith("Moved “DSA” to GITAM VIZAG · CSE CORE · Year 2 › the top level.");
  expect(screen.queryByRole("button", { name: "Open DSA" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open OS" })).toBeVisible();
});

it("copies a folder into a subject of another year, and keeps the original", async () => {
  api.copyNode.mockImplementation(async (nodes, id, target, onProgress) => {
    onProgress(1, 2);
    return [{ id: "c1", kind: "folder", name: "Unit 1", parentId: "algo", ...y2 }];
  });
  const notify = page();
  await userEvent.click(await screen.findByRole("button", { name: "Open DSA" }));
  await userEvent.click(screen.getByRole("button", { name: "Transfer or copy Unit 1" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
  await userEvent.selectOptions(within(dialog).getByLabelText("Year"), "2");
  await within(dialog).findByRole("option", { name: "Algorithms" });
  await userEvent.selectOptions(within(dialog).getByLabelText("Put it in"), "Algorithms");
  await userEvent.click(within(dialog).getByRole("button", { name: /Copy now/ }));
  expect(api.copyNode).toHaveBeenCalledWith(expect.any(Array), "u1", { scope: expect.objectContaining({ year: "2" }), parentId: "algo" }, expect.any(Function));
  expect(notify).toHaveBeenCalledWith("Copied “Unit 1” to GITAM VIZAG · CSE CORE · Year 2 › Algorithms.");
  expect(screen.getByRole("button", { name: "Open Unit 1" })).toBeVisible();
});

it("won't put a file at the top level or a folder inside itself", async () => {
  page();
  await userEvent.click(await screen.findByRole("button", { name: "Open DSA" }));
  await userEvent.click(screen.getByRole("button", { name: "Open Unit 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Transfer or copy Arrays" }));
  let dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByRole("option", { name: "Top level (as a subject)" })).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await userEvent.click(within(screen.getByRole("navigation", { name: "Folder path" })).getByRole("button", { name: "Subjects" }));
  await userEvent.click(screen.getByRole("button", { name: "Transfer or copy DSA" }));
  dialog = screen.getByRole("dialog");
  // DSA's own folders are not offered as places to put DSA.
  expect(within(dialog).queryByRole("option", { name: "DSA › Unit 1" })).toBeNull();
  expect(within(dialog).getByRole("option", { name: "OS" })).toBeInTheDocument();
});

it("moves, copies or swaps a whole year with another one", async () => {
  api.transferCourse.mockResolvedValue({ moved: 5, copied: 0, back: 1 });
  const notify = page();
  await screen.findByRole("button", { name: "Open DSA" });
  await userEvent.click(screen.getByRole("button", { name: /Swap or move this year/ }));
  const dialog = screen.getByRole("dialog", { name: "Transfer this course" });
  expect(within(dialog).getByLabelText("Year")).toHaveValue("2"); // the next year
  await userEvent.click(within(dialog).getByRole("button", { name: "Swap" }));
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "Swap all of GITAM VIZAG · CSE CORE · Year 1 (5 items) with GITAM VIZAG · CSE CORE · Year 2.",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: /Swap now/ }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Swap all material between Year 1 and/));
  expect(api.transferCourse).toHaveBeenCalledWith(
    expect.objectContaining({ year: "1" }),
    expect.objectContaining({ year: "2" }),
    "swap",
    expect.any(Function),
  );
  expect(notify).toHaveBeenCalledWith("Swapped: 5 items moved to GITAM VIZAG · CSE CORE · Year 2 and 1 item came back.");
  expect(api.loadNodes).toHaveBeenCalledTimes(3); // reloaded after
});

describe("cut, copy and paste", () => {
  it("cuts a subject in Year 1, pastes it in Year 2, and the clipboard follows across courses", async () => {
    api.moveNode.mockImplementation(async (nodes, id, target) =>
      nodes.filter((n) => ["dsa", "u1", "u2", "f1"].includes(n.id)).map((n) => ({ ...n, ...target.scope, year: "2", parentId: n.id === id ? null : n.parentId })),
    );
    const notify = page();
    await userEvent.click(await screen.findByRole("button", { name: "Cut DSA" }));
    expect(notify).toHaveBeenCalledWith("Cut “DSA”. Go to any course or folder and press Paste here.");
    const bar = screen.getByRole("region", { name: "Clipboard" });
    expect(bar).toHaveTextContent("Cut “DSA”");
    // Pasting where it already is isn't possible.
    expect(within(bar).getByRole("button", { name: /Paste here/ })).toBeDisabled();
    expect(bar).toHaveTextContent("It is already there.");
    // Go to Year 2: the clipboard is still there.
    await userEvent.selectOptions(screen.getByLabelText("Year"), "2");
    await screen.findByRole("button", { name: "Open Algorithms" });
    const bar2 = screen.getByRole("region", { name: "Clipboard" });
    expect(bar2).toHaveTextContent("from GITAM VIZAG · CSE CORE · Year 1 · paste into the top level of Year 2");
    await userEvent.click(within(bar2).getByRole("button", { name: /Paste here/ }));
    expect(api.moveNode).toHaveBeenCalledWith(NODES, "dsa", { scope: expect.objectContaining({ year: "2" }), parentId: null });
    expect(notify).toHaveBeenCalledWith("Moved “DSA” to GITAM VIZAG · CSE CORE · Year 2 › the top level.");
    expect(screen.getByRole("button", { name: "Open DSA" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Clipboard" })).toBeNull(); // a cut pastes once
  });

  it("copies a folder and pastes it into folders of another course, more than once", async () => {
    let n = 0;
    api.copyNode.mockImplementation(async (nodes, id, target) => [
      { id: `copy${++n}`, kind: "folder", name: "Unit 1", parentId: target.parentId, exam: "both", ...target.scope },
    ]);
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Open DSA" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy Unit 1" }));
    await userEvent.selectOptions(screen.getByLabelText("Year"), "2");
    await userEvent.click(await screen.findByRole("button", { name: "Open Algorithms" }));
    const bar = screen.getByRole("region", { name: "Clipboard" });
    expect(bar).toHaveTextContent("paste into “Algorithms”");
    await userEvent.click(within(bar).getByRole("button", { name: /Paste here/ }));
    expect(api.copyNode).toHaveBeenLastCalledWith(NODES, "u1", { scope: expect.objectContaining({ year: "2" }), parentId: "algo" }, expect.any(Function));
    expect(await screen.findByRole("button", { name: "Open Unit 1" })).toBeVisible();
    // A copy stays on the clipboard: paste again.
    await userEvent.click(within(screen.getByRole("region", { name: "Clipboard" })).getByRole("button", { name: /Paste here/ }));
    expect(api.copyNode).toHaveBeenCalledTimes(2);
    await userEvent.click(within(screen.getByRole("region", { name: "Clipboard" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Clipboard" })).toBeNull();
  });

  it("won't paste a file at the top level or a folder inside itself", async () => {
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Open DSA" }));
    await userEvent.click(screen.getByRole("button", { name: "Open Unit 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Cut Arrays" }));
    await userEvent.click(within(screen.getByRole("navigation", { name: "Folder path" })).getByRole("button", { name: "Subjects" }));
    let bar = screen.getByRole("region", { name: "Clipboard" });
    expect(bar).toHaveTextContent("Open a subject or folder to paste a file into it.");
    expect(within(bar).getByRole("button", { name: /Paste here/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cut DSA" }));
    await userEvent.click(screen.getByRole("button", { name: "Open DSA" }));
    await userEvent.click(screen.getByRole("button", { name: "Open Unit 1" }));
    bar = screen.getByRole("region", { name: "Clipboard" });
    expect(bar).toHaveTextContent("A folder can't be moved inside itself.");
    expect(within(bar).getByRole("button", { name: /Paste here/ })).toBeDisabled();
  });
});
