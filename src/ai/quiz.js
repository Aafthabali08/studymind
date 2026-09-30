// Quizzes built only from the uploaded document. Every question comes from a
// sentence (a "fact") of the PDF and the key terms it mentions, so nothing
// outside the document can appear. Six formats, 5 of each per set of 30, and
// three sets at a time; a new seed gives new questions.
import { STOP_WORDS, extractKeywords, splitSentences } from "./text";
import { GENERIC } from "./study";
import { geminiJSON } from "./gemini";

export const QUIZ_TYPES = [
  ["mcq", "Multiple choice"],
  ["blank", "Fill in the blank"],
  ["tf", "True or false"],
  ["match", "Matching"],
  ["term", "Name the term"],
  ["correct", "Which statement is correct?"],
];
export const QUIZ_TYPE_LABEL = Object.fromEntries(QUIZ_TYPES);
export const SET_SIZE = 30;
export const SET_COUNT = 3;
const PER_TYPE = SET_SIZE / QUIZ_TYPES.length; // 5

// ---- Random numbers that repeat for the same seed ------------------------------
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export const seedFrom = (text) =>
  [...String(text)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

// ---- Material: facts (sentences with their page) and key terms -----------------
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole-word patterns are compiled once per term (big PDFs test thousands of
// sentences against the same terms).
const reCache = new Map();
const wordRe = (term, flags = "iu") => {
  const key = flags + term;
  let re = reCache.get(key);
  if (!re) {
    if (reCache.size > 5000) reCache.clear();
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, flags);
    reCache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
};
/** Whole-word test with a cheap substring check first. */
const mentions = (lowerText, text, term) =>
  lowerText.includes(term.toLowerCase()) && wordRe(term).test(text);
const words = (t) => (t.match(/\S+/g) || []).length;

/** Lines → paragraphs (a line that doesn't end a sentence continues). */
function paragraphs(page) {
  const out = [];
  for (const raw of String(page || "").split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev && !/[.!?:]$/.test(prev) && /^[\p{Ll}(]/u.test(line))
      out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}
function clipAround(text, term, max = 38) {
  const list = text.split(" ");
  if (list.length <= max) return text;
  const at = list.findIndex((w) => w.toLowerCase().includes(term.toLowerCase().split(" ")[0]));
  const start = Math.max(0, Math.min(list.length - max, (at < 0 ? 0 : at) - Math.floor(max / 3)));
  return (start > 0 ? "…" : "") + list.slice(start, start + max).join(" ") + (start + max < list.length ? "…" : "");
}
const materialCache = new WeakMap();
/** Facts and terms of a document (cached per pages array). */
export function quizMaterial(doc) {
  const key = doc.pages;
  if (key && materialCache.has(key)) return materialCache.get(key);
  const facts = [];
  const seen = new Set();
  (doc.pages || []).forEach((page, p) => {
    for (const para of paragraphs(page))
      for (const s of splitSentences(para)) {
        const text = s.replace(/^[\d.)\s]+(?=\p{L})/u, "").trim();
        const n = words(text);
        const letters = (text.match(/\p{L}/gu) || []).length;
        if (n < 5 || n > 70 || letters < text.length * 0.55) continue;
        const k = text.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        facts.push({ text, page: p });
      }
  });
  const whole = (doc.pages || []).join("\n");
  const result = { facts, terms: quizTerms(facts, whole) };
  if (key) materialCache.set(key, result);
  return result;
}

// Everyday words that make poor quiz answers even when they are frequent.
const PLAIN = new Set(
  (
    "before after event events software tool tools name names description category popular lightweight platform edition " +
    "version following recommended problem problems code make sure please kindly various advanced first last " +
    "remaining important simple basic general specific common different new old good best main key important " +
    "page pages section chapter example figure table use user users time times day days way ways part parts " +
    "development management framework environment application applications service services server integrated " +
    "community edition standard support features feature information content details level"
  ).split(" "),
);
const isPlain = (k) =>
  STOP_WORDS.has(k) || GENERIC.has(k) || PLAIN.has(k) || /^\d+$/.test(k);
/**
 * Quiz-worthy terms: defined subjects, key phrases, technical names
 * (PyCharm, MySQL, HTML5, .NET, C#) and mid-sentence proper nouns.
 */
export function quizTerms(facts, whole) {
  const found = new Map();
  const lowerWhole = whole.toLowerCase();
  const display = (t) => {
    const at = lowerWhole.indexOf(t.toLowerCase());
    return at >= 0 ? whole.slice(at, at + t.length) : t;
  };
  const add = (raw, score) => {
    let t = raw
      .replace(/['’]s$/u, "")
      .replace(/^[^\p{L}\p{N}.#]+|[^\p{L}\p{N}+#)]+$/gu, "")
      .trim();
    if (t.endsWith(")") && !t.includes("(")) t = t.slice(0, -1).trim();
    const k = t.toLowerCase();
    if (t.length < 2 || t.length > 40 || words(t) > 4) return;
    const parts = k.split(" ");
    if (parts.every(isPlain) || isPlain(parts[0]) || isPlain(parts.at(-1))) return;
    // A single ordinary lowercase word must be long enough to be a real term.
    if (parts.length === 1 && /^\p{Ll}+$/u.test(t) && t.length < 6) return;
    const prev = found.get(k);
    if (prev) prev.score += score;
    else found.set(k, { term: display(t), score });
  };
  for (const f of facts) {
    const m = DEF.exec(f.text) || SUBJECT_VERB.exec(f.text);
    if (m && words(m[1]) <= 4) add(m[1], 3);
    const tokens = f.text.split(" ");
    const titleCase =
      tokens.filter((w) => /^\p{Lu}/u.test(w)).length >= tokens.length * 0.6;
    tokens.forEach((w, i) => {
      // Technical names and acronyms: internal capitals, digits, + or #.
      if (/^[.]?[\p{L}][\w.+#-]*$/u.test(w.replace(/[,;:()]+/g, "")) &&
          /[a-z][A-Z]|[A-Z]{2,}|\p{L}\d|\+\+|#|^\.[A-Z]|\.js$/u.test(w))
        add(w.replace(/[,;:()]+/g, ""), 2);
      // Proper nouns in the middle of a normal sentence.
      else if (i > 0 && !titleCase && /^\p{Lu}\p{Ll}{2,}/u.test(w)) {
        const next = tokens[i + 1];
        const pair = next && /^\p{Lu}\p{Ll}+/u.test(next) ? `${w} ${next}` : "";
        // Two capitalised words form a name only if the pair recurs
        // ("Visual Studio"), not when a table row runs words together.
        if (pair && (whole.match(wordRe(pair, "giu")) || []).length > 1) add(pair, 2);
        else add(w, 1);
      }
    });
  }
  // Single words: only noun-like ones ("backpropagation", "perception"), not
  // verbs or adverbs ("programmed", "explicitly").
  const NOUNISH =
    /(tion|sion|ment|ness|ity|ance|ence|ism|ogy|ure|ics|ship|hood|ware|work|base|ist|er|or)$/;
  for (const k of extractKeywords(whole, 120)) {
    if (k.includes(" ")) add(k, 2);
    else if (k.length >= 8 && NOUNISH.test(k)) add(k, 1);
  }
  for (const w of new Set(whole.toLowerCase().match(/\p{L}[\p{L}-]{8,}/gu) || []))
    if (NOUNISH.test(w)) add(w, 0.5);
  // Count mentions only for the strongest candidates (fast even for 200 pages).
  const lowerFacts = facts.map((f) => f.text.toLowerCase());
  const list = [];
  for (const v of [...found.values()].sort((a, b) => b.score - a.score).slice(0, 250)) {
    v.n = 0;
    for (let i = 0; i < facts.length; i++)
      if (mentions(lowerFacts[i], facts[i].text, v.term)) v.n++;
    if (v.n) list.push(v);
  }
  // Keep the longer of two overlapping terms when they occur equally often.
  return list
    .filter(
      (a) =>
        !list.some(
          (b) =>
            b !== a &&
            b.term.length > a.term.length &&
            (b.n >= a.n || b.score >= a.score) &&
            wordRe(a.term).test(b.term),
        ),
    )
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .slice(0, 80)
    .map((v) => v.term);
}

// ---- Question builders --------------------------------------------------------
const termsIn = (fact, terms) => {
  const lower = fact.lower || (fact.lower = fact.text.toLowerCase());
  return terms.filter((t) => mentions(lower, fact.text, t));
};
const blankOut = (text, term) => text.replace(wordRe(term), "_____");
function distractors(answer, terms, random, n = 3) {
  const size = words(answer);
  const lower = answer.toLowerCase();
  return shuffle(
    terms.filter((t) => {
      const l = t.toLowerCase();
      return l !== lower && !l.includes(lower) && !lower.includes(l);
    }),
    random,
  )
    .sort((a, b) => Math.abs(words(a) - size) - Math.abs(words(b) - size))
    .slice(0, n);
}
function choices(answer, wrong, random) {
  const options = shuffle([answer, ...wrong], random);
  return { options, answer: options.indexOf(answer) };
}
/** A false version of a fact: one key term swapped for another. */
function falsify(fact, terms, random, whole) {
  for (const t of shuffle(termsIn(fact, terms), random)) {
    for (const other of distractors(t, terms, random, 6)) {
      if (wordRe(other).test(fact.text)) continue;
      const changed = fact.text.replace(wordRe(t), other);
      if (!whole.includes(changed.toLowerCase())) return { text: changed, swapped: t, with: other };
    }
  }
  return null;
}
const DEF =
  /^(?:(?:an?|the)\s+)?(.{3,50}?)\s+(?:is|are|refers to|means|is defined as|is called|is used to|are used to|stands for)\s+(.{12,})$/iu;
// "Breadth-first search explores…", "A neural network consists of…"
const SUBJECT_VERB =
  /^(?:(?:an?|the)\s+)?([\p{L}][\p{L}\p{N}*-]*(?:\s+[\p{L}\p{N}*-]+){0,2}?)\s+(?:consists? of|occurs? when|uses?|explores?|evaluates?|computes?|enables?|helps?|combines?|discovers?|learns?|builds?|stores?|tracks?|converts?|displays?|contains?|provides?|allows?)\b/iu;

function makeQuestion(type, fact, term, ctx) {
  const { terms, random, whole } = ctx;
  const present = termsIn(fact, terms);
  const base = { page: fact.page, source: fact.text };
  if (type === "blank" || type === "term") {
    if (!term) return null;
    let prompt;
    if (type === "term") {
      // The term opens the sentence ("X is…", "X explores…"): describe the rest.
      const m = wordRe(term).exec(fact.text);
      if (!m || m.index > 8) return null;
      const rest = fact.text
        .slice(m.index + m[0].length)
        .replace(/^[\s,:;–-]+/, "")
        .trim();
      if (words(rest) < 4) return null;
      prompt = `Which term is described here? “… ${clipAround(rest, rest.split(" ")[0], 32)}”`;
    } else prompt = `Fill in the blank: “${blankOut(clipAround(fact.text, term), term)}”`;
    const wrong = distractors(term, terms, random);
    if (wrong.length < 3) return null;
    return { ...base, type, prompt, ...choices(term, wrong, random), explain: fact.text, key: `${type}:${term}:${fact.text}` };
  }
  if (type === "tf") {
    const falseVersion = random() < 0.5 ? falsify(fact, terms, random, whole) : null;
    const statement = falseVersion ? falseVersion.text : fact.text;
    return {
      ...base,
      type,
      prompt: `True or false? “${clipAround(statement, falseVersion?.with || present[0] || "")}”`,
      options: ["True", "False"],
      answer: falseVersion ? 1 : 0,
      explain: falseVersion
        ? `False: the document says “${falseVersion.swapped}”, not “${falseVersion.with}”. ${fact.text}`
        : fact.text,
      key: `tf:${falseVersion ? falseVersion.with : "true"}:${fact.text}`,
    };
  }
  if (type === "mcq") {
    if (!term) return null;
    // Three false statements about the same term, taken from other facts.
    const wrong = [];
    for (const f of shuffle(ctx.facts.filter((f) => f !== fact && !wordRe(term).test(f.text)), random)) {
      const swap = termsIn(f, terms).find((t) => !wordRe(t).test(term) && !wordRe(term).test(t));
      if (!swap) continue;
      const changed = f.text.replace(wordRe(swap), term);
      if (whole.includes(changed.toLowerCase())) continue;
      wrong.push(clipAround(changed, term, 30));
      if (wrong.length === 3) break;
    }
    if (wrong.length < 3) return null;
    return {
      ...base,
      type,
      prompt: `According to the document, which statement about “${term}” is true?`,
      ...choices(clipAround(fact.text, term, 30), wrong, random),
      explain: fact.text,
      key: `mcq:${term}:${fact.text}`,
    };
  }
  if (type === "correct") {
    const wrong = [];
    for (const f of shuffle(ctx.facts.filter((f) => f !== fact), random)) {
      const v = falsify(f, terms, random, whole);
      if (v) wrong.push(clipAround(v.text, v.with, 30));
      if (wrong.length === 3) break;
    }
    if (wrong.length < 3) return null;
    return {
      ...base,
      type,
      prompt: "Which statement is correct according to the document?",
      ...choices(clipAround(fact.text, present[0] || "", 30), wrong, random),
      explain: fact.text,
      key: `correct:${wrong.join("|")}:${fact.text}`,
    };
  }
  return null;
}
/** Matching: four terms, each with a clue from a different fact. */
function makeMatch(ctx, used) {
  const { terms, facts, random } = ctx;
  const pairs = [];
  const taken = new Set();
  for (const f of shuffle(facts, random)) {
    if ((used.get(f.text) || 0) >= 2) continue;
    const t = shuffle(termsIn(f, terms), random).find(
      (x) => !taken.has(x.toLowerCase()) && ![...taken].some((y) => y.includes(x.toLowerCase()) || x.toLowerCase().includes(y)),
    );
    if (!t) continue;
    taken.add(t.toLowerCase());
    pairs.push({ term: t, clue: clipAround(blankOut(f.text, t), "_____", 22), page: f.page, source: f.text });
    if (pairs.length === 4) break;
  }
  if (pairs.length < 4) return null;
  pairs.forEach((p) => used.set(p.source, (used.get(p.source) || 0) + 1));
  const order = shuffle(pairs.map((_, i) => i), random);
  return {
    type: "match",
    prompt: "Match each term with the sentence it completes.",
    pairs: pairs.map((p) => ({ term: p.term, page: p.page })),
    options: order.map((i) => pairs[i].clue),
    answer: pairs.map((_, i) => order.indexOf(i)),
    explain: pairs.map((p) => `${p.term}: ${p.source}`).join("\n"),
    page: pairs[0].page,
    key: `match:${pairs.map((p) => p.term).join("|")}`,
  };
}

/** Multiple choice from the question bank (question → the right answer's gist). */
function bankQuestions(bank, random) {
  const list = [2, 5, 8].flatMap((m) => bank?.[m] || []).filter((q) => q.question && q.answer && !/```/.test(q.question));
  const gist = (md) => {
    const text = String(md).replace(/```[\s\S]*?```/g, " ").replace(/[*_`>#|-]/g, " ").replace(/\s+/g, " ").trim();
    const first = text.match(/[^.!?]+[.!?]/)?.[0] || text;
    return first.length > 170 ? first.slice(0, 167) + "…" : first.trim();
  };
  const items = list.map((q) => ({ q, g: gist(q.answer) })).filter((x) => x.g.length > 10);
  if (items.length < 4) return [];
  return shuffle(items, random).map(({ q, g }) => {
    const wrong = shuffle(items.filter((x) => x.g !== g), random).slice(0, 3).map((x) => x.g);
    return {
      type: "mcq",
      prompt: String(q.question).replace(/[*_`]/g, ""),
      ...choices(g, wrong, random),
      explain: String(q.answer).replace(/[*_`]/g, "").slice(0, 400),
      page: Number.isInteger(q.page) ? q.page : null,
      key: `bank:${q.question}`,
    };
  });
}

/**
 * Three sets of up to 30 questions (5 per format). `avoid` holds keys of
 * questions already seen, so a refresh prefers new material.
 */
export function buildQuizSets(doc, { seed = 1, bank = null, avoid = new Set(), sets = SET_COUNT } = {}) {
  const random = rng(seed);
  const { facts, terms } = quizMaterial(doc);
  const whole = (doc.pages || []).join("\n").toLowerCase();
  const ctx = { facts, terms, random, whole };
  const need = PER_TYPE * sets;
  const pools = {};
  const used = new Set();
  const fresh = (q) => q && !used.has(q.key) && (used.add(q.key), true);
  for (const [type] of QUIZ_TYPES) {
    const pool = [];
    if (type === "mcq") pool.push(...bankQuestions(bank, random).filter(fresh));
    if (type === "match") {
      const matchUsed = new Map();
      for (let i = 0; i < need * 2 && pool.length < need * 2; i++) {
        const q = makeMatch(ctx, matchUsed);
        if (!q) break;
        if (fresh(q)) pool.push(q);
      }
    } else {
      // Every (sentence, term) pair can become a question, so even short
      // documents give many different ones.
      const pairs = shuffle(
        facts.flatMap((f) => {
          const inFact = termsIn(f, terms);
          return type === "tf" || type === "correct"
            ? [[f, inFact[0] || ""], [f, inFact[0] || ""]]
            : inFact.map((t) => [f, t]);
        }),
        random,
      );
      const perFact = new Map();
      for (const [f, t] of pairs) {
        if (pool.length >= need * 2) break;
        // Spread questions over the document: at most 2 per sentence per format.
        if ((perFact.get(f) || 0) >= 2) continue;
        const q = makeQuestion(type, f, t, ctx);
        if (fresh(q)) {
          pool.push(q);
          perFact.set(f, (perFact.get(f) || 0) + 1);
        }
      }
    }
    // Unseen questions first.
    pools[type] = [...pool.filter((q) => !avoid.has(q.key)), ...pool.filter((q) => avoid.has(q.key))];
  }
  const out = [];
  for (let s = 0; s < sets; s++) {
    const set = [];
    for (const [type] of QUIZ_TYPES) set.push(...pools[type].splice(0, PER_TYPE));
    // Fill gaps (a format with too little material) from what is left.
    const rest = QUIZ_TYPES.flatMap(([t]) => pools[t]);
    while (set.length < SET_SIZE && rest.length) {
      const q = rest.shift();
      pools[q.type].splice(pools[q.type].indexOf(q), 1);
      set.push(q);
    }
    const order = Object.fromEntries(QUIZ_TYPES.map(([t], i) => [t, i]));
    out.push(set.sort((a, b) => order[a.type] - order[b.type]).map((q, i) => ({ ...q, id: `${seed}-${s}-${i}` })));
  }
  return out;
}

/** Points for one answer: 1, 0, or a fraction of matching pairs. */
export function grade(q, response) {
  if (response == null) return 0;
  if (q.type === "match")
    return q.answer.filter((a, i) => response[i] === a).length / q.answer.length;
  return response === q.answer ? 1 : 0;
}

// ---- Gemini: a set of 30 written from the document text -----------------------
// Real JSON examples (models copy the style of the example they are shown).
const SHAPES = {
  mcq: '{"type":"mcq","prompt":"question","options":["a","b","c","d"],"answer":0,"explain":"quote","page":1}',
  blank:
    '{"type":"blank","prompt":"a sentence from the document with the missing term as _____","options":["term","term","term","term"],"answer":2,"explain":"quote","page":1}',
  tf: '{"type":"tf","prompt":"a statement","answer":true,"explain":"quote","page":1}',
  match:
    '{"type":"match","pairs":[{"term":"t1","clue":"c1"},{"term":"t2","clue":"c2"},{"term":"t3","clue":"c3"},{"term":"t4","clue":"c4"}],"explain":"quote","page":1}',
  term: '{"type":"term","prompt":"a description from the document","options":["term","term","term","term"],"answer":1,"explain":"quote","page":1}',
  correct:
    '{"type":"correct","options":["statement","statement","statement","statement"],"answer":3,"explain":"quote","page":1}',
};
// Three small requests run in parallel: much faster than one big one.
const GEMINI_PARTS = [
  ["mcq", "blank"],
  ["tf", "match"],
  ["term", "correct"],
];
const GEMINI_TIME_LIMIT = 60_000;

async function geminiPart(doc, types, text, avoid, signal) {
  const data = await geminiJSON(
    [
      {
        role: "system",
        content:
          "You write exam quiz questions for a student using ONLY the document below. Every question, option and " +
          "answer must come from the document text; never use outside knowledge. Wrong options must be plausible " +
          "and use the document's own terms. Cover different parts of the document. " +
          `Return valid JSON {"questions":[...]} with exactly 5 questions of each of these types, shaped like: ${types
            .map((t) => SHAPES[t])
            .join(" and ")}. Vary which option is correct. page is the 1-based page the answer comes from; explain quotes the document.`,
      },
      {
        role: "user",
        content:
          `Document "${doc.name}":\n${text}` +
          (avoid.length
            ? `\n\nDo not repeat these questions:\n${avoid
                .slice(-40)
                .map((p) => `- ${p}`)
                .join("\n")}`
            : ""),
      },
    ],
    { maxTokens: 3500, signal },
  );
  return normalizeGemini(data?.questions, doc).filter((q) =>
    types.includes(q.type),
  );
}

/**
 * Up to 30 questions written by Gemini from the document, in at most a
 * minute: parts that are not back in time are left out (the caller tops the
 * set up with built-in questions).
 */
export async function geminiQuizSet(doc, { avoid = [], signal } = {}) {
  const text = (doc.pages || [])
    .map((p, i) => (p.trim() ? `[p. ${i + 1}]\n${p.trim()}` : ""))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 60000);
  const controller = new AbortController();
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  const timer = setTimeout(() => controller.abort(), GEMINI_TIME_LIMIT);
  try {
    const parts = await Promise.allSettled(
      GEMINI_PARTS.map((types) =>
        geminiPart(doc, types, text, avoid, controller.signal),
      ),
    );
    if (signal?.aborted) {
      const error = new Error("Cancelled.");
      error.name = "AbortError";
      throw error;
    }
    const questions = parts.flatMap((p) =>
      p.status === "fulfilled" ? p.value : [],
    );
    if (!questions.length) {
      const failure = parts.find((p) => p.status === "rejected")?.reason;
      throw new Error(
        failure?.message && failure.name !== "AbortError"
          ? failure.message
          : "Gemini took too long to write the quiz.",
      );
    }
    return questions;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeGemini(list, doc) {
  const whole = (doc.pages || []).join("\n").toLowerCase();
  const flat = whole.replace(/\s+/g, " ");
  // A term counts as "from the document" when its main name appears there
  // ("PyCharm" for "PyCharm (Community Edition)", even across table lines),
  // or when nearly all of its words do.
  const inDoc = (t) => {
    const term = String(t).toLowerCase().trim();
    if (!term) return false;
    if (flat.includes(term.replace(/\s+/g, " "))) return true;
    const core = term.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    if (core.length >= 2 && flat.includes(core)) return true;
    const parts = term.match(/[\p{L}\p{N}.+#]{3,}/gu) || [];
    return parts.length > 0 && parts.filter((w) => flat.includes(w)).length / parts.length >= 0.75;
  };
  const pageOf = (p) => Math.max(0, Math.min((doc.pages?.length || 1) - 1, (Number(p) || 1) - 1));
  const out = [];
  for (const q of Array.isArray(list) ? list : []) {
    const type = q?.type;
    if (!QUIZ_TYPE_LABEL[type]) continue;
    const explain = String(q.explain || "");
    const page = pageOf(q.page);
    if (type === "tf") {
      if (typeof q.answer !== "boolean" || !q.prompt) continue;
      out.push({ type, prompt: `True or false? “${q.prompt}”`, options: ["True", "False"], answer: q.answer ? 0 : 1, explain, page });
    } else if (type === "match") {
      const pairs = (q.pairs || []).filter((p) => p?.term && p?.clue).slice(0, 4);
      if (pairs.length < 3 || !pairs.every((p) => inDoc(p.term))) continue;
      const order = shuffle(
        pairs.map((_, i) => i),
        rng(seedFrom(pairs.map((p) => p.term).join("|"))),
      );
      out.push({
        type,
        prompt: "Match each term with its description.",
        pairs: pairs.map((p) => ({ term: String(p.term) })),
        options: order.map((i) => String(pairs[i].clue)),
        answer: pairs.map((_, i) => order.indexOf(i)),
        explain,
        page,
      });
    } else {
      const options = (q.options || []).map(String);
      const answer = Number(q.answer);
      if (options.length !== 4 || !(answer >= 0 && answer <= 3) || new Set(options).size !== 4) continue;
      // Term answers must literally appear in the document.
      if ((type === "blank" || type === "term") && !inDoc(options[answer])) continue;
      const prompt =
        type === "correct"
          ? "Which statement is correct according to the document?"
          : type === "blank"
            ? `Fill in the blank: “${String(q.prompt || "").replace(/^Fill in the blank:\s*/i, "")}”`
            : type === "term"
              ? `Which term is described here? “${String(q.prompt || "")}”`
              : String(q.prompt || "");
      if (!prompt) continue;
      out.push({ type, prompt, options, answer, explain, page });
    }
  }
  return out.map((q, i) => ({ ...q, key: `gemini:${q.prompt}:${q.options?.join("|")}`, id: `g-${Date.now()}-${i}` }));
}

/** Flashcards from the document when there is no question bank yet. */
export function termFlashcards(doc, limit = 40) {
  const { facts, terms } = quizMaterial(doc);
  const cards = [];
  const used = new Set();
  for (const term of terms) {
    const fact = facts.find((f) => !used.has(f) && wordRe(term).test(f.text));
    if (!fact) continue;
    used.add(fact);
    cards.push({
      prompt: `What does the document say about “${term}”?`,
      answer: fact.text,
      page: fact.page,
    });
    if (cards.length >= limit) break;
  }
  return cards;
}

/**
 * Tops up a thin question bank (table-style PDFs have few full sentences)
 * with 2-mark "What is X?" questions about the document's key terms.
 */
export function withTermQuestions(bank, doc, target = 10) {
  const have = bank[2].length;
  if (have >= target) return bank;
  const { facts, terms } = quizMaterial(doc);
  const asked = new Set(
    [2, 5, 8].flatMap((m) => bank[m].map((q) => q.question.toLowerCase())),
  );
  const extra = [];
  const used = new Set();
  for (const term of terms) {
    if (have + extra.length >= target) break;
    if ([...asked].some((q) => q.includes(term.toLowerCase()))) continue;
    const fact = facts.find((f) => !used.has(f) && wordRe(term).test(f.text));
    if (!fact) continue;
    used.add(fact);
    extra.push({
      type: "Definition",
      question: `What is ${term} according to the document?`,
      answer: `${fact.text.replace(wordRe(term), `**${term}**`)}\n\n*(p. ${fact.page + 1})*`,
      trick: "",
      page: fact.page,
      weight: 1,
    });
  }
  return extra.length ? { ...bank, 2: [...bank[2], ...extra] } : bank;
}
