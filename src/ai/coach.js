// Interview coach: understands an answer (technologies, numbers, challenges,
// key phrases), asks deeper situation-based follow-ups, rates answers
// (red / yellow / blue), writes a better answer and analyses the voice.
// Everything has an instant built-in version; an AI model upgrades it within
// a time limit so the interview never stalls.
import {
  contentTerms,
  extractKeywords,
  splitSentences,
} from "./text";
import {
  ACTION,
  RESULT,
  SITUATION,
  reviewAnswer,
  techTerms,
} from "./interview";
export { ACTION, RESULT, SITUATION };
import { geminiAvailable, streamGemini } from "./gemini";
import { semanticRelevance } from "./speech";

/** Interview Studio uses Gemini only for questions and answers. */
export const questionModelAvailable = () => geminiAvailable();
const askGemini = (messages, maxTokens) =>
  streamGemini(messages, { maxTokens, temperature: 0.6 });

export const BANDS = {
  red: { label: "Needs work", min: 0 },
  yellow: { label: "Fair", min: 50 },
  blue: { label: "Strong", min: 75 },
};
export const bandFor = (score) =>
  score >= 75 ? "blue" : score >= 50 ? "yellow" : "red";

const words = (t) => (t || "").trim().split(/\s+/).filter(Boolean);
const FILLERS =
  /\b(um+|uh+|like|basically|actually|you know|kind of|sort of|literally|so yeah)\b/gi;
const QUESTION_NOISE = new Set(
  "tell describe explain walk through give time about your would what which how why when where situation example specific".split(
    " ",
  ),
);
const stem = (t) => t.slice(0, 5);

/** The first {...} object in a model reply (tolerates fences and extra text). */
export function parseJSONReply(reply) {
  const text = String(reply ?? "");
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Whether a promise settles within `ms`; otherwise resolves to `fallback`. */
export function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => (timer = setTimeout(() => resolve(fallback), ms))),
  ]).finally(() => clearTimeout(timer));
}

// ---- Understanding an answer --------------------------------------------------
export function extractTopics(answer) {
  const text = answer || "";
  const metrics = [];
  for (const m of text.matchAll(
    /[^.!?]*?\b\d[\d,.]*\s*(?:%|percent|x\b|ms\b|milliseconds|seconds?|minutes?|hours?|days?|weeks?|users?|students?|people|customers|requests|transactions|times)[^.!?]*/gi,
  ))
    metrics.push(m[0].trim().replace(/\s+/g, " ").slice(0, 120));
  const challenge = (text.match(
    /\b(bug|issue|problem|challenge|outage|failure|error|deadline|bottleneck|crash|conflict|migration|delay)\b/i,
  ) || [])[1];
  const phrases = extractKeywords(text, 8).filter(
    (p) => p.includes(" ") || p.length >= 7,
  );
  return {
    tech: techTerms(text),
    metrics,
    challenge: challenge?.toLocaleLowerCase() || "",
    team: /\b(team|teammates?|manager|client|stakeholders?|colleagues?)\b/i.test(
      text,
    ),
    phrases,
  };
}

const TECH_FOLLOW_UPS = [
  (t) =>
    `You mentioned ${t}. Describe a specific situation where ${t} caused a problem in your work. How did you find the root cause, and what did you change?`,
  (t) =>
    `Why did you choose ${t} over the alternatives? Walk me through the trade-offs you considered in that decision.`,
  (t) =>
    `Suppose the load on your ${t} setup suddenly grew ten times overnight. What would break first, and how would you handle it?`,
  (t) =>
    `Explain how ${t} works under the hood, using the project you just described as the example.`,
];

/**
 * A deeper, situation-based follow-up built from what the candidate actually
 * said. Returns null when the answer is too thin to dig into.
 */
export function followUpQuestion(answer, used = new Set()) {
  if (words(answer).length < 12) return null;
  const t = extractTopics(answer);
  const fresh = (x) => x && !used.has(x.toLocaleLowerCase());
  const tech = t.tech.find(fresh);
  if (tech)
    return {
      question: TECH_FOLLOW_UPS[used.size % TECH_FOLLOW_UPS.length](tech),
      focus: tech,
    };
  const metric = t.metrics.find(fresh);
  if (metric)
    return {
      question: `You said "${metric}". How exactly did you measure that, what was the baseline, and what would you do to improve it further?`,
      focus: metric,
    };
  if (fresh(t.challenge))
    return {
      question: `You mentioned a ${t.challenge}. Take me through that moment step by step: what did you try first, what didn't work, and what finally solved it?`,
      focus: t.challenge,
    };
  const phrase = t.phrases.find(fresh);
  if (phrase)
    return {
      question: `Tell me more about the ${phrase} part: what was the hardest decision you made there, what options did you consider, and what happened as a result?`,
      focus: phrase,
    };
  if (t.team && fresh("team"))
    return {
      question:
        "You mentioned your team. Tell me about a moment you disagreed with someone there. How did you handle it, and what was the outcome?",
      focus: "team",
    };
  return null;
}

