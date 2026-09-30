// Multi-document study plans. The instant planner splits every selected PDF
// into its topics (sections), balances them across the study days by amount
// of text, and keeps revision days at the end. Gemini can plan by topic too.
import { headingOf, sections, tidyTitle } from "./study";
export { headingOf };
import { canGenerate } from "./engine";
import { geminiAvailable, geminiJSON } from "./gemini";

const words = (t) => (t.match(/\S+/g) || []).length;
const range = (a, b) => (a === b ? `p. ${a + 1}` : `pp. ${a + 1}–${b + 1}`);

const isPageTitle = (t) => /^Page \d+$/.test(t);

/**
 * Topics of one document: { docId, docName, title, start, end, words,
 * pages: [{ page, words }] }. Untitled pages are named after their first
 * heading-like line.
 */
export function topicsOf(doc) {
  const secs = sections(doc.pages);
  // A one-page note without a heading is simply named after the document.
  const untitled = (i) =>
    doc.pages.length === 1 ? doc.name || "Page 1" : `Page ${i + 1}`;
  const units = secs.length
    ? secs.map((s) => {
        const perPage = new Map();
        s.blocks.forEach((b) =>
          perPage.set(b.page, (perPage.get(b.page) || 0) + words(b.text)),
        );
        if (!perPage.size) perPage.set(s.page, 0);
        const pages = [...perPage.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([page, w]) => ({ page, words: w + 1 }));
        return {
          title: isPageTitle(s.title)
            ? headingOf(doc.pages[s.page]) || untitled(s.page)
            : tidyTitle(s.title),
          start: Math.min(s.page, pages[0].page),
          end: Math.max(s.page, ...pages.map((p) => p.page)),
          words: pages.reduce((n, p) => n + p.words, 0),
          pages,
        };
      })
    : doc.pages.map((p, i) => ({
        title: headingOf(p) || untitled(i),
        start: i,
        end: i,
        words: words(p) + 1,
        pages: [{ page: i, words: words(p) + 1 }],
      }));
  // A document that forms one untitled topic is named after the document.
  if (units.length === 1 && isPageTitle(units[0].title) && doc.name)
    units[0].title = doc.name;
  return units.map((u) => ({
    ...u,
    docId: doc.id,
    docName: doc.name,
    docPages: doc.pages,
  }));
}

/** Splits a topic that is much bigger than a day's share into page runs. */
function splitTopic(u, target) {
  if (u.words <= target * 1.25 || u.pages.length < 2) return [u];
  const parts = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    parts.push(run);
    run = [];
  };
  u.pages.forEach((p) => {
    run.push(p);
    if (run.reduce((n, x) => n + x.words, 0) >= target * 0.8) flush();
  });
  // A tiny tail joins the previous part.
  if (run.length && parts.length && run.reduce((n, x) => n + x.words, 0) < target * 0.3)
    parts[parts.length - 1].push(...run);
  else flush();
  const titles = new Set();
  return parts.map((run, k) => {
    const heading = headingOf(u.docPages?.[run[0].page]);
    let title =
      k === 0 && (!heading || heading === u.title)
        ? u.title
        : heading && !titles.has(heading) && heading !== u.title
          ? heading
          : `${u.title} (part ${k + 1})`;
    titles.add(title);
    return {
      ...u,
      title,
      start: run[0].page,
      end: run.at(-1).page,
      words: run.reduce((n, x) => n + x.words, 0),
      pages: run,
    };
  });
}

