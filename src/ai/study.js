// Detailed notes and mark-wise question banks (2 / 5 / 8 marks).
// Two builders for each: an instant one assembled only from the document's own
// sentences (nothing invented), and a Gemini/LLM one that writes full,
// exam-style explanations with headings, figures and code blocks.
import {
  STOP_WORDS,
  contentTerms,
  extractKeywords,
  splitSentences,
  summarizeExtractive,
} from "./text";
import { contextBudget, generate } from "./engine";
import { geminiAvailable, geminiJSON, imagePart } from "./gemini";

export const MARKS = [2, 5, 8];

// ---- Structure detection -----------------------------------------------------
const CODE_LINE =
  /[{};]\s*$|^\s*(def |class |import |from \S+ import|return\b|if\s*\(|for\s*\(|while\s*\(|function\b|const |let |var |public |private |static |#include|int |void |printf|print\(|console\.|System\.out|SELECT\b|INSERT\b|UPDATE\b|CREATE TABLE|<\/?[a-z][\w-]*[^>]*>)|^\s*(for|while|if|elif|else|try|except|with)\b[^.]*:\s*$|^\s*[\w.[\]]+\s*[-+*/]?=\s*[^=\s]|=>|==|\+\+|\w+\(\)\s*[:{]/;
// A full prose sentence ("The model is trained on data.") ends code blocks.
const PROSE = /^[\p{Lu}"'(][^{};=]*[.!?]["')]?$/u;

export function detectLanguage(code) {
  if (/#include|printf|scanf|std::|cout/.test(code))
    return /std::|cout|cin/.test(code) ? "cpp" : "c";
  if (/System\.out|public (static )?(class|void)|import java\./.test(code))
    return "java";
  if (/\bdef |\bprint\(|import \w+$|elif |self\.|:\s*$/m.test(code))
    return "python";
  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/.test(code)) return "sql";
  if (/<\/?(div|html|body|p|span|head)[\s>]/.test(code)) return "html";
  if (/console\.|=>|\bconst |\blet |function\b|document\./.test(code))
    return "javascript";
  return "";
}

export const isHeading = (line) => {
  const t = line.trim();
  const words = t.split(/\s+/);
  const capitalised = words.filter((w) => /^[\p{Lu}\d]/u.test(w)).length;
  return (
    t.length > 2 &&
    words.length <= 9 &&
    !/[.,;:!?)]$/.test(t) &&
    /^[\p{Lu}\d]/u.test(t) &&
    !CODE_LINE.test(t) &&
    /\p{L}{3}/u.test(t) &&
    // Short, or mostly Title Case: avoids treating a wrapped sentence as a heading.
    (words.length <= 4 || capitalised / words.length >= 0.6)
  );
};

/**
 * Parses one page line by line (PDF text rarely has blank lines between
 * paragraphs) into heading / paragraph / code blocks.
 */
export function parseBlocks(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let para = [],
    code = [];
  const flushPara = () => {
    if (para.length)
      blocks.push({
        type: "p",
        text: para.join(" ").replace(/\s+/g, " ").trim(),
      });
    para = [];
  };
  const flushCode = () => {
    while (code.length && !code.at(-1).trim()) code.pop();
    if (code.length >= 2) blocks.push({ type: "code", text: code.join("\n") });
    else if (code.length) para.push(code[0].trim());
    code = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (!line.trim()) {
      if (code.length && next && CODE_LINE.test(next))
        return void code.push("");
      flushCode();
      return flushPara();
    }
    const looksCode = CODE_LINE.test(line);
    if (
      looksCode ||
      (code.length && !PROSE.test(line.trim()) && !isHeading(line))
    ) {
      flushPara();
      return void code.push(line);
    }
    flushCode();
    const endsSentence = !para.length || /[.!?:]["')]?$/.test(para.at(-1));
    if (isHeading(line) && next && endsSentence) {
      flushPara();
      return void blocks.push({ type: "heading", text: line.trim() });
    }
    para.push(line.trim());
  });
  flushCode();
  flushPara();
  return blocks;
}

/**
 * Splits pages into sections: { title, page, blocks: [{type:"p"|"code"|"sub", text}] }.
 * The first heading on a page starts a section; later ones become sub-headings.
 */
export function sections(pages) {
  const out = [];
  let current = null;
  pages.forEach((text, page) => {
    parseBlocks(text).forEach((b, bi) => {
      if (b.type === "heading") {
        if (bi === 0 || !current || !current.blocks.length) {
          current = { title: b.text, page, blocks: [] };
          out.push(current);
        } else current.blocks.push({ type: "sub", text: b.text, page });
        return;
      }
      if (!current) {
        current = { title: `Page ${page + 1}`, page, blocks: [] };
        out.push(current);
      }
      current.blocks.push({
        ...b,
        page,
        ...(b.type === "code" ? { lang: detectLanguage(b.text) } : {}),
      });
    });
  });
  return out.filter((s) => s.blocks.length);
}

/** Page texts as prose only (no headings or code), for summaries. */
const prosePages = (pages) =>
  pages.map((t) =>
    parseBlocks(t)
      .filter((b) => b.type === "p")
      .map((b) => b.text)
      .join("\n\n"),
  );
const sectionText = (s) =>
  s.blocks
    .filter((b) => b.type === "p")
    .map((b) => b.text)
    .join(" ");
const pageRef = (p) => `*(p. ${p + 1})*`;
const figure = (img) =>
  `![Figure from page ${img.page + 1}${img.caption ? `: ${img.caption}` : ""}](image:${img.id})`;

function blocksToMarkdown(blocks) {
  return blocks
    .map((b) =>
      b.type === "code"
        ? "```" + b.lang + "\n" + b.text + "\n```"
        : b.type === "sub"
          ? `#### ${b.text}`
          : b.text,
    )
    .join("\n\n");
}

// ---- Section titles ---------------------------------------------------------
const SMALL_WORDS = new Set(
  "a an and as at by for from in into of on or the to with".split(" "),
);
/** "MULTIMEDIA IN HTML5" → "Multimedia in HTML5" (keeps acronyms). */
export function tidyTitle(line) {
  if (line !== line.toUpperCase()) return line;
  return line
    .split(/\s+/)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      if (/\d/.test(w) || (w.length <= 4 && /^[A-Z]+$/.test(w) && i > 0))
        return w; // HTML5, AVI, CSS
      return i === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}
/**
 * The heading of a page: a short line that isn't a sentence. Lines written in
 * CAPITALS or ending with ":" (typical lecture headers) win over the first
 * short line.
 */
export function headingOf(text) {
  const candidates = [];
  for (const raw of String(text || "").split("\n").slice(0, 25)) {
    const colon = /:\s*$/.test(raw);
    const line = raw
      .replace(/^[\s\d.)•*#-]+/, "")
      .replace(/[\s:–-]+$/, "")
      .trim();
    const n = line.split(/\s+/).filter(Boolean).length;
    if (
      n >= 2 &&
      n <= 8 &&
      line.length <= 60 &&
      !/[.,;!?]$/.test(line) &&
      !/[()<>{}=]/.test(line) &&
      /[A-Za-z]{3}/.test(line) &&
      !/^studymind\b/i.test(line)
    )
      candidates.push({
        line,
        strong: colon || line === line.toUpperCase(),
      });
  }
  const best = candidates.find((c) => c.strong) || candidates[0];
  return best ? tidyTitle(best.line) : "";
}
/** A section's title; untitled "Page N" sections use the page's heading. */
const sectionTitle = (s, pages) =>
  /^Page \d+$/.test(s.title) ? headingOf(pages[s.page]) || s.title : s.title;
// Filler subjects never make good questions ("do not…", "it…", "this…").
const WEAK_SUBJECT =
  /^(do|does|did|not|don't|it|its|this|that|these|those|they|there|here|which|we|you|i|he|she|please|kindly|also)\b/i;

// ---- Emphasis and memory tricks ---------------------------------------------
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Bold (rendered as highlighted, underlined text) the first mention of each term. */
function emphasise(text, terms) {
  let out = text;
  for (const term of terms) {
    if (term.length < 4) continue;
    const re = new RegExp(
      `(^|[^*\\p{L}])(${escapeRe(term)})(?=[^*\\p{L}]|$)`,
      "iu",
    );
    if (!out.includes(`**${term}`)) out = out.replace(re, "$1**$2**");
  }
  return out;
}
export const GENERIC = new Set(
  (
    "system systems process method methods thing things way ways type types part parts example examples following used using result results data " +
    "consists consist occurs occur refers refer reduces reduce uses use helps help address enables enable applies apply passes pass computes compute " +
    "updates update explores explore evaluates evaluate learns provides provide makes make gives give takes take describes describe means mean " +
    "includes include contains contain another called known study subset based allows allow shows show given found"
  ).split(" "),
);
/** The most telling word of a phrase: its rarest content word. */
function keyWord(text, freq, used = new Set()) {
  const terms = contentTerms(text).filter(
    (t) => t.length > 2 && !GENERIC.has(t) && !used.has(t),
  );
  if (!terms.length) return "";
  return terms.reduce((best, t) =>
    (freq.get(t) || 0) > (freq.get(best) || 0) || best === "" ? t : best,
  );
}
const capWord = (w) => w.charAt(0).toLocaleUpperCase() + w.slice(1);
/** Acronym trick from 2–7 items, or a keyword chain otherwise. */
export function memoryTrick(items, freq = new Map()) {
  const used = new Set();
  const words = items
    .map((i) => {
      const w = keyWord(i, freq, used);
      if (w) used.add(w);
      return w;
    })
    .filter(Boolean);
  if (words.length >= 2 && words.length <= 7) {
    const letters = words.map((w) => w[0].toLocaleUpperCase()).join("");
    return `Remember **${letters}** → ${words
      .map((w) => `**${w[0].toLocaleUpperCase()}**${w.slice(1)}`)
      .join(" · ")}`;
  }
  return words.length
    ? `Key words: ${words
        .slice(0, 5)
        .map((w) => `**${capWord(w)}**`)
        .join(" → ")}`
    : "";
}
function definitionTrick(term, sentence, freq) {
  const skip = new Set(contentTerms(term));
  const keys = [];
  for (const t of contentTerms(sentence))
    if (!skip.has(t) && !GENERIC.has(t) && t.length > 3 && !keys.includes(t))
      keys.push(t);
  const top = keys
    .sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0))
    .slice(0, 3);
  // keep the original reading order so the chain reads naturally
  top.sort(
    (a, b) =>
      sentence.toLocaleLowerCase().indexOf(a) -
      sentence.toLocaleLowerCase().indexOf(b),
  );
  return top.length
    ? `Think: **${capWord(term)}** = ${top.map((t) => `**${t}**`).join(" + ")}`
    : "";
}
/** Terms worth highlighting: defined subjects and multi-word key phrases. */
function keyTerms(prose) {
  const out = [];
  for (const sentence of prose.flatMap((t) => splitSentences(t))) {
    const m = SUBJECT.exec(sentence);
    if (
      m &&
      m[1].length > 3 &&
      !/^(it|this|that|these|they|there|here|which)$/i.test(m[1])
    )
      out.push(m[1].toLocaleLowerCase());
  }
  for (const k of extractKeywords(prose.join("\n"), 16))
    if (k.includes(" ") || k.length >= 9) out.push(k);
  return [...new Set(out)].filter((t) => !GENERIC.has(t)).slice(0, 20);
}
function termFrequency(pages) {
  const freq = new Map();
  for (const t of contentTerms(pages.join("\n")))
    freq.set(t, (freq.get(t) || 0) + 1);
  return freq;
}
const mentions = (text, term) =>
  (
    text
      .toLocaleLowerCase()
      .match(new RegExp(escapeRe(term.toLocaleLowerCase()), "g")) || []
  ).length;

// ---- Instant (extractive) builders -----------------------------------------
/**
 * Easy-to-revise notes: each topic gets an "In short" line, bullet key points
 * with highlighted terms, the full details, figures, and a memory trick.
 */
export function buildNotes(doc, images = []) {
  const secs = sections(doc.pages).map((s) => ({
    ...s,
    title: sectionTitle(s, doc.pages),
  }));
  const prose = prosePages(doc.pages);
  const freq = termFrequency(prose);
  const terms = keyTerms(prose);
  const overview = summarizeExtractive(prose, { sentences: 3 });
  const used = new Set();
  const md = [`# ${doc.name}`];
  if (overview.length)
    md.push(
      `> **Overview.** ${emphasise(overview.map((s) => s.text).join(" "), terms)}`,
    );
  if (secs.length > 2)
    md.push(
      "## Contents\n" +
        secs
          .map((s, i) => `${i + 1}. ${s.title} ${pageRef(s.page)}`)
          .join("\n"),
    );
  secs.forEach((s, n) => {
    const lastPage = Math.max(...s.blocks.map((b) => b.page));
    const text = sectionText(s);
    const key = summarizeExtractive([text], { sentences: 4 });
    // The topic sentence (the first full sentence) says what the section is about.
    const short = splitSentences(text).find((x) => x.split(" ").length >= 6);
    md.push(
      `## ${n + 1}. ${s.title}\n*${lastPage > s.page ? `Pages ${s.page + 1}–${lastPage + 1}` : `Page ${s.page + 1}`}*`,
    );
    if (short) md.push(`> **In short:** ${emphasise(short, terms)}`);
    if (key.length > 1)
      md.push(
        "### Key points\n\n" +
          key.map((k) => `- ${emphasise(k.text, terms)}`).join("\n"),
      );
    md.push("### In detail\n\n" + blocksToMarkdown(s.blocks));
    for (const img of images)
      if (img.page >= s.page && img.page <= lastPage && !used.has(img.id)) {
        used.add(img.id);
        md.push(figure(img));
      }
    const trick = memoryTrick(
      key.length > 1 ? key.map((k) => k.text) : [text],
      freq,
    );
    if (trick) md.push(`> 🧠 **Remember:** ${trick}`);
  });
  const leftovers = images.filter((i) => !used.has(i.id));
  if (leftovers.length)
    md.push("## Figures\n\n" + leftovers.map(figure).join("\n\n"));
  if (terms.length)
    md.push(
      "## Key terms\n\n| Term | First appears |\n| --- | --- |\n" +
        terms
          .slice(0, 10)
          .map((t) => {
            const p = doc.pages.findIndex((x) =>
              x.toLocaleLowerCase().includes(t),
            );
            return `| **${t}** | ${p >= 0 ? `p. ${p + 1}` : "—"} |`;
          })
          .join("\n"),
    );
  const revision = summarizeExtractive(prose, { sentences: 6 });
  if (revision.length > 2)
    md.push(
      "## Quick revision\n\n" +
        revision
          .map((r) => `- ${emphasise(r.text, terms)} ${pageRef(r.page)}`)
          .join("\n"),
    );
  return md.join("\n\n");
}

const DEFINITION =
  /\b(is|are|refers to|means|is defined as|consists of|describes|occurs when|stands for)\b/i;
// "A neural network consists of…" → "neural network"
const SUBJECT =
  /^(?:(?:an?|the)\s+)?([\p{L}][\p{L}\p{N}*-]*(?:\s+[\p{L}\p{N}*-]+){0,3}?)\s+(?:is|are|refers to|means|is defined as|consists of|occurs when|stands for)\b/iu;
const LIST =
  /^(?:(?:an?|the)\s+)?([\p{L}][\p{L}\p{N}*-]*(?:\s+[\p{L}\p{N}*-]+){0,3}?)\s+(?:consists of|includes?|contains?|has|have|involves?|comprises?)\s+(.+)$/iu;
const PURPOSE =
  /^(?:(?:an?|the)\s+)?([\p{L}][\p{L}\p{N}*-]*(?:\s+[\p{L}\p{N}*-]+){0,4}?)\s+(?:is used to|are used to|helps?|enables?|allows?|lets?|ensures?|reduces?|prevents?|improves?)\b/iu;
const ACRONYM = /\b([A-Z]{2,6})\s+stands for\s+([^.]+)/;
const cap = (t) => t.charAt(0).toLocaleUpperCase() + t.slice(1);
const tidy = (t) =>
  /^\p{Lu}{2,}/u.test(t) ? t : t.charAt(0).toLocaleLowerCase() + t.slice(1);
const listItems = (text) =>
  text
    .replace(/[.;]\s*$/, "")
    .split(/,\s*(?:and\s+|or\s+)?|\s+and\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);

// Question types shown as categories inside each marks group.
export const QUESTION_TYPES = {
  2: ["Definition", "List / State", "Full form", "Purpose", "Code"],
  5: [
    "Explain",
    "Differentiate",
    "List & explain",
    "With diagram",
    "Program / Code",
  ],
  8: [
    "Discuss in detail",
    "Compare & contrast",
    "With diagram",
    "Program / Code",
  ],
};

/**
 * Mark-wise question bank built only from the document's sentences. Every
 * question has a type (category), an importance flag and a memory trick.
 */
export function buildQuestionBank(doc, images = []) {
  const prose = prosePages(doc.pages);
  const freq = termFrequency(prose);
  const terms = keyTerms(prose);
  const whole = prose.join("\n");
  const named = sections(doc.pages).map((s) => ({
    ...s,
    title: sectionTitle(s, doc.pages),
  }));
  const secs = named.filter((s) => splitSentences(sectionText(s)).length >= 2);
  const bank = { 2: [], 5: [], 8: [] };
  const allSentences = prose.flatMap((t, page) =>
    splitSentences(t).map((s) => ({ s, page })),
  );
  const seen = new Set(),
    usedSentences = new Set();
  const add = (marks, q) => {
    const key = q.question.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    bank[marks].push(q);
    return true;
  };

  // ---- 2 marks ----
  const definitions = [];
  for (const hit of allSentences) {
    if (bank[2].length >= 16) break;
    const acr = ACRONYM.exec(hit.s);
    if (acr) {
      const items = listItems(acr[2]);
      add(2, {
        type: "Full form",
        question: `What does ${acr[1]} stand for?`,
        answer: `**${acr[1]}** stands for ${emphasise(acr[2], items)}.\n\n${items.map((i) => `- **${cap(i)}**`).join("\n")}\n\n${pageRef(hit.page)}`,
        trick: `The letters spell it: ${items.map((i) => `**${i[0].toLocaleUpperCase()}**${i.slice(1)}`).join(" · ")}`,
        page: hit.page,
        weight: mentions(whole, acr[1]),
      });
      usedSentences.add(hit);
      continue;
    }
    const list = LIST.exec(hit.s);
    if (
      list &&
      /,/.test(list[2]) &&
      !WEAK_SUBJECT.test(list[1])
    ) {
      const subject = tidy(list[1]);
      const items = listItems(list[2]);
      if (items.length >= 3 && items.length <= 8) {
        add(2, {
          type: "List / State",
          question: `List the components of ${/^an?\s/i.test(hit.s) ? "a " : ""}${subject}.`,
          answer: `${emphasise(hit.s, [subject])}\n\n${items.map((i) => `- ${cap(i)}`).join("\n")}\n\n${pageRef(hit.page)}`,
          trick: memoryTrick(items, freq),
          page: hit.page,
          weight: mentions(whole, subject) + items.length,
        });
        usedSentences.add(hit);
      }
    }
    const m = SUBJECT.exec(hit.s);
    if (
      m &&
      !usedSentences.has(hit) &&
      !WEAK_SUBJECT.test(m[1]) &&
      m[1].length > 3 &&
      hit.s.split(" ").length >= 6
    ) {
      const term = tidy(m[1].replace(/\s+/g, " "));
      const next = allSentences[allSentences.indexOf(hit) + 1];
      const support = next && next.page === hit.page ? next.s : "";
      if (
        add(2, {
          type: "Definition",
          question: DEFINITION.test(hit.s)
            ? `Define ${term}.`
            : `What is meant by ${term}?`,
          answer: `${emphasise(hit.s, [term])}${support ? `\n\n- ${emphasise(support, terms)}` : ""}\n\n${pageRef(hit.page)}`,
          trick:
            definitionTrick(term, hit.s, freq) ||
            definitionTrick(term, `${hit.s} ${support}`, freq) ||
            memoryTrick([hit.s, support].filter(Boolean), freq),
          page: hit.page,
          weight: mentions(whole, term),
        })
      ) {
        definitions.push({ term, hit });
        usedSentences.add(hit);
      }
    }
    const purpose = PURPOSE.exec(hit.s);
    if (
      purpose &&
      !usedSentences.has(hit) &&
      purpose[1].length > 3 &&
      !WEAK_SUBJECT.test(purpose[1])
    ) {
      const subject = tidy(purpose[1]);
      add(2, {
        type: "Purpose",
        question: `What is the role of ${subject}?`,
        answer: `${emphasise(hit.s, [subject])}\n\n${pageRef(hit.page)}`,
        trick: definitionTrick(subject, hit.s, freq),
        page: hit.page,
        weight: mentions(whole, subject),
      });
      usedSentences.add(hit);
    }
  }
  named.forEach((s) => {
    const code = s.blocks.find((b) => b.type === "code");
    if (code && code.text.split("\n").length <= 12 && bank[2].length < 18)
      add(2, {
        type: "Code",
        question: `What does the following ${code.lang ? `${code.lang} ` : ""}code do?\n\n\`\`\`${code.lang}\n${code.text}\n\`\`\``,
        answer: `${emphasise(sectionText(s) || s.title, terms)}\n\n- Topic: **${s.title}** ${pageRef(s.page)}`,
        trick: `Read it line by line: ${code.text
          .split("\n")
          .map((l) => l.trim().split(/[\s(]/)[0])
          .filter(Boolean)
          .slice(0, 5)
          .map((w) => `\`${w}\``)
          .join(" → ")}`,
        page: s.page,
        weight: 2,
      });
  });

  // ---- 5 marks ----
  for (const s of secs) {
    const text = sectionText(s);
    const intro = splitSentences(text)[0];
    const points = summarizeExtractive([text], { sentences: 6 })
      .filter((p) => p.text !== intro)
      .slice(0, 5);
    if (points.length < 2) continue;
    const code = s.blocks.find((b) => b.type === "code");
    const img = images.find((i) => i.page >= s.page && i.page <= s.page + 1);
    const body = [
      `**${s.title}** ${pageRef(s.page)}`,
      emphasise(intro, terms),
      "### Key points\n" +
        points.map((p) => `- ${emphasise(p.text, terms)}`).join("\n"),
    ];
    const trick = memoryTrick(
      points.map((p) => p.text),
      freq,
    );
    add(5, {
      type: "Explain",
      question: `Explain ${s.title} with suitable points.`,
      answer: [
        ...body,
        code ? "### Example\n```" + code.lang + "\n" + code.text + "\n```" : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      trick,
      page: s.page,
      weight: text.length / 50 + mentions(whole, s.title),
    });
    if (img)
      add(5, {
        type: "With diagram",
        question: `Explain ${s.title} with a neat diagram.`,
        answer: [...body.slice(0, 2), "### Diagram", figure(img), body[2]].join(
          "\n\n",
        ),
        trick,
        page: s.page,
        weight: text.length / 60,
      });
    if (code)
      add(5, {
        type: "Program / Code",
        question: `Write and explain a program for ${s.title.toLocaleLowerCase()}.`,
        answer: [
          `### Program`,
          "```" + code.lang + "\n" + code.text + "\n```",
          "### Explanation",
          ...splitSentences(text).map((x) => `- ${emphasise(x, terms)}`),
          pageRef(s.page),
        ].join("\n\n"),
        trick: `Structure: **Input → Loop → Compute → Return**`,
        page: s.page,
        weight: 3,
      });
  }
  // Differentiate: two terms that are each the subject of their own sentence
  // or clause and share a head word ("supervised learning" / "unsupervised
  // learning", "breadth-first search" / "depth-first search"), or two terms
  // defined on the same page.
  const clauses = allSentences.flatMap((x) =>
    x.s
      .split(/;\s*/)
      .map((c) => ({ c: c.replace(/^(?:an?|the)\s+/i, ""), hit: x })),
  );
  const subjects = new Map();
  for (const { c, hit } of clauses) {
    const m =
      /^([\p{L}-]{3,}\s[\p{L}]{3,})\s+(?:is|are|uses?|explores?|evaluates?|discovers?|computes?|updates?|predicts?|stores?|consists?|makes?|finds?|returns?|takes?|works?)\b/iu.exec(
        c,
      );
    if (
      m &&
      !m[1].split(" ").some((w) => STOP_WORDS.has(w.toLocaleLowerCase()))
    )
      subjects.set(m[1].toLocaleLowerCase(), { s: c, page: hit.page });
  }
  const pairs = [];
  const heads = new Map();
  for (const term of subjects.keys()) {
    const head = term.split(" ")[1];
    heads.set(head, [...(heads.get(head) || []), term]);
  }
  for (const group of heads.values())
    for (let i = 0; i + 1 < group.length; i++)
      pairs.push([group[i], group[i + 1]]);
  // Definitions on the same page are only compared when their descriptions
  // share ideas (e.g. precision / recall are both "the fraction of positive…").
  const stems = (x) =>
    new Set(
      contentTerms(x)
        .filter((t) => t.length > 3 && !GENERIC.has(t))
        .map((t) => t.slice(0, 5)),
    );
  for (let i = 0; i + 1 < definitions.length; i++) {
    const [a, b] = [definitions[i], definitions[i + 1]];
    const shared = [...stems(a.hit.s)].filter((t) =>
      stems(b.hit.s).has(t),
    ).length;
    if (a.hit.page === b.hit.page && shared >= 2) pairs.push([a.term, b.term]);
  }
  const sentenceFor = (term) =>
    subjects.get(term.toLocaleLowerCase()) ||
    (() => {
      const d = definitions.find((x) => x.term === term);
      return d && { s: d.hit.s, page: d.hit.page };
    })();
  for (const [a, b] of pairs) {
    if (bank[5].length >= 14) break;
    const sa = sentenceFor(a),
      sb = sentenceFor(b);
    if (!sa || !sb || sa.s === sb.s) continue;
    // Trick: the word that differs between the two descriptions.
    const distinct = (x, y, term) =>
      contentTerms(x).filter(
        (t) =>
          t.length > 3 &&
          !contentTerms(y).includes(t) &&
          !GENERIC.has(t) &&
          !contentTerms(term).includes(t),
      );
    const wa = distinct(sa.s, sb.s, a),
      wb = distinct(sb.s, sa.s, b);
    add(5, {
      type: "Differentiate",
      question: `Differentiate between ${a} and ${b}.`,
      answer: [
        `| Point | ${cap(a)} | ${cap(b)} |`,
        "| --- | --- | --- |",
        `| Meaning | ${cap(sa.s).replace(/\|/g, "/")} | ${cap(sb.s).replace(/\|/g, "/")} |`,
        `| Key idea | ${wa[0] || "—"} | ${wb[0] || "—"} |`,
        `| Page | p. ${sa.page + 1} | p. ${sb.page + 1} |`,
        "",
        `- **${cap(a)}:** ${emphasise(cap(sa.s), terms)}`,
        `- **${cap(b)}:** ${emphasise(cap(sb.s), terms)}`,
      ].join("\n"),
      trick:
        wa[0] && wb[0]
          ? `${cap(a)} → **${wa[0]}**, ${b} → **${wb[0]}**`
          : `Picture a two-column table: **${a}** | **${b}**`,
      page: sa.page,
      weight: mentions(whole, a) + mentions(whole, b),
    });
  }
  // List & explain: from list sentences with enough context.
  for (const q of bank[2].filter((x) => x.type === "List / State")) {
    const subject = q.question
      .replace(/^List the components of (a )?/, "")
      .replace(/\.$/, "");
    const related = allSentences
      .filter((x) => x.page === q.page && !q.answer.includes(x.s))
      .slice(0, 4);
    if (related.length < 2) continue;
    add(5, {
      type: "List & explain",
      question: `List and explain the components of ${subject}.`,
      answer: [
        q.answer.replace(/\n\n\*\(p\.[^)]*\)\*$/, ""),
        "### Explanation",
        ...related.map((r) => `- ${emphasise(r.s, terms)}`),
        pageRef(q.page),
      ].join("\n\n"),
      trick: q.trick,
      page: q.page,
      weight: q.weight + 2,
    });
  }

  // ---- 8 marks ----
  const big = [...secs].sort(
    (a, b) => sectionText(b).length - sectionText(a).length,
  );
  const detail = (s) =>
    `### ${cap(s.title)} ${pageRef(s.page)}\n\n` +
    summarizeExtractive([sectionText(s)], { sentences: 5 })
      .map((k) => `- ${emphasise(k.text, terms)}`)
      .join("\n") +
    "\n\n" +
    blocksToMarkdown(s.blocks.filter((b) => b.type !== "p")) +
    images
      .filter((img) => img.page === s.page)
      .slice(0, 1)
      .map((img) => `\n\n${figure(img)}`)
      .join("");
  for (let i = 0; i < big.length && bank[8].length < 8; i++) {
    const a = big[i],
      b = secs[secs.indexOf(a) + 1];
    const group = b && sectionText(a).length < 900 ? [a, b] : [a];
    const all = group.map(sectionText).join(" ");
    const intro = splitSentences(sectionText(group[0]))[0];
    const conclusion = summarizeExtractive([all], { sentences: 4 })
      .filter((c) => c.text !== intro)
      .slice(-2);
    const keyPoints = summarizeExtractive([all], { sentences: 6 }).map(
      (k) => k.text,
    );
    add(8, {
      type: images.some((img) => group.some((s) => img.page === s.page))
        ? "With diagram"
        : group.some((s) => s.blocks.some((x) => x.type === "code"))
          ? "Program / Code"
          : "Discuss in detail",
      question:
        group.length > 1
          ? `Discuss ${group[0].title} and ${group[1].title} in detail.`
          : `Discuss ${group[0].title} in detail.`,
      answer: [
        `## Introduction\n\n${emphasise(intro, terms)}`,
        group.map(detail).join("\n\n"),
        `## Conclusion\n\n${conclusion.map((c) => emphasise(c.text, terms)).join(" ")}`,
      ].join("\n\n"),
      trick: memoryTrick(keyPoints, freq),
      page: group[0].page,
      weight: all.length / 40,
    });
    if (group.length > 1) i++;
  }
  for (let i = 0; i + 1 < secs.length && bank[8].length < 10; i += 2) {
    const [a, b] = [secs[i], secs[i + 1]];
    const pa = summarizeExtractive([sectionText(a)], { sentences: 3 }).map(
      (x) => x.text,
    );
    const pb = summarizeExtractive([sectionText(b)], { sentences: 3 }).map(
      (x) => x.text,
    );
    const rows = Math.max(pa.length, pb.length);
    add(8, {
      type: "Compare & contrast",
      question: `Compare and contrast ${a.title} and ${b.title}.`,
      answer: [
        `## Introduction\n\n${emphasise(splitSentences(sectionText(a))[0], terms)} ${emphasise(splitSentences(sectionText(b))[0], terms)}`,
        `## Comparison\n\n| # | ${a.title} | ${b.title} |\n| --- | --- | --- |\n` +
          Array.from(
            { length: rows },
            (_, r) =>
              `| ${r + 1} | ${(pa[r] || "—").replace(/\|/g, "/")} | ${(pb[r] || "—").replace(/\|/g, "/")} |`,
          ).join("\n"),
        `### ${a.title}\n\n${pa.map((x) => `- ${emphasise(x, terms)}`).join("\n")}`,
        `### ${b.title}\n\n${pb.map((x) => `- ${emphasise(x, terms)}`).join("\n")}`,
        `## Conclusion\n\nBoth topics are covered on ${a.page === b.page ? `page ${a.page + 1}` : `pages ${a.page + 1} and ${b.page + 1}`}; revise them together.`,
      ].join("\n\n"),
      trick: `Two columns: **${keyWord(sectionText(a), freq) || a.title}** | **${keyWord(sectionText(b), freq) || b.title}**`,
      page: a.page,
      weight: (sectionText(a).length + sectionText(b).length) / 80,
    });
  }
  return markImportant(bank);
}

/** Flag the top 40% of each marks group (by weight) as important. */
function markImportant(bank) {
  for (const m of MARKS) {
    const list = bank[m];
    const keep = Math.max(1, Math.round(list.length * 0.4));
    const ranked = list
      .map((q, i) => ({ i, w: q.weight || 0 }))
      .sort((a, b) => b.w - a.w || a.i - b.i)
      .slice(0, keep)
      .map((x) => x.i);
    list.forEach((q, i) => {
      q.important = ranked.includes(i);
      delete q.weight;
    });
  }
  return bank;
}

// ---- AI builders --------------------------------------------------------------
function material(doc) {
  const budget = contextBudget() * 4; // ≈ characters
  let text = "",
    truncated = false;
  for (const [i, p] of doc.pages.entries()) {
    const chunk = p.trim() ? `\n\n[Page ${i + 1}]\n${p.trim()}` : "";
    if (text.length + chunk.length > budget) {
      truncated = true;
      break;
    }
    text += chunk;
  }
  return { text, truncated };
}

function withFigures(prompt, images) {
  const usable = images.slice(0, 12);
  if (!geminiAvailable() || !usable.length) return prompt;
  const parts = [{ text: prompt }];
  for (const img of usable) {
    const part = imagePart(img.dataUrl);
    if (part)
      parts.push(
        { text: `Figure id "${img.id}" (page ${img.page + 1}):` },
        part,
      );
  }
  return parts;
}

const FORMAT_RULES =
  "Write in easy, clear English with short sentences a student can revise quickly. Use GitHub " +
  "Markdown: ## for topics, ### for sub-headings, bullet points for key ideas, **bold** for every " +
  "key term (it is shown highlighted and underlined), tables for comparisons, and fenced code " +
  "blocks with a language tag (```python, ```java, ```sql …) for any code. To show a figure, " +
  "write ![short caption](image:ID) using ONLY the figure ids provided. Cite pages as (p. N). " +
  "Base everything on the document; you may add standard textbook explanation, examples and " +
  "code that are consistent with it, but never contradict it or invent document-specific facts.";

export async function generateNotes(doc, images, { onToken } = {}) {
  const { text, truncated } = material(doc);
  const figureList = images.length
    ? `\nAvailable figures: ${images.map((i) => `${i.id} (p. ${i.page + 1})`).join(", ")}`
    : "\nThere are no figures.";
  return generate(
    [
      {
        role: "system",
        content:
          "You are a friendly expert teacher writing study notes that are easy to understand and " +
          "remember. " +
          FORMAT_RULES +
          " Structure: # title; a 2-3 line overview; then for each topic in document order: " +
          "## numbered topic heading, a '> **In short:**' one-line summary in simple words, " +
          "### Key points (bullets), ### Explanation (short paragraphs with ### sub-headings where " +
          "useful, examples, code, figures), and '> 🧠 **Remember:**' a memory trick (acronym, " +
          "rhyme or keyword chain). Finish with ## Key terms (table: term | simple meaning), " +
          "## Quick revision (bullets) and ## Most important questions (bullets marked 2/5/8 marks).",
      },
      {
        role: "user",
        content: withFigures(
          `Document: ${doc.name}${truncated ? " (long document; only the first part is included)" : ""}${figureList}\n${text}`,
          images,
        ),
      },
    ],
    { onToken, maxTokens: 9000, thinking: "medium" },
  );
}

const MARK_GUIDE = {
  2: {
    words: "40-80 words",
    types: QUESTION_TYPES[2],
    shape:
      "a one-line **definition** or direct answer with key terms in bold, then 2-3 bullet points.",
  },
  5: {
    words: "at least 180 words",
    types: QUESTION_TYPES[5],
    shape:
      "a short introduction, ### sub-headings with bullet points, a table for any comparison, " +
      "and an example, figure or code snippet.",
  },
  8: {
    words: "at least 400 words",
    types: QUESTION_TYPES[8],
    shape:
      "## Introduction, three or more ### sections with bullets and short paragraphs, a table " +
      "for comparisons, a figure or code block where relevant, and ## Conclusion.",
  },
};
const questionCount = (doc, marks) => {
  const pages = doc.pages.length;
  return marks === 2
    ? Math.min(20, Math.max(8, pages * 2))
    : marks === 5
      ? Math.min(12, Math.max(5, pages))
      : Math.min(8, Math.max(3, Math.ceil(pages / 2)));
};

/** One marks group from Gemini: every important and predictable question. */
async function geminiGroup(doc, images, marks) {
  const { text } = material(doc);
  const guide = MARK_GUIDE[marks];
  const figureList = images.length
    ? `Available figures: ${images.map((i) => `${i.id} (p. ${i.page + 1})`).join(", ")}`
    : "There are no figures.";
  const data = await geminiJSON(
    [
      {
        role: "system",
        content:
          `You are an experienced university examiner. Write ALL the important and predictable ` +
          `${marks}-mark exam questions for this document (about ${questionCount(doc, marks)}), covering ` +
          `every topic, with model answers. ` +
          FORMAT_RULES +
          ` Group questions by type using exactly these type names: ${guide.types.join(", ")} ` +
          `(use a type only if it fits the content; include Program / Code questions whenever the ` +
          `document has code). Each question starts with a command word (Define, What is, List, State, ` +
          `Explain, Differentiate, Compare, Discuss, Write, Illustrate) — never a title. Each answer is ` +
          `${guide.words}: ${guide.shape} Add a memory trick for every answer (acronym, rhyme, keyword ` +
          `chain or short story) in Markdown. Mark important=true for the questions most likely to be asked. ` +
          `Return JSON: {"questions":[{"question","type","important","answer","trick","page"}]} ` +
          `where page is the 1-based page number and answer/trick are Markdown.`,
      },
      {
        role: "user",
        content: withFigures(
          `Document: ${doc.name}\n${figureList}\n${text}`,
          images,
        ),
      },
    ],
    { maxTokens: marks === 2 ? 7000 : 12000, thinking: "medium" },
  );
  return (Array.isArray(data?.questions) ? data.questions : [])
    .filter((q) => q?.question && q?.answer)
    .map((q) => ({
      question: String(q.question),
      type: guide.types.includes(q.type)
        ? q.type
        : String(q.type || guide.types[0]),
      important: Boolean(q.important),
      answer: String(q.answer),
      trick: q.trick ? String(q.trick) : "",
      page: Math.max(
        0,
        Math.min(doc.pages.length - 1, Number(q.page || 1) - 1),
      ),
    }));
}

/**
 * Full Gemini question bank. The three marks groups are requested in parallel
 * (faster, and one busy request does not lose the others). A group that fails
 * keeps the questions it had (`previous`, e.g. an earlier Gemini bank), else
 * the built-in ones; `failed` lists those marks.
 */
export async function generateQuestionBank(doc, images, { previous } = {}) {
  if (!geminiAvailable()) throw new Error("Question banks need Gemini.");
  const results = await Promise.allSettled(
    MARKS.map((m) => geminiGroup(doc, images, m)),
  );
  if (results.every((r) => r.status === "rejected" || !r.value.length)) {
    const failure = results.find((r) => r.status === "rejected");
    throw (
      failure?.reason ||
      new Error("Gemini returned an empty question bank. Try again.")
    );
  }
  const fallback = buildQuestionBank(doc, images);
  const ok = (i) => results[i].status === "fulfilled" && results[i].value.length;
  const bank = Object.fromEntries(
    MARKS.map((m, i) => [
      m,
      ok(i) ? results[i].value : previous?.[m]?.length ? previous[m] : fallback[m],
    ]),
  );
  bank.failed = MARKS.filter((_, i) => !ok(i));
  return bank;
}

/** Groups a marks list by question type, keeping the preferred type order. */
export function groupByType(list, marks) {
  const order = QUESTION_TYPES[marks] || [];
  const groups = new Map();
  list.forEach((q, index) => {
    const type = q.type || "Questions";
    groups.set(type, [...(groups.get(type) || []), { q, index }]);
  });
  return [...groups.entries()].sort(
    (a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99),
  );
}

export function bankToMarkdown(doc, bank) {
  return [
    `# ${doc.name} — Complete question bank`,
    `*${MARKS.map((m) => `${(bank[m] || []).length} × ${m} marks`).join(" · ")}*`,
    ...MARKS.map(
      (m) =>
        `## ${m}-mark questions\n\n` +
        groupByType(bank[m] || [], m)
          .map(
            ([type, items]) =>
              `### ${type}\n\n` +
              items
                .map(
                  ({ q, index }) =>
                    `#### Q${index + 1}. ${q.question}${q.important ? " ★ Important" : ""} (p. ${q.page + 1})\n\n${q.answer}` +
                    (q.trick ? `\n\n> 🧠 **Memory trick:** ${q.trick}` : ""),
                )
                .join("\n\n"),
          )
          .join("\n\n"),
    ),
  ].join("\n\n");
}

// ---- Flashcards and quiz from the question bank --------------------------------
/** Markdown → plain text for cards and quiz options. */
function plainText(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`>|~]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}
function clipWords(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).trim() + "…";
}
const bankList = (bank) =>
  [2, 5, 8]
    .flatMap((marks) => (bank?.[marks] || []).map((q) => ({ ...q, marks })))
    .filter((q) => q.question && q.answer && !/```/.test(q.question));

/** One flashcard per bank question: question → answer gist + memory trick. */
export function bankFlashcards(bank) {
  return bankList(bank).map((q) => ({
    prompt: plainText(q.question),
    answer: clipWords(plainText(q.answer), 420),
    trick: q.trick ? plainText(q.trick) : "",
    marks: q.marks,
    page: Number.isInteger(q.page) ? q.page : null,
  }));
}