/** AI follow-up (≤ 7 s), falling back to the built-in one. */
export async function followUpQuestionAI({ question, answer, role, used }) {
  const fallback = followUpQuestion(answer, used);
  if (!geminiAvailable() || !fallback) return fallback;
  const reply = await withTimeout(
    askGemini(
      [
        {
          role: "system",
          content:
            "You are a sharp interviewer. Read the candidate's answer, pick the most interesting technology, " +
            "claim, number or decision they mentioned, and ask ONE deeper, situation-based follow-up question " +
            "about it (a realistic scenario, failure, trade-off or 'what would you do if…'). Do not repeat " +
            `topics already covered: ${[...used].join(", ") || "none"}. Reply as JSON: {"question": "...", "focus": "the keyword"}.`,
        },
        {
          role: "user",
          content: `Role: ${role}\nQuestion: ${question}\nAnswer: ${answer}`,
        },
      ],
      220,
    ),
    7000,
    null,
  );
  const data = parseJSONReply(reply);
  if (data?.question?.length > 20)
    return {
      question: String(data.question),
      focus: String(data.focus || fallback.focus),
    };
  return fallback;
}

// ---- Rating ------------------------------------------------------------------
/**
 * 0–100 score from length, STAR structure, specificity and relevance, with a
 * red / yellow / blue band and concrete strengths and improvements.
 */
export function scoreAnswer(
  answer,
  question = "",
  { relevance: modelRelevance } = {},
) {
  const text = (answer || "").trim();
  const n = words(text).length;
  const review = reviewAnswer(text);
  const lengthScore =
    n < 15 ? 10 : n < 40 ? 45 : n <= 260 ? 100 : n <= 360 ? 75 : 55;
  const situation = SITUATION.test(text);
  const action = ACTION.test(text);
  const result = RESULT.test(text);
  const structure = ((situation + action + result) / 3) * 100;
  const numbers = (text.match(/\d+/g) || []).length;
  const tech = techTerms(text).length;
  const specificity = Math.min(
    100,
    numbers * 20 +
      tech * 20 +
      (/\bfor example|for instance|such as\b/i.test(text) ? 20 : 0),
  );
  const qTerms = [
    ...new Set(
      contentTerms(question)
        .filter((t) => t.length > 4 && !QUESTION_NOISE.has(t))
        .map(stem),
    ),
  ];
  const aTerms = new Set(contentTerms(text).map(stem));
  // Relevance: MiniLM meaning similarity when available, else keyword overlap.
  const relevance =
    modelRelevance ??
    (qTerms.length
      ? Math.min(
          100,
          (qTerms.filter((t) => aTerms.has(t)).length /
            Math.min(qTerms.length, 3)) *
            100,
        )
      : 70);
  const fillers = (text.match(FILLERS) || []).length;
  let score =
    lengthScore * 0.2 + structure * 0.35 + specificity * 0.2 + relevance * 0.25;
  if (n && (fillers / n) * 100 > 3) score -= 8;
  if (
    (text.match(/\bwe\b/gi) || []).length >
    (text.match(/\bI\b/g) || []).length + 1
  )
    score -= 5;
  if (n < 5) score = Math.min(score, 15);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFor(score);
  const strengths = [...review.strengths];
  const improvements = [...review.improvements];
  if (tech || numbers)
    strengths.push("You gave specific details (names, tools or numbers).");
  else
    improvements.push(
      "Add specifics: the tool, technology or number that proves your point.",
    );
  if ((modelRelevance != null || qTerms.length) && relevance < 50)
    improvements.push(
      "Answer the question more directly: use its key words in your first sentence.",
    );
  return {
    score,
    band,
    label: BANDS[band].label,
    parts: {
      length: Math.round(lengthScore),
      structure: Math.round(structure),
      specificity: Math.round(specificity),
      relevance: Math.round(relevance),
    },
    strengths,
    improvements,
  };
}

