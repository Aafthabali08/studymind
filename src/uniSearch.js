// Smart search for the university library, across every university, degree
// and year. It understands what students type:
//   short forms      "dbms", "os", "cn", "dsa", "pyq", "imp"
//   spelling slips   "normalisaton", "algoritm"
//   word forms       "normalize" finds "Normalization", "sorting" finds "sort"
//   unit numbers     "unit-2", "u2", "unit II", "module 2" all mean unit 2
//   file contents    topics inside files (keywords saved when they're uploaded)
// When nothing matches every word, the nearest results are offered instead.
import { STOP_WORDS } from "./ai/text";

// Common short forms in CSE courses (and study material), both directions.
export const SHORT_FORMS = {
  dbms: "database management systems",
  rdbms: "relational database management systems",
  db: "database",
  os: "operating systems",
  cn: "computer networks",
  dsa: "data structures algorithms",
  ds: "data structures",
  daa: "design analysis algorithms",
  ada: "analysis design algorithms",
  oop: "object oriented programming",
  oops: "object oriented programming",
  coa: "computer organization architecture",
  co: "computer organization",
  toc: "theory computation",
  flat: "formal languages automata theory",
  cd: "compiler design",
  se: "software engineering",
  ai: "artificial intelligence",
  ml: "machine learning",
  dl: "deep learning",
  nlp: "natural language processing",
  cv: "computer vision",
  iot: "internet things",
  dm: "discrete mathematics",
  dwdm: "data warehousing data mining",
  wt: "web technologies",
  cc: "cloud computing",
  is: "information security",
  cns: "cryptography network security",
  ppl: "principles programming languages",
  pps: "programming problem solving",
  stld: "switching theory logic design",
  deld: "digital electronics logic design",
  de: "digital electronics",
  beee: "basic electrical electronics engineering",
  evs: "environmental science",
  eg: "engineering graphics",
  la: "linear algebra",
  ps: "probability statistics",
  pns: "probability statistics",
  m1: "mathematics 1",
  m2: "mathematics 2",
  m3: "mathematics 3",
  pyq: "previous papers",
  pyqs: "previous papers",
  qp: "question paper",
  imp: "important",
  ques: "questions",
  qns: "questions",
  sem: "semester",
  ppt: "slides",
  lab: "lab practical",
  sup: "supply",
};
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** Lower case, "&" → and, "unit-2" / "u2" / "unit II" / "module 2" → "unit 2". */
export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    // "u2" too, but not "m1" (that is Mathematics 1).
    .replace(/\b(?:unit|module|chapter|chap|ch)[\s._-]*(\d+|x|ix|iv|v?i{1,3}|v)\b|\bu[\s._-]?(\d+)\b/g, (all, n, digits) =>
      `unit ${digits ?? (/^\d+$/.test(n) ? Number(n) : ROMAN[n])}`,
    )
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export const tokens = (text) =>
  normalize(text)
    .split(" ")
    .filter((t) => t && !STOP_WORDS.has(t));

/** A light stemmer: normalization / normalize / normalized → normal. */
export function stem(word) {
  let w = word;
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  for (const suffix of ["izations", "isations", "ization", "isation", "ations", "ation", "ements", "ement", "ments", "ment", "ness", "ities", "ity", "ings", "ing", "izes", "ises", "ized", "ised", "ize", "ise", "ers", "er", "ies", "es", "ed", "ly", "al", "s"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length);
      if (suffix === "ies") w += "y";
      break;
    }
  }
  return w;
}

/** Edit distance with swaps ("algoritm", "algroithm"), stopping early past `max`. */
export function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return max + 1;
  }
  return d[a.length][b.length];
}
const allowedSlips = (w) => (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0);

/** How well one query word matches one word of a name (0 … 1). */
export function wordMatch(q, w) {
  if (q === w) return 1;
  if (/^\d+$/.test(q) || /^\d+$/.test(w)) return 0; // unit 2 ≠ unit 12
  const sq = stem(q),
    sw = stem(w);
  if (sq === sw) return 0.92;
  if (q.length >= 3 && w.startsWith(q)) return 0.8;
  if (sq.length >= 4 && sw.startsWith(sq)) return 0.75;
  const slips = allowedSlips(q);
  if (slips && distance(q, w, slips) <= slips) return 0.68;
  if (slips && sq.length >= 4 && distance(sq, sw, slips) <= slips) return 0.62;
  return 0;
}

