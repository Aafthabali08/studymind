import React, { useState } from "react";
import { Check, X } from "lucide-react";
import { useAuth } from "./auth";
import { sendFeedback } from "./support";
import { setLearning } from "./ai/memory";

/**
 * ✓ Correct / ✗ Wrong feedback on any AI output. "Wrong" asks what was wrong
 * (optional). Feedback goes to the admin and into the user's learning memory,
 * which Gemini reads next time.
 */
export default function FeedbackButtons({
  kind,
  item,
  docId = "",
  docName = "",
  initial = null,
  onVerdict,
  label = "Was this correct?",
}) {
  const { user } = useAuth();
  const [verdict, setVerdict] = useState(initial),
    [asking, setAsking] = useState(false),
    [comment, setComment] = useState(""),
    [state, setState] = useState("idle"); // idle | sending | sent | error
  if (!user) return null;

  async function send(v, note = "") {
    setState("sending");
    try {
      const memory = await sendFeedback(user, {
        kind,
        verdict: v,
        item,
        comment: note,
        docId,
        docName,
      });
      setLearning({ avoid: memory.avoid, good: memory.good });
      setVerdict(v);
      setAsking(false);
      setState("sent");
      onVerdict?.(v);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="feedback-buttons">
      <span className="fb-label">
        {state === "sent" ? "Thanks, StudyMind will learn from this." : label}
      </span>
      <button
        type="button"
        className={"fb-btn good" + (verdict === "correct" ? " active" : "")}
        aria-pressed={verdict === "correct"}
        disabled={state === "sending"}
        onClick={() => send("correct")}
      >
        <Check size={14} /> Correct
      </button>
      <button
        type="button"
        className={"fb-btn bad" + (verdict === "wrong" ? " active" : "")}
        aria-pressed={verdict === "wrong"}
        disabled={state === "sending"}
        onClick={() => setAsking((a) => !a)}
      >
        <X size={14} /> Wrong
      </button>
      {state === "error" && (
        <span className="fb-error">Could not send. Try again.</span>
      )}
      {asking && (
        <form
          className="fb-form"
          onSubmit={(e) => {
            e.preventDefault();
            send("wrong", comment.trim());
          }}
        >
          <input
            aria-label="What was wrong?"
            placeholder="What was wrong? (optional)"
            value={comment}
            maxLength={500}
            onChange={(e) => setComment(e.target.value)}
          />
          <button className="primary" disabled={state === "sending"}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}