/** A STAR-structured rewrite that reuses the candidate's own sentences. */
export function betterAnswer(question, answer) {
  const sentences = splitSentences(answer || "");
  const RESULT_CUE =
    /(\d+\s*(%|x|ms|seconds|users|people|percent|orders|customers))|\b(as a result|result(ed)?|reduced|increased|improved|saved|delivered|launched|achieved|took \d+|finally)\b/i;
  const result = [...sentences].reverse().find((s) => RESULT_CUE.test(s));
  const isAction = (s) =>
    /^\s*(then\s+|so\s+|also\s+)?I\s+\w+/i.test(s) ||
    ACTION.test(s) ||
    /\bI\s+(also\s+)?(built|made|designed|wrote|led|created|fixed|tested|added|used|profiled|moved|split)\b/.test(
      s,
    );
  // Situation: an opening sentence that sets the scene ("In my last role…",
  // "At my internship…") even if it names what was built; otherwise the
  // first sentence that is neither the result nor an action.
  const opener = sentences[0];
  const situation =
    (opener && opener !== result && SITUATION.test(opener) && opener) ||
    sentences.find((s) => s !== result && !isAction(s)) ||
    sentences.find((s) => s !== result) ||
    sentences[0];
  const task = sentences.find(
    (s) =>
      s !== result &&
      s !== situation &&
      /\b(had to|needed( to)?|goal|task|responsible|asked( me)? to|wanted|required|deadline|before)\b/i.test(
        s,
      ),
  );
  const actions = sentences.filter(
    (s) => s !== situation && s !== task && s !== result && isAction(s),
  );
  const tech = techTerms(answer);
  // Missing parts are suggestions to add, clearly marked as such.
  const line = (label, text, hint) =>
    `**${label}:** ${text ? text : `*➕ Add: ${hint}*`}`;
  return [
    `### A stronger answer (STAR)`,
    line("Situation", situation, "where you were and what was happening."),
    line("Task", task, "your goal or responsibility, e.g. \"I had to make the page load in under 2 seconds.\""),
    line(
      "Action",
      actions.slice(0, 3).join(" "),
      'what you did yourself: "I designed…", "I built…", "I chose X because…".',
    ),
    line(
      "Result",
      result,
      'a measurable result to finish, e.g. "cut load time by 40%".',
    ),
    tech.length
      ? `**Tip:** Name ${tech.slice(0, 2).join(" and ")} early and say *why* you chose ${tech.length > 1 ? "them" : "it"}.`
      : "**Tip:** Mention the specific tool, method or technology you used.",
  ].join("\n\n");
}

/**
 * Open-model rating: the instant score, with relevance re-measured by the
 * on-device MiniLM embedding model (meaning, not just shared words).
 */
export async function scoreAnswerOpen(question, answer) {
  const relevance = await withTimeout(
    semanticRelevance(question, answer),
    4000,
    null,
  );
  return {
    ...scoreAnswer(answer, question, relevance == null ? {} : { relevance }),
    scoredBy: relevance == null ? "rules" : "rules + MiniLM",
  };
}

/** A stronger model answer from Gemini (≤ 25 s), else the built-in STAR rewrite. */
export async function betterAnswerAI({ question, answer, role }) {
  const fallback = betterAnswer(question, answer);
  if (!geminiAvailable() || words(answer).length < 5)
    return { better: fallback, source: "built-in" };
  const reply = await withTimeout(
    askGemini(
      [
        {
          role: "system",
          content:
            "You are an interview coach. Rewrite the candidate's answer into a stronger model answer in Markdown: " +
            "under 170 words, STAR structure with **Situation**, **Task**, **Action**, **Result** labels, truthful to " +
            "what they said (mark anything they should add in [brackets]), key points in **bold**.",
        },
        {
          role: "user",
          content: `Role: ${role}\nQuestion: ${question}\nAnswer: ${answer}`,
        },
      ],
      600,
    ),
    25000,
    null,
  );
  return reply?.trim()
    ? { better: reply.trim(), source: "gemini" }
    : { better: fallback, source: "built-in" };
}

