// Pure text-processing pipeline. Everything here is synchronous, dependency-free
// and runs in milliseconds, so the UI always has an instant, source-exact answer
// before any (optional) neural model has loaded.
//
// Pipeline: pages -> sentences -> overlapping chunks (~180 words, page-tagged)
//           -> BM25 index (keyword) [+ embeddings in the worker (semantic)]
//           -> retrieval / extractive summary / keywords, always with page numbers.

export const STOP_WORDS = new Set(
  (
    "a an the is are was were be been being this that these those what how why when where who whom which " +
    "explain tell me about in on of to for and or does do did can could would should will shall may might must " +
    "you your yours please it its with from by as at into onto than then so such not no nor but if else also " +
    "i my we our they their them he she his her there here have has had having very just more most some any " +
    "first second one two three use used using uses new like well many much make makes made " +
    "each other all both few only own same too s t don now up down out over under again further once"
  ).split(" "),
);

export const tokenize = (text) =>
  (text || "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

export const contentTerms = (text) =>
  tokenize(text).filter((t) => t.length > 1 && !STOP_WORDS.has(t));

const wordCount = (text) => (text.match(/\S+/g) || []).length;

/** Split text into sentences, treating blank lines and bullets as boundaries. */
// A short, title-like line with no closing punctuation (PDF headings arrive as
// their own line, usually without a blank line after them).
const headingLine = (line) => {
  const words = line.trim().split(/\s+/);
  return (
    words.length <= 8 &&
    /^[\p{Lu}\d]/u.test(line.trim()) &&
    !/[.,;:!?)]$/.test(line.trim()) &&
    (words.length <= 4 ||
      words.filter((w) => /^[\p{Lu}\d]/u.test(w)).length / words.length >= 0.6)
  );
};

export function splitSentences(text) {
  return (text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line, i, all) =>
      headingLine(line) && all[i + 1]?.trim() ? line + "\n" : line,
    )
    .join("\n")
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'(])|\n{2,}|\n(?=\s*[-•*▪●]\s)/u)
    .map((s) =>
      s
        .replace(/^\s*[-•*▪●]\s*/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => s.length > 1);
}

/**
 * Chunk pages for retrieval. Word-by-word is too fine (single words carry no
 * meaning) and whole pages are too coarse (small models and rankers blur them),
 * so we group whole sentences into ~targetWords chunks and repeat the last
 * sentence of each chunk at the start of the next so no idea is cut in half.
 */
export function chunkPages(pages, { targetWords = 180, overlap = 1 } = {}) {
  const chunks = [];
  pages.forEach((pageText, page) => {
    let current = [],
      words = 0,
      fresh = 0; // sentences added since the last chunk (excludes overlap)
    const flush = () => {
      const text = current.join("\n");
      chunks.push({ id: chunks.length, page, text, words: wordCount(text) });
      current = overlap ? current.slice(-overlap) : [];
      words = current.reduce((n, s) => n + wordCount(s), 0);
      fresh = 0;
    };
    for (const sentence of splitSentences(pageText)) {
      const w = wordCount(sentence);
      if (fresh && words + w > targetWords) flush();
      current.push(sentence);
      words += w;
      fresh++;
    }
    if (fresh) flush();
  });
  return chunks;
}

/** Okapi BM25 index over chunks. */
export function buildIndex(chunks) {
  const docs = chunks.map((c) => {
    const terms = contentTerms(c.text);
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    return { tf, length: terms.length };
  });
  const df = new Map();
  for (const d of docs)
    for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1) || 1;
  return { chunks, docs, df, avg, n: docs.length };
}

const stem = (t) => t.replace(/(ing|ed|es|s)$/u, "");

