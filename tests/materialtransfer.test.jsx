import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const y1 = { university: "GITAM VIZAG", degree: "CSE CORE", year: "1" };
const y2 = { ...y1, year: "2" };
const Y1 = [
  { id: "dsa", kind: "subject", name: "DSA", parentId: null, exam: "both" },
  { id: "u1", kind: "folder", name: "Unit 1", parentId: "dsa", exam: "both" },
  { id: "u2", kind: "folder", name: "Unit 2", parentId: "dsa", exam: "both" },
  { id: "arr", kind: "file", name: "Arrays", parentId: "u1", exam: "both", pageCount: 4 },
  { id: "os", kind: "subject", name: "OS", parentId: null, exam: "both" },
].map((n) => ({ ...n, ...y1 }));
const Y2 = [
  { id: "algo", kind: "subject", name: "Algorithms", parentId: null, exam: "both" },
  { id: "algoU1", kind: "folder", name: "Unit 1", parentId: "algo", exam: "both" },
].map((n) => ({ ...n, ...y2 }));

const api = vi.hoisted(() => ({ loadUniOptions: vi.fn(), loadNodes: vi.fn(), moveNode: vi.fn(), copyNode: vi.fn() }));
vi.mock("../src/university", async (orig) => ({ ...(await orig()), ...api }));
vi.mock("../src/documents", () => ({ readDocument: vi.fn(), warmUpReader: vi.fn(), downloadBlob: vi.fn() }));
const { default: MaterialTransfer } = await import("../src/MaterialTransfer");
const { default: UniversityPage } = await import("../src/UniversityPage");

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.loadUniOptions.mockResolvedValue({ universities: ["GITAM VIZAG", "GITAM Hyderabad"], degrees: ["CSE CORE", "CSE AI & ML"], years: ["1", "2", "3", "4", "5"] });
  api.loadNodes.mockImplementation(async (s) => (s.year === "1" && s.degree === "CSE CORE" ? Y1 : s.year === "2" ? Y2 : []));
  api.moveNode.mockResolvedValue([]);
  api.copyNode.mockResolvedValue([]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

const from = () => screen.getByRole("region", { name: "From" });
const to = () => screen.getByRole("region", { name: "To" });

it("picks units and files from one course and transfers them into a subject of another", async () => {
  const notify = vi.fn();
  render(<MaterialTransfer notify={notify} initialFrom={y1} />);
  // From Year 1 → To defaults to the next year.
  expect(within(from()).getByLabelText("Year")).toHaveValue("1");
  expect(within(to()).getByLabelText("Year")).toHaveValue("2");
  await within(from()).findByRole("checkbox", { name: "Select DSA" });
  await userEvent.click(within(from()).getByRole("button", { name: "Open DSA" }));
  await userEvent.click(within(from()).getByRole("checkbox", { name: "Select Unit 1" }));
  await userEvent.click(within(from()).getByRole("checkbox", { name: "Select Unit 2" }));
  // Unit 1 brings its file with it.
  await userEvent.click(within(from()).getByRole("button", { name: "Open Unit 1" }));
  expect(within(from()).getByRole("checkbox", { name: "Select Arrays" })).toBeChecked();
  expect(within(from()).getByRole("checkbox", { name: "Select Arrays" })).toBeDisabled();
  // To: Year 2 › Algorithms.
  await userEvent.click(await within(to()).findByRole("radio", { name: "Put them in Algorithms" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Transfer 2 items (2 folders, 1 file) from GITAM VIZAG · CSE CORE · Year 1 to GITAM VIZAG · CSE CORE · Year 2 › Algorithms.",
  );
  await userEvent.click(screen.getByRole("button", { name: /Transfer here/ }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/They will leave GITAM VIZAG · CSE CORE · Year 1/));
  expect(api.moveNode.mock.calls.map((c) => [c[1], c[2].parentId, c[2].scope.year])).toEqual([
    ["u1", "algo", "2"],
    ["u2", "algo", "2"],
  ]);
  expect(notify).toHaveBeenCalledWith("Transferred 2 items to GITAM VIZAG · CSE CORE · Year 2 › Algorithms.");
});

it("copies everything in a year to the top level of another university and degree", async () => {
  const notify = vi.fn();
  render(<MaterialTransfer notify={notify} initialFrom={y1} />);
  await userEvent.click(await within(from()).findByRole("checkbox", { name: /Select everything in Year 1/ }));
  await userEvent.click(screen.getByRole("button", { name: /Copy/ }));
  await userEvent.selectOptions(within(to()).getByLabelText("University"), "GITAM Hyderabad");
  await userEvent.selectOptions(within(to()).getByLabelText("Degree"), "CSE AI & ML");
  await userEvent.selectOptions(within(to()).getByLabelText("Year"), "1");
  await within(to()).findByRole("radio", { name: /Top level/ });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Copy 2 items (2 subjects, 2 folders, 1 file) from GITAM VIZAG · CSE CORE · Year 1 to GITAM Hyderabad · CSE AI & ML · Year 1 › the top level.",
  );
  await userEvent.click(screen.getByRole("button", { name: /Paste copies here/ }));
  expect(window.confirm).not.toHaveBeenCalled(); // copying doesn't remove anything
  expect(api.copyNode.mock.calls.map((c) => [c[1], c[2].parentId, c[2].scope.university])).toEqual([
    ["dsa", null, "GITAM Hyderabad"],
    ["os", null, "GITAM Hyderabad"],
  ]);
  expect(notify).toHaveBeenCalledWith("Copied 2 items to GITAM Hyderabad · CSE AI & ML · Year 1 › the top level.");
});

it("explains what's missing: nothing picked, or a file with no folder to go in", async () => {
  render(<MaterialTransfer notify={vi.fn()} initialFrom={y1} />);
  await within(from()).findByRole("checkbox", { name: "Select DSA" });
  expect(screen.getByRole("status")).toHaveTextContent("Pick what to transfer on the left.");
  expect(screen.getByRole("button", { name: /Transfer here/ })).toBeDisabled();
  await userEvent.click(within(from()).getByRole("button", { name: "Open DSA" }));
  await userEvent.click(within(from()).getByRole("button", { name: "Open Unit 1" }));
  await userEvent.click(within(from()).getByRole("checkbox", { name: "Select Arrays" }));
  await within(to()).findByRole("radio", { name: /Top level/ });
  expect(screen.getByRole("status")).toHaveTextContent("Files need a subject or folder: pick one on the right.");
  expect(screen.getByRole("button", { name: /Transfer here/ })).toBeDisabled();
});

it("is only offered to the admin on the University page", async () => {
  const { unmount } = render(<UniversityPage active admin={false} notify={vi.fn()} onOpenFile={vi.fn()} />);
  await screen.findByRole("button", { name: "Open DSA" });
  expect(screen.queryByRole("button", { name: /Transfer materials/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cut DSA" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy DSA" })).toBeNull();
  unmount();
  render(<UniversityPage active admin notify={vi.fn()} onOpenFile={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: /Transfer materials/ }));
  const panel = screen.getByRole("region", { name: "Transfer materials" });
  expect(within(panel).getByRole("region", { name: "From" })).toBeVisible();
});
