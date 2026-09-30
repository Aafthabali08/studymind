import React, { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Sparkles, RotateCcw } from "lucide-react";
import { makeMultiPlan, planWithGemini } from "./ai/plan";
import { canGenerate } from "./ai/engine";
import { geminiAvailable } from "./ai/gemini";
import { loadPlan, savePlan } from "./cloud";
import Thinking from "./Thinking";

export default function StudyPlan({ active, docs, notify, uid, onOpenDoc }) {
  const [plan, setPlan] = useState(null),
    [checked, setChecked] = useState({}),
    [chosen, setChosen] = useState(null), // null = every document
    [days, setDays] = useState("5"),
    [hours, setHours] = useState("2"),
    [planning, setPlanning] = useState(false);
  const selected = docs.filter((d) => (chosen ? chosen.includes(d.id) : true));

  // Restore the saved plan for this account.
  useEffect(() => {
    if (!uid) return;
    let live = true;
    loadPlan(uid)
      .then((saved) => {
        if (!live || !saved?.items) return;
        setPlan(saved);
        setChecked(saved.checked || {});
        setChosen(saved.docIds || null);
        setDays(String(saved.days || 5));
        setHours(String(saved.hoursPerDay || 2));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid]);

  function persist(nextPlan, nextChecked) {
    if (uid && nextPlan)
      savePlan(uid, { ...nextPlan, checked: nextChecked }).catch(() =>
        notify(
          "Your plan is kept here but could not be saved to your account.",
        ),
      );
  }
  async function create(withGemini) {
    const options = { days: Number(days), hoursPerDay: Number(hours) };
    try {
      if (!selected.length) throw new Error("Choose at least one document.");
      let next;
      if (withGemini) {
        setPlanning(true);
        next = await planWithGemini(selected, options);
      } else next = makeMultiPlan(selected, options);
      setPlan(next);
      setChecked({});
      persist(next, {});
    } catch (e) {
      notify(e.message);
    } finally {
      setPlanning(false);
    }
  }
  function toggle(i, value) {
    const next = { ...checked, [i]: value };
    setChecked(next);
    persist(plan, next);
  }
  const done = plan ? plan.items.filter((_, i) => checked[i]).length : 0;

  return (
    <div hidden={!active}>
      <section className="page-title">
        <div className="eyebrow">ONE STEP AT A TIME</div>
        <h1>Make space to learn.</h1>
        <p>One plan across all your documents, built around your time.</p>
      </section>
      <div className="plan-layout">
        <form
          className="panel setup"
          onSubmit={(e) => {
            e.preventDefault();
            create(false);
          }}
        >
          <h2>Your study rhythm.</h2>
          <fieldset className="doc-picker">
            <legend>Documents to cover</legend>
            {docs.length ? (
              docs.map((d) => (
                <label key={d.id} className="doc-pick">
                  <input
                    type="checkbox"
                    checked={selected.some((s) => s.id === d.id)}
                    onChange={(e) => {
                      const ids = selected.map((s) => s.id);
                      setChosen(
                        e.target.checked
                          ? [...ids, d.id]
                          : ids.filter((id) => id !== d.id),
                      );
                    }}
                  />
                  <span>
                    {d.name}
                    <small>
                      {d.pages.length} {d.pages.length === 1 ? "page" : "pages"}
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p className="fine">
                Upload documents first; your plan covers them together.
              </p>
            )}
          </fieldset>
          <div className="field-pair">
            <label>
              Days to study
              <input
                name="days"
                type="number"
                min="1"
                max="60"
                step="1"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                required
              />
            </label>
            <label>
              Hours per day
              <input
                name="hours"
                type="number"
                min="0.5"
                max="12"
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                required
              />
            </label>
          </div>
          <button className="primary" disabled={!selected.length || planning}>
            Create study plan
            <ArrowRight size={16} />
          </button>
          {geminiAvailable() && canGenerate() && (
            <button
              type="button"
              className="secondary wide-button"
              disabled={!selected.length || planning}
              onClick={() => create(true)}
            >
              <Sparkles size={16} /> Plan by topic with Gemini
            </button>
          )}
          <p className="fine">
            {selected.length} document{selected.length === 1 ? "" : "s"}{" "}
            selected. Topics are balanced by length and the last days are kept
            for revision.
          </p>
        </form>
        <section className="panel setup">
          <h2>
            {plan ? "Your next small steps." : "A clear path starts here."}
          </h2>
          {planning ? (
            <Thinking
              label="Planning your topics…"
              detail="Reading each document's outline to order topics and balance your days."
              lines={4}
            />
          ) : plan ? (
            <>
              <p>
                {done} / {plan.items.length} days complete ·{" "}
                {plan.source === "gemini"
                  ? "planned by Gemini"
                  : "built from your documents"}
              </p>
              <div className="progress" aria-hidden="true">
                <i style={{ width: `${(done / plan.items.length) * 100}%` }} />
              </div>
              <ol className="plan-days" aria-label="Study plan days">
                {plan.items.map((item, i) => (
                  <li
                    key={i}
                    className={"plan-item" + (checked[i] ? " done" : "")}
                  >
                    <label className="plan-check">
                      <input
                        type="checkbox"
                        checked={!!checked[i]}
                        onChange={(e) => toggle(i, e.target.checked)}
                      />
                      <strong>
                        Day {item.day}
                        {item.type === "review" && (
                          <span className="tag">Revision</span>
                        )}
                      </strong>
                      <small>
                        {item.tasks.reduce((n, t) => n + t.minutes, 0)} min
                      </small>
                    </label>
                    <ul className="plan-tasks">
                      {item.tasks.map((t, j) => {
                        const doc = docs.find((d) => d.id === t.docId);
                        return (
                          <li key={j}>
                            <span>
                              <b>{t.title}</b>
                              {t.pages && ` · ${t.pages}`}
                              {item.type === "study" && t.docName && (
                                <em> — {t.docName}</em>
                              )}
                            </span>
                            <span className="task-meta">
                              {t.minutes} min
                              {doc && (
                                <button
                                  type="button"
                                  className="tag"
                                  aria-label={`Open ${doc.name}`}
                                  onClick={() => onOpenDoc?.(doc)}
                                >
                                  <BookOpen size={12} />
                                </button>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {item.practice && <p className="fine">{item.practice}</p>}
                  </li>
                ))}
              </ol>
              <button
                className="text-button"
                onClick={() => {
                  setPlan(null);
                  setChecked({});
                  if (uid) savePlan(uid, { items: null }).catch(() => {});
                }}
              >
                <RotateCcw size={14} /> Clear plan
              </button>
            </>
          ) : (
            <p>
              Choose one or more documents and your timeframe. StudyMind splits
              them into topics and spreads them across your days.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
