import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import Thinking from "./Thinking";
import useIdleValue from "./useIdleValue";
import {
  QUIZ_TYPES,
  QUIZ_TYPE_LABEL,
  SET_COUNT,
  buildQuizSets,
  geminiQuizSet,
  grade,
  seedFrom,
} from "./ai/quiz";

const LETTERS = ["A", "B", "C", "D"];
const blankProgress = () => ({ index: 0, responses: {}, done: false });
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Three sets of 30 questions built from the document: multiple choice, fill
 * in the blank, true/false, matching, name the term and "which statement is
 * correct". New questions on every refresh; a set can also be written by
 * Gemini from the same document.
 */
export default function QuizPanel({ doc, bank, onPage, notify, geminiOn }) {
  const [seed, setSeed] = useState(() => seedFrom(doc.id || doc.name));
  const seen = useRef(new Set());
  const [setIdx, setSetIdx] = useState(0);
  const [progress, setProgress] = useState({});
  const [geminiSets, setGeminiSets] = useState({});
  const [writing, setWriting] = useState(false);
  const controller = useRef(null);

  // Built in idle time so opening the Quiz tab never freezes on big PDFs.
  const built = useIdleValue(
    () => buildQuizSets(doc, { seed, bank, avoid: seen.current }),
    [doc.pages, bank, seed],
  );
  const sets = built || [];
  // A different document starts fresh.
  useEffect(() => {
    setSeed(seedFrom(doc.id || doc.name));
    setProgress({});
    setGeminiSets({});
    setSetIdx(0);
    seen.current = new Set();
  }, [doc.id]);
  useEffect(() => () => controller.current?.abort(), []);

  const questions = geminiSets[setIdx] || sets[setIdx] || [];
  const state = progress[setIdx] || blankProgress();
  const q = questions[state.index];
  const response = state.responses[state.index];
  const answered = response !== undefined;
  const update = (patch) =>
    setProgress((p) => ({
      ...p,
      [setIdx]: { ...(p[setIdx] || blankProgress()), ...patch },
    }));
  const answer = (value) =>
    update({ responses: { ...state.responses, [state.index]: value } });
  const next = () =>
    state.index >= questions.length - 1
      ? update({ done: true })
      : update({ index: state.index + 1 });

  function refresh() {
    controller.current?.abort();
    for (const set of sets) for (const x of set) seen.current.add(x.key);
    setSeed((s) => (s * 31 + Date.now()) >>> 0);
    setProgress({});
    setGeminiSets({});
    notify?.("New questions ready: 3 fresh sets from your document.");
  }
  async function writeWithGemini() {
    controller.current?.abort();
    controller.current = new AbortController();
    setWriting(true);
    try {
      const avoid = [...sets.flat(), ...Object.values(geminiSets).flat()].map(
        (x) => x.prompt,
      );
      const list = await geminiQuizSet(doc, {
        avoid,
        signal: controller.current.signal,
      });
      const fromGemini = list.length;
      // Top up to 30 from the built-in set, keeping 5 per format when possible.
      const counts = {};
      for (const x of list) counts[x.type] = (counts[x.type] || 0) + 1;
      for (const x of sets[setIdx] || []) {
        if (list.length >= 30) break;
        if ((counts[x.type] || 0) < 5) {
          list.push(x);
          counts[x.type] = (counts[x.type] || 0) + 1;
        }
      }
      const order = Object.fromEntries(QUIZ_TYPES.map(([t], i) => [t, i]));
      const full = list
        .slice(0, 30)
        .sort((a, b) => order[a.type] - order[b.type]);
      setGeminiSets((g) => ({ ...g, [setIdx]: full }));
      setProgress((p) => ({ ...p, [setIdx]: blankProgress() }));
      notify?.(
        fromGemini >= 30
          ? `Set ${setIdx + 1} was written by Gemini from your document.`
          : `Set ${setIdx + 1}: ${fromGemini} questions by Gemini, the rest built from your document.`,
      );
    } catch (e) {
      if (e?.name !== "AbortError")
        notify?.(
          `${e.message || "Gemini could not write the quiz."} The built-in set is still ready.`,
        );
    } finally {
      setWriting(false);
    }
  }

  if (!built)
    return (
      <Thinking
        label="Building your quiz…"
        detail="3 sets of 30 questions from your document."
        lines={4}
      />
    );
  if (!sets.some((s) => s.length))
    return (
      <div className="quiz">
        <h2>A little more material needed.</h2>
        <p>
          This document has too little text to build a quiz. Try a longer PDF
          or open Flashcards.
        </p>
      </div>
    );

  const score = questions.reduce(
    (n, x, i) => n + grade(x, state.responses[i]),
    0,
  );
  return (
    <div className="quiz">
      <div className="quiz-top">
        <div className="quiz-sets" role="group" aria-label="Quiz sets">
          {Array.from({ length: SET_COUNT }, (_, i) => {
            const p = progress[i];
            const total = (geminiSets[i] || sets[i] || []).length;
            return (
              <button
                key={i}
                className={i === setIdx ? "active" : ""}
                aria-pressed={i === setIdx}
                disabled={!total}
                onClick={() => setSetIdx(i)}
              >
                Set {i + 1}
                <small>
                  {p?.done
                    ? `${fmt(
                        (geminiSets[i] || sets[i]).reduce(
                          (n, x, j) => n + grade(x, p.responses[j]),
                          0,
                        ),
                      )}/${total}`
                    : `${total} Q`}
                  {geminiSets[i] ? " · Gemini" : ""}
                </small>
              </button>
            );
          })}
        </div>
        <div className="quiz-actions">
          <button className="secondary" onClick={refresh} disabled={writing}>
            <RefreshCw size={15} /> New questions
          </button>
          {geminiOn && (
            <button
              className="secondary"
              onClick={writeWithGemini}
              disabled={writing}
            >
              <Sparkles size={15} /> Gemini set
            </button>
          )}
        </div>
      </div>

      {writing ? (
        <Thinking
          label={`Gemini is writing set ${setIdx + 1}…`}
          detail="30 questions in 6 formats, only from your document. Takes up to a minute."
          lines={5}
        />
      ) : state.done ? (
        <Results
          questions={questions}
          responses={state.responses}
          score={score}
          onRetry={() => update(blankProgress())}
          onNextSet={
            setIdx < SET_COUNT - 1 && (sets[setIdx + 1] || []).length
              ? () => setSetIdx(setIdx + 1)
              : null
          }
          onRefresh={refresh}
          onPage={onPage}
        />
      ) : q ? (
        <>
          <div className="quiz-progress">
            <div className="eyebrow">
              SET {setIdx + 1} · QUESTION {state.index + 1} OF{" "}
              {questions.length}
            </div>
            <span className="quiz-type">{QUIZ_TYPE_LABEL[q.type]}</span>
          </div>
          <div
            className="quiz-bar"
            role="progressbar"
            aria-label="Quiz progress"
            aria-valuemin={0}
            aria-valuemax={questions.length}
            aria-valuenow={state.index}
          >
            <i style={{ width: `${(state.index / questions.length) * 100}%` }} />
          </div>
          <h2 className="quiz-prompt">{q.prompt}</h2>
          {q.type === "match" ? (
            <Matching
              key={q.id}
              q={q}
              response={response}
              onCheck={answer}
            />
          ) : (
            <div className="quiz-options" role="group" aria-label="Answers">
              {q.options.map((label, i) => (
                <button
                  key={i}
                  className={
                    "quiz-option" +
                    (response === i ? " chosen" : "") +
                    (answered && i === q.answer ? " right" : "") +
                    (response === i && i !== q.answer ? " wrong" : "")
                  }
                  disabled={answered}
                  onClick={() => answer(i)}
                >
                  {q.type !== "tf" && <b className="quiz-letter">{LETTERS[i]}</b>}
                  <span>{label}</span>
                  {answered && i === q.answer && <Check size={17} />}
                  {response === i && i !== q.answer && <X size={17} />}
                </button>
              ))}
            </div>
          )}
          {answered ? (
            <div className="feedback" role="status">
              <strong>
                {grade(q, response) === 1
                  ? "Correct. Nicely remembered."
                  : grade(q, response) > 0
                    ? `Partly right: ${Math.round(grade(q, response) * 4)} of 4 pairs.`
                    : "Not quite. Here is the answer."}
              </strong>
              {q.explain && <p className="quiz-explain">{q.explain}</p>}
              {q.page != null && (
                <button className="text-button" onClick={() => onPage?.(q.page)}>
                  Review page {q.page + 1} <ArrowUpRight size={15} />
                </button>
              )}
              <button className="primary" onClick={next}>
                {state.index === questions.length - 1
                  ? "Finish quiz"
                  : "Next question"}
                <ArrowRight size={16} />
              </button>
            </div>
          ) : (
            <div className="quiz-skip">
              <button className="text-button" onClick={() => { answer(null); next(); }}>
                Skip
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Pick the matching sentence for each term, then check. */
function Matching({ q, response, onCheck }) {
  const [draft, setDraft] = useState(() => q.pairs.map(() => ""));
  const checked = response != null;
  const picks = checked ? response : draft;
  return (
    <div className="quiz-match">
      <ol className="match-clues">
        {q.options.map((clue, i) => (
          <li key={i}>
            <b>{LETTERS[i]}</b> {clue}
          </li>
        ))}
      </ol>
      {q.pairs.map((pair, i) => {
        const ok = checked && picks[i] === q.answer[i];
        return (
          <label
            key={i}
            className={"match-row" + (checked ? (ok ? " right" : " wrong") : "")}
          >
            <span className="match-term">{pair.term}</span>
            <select
              aria-label={`Sentence for ${pair.term}`}
              value={picks[i] === "" || picks[i] == null ? "" : String(picks[i])}
              disabled={checked}
              onChange={(e) =>
                setDraft((d) =>
                  d.map((v, j) => (j === i ? Number(e.target.value) : v)),
                )
              }
            >
              <option value="">Choose…</option>
              {q.options.map((_, j) => (
                <option key={j} value={j}>
                  {LETTERS[j]}
                </option>
              ))}
            </select>
            {checked && !ok && (
              <small>Answer: {LETTERS[q.answer[i]]}</small>
            )}
          </label>
        );
      })}
      {!checked && (
        <button
          className="primary"
          disabled={draft.some((v) => v === "")}
          onClick={() => onCheck(draft)}
        >
          Check matches
        </button>
      )}
    </div>
  );
}

function Results({ questions, responses, score, onRetry, onNextSet, onRefresh, onPage }) {
  const total = questions.length;
  const pct = total ? Math.round((score / total) * 100) : 0;
  const byType = QUIZ_TYPES.map(([type, label]) => {
    const list = questions
      .map((x, i) => [x, i])
      .filter(([x]) => x.type === type);
    return {
      label,
      total: list.length,
      got: list.reduce((n, [x, i]) => n + grade(x, responses[i]), 0),
    };
  }).filter((t) => t.total);
  const missed = questions
    .map((x, i) => [x, i])
    .filter(([x, i]) => grade(x, responses[i]) < 1);
  const answerText = (x) =>
    x.type === "match"
      ? x.pairs.map((p, i) => `${p.term} → ${LETTERS[x.answer[i]]}`).join(", ")
      : x.options[x.answer];
  return (
    <div className="quiz-results">
      <div className="eyebrow">QUIZ COMPLETE</div>
      <h2>
        {fmt(score)} / {total} correct
      </h2>
      <p className="quiz-pct">
        {pct}% ·{" "}
        {pct >= 80
          ? "Excellent. You know this document well."
          : pct >= 50
            ? "Good progress. Review the ones you missed."
            : "Keep going. Re-read the pages below and try again."}
      </p>
      <div className="quiz-breakdown">
        {byType.map((t) => (
          <div key={t.label}>
            <span>{t.label}</span>
            <i>
              <b style={{ width: `${(t.got / t.total) * 100}%` }} />
            </i>
            <small>
              {fmt(t.got)}/{t.total}
            </small>
          </div>
        ))}
      </div>
      <div className="button-row">
        <button className="secondary" onClick={onRetry}>
          <RotateCcw size={15} /> Try this set again
        </button>
        {onNextSet && (
          <button className="primary" onClick={onNextSet}>
            Next set <ArrowRight size={16} />
          </button>
        )}
        <button className="secondary" onClick={onRefresh}>
          <RefreshCw size={15} /> New questions
        </button>
      </div>
      {missed.length > 0 && (
        <details className="quiz-review">
          <summary>Review {missed.length} missed questions</summary>
          <ol>
            {missed.map(([x, i]) => (
              <li key={x.id || i}>
                <p>{x.prompt}</p>
                <p>
                  <b>Answer:</b> {answerText(x)}
                </p>
                {x.page != null && (
                  <button className="text-button" onClick={() => onPage?.(x.page)}>
                    Page {x.page + 1} <ArrowUpRight size={14} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
