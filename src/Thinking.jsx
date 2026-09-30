import React, { useEffect, useState } from "react";
import { getRetryStatus, onRetryStatus } from "./ai/gemini";

/**
 * Loading state for anything waiting on an AI/ML model: animated dots, a live
 * seconds counter and skeleton lines, plus a hint once the wait gets long so
 * a slow model never looks frozen.
 */
export default function Thinking({
  label = "Thinking…",
  detail,
  lines = 3,
  slowHint = "Still working. Longer answers and first-time model loads take a little more time.",
  compact = false,
}) {
  const [seconds, setSeconds] = useState(0);
  const [retry, setRetry] = useState(getRetryStatus);
  useEffect(() => onRetryStatus(setRetry), []);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className={"ai-thinking" + (compact ? " compact" : "")}
      role="status"
      aria-live="polite"
    >
      <div className="ai-thinking-head">
        <span className="thinking-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="thinking-text">
          <strong>{label}</strong>
          {detail && <small>{detail}</small>}
        </span>
        {seconds > 0 && (
          <span className="thinking-timer" aria-hidden="true">
            {seconds}s
          </span>
        )}
      </div>
      {!compact && lines > 0 && (
        <div className="skeleton" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <i key={i} style={{ width: `${92 - i * 17}%` }} />
          ))}
        </div>
      )}
      {retry ? (
        <p className="thinking-hint">{retry}</p>
      ) : (
        seconds >= 8 && slowHint && <p className="thinking-hint">{slowHint}</p>
      )}
    </div>
  );
}