export function makeMultiPlan(docs, { days, hoursPerDay = 2 } = {}) {
  if (!docs?.length) throw new Error("Choose at least one document.");
  if (!Number.isInteger(days) || days < 1 || days > 60)
    throw new Error("Choose a whole number of days from 1 to 60.");
  if (!(hoursPerDay >= 0.5 && hoursPerDay <= 12))
    throw new Error("Choose between 0.5 and 12 hours per day.");
  const topics = docs.flatMap(topicsOf);
  const reviewDays = days >= 3 ? Math.max(1, Math.round(days / 6)) : 0;
  const wanted = Math.max(1, days - reviewDays);
  const topicTotal = topics.reduce((n, u) => n + u.words, 0);
  const units = topics.flatMap((u) => splitTopic(u, topicTotal / wanted));
  const studyDays = Math.min(wanted, units.length);
  const total = units.reduce((n, u) => n + u.words, 0);
  const minutes = Math.round(hoursPerDay * 60);
  const groups = [];
  let current = [],
    load = 0;
  units.forEach((u, i) => {
    const left = units.length - i; // including this one
    const daysLeft = studyDays - groups.length - 1;
    // Start a new day if this topic would overfill today, or when every
    // remaining day still needs a topic.
    if (
      current.length &&
      daysLeft > 0 &&
      (load + u.words / 2 > total / studyDays || left === daysLeft)
    ) {
      groups.push(current);
      current = [];
      load = 0;
    }
    current.push(u);
    load += u.words;
  });
  if (current.length) groups.push(current);
  const reading = Math.max(10, minutes - 15); // keep 15 min for practice
  // The heaviest day uses the full reading time; lighter days get less, so a
  // one-page topic is a short session, not a two-hour one.
  const heaviest = Math.max(
    ...groups.map((g) => g.reduce((n, u) => n + u.words, 0)),
  );
  const items = groups.map((group, d) => {
    const docsToday = [...new Set(group.map((u) => u.docName))];
    let tasks = group.map((u) => ({
      docId: u.docId,
      docName: u.docName,
      title: u.title,
      pages: range(u.start, u.end),
      minutes: Math.max(5, Math.round((reading * u.words) / heaviest)),
    }));
    const sum = tasks.reduce((n, t) => n + t.minutes, 0);
    if (sum > reading)
      tasks = tasks.map((t) => ({
        ...t,
        minutes: Math.max(5, Math.floor((t.minutes * reading) / sum)),
      }));
    return {
      day: d + 1,
      type: "study",
      tasks,
      practice: `Practise the 2- and 5-mark questions for ${docsToday.join(", ")}.`,
    };
  });
  const allDocs = docs.map((d) => d.name).join(", ");
  for (let r = 0; r < days - groups.length; r++)
    items.push({
      day: groups.length + r + 1,
      type: "review",
      tasks: [
        {
          title:
            r === days - groups.length - 1
              ? "Final revision: read your notes and key terms"
              : "Revision: re-read your notes",
          docName: allDocs,
          pages: "",
          minutes: Math.max(10, minutes - 30),
        },
      ],
      practice:
        "Attempt the 8-mark questions without looking, then check the model answers.",
    });
  return {
    items,
    days,
    hoursPerDay,
    docIds: docs.map((d) => d.id),
    source: "built-in",
  };
}

/** Topic-level plan written by Gemini from each document's outline. */
export async function planWithGemini(docs, { days, hoursPerDay = 2 }) {
  if (!geminiAvailable() || !canGenerate())
    throw new Error("Planning with Gemini needs a Gemini API key.");
  const base = makeMultiPlan(docs, { days, hoursPerDay }); // validates input
  const outline = docs
    .map(
      (d) =>
        `Document "${d.name}" (${d.pages.length} pages):\n` +
        topicsOf(d)
          .map(
            (t) => `- ${t.title} (${range(t.start, t.end)}, ~${t.words} words)`,
          )
          .join("\n"),
    )
    .join("\n\n");
  const data = await geminiJSON(
    [
      {
        role: "system",
        content:
          "You are a study coach. Build a realistic day-by-day plan that covers every topic of every " +
          "document, orders topics so prerequisites come first, balances effort by length and difficulty, " +
          "and ends with revision days. Return JSON: " +
          '{"days":[{"day":1,"type":"study"|"review","tasks":[{"docName","title","pages","minutes"}],"practice"}]}. ' +
          "Use exactly the requested number of days; daily minutes must fit the hours given.",
      },
      {
        role: "user",
        content: `Days: ${days}\nHours per day: ${hoursPerDay}\n\n${outline}`,
      },
    ],
    { maxTokens: 6000 },
  );
  const items = (Array.isArray(data?.days) ? data.days : [])
    .slice(0, days)
    .map((d, i) => ({
      day: i + 1,
      type: d.type === "review" ? "review" : "study",
      tasks: (Array.isArray(d.tasks) ? d.tasks : []).map((t) => ({
        docId: docs.find((x) => x.name === t.docName)?.id,
        docName: String(t.docName || ""),
        title: String(t.title || "Study"),
        pages: String(t.pages || ""),
        minutes: Number(t.minutes) || 30,
      })),
      practice: String(d.practice || ""),
    }))
    .filter((d) => d.tasks.length);
  if (!items.length)
    throw new Error("Gemini returned an empty plan. Try again.");
  return { ...base, items, source: "gemini" };
}
