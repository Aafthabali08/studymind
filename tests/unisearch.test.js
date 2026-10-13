import { describe, expect, it } from "vitest";
import { distance, expandQuery, fileKeywords, normalize, smartSearch, stem, wordMatch } from "../src/uniSearch";
import { extractKeywords } from "../src/ai/text";

const c = (year, degree = "CSE CORE", university = "GITAM VIZAG") => ({ university, degree, year });
const NODES = [
  { id: "dbms", kind: "subject", name: "Database Management Systems", parentId: null, ...c("2") },
  { id: "d2", kind: "folder", name: "Unit 2", parentId: "dbms", ...c("2") },
  { id: "d12", kind: "folder", name: "Unit 12", parentId: "dbms", ...c("2") },
  { id: "norm", kind: "file", name: "Normalization notes", parentId: "d2", keywords: ["functional dependency", "bcnf", "normal forms"], ...c("2") },
  { id: "os", kind: "subject", name: "Operating Systems", parentId: null, ...c("3") },
  { id: "osimp", kind: "folder", name: "Important questions", parentId: "os", ...c("3") },
  { id: "sched", kind: "file", name: "CPU scheduling", parentId: "osimp", keywords: ["round robin", "deadlock", "semaphores"], ...c("3") },
  { id: "dsa", kind: "subject", name: "DSA", parentId: null, ...c("1", "CSE AI & ML") },
  { id: "sort", kind: "file", name: "Sorting algorithms", parentId: "dsa", keywords: ["quick sort", "merge sort"], ...c("1", "CSE AI & ML") },
  { id: "papers", kind: "folder", name: "Previous papers", parentId: "dsa", ...c("1", "CSE AI & ML") },
];
const names = (r) => r.map((x) => x.node.name);

describe("understanding what is typed", () => {
  it("normalises unit numbers written many ways", () => {
    for (const q of ["unit-2", "Unit 2", "unit II", "module 2", "u2", "UNIT_2", "chapter ii"]) expect(normalize(q)).toBe("unit 2");
    expect(normalize("M1 & M2")).toBe("m1 and m2"); // Mathematics, not modules
  });
  it("stems word forms and tolerates spelling slips", () => {
    expect(stem("normalization")).toBe(stem("normalized"));
    expect(stem("normalisation")).toBe(stem("normalize"));
    expect(stem("algorithms")).toBe("algorithm");
    expect(distance("algoritm", "algorithm")).toBe(1);
    expect(distance("algroithm", "algorithm")).toBe(1); // swapped letters
    expect(wordMatch("normalisaton", "normalization")).toBeGreaterThan(0.5);
    expect(wordMatch("2", "12")).toBe(0);
    expect(wordMatch("sch", "scheduling")).toBe(0.8);
  });
  it("expands short forms", () => {
    expect(expandQuery("dbms imp")).toEqual([
      { word: "dbms", long: ["database", "management", "systems"] },
      { word: "imp", long: ["important"] },
    ]);
  });
});

describe("searching every course", () => {
  it("finds subjects by short form across years and degrees", () => {
    expect(names(smartSearch(NODES, "dbms").results)[0]).toBe("Database Management Systems");
    expect(names(smartSearch(NODES, "os").results)[0]).toBe("Operating Systems");
    expect(names(smartSearch(NODES, "dsa").results)[0]).toBe("DSA");
  });
  it("matches a unit exactly (unit 2 is not unit 12) inside its subject", () => {
    const r = names(smartSearch(NODES, "dbms unit-2").results);
    expect(r[0]).toBe("Unit 2");
    expect(r).toContain("Normalization notes");
    expect(r).not.toContain("Unit 12");
  });
  it("finds files by their content and by word forms or typos", () => {
    expect(names(smartSearch(NODES, "deadlock").results)).toEqual(["CPU scheduling"]);
    expect(names(smartSearch(NODES, "bcnf").results)).toEqual(["Normalization notes"]);
    expect(names(smartSearch(NODES, "normalize").results)).toEqual(["Normalization notes"]);
    expect(names(smartSearch(NODES, "normalisaton").results)).toEqual(["Normalization notes"]);
    expect(names(smartSearch(NODES, "sorting algoritms").results)).toEqual(["Sorting algorithms"]);
  });
  it("understands study words like imp and pyq", () => {
    expect(names(smartSearch(NODES, "os imp").results)[0]).toBe("Important questions");
    expect(names(smartSearch(NODES, "pyq").results)).toEqual(["Previous papers"]);
  });
  it("puts the student's own course first", () => {
    const more = [...NODES, { id: "os2", kind: "subject", name: "Operating Systems", parentId: null, ...c("2") }];
    const r = smartSearch(more, "operating systems", { course: c("2") }).results;
    expect(r[0].node.id).toBe("os2");
    expect(r[1].node.id).toBe("os");
  });
  it("offers the nearest results when nothing matches every word", () => {
    const { results, related } = smartSearch(NODES, "deadlock prevention banker");
    expect(results).toEqual([]);
    expect(names(related)).toEqual(["CPU scheduling"]);
    expect(smartSearch(NODES, "quantum chemistry")).toEqual({ results: [], related: [] });
  });
  it("respects the exam filter through the visible() check", () => {
    const hideFiles = (n) => n.kind !== "file";
    expect(names(smartSearch(NODES, "deadlock", { visible: hideFiles }).results)).toEqual([]);
  });
});

it("collects content keywords for search when a file is uploaded", () => {
  const pages = ["Normal Forms\n\nA relation is in BCNF when every determinant is a candidate key. Functional dependency rules decide the normal form. Functional dependency examples follow."];
  const k = fileKeywords(pages, extractKeywords);
  expect(k[0]).toBe("normal forms");
  expect(k).toContain("functional dependency");
  expect(k).toContain("bcnf"); // short forms are kept even when they appear once
  expect(k).toContain("determinant");
  expect(k.length).toBeLessThanOrEqual(120);
});
