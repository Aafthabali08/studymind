import { it, expect } from "vitest";
import { headingOf, makeMultiPlan, topicsOf } from "../src/ai/plan";
import { samples } from "./fixtures/samples";

it("splits documents into their topics", () => {
  expect(topicsOf(samples[0]).map((t) => t.title)).toEqual([
    "Foundations of Artificial Intelligence",
    "Search and Problem Solving",
    "Neural Networks",
  ]);
});

it("covers every topic of every document once, then revises", () => {
  const plan = makeMultiPlan(samples, { days: 6, hoursPerDay: 1.5 });
  expect(plan.items).toHaveLength(6);
  const covered = plan.items
    .filter((d) => d.type === "study")
    .flatMap((d) => d.tasks.map((t) => t.title));
  expect(covered).toEqual(
    samples.flatMap((d) => topicsOf(d).map((t) => t.title)),
  );
  expect(plan.items.at(-1).type).toBe("review");
  plan.items.forEach((d) => expect(d.tasks.length).toBeGreaterThan(0));
  plan.items
    .filter((d) => d.type === "study")
    .forEach((d) =>
      expect(d.tasks.reduce((n, t) => n + t.minutes, 0)).toBeLessThanOrEqual(
        90,
      ),
    );
});

it("never leaves a study day empty when days outnumber topics", () => {
  const plan = makeMultiPlan([samples[1]], { days: 10 });
  expect(plan.items).toHaveLength(10);
  expect(plan.items.filter((d) => d.type === "study")).toHaveLength(2);
});

it("validates its input", () => {
  expect(() => makeMultiPlan([], { days: 3 })).toThrow(/at least one document/);
  expect(() => makeMultiPlan(samples, { days: 0 })).toThrow(/1 to 60/);
  expect(() => makeMultiPlan(samples, { days: 3, hoursPerDay: 20 })).toThrow(
    /hours/,
  );
});

const lecture = {
  id: "mm",
  name: "Multimedia HTML5",
  pages: [
    "1\nMULTIMEDIA IN HTML5\nMultimedia : the term media refers to text, image, audio and video. " + "Audio and video are used on the web page. ".repeat(40),
    "Exploring audio and video file formats:\nAAC is a lossy format used by many devices. " + "Formats store audio in different ways. ".repeat(40),
    "USING VIDEO ELEMENTS\nThe video element is used to display a video file in a web page. " + "Controls let the viewer play and pause. ".repeat(40),
    "Embedding a video file\nThe embed element shows external content such as plug-ins. " + "Width and height set the size. ".repeat(40),
  ],
};
const note = { id: "n", name: "Short note", pages: ["Photosynthesis turns light into chemical energy."] };

it("names untitled pages after their first heading-like line", () => {
  expect(headingOf("1\nMULTIMEDIA IN HTML5\nMultimedia : the term…")).toBe(
    "Multimedia in HTML5",
  );
  expect(headingOf("Exploring audio and video file formats:\nAAC is…")).toBe(
    "Exploring audio and video file formats",
  );
  expect(headingOf("This is a whole sentence that ends here.")).toBe("");
});

it("splits a big document by page so no single day holds all of it", () => {
  const plan = makeMultiPlan([note, lecture], { days: 5, hoursPerDay: 2 });
  const study = plan.items.filter((d) => d.type === "study");
  const titles = study.flatMap((d) => d.tasks.map((t) => t.title));
  expect(titles).toContain("Multimedia in HTML5");
  expect(titles).toContain("Using video elements");
  expect(titles.some((t) => /^Page \d+$/.test(t))).toBe(false);
  // The lecture is spread over several days.
  expect(
    study.filter((d) => d.tasks.some((t) => t.docName === "Multimedia HTML5"))
      .length,
  ).toBeGreaterThan(1);
  // Every page of the lecture is covered exactly once.
  const covered = study
    .flatMap((d) => d.tasks)
    .filter((t) => t.docName === "Multimedia HTML5")
    .map((t) => t.pages);
  expect(covered.join(" ")).toMatch(/p(p)?\. 1/);
  expect(covered.join(" ")).toMatch(/4/);
});

it("gives a tiny topic a short session instead of the whole day", () => {
  const plan = makeMultiPlan([note, lecture], { days: 5, hoursPerDay: 2 });
  const noteTask = plan.items
    .flatMap((d) => d.tasks)
    .find((t) => t.docName === "Short note");
  expect(noteTask.minutes).toBeLessThan(30);
  plan.items
    .filter((d) => d.type === "study")
    .forEach((d) =>
      expect(d.tasks.reduce((n, t) => n + t.minutes, 0)).toBeLessThanOrEqual(105),
    );
});