/** Gemini-written interview questions tailored to the resume (≤ 20 s). */
export async function geminiInterviewQuestions({
  resumeText,
  role,
  experience,
  count,
}) {
  if (!geminiAvailable()) return null;
  const reply = await withTimeout(
    askGemini(
      [
        {
          role: "system",
          content:
            "You are an experienced interviewer. Write specific interview questions that reference real projects, " +
            "roles, skills and claims from the candidate's resume, mixing technical depth, situations and behaviour. " +
            "One question per line, numbered. No answers.",
        },
        {
          role: "user",
          content: `Role: ${role}\nExperience: ${experience}\nResume:\n${(resumeText || "").slice(0, 30000)}\n\nWrite ${count} questions.`,
        },
      ],
      70 * count,
    ),
    20000,
    null,
  );
  const list = String(reply || "")
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*(\d+[.)]|[-*•])\s*/, "")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .filter((l) => l.length > 20 && l.endsWith("?"));
  return list.length >= Math.min(2, count) ? list.slice(0, count) : null;
}

/** Streaming Gemini coaching for one answer. */
export function geminiCoaching({
  question,
  answer,
  role,
  resumeText = "",
  onToken,
  signal,
}) {
  return streamGemini(
    [
      {
        role: "system",
        content:
          "You are a supportive interview coach. Give feedback in 3 short sections: 'What worked', 'Improve', and " +
          "'Stronger version' (under 120 words, truthful to the candidate's answer and resume). Be specific.",
      },
      {
        role: "user",
        content: `Role: ${role}\nQuestion: ${question}\nAnswer: ${answer}${resumeText ? `\nResume excerpt:\n${resumeText.slice(0, 2500)}` : ""}`,
      },
    ],
    { onToken, maxTokens: 420, signal },
  );
}

// ---- Voice -------------------------------------------------------------------
/**
 * Rates delivery from microphone statistics and the transcript: pace (words
 * per minute), pauses, filler words and volume steadiness.
 */
export function voiceReport(stats, transcript) {
  if (!stats || stats.durationSec < 3) return null;
  const n = words(transcript).length;
  const speaking = Math.max(stats.speakingSec, 1);
  const wpm = Math.round(n / (speaking / 60));
  const fillers = (transcript.match(FILLERS) || []).length;
  const fillerRate = n ? (fillers / n) * 100 : 0;
  const pausesPerMin = stats.pauses / Math.max(stats.durationSec / 60, 0.5);
  const pace =
    wpm >= 115 && wpm <= 165 ? 100 : wpm >= 95 && wpm <= 185 ? 75 : n ? 45 : 0;
  const fluency = fillerRate <= 2 ? 100 : fillerRate <= 5 ? 70 : 40;
  const pausing = pausesPerMin <= 3 ? 100 : pausesPerMin <= 6 ? 70 : 45;
  const steadiness = Math.round(stats.steadiness * 100);
  const score = Math.round(
    pace * 0.35 + fluency * 0.25 + pausing * 0.2 + steadiness * 0.2,
  );
  const tips = [];
  if (wpm > 165)
    tips.push(`You spoke fast (${wpm} words/min). Slow down to about 130–150.`);
  else if (wpm && wpm < 115)
    tips.push(`You spoke slowly (${wpm} words/min). Aim for about 130–150.`);
  if (fillerRate > 2)
    tips.push(
      `${fillers} filler words ("um", "like", "basically"). Pause silently instead.`,
    );
  if (pausesPerMin > 3)
    tips.push(
      `${stats.pauses} long pauses. Plan your first sentence before speaking.`,
    );
  if (stats.steadiness < 0.6)
    tips.push("Your volume varied a lot. Keep a steady, confident voice.");
  if (!tips.length) tips.push("Clear, steady delivery. Keep it up.");
  return {
    score,
    band: bandFor(score),
    wpm,
    fillers,
    pauses: stats.pauses,
    longestPauseSec: stats.longestPauseSec,
    speakingSec: Math.round(stats.speakingSec),
    steadiness,
    tips,
  };
}

/** Merges two recordings of the same answer. */
export function mergeVoiceStats(a, b) {
  if (!a) return b;
  if (!b) return a;
  const total = a.durationSec + b.durationSec || 1;
  return {
    durationSec: total,
    speakingSec: a.speakingSec + b.speakingSec,
    pauses: a.pauses + b.pauses,
    longestPauseSec: Math.max(a.longestPauseSec, b.longestPauseSec),
    avgVolume:
      (a.avgVolume * a.durationSec + b.avgVolume * b.durationSec) / total,
    steadiness:
      (a.steadiness * a.durationSec + b.steadiness * b.durationSec) / total,
  };
}

