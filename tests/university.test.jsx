import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  childrenOf,
  descendants,
  editOptions,
  examFits,
  pathOf,
  searchNodes,
  visible,
} from "../src/university";

const scope = { university: "GITAM VIZAG", degree: "CSE CORE", year: "2" };
const NODES = [
  { id: "s1", kind: "subject", name: "DBMS", parentId: null, exam: "both" },
  { id: "s2", kind: "subject", name: "Operating Systems", parentId: null, exam: "both" },
  { id: "f10", kind: "folder", name: "Unit 10", parentId: "s1", exam: "both" },
  { id: "f2", kind: "folder", name: "Unit 2", parentId: "s1", exam: "both" },
  { id: "fi", kind: "folder", name: "Important questions", parentId: "s1", exam: "supply" },
  { id: "x1", kind: "file", name: "Normalization notes", parentId: "f2", exam: "both", pageCount: 12, imageCount: 2, hasOriginal: true, fileName: "Normalization notes.pdf" },
  { id: "x2", kind: "file", name: "Supply 2024 paper", parentId: "fi", exam: "supply", pageCount: 3 },
  { id: "x3", kind: "file", name: "SQL basics", parentId: "s1", exam: "regular", pageCount: 5 },
].map((n) => ({ ...n, ...scope }));

describe("library helpers", () => {
  it("lists folders before files, numerically, filtered by exam", () => {
    expect(childrenOf(NODES, null).map((n) => n.name)).toEqual(["DBMS", "Operating Systems"]);
    expect(childrenOf(NODES, "s1").map((n) => n.name)).toEqual([
      "Important questions",
      "Unit 2",
      "Unit 10",
      "SQL basics",
    ]);
    expect(childrenOf(NODES, "s1", "regular").map((n) => n.name)).toEqual(["Unit 2", "Unit 10", "SQL basics"]);
    expect(childrenOf(NODES, "s1", "supply").map((n) => n.name)).toEqual(["Important questions", "Unit 2", "Unit 10"]);
    expect(examFits({ exam: "both" }, "supply")).toBe(true);
    // A file inside a supply-only folder is hidden for regular students.
    expect(visible(NODES, NODES.find((n) => n.id === "x2"), "regular")).toBe(false);
  });

  it("finds paths, everything inside a node, and searches names with their folders", () => {
    expect(pathOf(NODES, "x1").map((n) => n.name)).toEqual(["DBMS", "Unit 2", "Normalization notes"]);
    expect(descendants(NODES, "s1").map((n) => n.id).sort()).toEqual(["f10", "f2", "fi", "s1", "x1", "x2", "x3"]);
    expect(searchNodes(NODES, "dbms unit 2").map((r) => r.node.name)).toEqual(["Unit 2", "Normalization notes"]);
    expect(searchNodes(NODES, "paper").map((r) => r.node.name)).toEqual(["Supply 2024 paper"]);
    expect(searchNodes(NODES, "paper", "regular")).toEqual([]);
    expect(searchNodes(NODES, "  ")).toEqual([]);
  });

  it("edits the admin's option lists without repeats", () => {
    const o = { universities: ["GITAM VIZAG"], degrees: ["CSE CORE"], years: ["1", "2", "3", "4"] };
    expect(editOptions(o, "universities", { add: " gitam vizag " }).universities).toEqual(["GITAM VIZAG"]);
    expect(editOptions(o, "universities", { add: "GITAM Hyderabad" }).universities).toEqual(["GITAM VIZAG", "GITAM Hyderabad"]);
    expect(editOptions(o, "years", { add: "10" }).years).toEqual(["1", "2", "3", "4", "10"]);
    expect(editOptions(o, "degrees", { remove: "CSE CORE" }).degrees).toEqual([]);
  });
});

// ---- The page -------------------------------------------------------------------
const api = vi.hoisted(() => ({
  loadUniOptions: vi.fn(),
  saveUniOptions: vi.fn(),
  loadNodes: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNodes: vi.fn(),
  saveUniFile: vi.fn(),
  loadOriginal: vi.fn(),
  loadAllNodes: vi.fn(),
  indexFiles: vi.fn(),
}));
vi.mock("../src/university", async (orig) => ({ ...(await orig()), ...api }));
vi.mock("../src/documents", () => ({
  readDocument: vi.fn(async () => ({ pages: ["Unit 1 text", "More"], images: [] })),
  warmUpReader: vi.fn(),
  downloadBlob: vi.fn(),
}));
const { default: UniversityPage } = await import("../src/UniversityPage");

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.loadUniOptions.mockResolvedValue({
    universities: ["GITAM VIZAG"],
    degrees: ["CSE CORE"],
    years: ["1", "2", "3", "4"],
  });
  api.loadNodes.mockResolvedValue(NODES);
});
afterEach(() => vi.restoreAllMocks());