export function bm25Search(index, query, k = 5) {
  const terms = [...new Set(contentTerms(query))];
  if (!terms.length) return [];
  const k1 = 1.4,
    b = 0.75;
  return index.docs
    .map((d, i) => {
      let score = 0;
      for (const term of terms) {
        let f = d.tf.get(term) || 0;
        let df = index.df.get(term) || 0;
        if (!f) {
          // Light stemming so "networks" still finds "network".
          const s = stem(term);
          for (const [t, count] of d.tf)
            if (stem(t) === s) {
              f = count;
              df = index.df.get(t) || 1;
              break;
            }
        }
        if (!f) continue;
        const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
        score +=
          (idf * f * (k1 + 1)) /
          (f + k1 * (1 - b + (b * d.length) / index.avg));
      }
      return { chunk: index.chunks[i], score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.id - b.chunk.id)
    .slice(0, k);
}

/** Combine keyword and semantic rankings (reciprocal rank fusion). */
export function fuseRankings(lists, k = 5, weights = lists.map(() => 1)) {
  const scores = new Map();
  lists.forEach((list, l) =>
    list.forEach((r, rank) => {
      const prev = scores.get(r.chunk.id) || { chunk: r.chunk, score: 0 };
      prev.score += weights[l] / (60 + rank);
      scores.set(r.chunk.id, prev);
    }),
  );
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

/** The sentences of a chunk that best match the query, in reading order. */
export function bestSentences(text, query, max = 3) {
  const q = new Set(contentTerms(query).map(stem));
  const lines = text.split("\n").flatMap(splitSentences);
  // Skip heading-like fragments (no verb-length sentence) when real sentences exist.
  const full = lines.filter((s) => wordCount(s) >= 5);
  const sentences = full.length ? full : lines;
  const scored = sentences.map((s, i) => ({
    s,
    i,
    score: contentTerms(s).filter((t) => q.has(stem(t))).length,
  }));
  const top = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i);
  return (top.length ? top : scored.slice(0, max)).map((x) => x.s).join(" ");
}

/**
 * Instant extractive answer: exact sentences from the best-matching chunks,
 * so the information shown is always verbatim from the document.
 */
export function extractiveAnswer(
  index,
  query,
  ranked = bm25Search(index, query, 4),
) {
  if (!ranked.length) return null;
  const top = ranked[0];
  const sources = [];
  for (const r of ranked)
    if (
      !sources.some((s) => s.page === r.chunk.page) &&
      r.score >= top.score * 0.5
    )
      sources.push({ page: r.chunk.page, text: r.chunk.text });
  return {
    text: bestSentences(top.chunk.text, query, 3),
    page: top.chunk.page,
    sources: sources.slice(0, 3),
    context: ranked.map((r) => r.chunk),
  };
}

/**
 * Extractive summary (TF-IDF centroid + position prior, redundancy-aware).
 * Returns key sentences in reading order with their page numbers.
 */
export function summarizeExtractive(pages, { sentences = 5 } = {}) {
  const all = [];
  pages.forEach((text, page) =>
    splitSentences(text).forEach((s, i) => {
      const terms = contentTerms(s);
      if (terms.length >= 4 && wordCount(s) <= 70)
        all.push({ s, page, i, terms });
    }),
  );
  if (!all.length) return [];
  const df = new Map();
  for (const x of all)
    for (const t of new Set(x.terms)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + all.length / (df.get(t) || 1));
  const centroid = new Map();
  for (const x of all)
    for (const t of x.terms) centroid.set(t, (centroid.get(t) || 0) + idf(t));
  const vec = (terms) => {
    const v = new Map();
    for (const t of terms) v.set(t, (v.get(t) || 0) + idf(t));
    return v;
  };
  const cos = (a, b) => {
    let dot = 0,
      na = 0,
      nb = 0;
    for (const [t, w] of a) {
      na += w * w;
      if (b.has(t)) dot += w * b.get(t);
    }
    for (const w of b.values()) nb += w * w;
    return dot / (Math.sqrt(na * nb) || 1);
  };
  const scored = all.map((x, order) => ({
    ...x,
    order,
    v: vec(x.terms),
    score:
      cos(vec(x.terms), centroid) +
      (x.i === 0 ? 0.08 : 0) +
      (x.i === 1 ? 0.04 : 0),
  }));
  const picked = [];
  for (const x of [...scored].sort((a, b) => b.score - a.score)) {
    if (picked.length >= sentences) break;
    if (picked.every((p) => cos(p.v, x.v) < 0.6)) picked.push(x);
  }
  return picked
    .sort((a, b) => a.order - b.order)
    .map(({ s, page }) => ({ text: s, page }));
}

/** Top distinctive terms and two-word phrases. */
export function extractKeywords(text, n = 8) {
  const words = tokenize(text);
  const counts = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
      counts.set(w, (counts.get(w) || 0) + 1);
    const next = words[i + 1];
    if (
      next &&
      !STOP_WORDS.has(w) &&
      !STOP_WORDS.has(next) &&
      w.length > 2 &&
      next.length > 2
    )
      counts.set(`${w} ${next}`, (counts.get(`${w} ${next}`) || 0) + 1.5);
  }
  const result = [];
  for (const [term, c] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (c < 2 && result.length >= 3) break;
    if (result.some((r) => r.includes(term) || term.includes(r))) continue;
    result.push(term);
    if (result.length >= n) break;
  }
  return result;
}