/** First letters of a name: "Operating Systems" → "os". */
const initials = (words) => words.map((w) => w[0]).join("");

/** The query as alternatives per word: each word, or its long form. */
export function expandQuery(query) {
  const words = tokens(query);
  return words.map((w) => {
    const long = SHORT_FORMS[w];
    return { word: w, long: long ? long.split(" ").filter((t) => !STOP_WORDS.has(t)) : null };
  });
}

/**
 * Searches nodes (subjects, folders, files of every course). Each needs
 * name and parentId; files may have keywords. `nodes` is the whole library
 * (paths are built from it). Returns { results, related }: results match
 * every word; related are the nearest when few or none do.
 */
export function smartSearch(nodes, query, { filter = "all", course = null, visible = () => true } = {}) {
  const terms = expandQuery(query);
  if (!terms.length) return { results: [], related: [] };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (n) => {
    const out = [];
    for (let x = n; x; x = byId.get(x.parentId)) out.unshift(x);
    return out;
  };
  const scored = [];
  for (const node of nodes) {
    if (!visible(node, filter)) continue;
    const path = pathOf(node);
    const own = tokens(node.name);
    const above = path.slice(0, -1).flatMap((p) => tokens(p.name));
    const inside = (node.keywords || []).flatMap((k) => tokens(k));
    const fields = [
      [own, 1],
      [above, 0.7],
      [inside, 0.55],
    ];
    const matchWords = (word) => {
      let best = 0;
      for (const [list, weight] of fields) for (const w of list) best = Math.max(best, wordMatch(word, w) * weight);
      // "os" → Operating Systems, by initials.
      if (word.length >= 2 && word.length <= 6 && initials(own) === word) best = Math.max(best, 0.95);
      return best;
    };
    let total = 0,
      matched = 0;
    for (const { word, long } of terms) {
      let best = matchWords(word);
      if (long) {
        // The long form counts when most of its words are there.
        const parts = long.map(matchWords);
        const hit = parts.filter((p) => p >= 0.5).length / parts.length;
        if (hit >= 0.6) best = Math.max(best, 0.9 * (parts.reduce((a, b) => a + b, 0) / parts.length) + 0.1);
      }
      total += best;
      if (best >= 0.5) matched++;
    }
    if (!matched) continue;
    let score = total / terms.length;
    if (course && node.university === course.university && node.degree === course.degree && String(node.year) === String(course.year))
      score *= 1.12; // this course first
    if (node.kind !== "file") score *= 1.03;
    scored.push({ node, path, score, all: matched === terms.length, coverage: matched / terms.length });
  }
  scored.sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name, undefined, { numeric: true }));
  const results = scored.filter((s) => s.all);
  // Nearest results: most of the words when some results exist, else any
  // that match at least a third (e.g. one word of three).
  const minCoverage = results.length ? 0.5 : 0.3;
  const related =
    results.length >= 3
      ? []
      : scored
          .filter((s) => !s.all && s.coverage >= minCoverage)
          .sort((a, b) => b.coverage - a.coverage || b.score - a.score)
          .slice(0, 12);
  return { results: results.slice(0, 60), related };
}

/**
 * Words that describe a file's content, saved with it for search: its
 * headings, key phrases, short forms (BCNF, TCP, SQL) and its most frequent
 * topic words. About 120 terms (a few kilobytes).
 */
export function fileKeywords(pages, extract) {
  const text = pages.join("\n");
  const headings = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && l.length < 70 && /^[\p{Lu}0-9]/u.test(l) && !/[.:;,]$/.test(l) && l.split(/\s+/).length <= 8)
    .slice(0, 20);
  const acronyms = [...new Set(text.match(/\b[A-Z][A-Z0-9]{1,6}s?\b/g) || [])].filter((a) => !/^[IVX]+$/.test(a)).slice(0, 30);
  const counts = new Map();
  for (const w of normalize(text).split(" "))
    if (w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) counts.set(w, (counts.get(w) || 0) + 1);
  const frequent = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([w]) => w);
  const seen = new Set();
  return [...headings, ...extract(text, 30), ...acronyms, ...frequent]
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k && !seen.has(k) && seen.add(k))
    .slice(0, 120);
}