const renderPage = (props = {}) => {
  const onOpenFile = vi.fn(async () => {});
  const notify = vi.fn();
  render(<UniversityPage active admin={false} notify={notify} onOpenFile={onOpenFile} {...props} />);
  return { onOpenFile, notify };
};

it("lets a student pick their course, browse folders, filter by exam, search and open a file", async () => {
  const { onOpenFile } = renderPage();
  expect(screen.getByLabelText("University")).toHaveValue("GITAM VIZAG");
  expect(screen.getByLabelText("Degree")).toHaveValue("CSE CORE");
  await userEvent.selectOptions(screen.getByLabelText("Year"), "2");
  expect(api.loadNodes).toHaveBeenLastCalledWith({ university: "GITAM VIZAG", degree: "CSE CORE", year: "2" });
  expect(await screen.findByRole("button", { name: "Open DBMS" })).toBeVisible();
  // No admin tools for students.
  expect(screen.queryByRole("button", { name: /Add subject/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Edit options/ })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Open DBMS" }));
  expect(screen.getByRole("heading", { name: "DBMS" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Important questions" })).toBeVisible();
  // Regular students don't see supply-only material.
  await userEvent.click(screen.getByRole("button", { name: "Regular" }));
  expect(screen.queryByRole("button", { name: "Open Important questions" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open SQL basics" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "All" }));

  await userEvent.click(screen.getByRole("button", { name: "Open Unit 2" }));
  expect(within(screen.getByRole("navigation", { name: "Folder path" })).getByText("DBMS")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Open Normalization notes" }));
  expect(onOpenFile).toHaveBeenCalledWith(
    expect.objectContaining({ id: "x1" }),
    [expect.objectContaining({ name: "DBMS" }), expect.objectContaining({ name: "Unit 2" }), expect.objectContaining({ name: "Normalization notes" })],
  );
  expect(screen.getByRole("button", { name: "View Normalization notes" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Download Normalization notes" })).toBeVisible();

  // Search looks across every course, own course first.
  api.loadAllNodes.mockResolvedValue([
    ...NODES,
    { id: "y3", kind: "subject", name: "Compiler Design", parentId: null, exam: "both", university: "GITAM VIZAG", degree: "CSE CORE", year: "3" },
    { id: "y3p", kind: "file", name: "Previous paper 2023", parentId: "y3", exam: "both", pageCount: 2, university: "GITAM VIZAG", degree: "CSE CORE", year: "3" },
  ]);
  await userEvent.type(screen.getByLabelText("Search subjects, folders and files"), "paper");
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByRole("heading", { name: "2 results for “paper”" })).toBeVisible();
  expect(screen.getByText("DBMS › Important questions")).toBeVisible();
  expect(screen.getByText("GITAM VIZAG · CSE CORE · Year 3 — Compiler Design")).toBeVisible();
  // Results from another course are read-only for the admin's tools.
  expect(screen.queryByRole("button", { name: "Delete Previous paper 2023" })).toBeNull();
  // Just this course.
  await userEvent.click(screen.getByRole("button", { name: "This course" }));
  expect(screen.getByRole("heading", { name: "1 result for “paper”" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "All courses" }));
  await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.queryByText(/result for/)).toBeNull();
  // The choice is remembered for next time.
  expect(JSON.parse(localStorage.getItem("studymind-university"))).toMatchObject({ year: "2", exam: "all" });
});

it("lets the admin add subjects and folders, upload files, rename, delete and edit the options", async () => {
  api.loadNodes.mockResolvedValue([]);
  api.createNode.mockImplementation(async ({ scope: s, parentId, kind, name, exam }) => ({
    id: `n-${name}`,
    parentId,
    kind,
    name,
    exam,
    ...s,
  }));
  api.saveUniFile.mockImplementation(async ({ parentId, file, pages }) => ({
    id: "file-1",
    kind: "file",
    name: file.name.replace(/\.pdf$/, ""),
    parentId,
    exam: "both",
    pageCount: pages.length,
    hasOriginal: true,
  }));
  api.saveUniOptions.mockResolvedValue();
  api.deleteNodes.mockImplementation(async (nodes, id) => [id]);
  const { notify } = renderPage({ admin: true });
  expect(await screen.findByText(/No subjects yet for this course/)).toBeVisible();

  await userEvent.type(screen.getByLabelText("New subject name"), "DBMS");
  await userEvent.selectOptions(screen.getByLabelText("Exam for new items"), "regular");
  await userEvent.click(screen.getByRole("button", { name: /Add subject/ }));
  expect(api.createNode).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "subject", name: "DBMS", parentId: null, exam: "regular", scope: expect.objectContaining({ university: "GITAM VIZAG" }) }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Open DBMS" }));
  await userEvent.click(screen.getByRole("button", { name: /Unit 1/ }));
  expect(api.createNode).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "folder", name: "Unit 1", parentId: "n-DBMS", parentName: "DBMS" }));
  await userEvent.click(screen.getByRole("button", { name: "Open Unit 1" }));

  await userEvent.upload(
    screen.getByLabelText("Choose files to upload"),
    new File(["%PDF"], "Unit 1 notes.pdf", { type: "application/pdf" }),
  );
  expect(await screen.findByRole("button", { name: "Open Unit 1 notes" })).toBeVisible();
  expect(api.saveUniFile).toHaveBeenCalledWith(expect.objectContaining({ parentId: "n-Unit 1", parentName: "Unit 1", pages: ["Unit 1 text", "More"] }));
  expect(screen.getAllByText("2 pages").length).toBeGreaterThan(0); // card and upload status

  vi.spyOn(window, "prompt").mockReturnValue("Unit 1 – notes");
  await userEvent.click(screen.getByRole("button", { name: "Rename Unit 1 notes" }));
  expect(api.updateNode).toHaveBeenCalledWith(
    "file-1",
    { name: "Unit 1 – notes" },
    expect.objectContaining({ action: "rename", summary: "Renamed file “Unit 1 notes” to “Unit 1 – notes”" }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await userEvent.click(screen.getByRole("button", { name: "Delete Unit 1 – notes" }));
  expect(api.deleteNodes).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Open Unit 1 – notes" })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: /Edit options/ }));
  await userEvent.type(screen.getByLabelText("Add to Universities"), "GITAM Hyderabad");
  await userEvent.click(within(screen.getByRole("region", { name: "University options" })).getAllByRole("button", { name: /Add/ })[0]);
  await userEvent.click(screen.getByRole("button", { name: "Save options" }));
  expect(api.saveUniOptions).toHaveBeenCalledWith(
    expect.objectContaining({ universities: ["GITAM VIZAG", "GITAM Hyderabad"], degrees: ["CSE CORE"] }),
  );
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Options saved/));
  expect(screen.getByRole("option", { name: "GITAM Hyderabad" })).toBeInTheDocument();
});

it("lets the admin drop files onto a folder, pick icons, and download Office originals", async () => {
  const documents = await import("../src/documents");
  const nodes = [
    ...NODES,
    { id: "pp", kind: "file", name: "ER slides", parentId: "f2", exam: "both", pageCount: 9, hasOriginal: true, fileName: "ER slides.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ...scope },
  ];
  api.loadNodes.mockResolvedValue(nodes);
  api.updateNode.mockResolvedValue();
  api.loadOriginal.mockResolvedValue(new Blob(["pptx"]));
  api.saveUniFile.mockImplementation(async ({ parentId, file }) => ({ id: `new-${file.name}`, kind: "file", name: file.name.replace(/\.\w+$/, ""), parentId, exam: "both", pageCount: 2, fileName: file.name, hasOriginal: true }));
  const { notify } = renderPage({ admin: true });
  await userEvent.click(await screen.findByRole("button", { name: "Open DBMS" }));

  // Icons: automatic from the name, a built-in one, or any emoji.
  await userEvent.click(screen.getByRole("button", { name: "Change icon for Unit 2" }));
  const picker = screen.getByRole("dialog", { name: "Icon for Unit 2" });
  expect(within(picker).getByRole("button", { name: "Units" })).toHaveClass("active");
  await userEvent.click(within(picker).getByRole("button", { name: "Database" }));
  expect(api.updateNode).toHaveBeenLastCalledWith("f2", { icon: "database" }, expect.objectContaining({ action: "icon" }));
  await userEvent.click(screen.getByRole("button", { name: "Change icon for Important questions" }));
  await userEvent.type(screen.getByLabelText("Or type an emoji"), "⭐");
  await userEvent.click(screen.getByRole("button", { name: "Use" }));
  expect(api.updateNode).toHaveBeenLastCalledWith("fi", { icon: "⭐" }, expect.objectContaining({ action: "icon", summary: "Set the icon of “Important questions” to ⭐" }));
  expect(screen.getByRole("button", { name: "Open Important questions" })).toHaveTextContent("⭐");

  // Drag and drop: Word, PowerPoint and images upload like PDFs.
  await userEvent.click(screen.getByRole("button", { name: "Open Unit 2" }));
  const panel = document.querySelector(".uni-browser");
  const files = [new File(["w"], "Normal forms.docx"), new File(["p"], "Keys.pptx"), new File(["i"], "Board.png", { type: "image/png" })];
  fireEvent.dragEnter(panel, { dataTransfer: { types: ["Files"], files } });
  expect(screen.getByText("Drop to upload to “Unit 2”")).toBeInTheDocument();
  fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files } });
  expect(await screen.findByRole("button", { name: "Open Board" })).toBeVisible();
  expect(api.saveUniFile.mock.calls.map(([a]) => a.file.name)).toEqual(["Normal forms.docx", "Keys.pptx", "Board.png"]);
  expect(api.saveUniFile).toHaveBeenCalledWith(expect.objectContaining({ parentId: "f2" }));
  expect(screen.queryByText(/Drop to upload/)).toBeNull();

  // Download saves the original with its own name.
  await userEvent.click(screen.getByRole("button", { name: "Download ER slides" }));
  expect(documents.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "ER slides.pptx");
  expect(screen.getByRole("button", { name: "View ER slides" })).toHaveTextContent("View");

  // At the top level there is no folder to drop into.
  await userEvent.click(within(screen.getByRole("navigation", { name: "Folder path" })).getByRole("button", { name: "Subjects" }));
  fireEvent.drop(panel, { dataTransfer: { types: ["Files"], files } });
  expect(notify).toHaveBeenLastCalledWith("Open a subject or folder first, then drop the files into it.");
});

it("opens a search result from another course there, and the admin can index older files for search", async () => {
  const y3 = { university: "GITAM VIZAG", degree: "CSE CORE", year: "3" };
  const Y3 = [
    { id: "cd", kind: "subject", name: "Compiler Design", parentId: null, exam: "both", ...y3 },
    { id: "cdu1", kind: "folder", name: "Unit 1", parentId: "cd", exam: "both", ...y3 },
    { id: "lex", kind: "file", name: "Lexical analysis", parentId: "cdu1", exam: "both", ...y3 },
  ];
  api.loadNodes.mockImplementation(async (sc) => (sc.year === "3" ? Y3 : NODES));
  api.loadAllNodes.mockResolvedValue([...NODES, ...Y3]);
  api.indexFiles.mockImplementation(async (nodes, onProgress) => {
    onProgress(1, 2);
    nodes.filter((n) => n.kind === "file").forEach((n) => (n.keywords = n.id === "lex" ? ["tokens", "lexemes"] : ["x"]));
    return 2;
  });
  const { notify } = renderPage({ admin: true });
  await screen.findByRole("button", { name: "Open DBMS" });
  // "cd" is short for Compiler Design.
  await userEvent.type(screen.getByLabelText("Search subjects, folders and files"), "cd unit 1");
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByRole("button", { name: "Open Unit 1" })).toBeVisible();
  // Files without search keywords: the admin can let search look inside them.
  await userEvent.click(screen.getByRole("button", { name: /Search inside \d+ older files/ }));
  expect(api.indexFiles).toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith("Search now looks inside 2 more files.");
  // Opening a folder from Year 3 switches to Year 3 and opens it.
  await userEvent.click(screen.getByRole("button", { name: "Open Unit 1" }));
  expect(await screen.findByRole("button", { name: "Open Lexical analysis" })).toBeVisible();
  expect(screen.getByLabelText("Year")).toHaveValue("3");
  expect(within(screen.getByRole("navigation", { name: "Folder path" })).getByText("Compiler Design")).toBeVisible();
});
