import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Square,
  Volume2,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  FileText,
  Plus,
  X,
  Check,
  Sparkles,
  RefreshCw,
  CornerDownRight,
  RotateCcw,
} from "lucide-react";
import { interviewQuestions } from "./logic";
import ExportButtons from "./ExportButtons";
import { exportBlocks } from "./exporters/index";
import { markdownBlocks } from "./exporters/blocks";
import { readResume } from "./resume";
import {
  parseResume,
  hasResumeContent,
  resumeQuestions,
  reviewAnswer,
} from "./ai/interview";
import {
  joinRecognition,
  phoneSpeech,
  preloadSpeech,
  liteSpeech,
  speechSupported,
  transcribe,
  useSpeech,
} from "./ai/speech";
import { hasSpeech, trailingSilence } from "./audio";
import {
  BANDS,
  betterAnswer,
  bandFor,
  deepDiveLength,
  deepDiveTopic,
  deepFollowUp,
  deepFollowUpAI,
  betterAnswerAI,
  geminiCoaching,
  geminiInterviewQuestions,
  mergeVoiceStats,
  questionModelAvailable,
  scoreAnswerOpen,
  withTimeout,
  scoreAnswer,
  voiceReport,
} from "./ai/coach";
import { SpeechTiming, VoiceMeter, voiceAnalysisSupported } from "./voice";
import { useAuth } from "./auth";
import Thinking from "./Thinking";
import Markdown from "./Markdown";
import FeedbackButtons from "./FeedbackButtons";
import { deleteResume, loadResume, saveInterview, saveResume } from "./cloud";

const FORMATS = {
  resume: "From my resume",
  behavioral: "Behavioral & project",
  mixed: "Resume + behavioral",
};
const EXTRA_BEHAVIORAL = [
  "Tell me about a time you disagreed with a teammate. How did you resolve it?",
  "Describe a mistake you made and what you changed afterwards.",
  "Tell me about a time you had to learn something new quickly.",
  "Describe a project you are proud of. What was your exact contribution?",
  "How do you prioritise when several deadlines land in the same week?",
  "Tell me about a time you received critical feedback. What did you do with it?",
  "Describe a complex problem you broke into smaller parts. How did you approach it?",
  "Tell me about a time you helped a teammate succeed.",
  "How do you keep your skills up to date?",
  "What would your first 30 days in this role look like?",
  "Why should we hire you for this role?",
  "Where do you want to grow over the next two years?",
];
const MIN_Q = 1,
  MAX_Q = 15;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clampCount = (n) =>
  Math.max(MIN_Q, Math.min(MAX_Q, Math.round(Number(n) || MIN_Q)));
function behavioral(role, experience, count) {
  return [...interviewQuestions(role, experience), ...EXTRA_BEHAVIORAL].slice(
    0,
    count,
  );
}
function mixed(resumeList, behavioralList, count) {
  const out = [];
  for (
    let i = 0;
    out.length < count &&
    i < Math.max(resumeList.length, behavioralList.length);
    i++
  )
    for (const q of [resumeList[i], behavioralList[i]])
      if (q && out.length < count && !out.includes(q)) out.push(q);
  return out;
}
/** Tops up a question list with behavioral questions until it has `count`. */
function fill(list, role, experience, count) {
  const out = [...list];
  for (const q of behavioral(role, experience, MAX_Q))
    if (out.length < count && !out.includes(q)) out.push(q);
  return out.slice(0, count);
}

/** Which open models power speech and scoring, and whether they are ready. */
function SpeechStatus({ speech, onDevice }) {
  if (!onDevice)
    return (
      <p className="fine speech-status">
        Speech: browser speech service · Scoring: on-device rules.
      </p>
    );
  const parts = [
    ["live", "Moonshine (live speech)"],
    ["final", "Whisper (final transcript)"],
    ["embed", "MiniLM (scoring)"],
  ];
  return (
    <div className="speech-status" aria-label="On-device models">
      {parts.map(([kind, label]) => {
        const status = speech[kind];
        const pct = speech.progress[kind];
        return (
          <span key={kind} className={`model-pill ${status}`}>
            <i aria-hidden="true" />
            {label}
            <small>
              {status === "ready"
                ? "ready"
                : status === "loading"
                  ? `${pct || 0}%`
                  : status === "error"
                    ? "unavailable"
                    : "waiting"}
            </small>
          </span>
        );
      })}
    </div>
  );
}

/** The models this device loads (phones get Whisper tiny; see liteSpeech). */
const deviceModels = () => [
  ["live", "Moonshine", "Live speech-to-text", 28],
  liteSpeech()
    ? ["final", "Whisper tiny", "Final transcript", 41]
    : ["final", "Whisper base", "Final transcript", 74],
  ["embed", "MiniLM", "Answer scoring", 23],
];
export const modelsReady = (speech) =>
  deviceModels().every(([kind]) => speech[kind] === "ready");

/**
 * In-page loading screen while the three open models download (once) and
 * warm up. The studio opens by itself when all three are ready.
 */
function ModelLoader({ speech, onSkip }) {
  const MODELS = deviceModels();
  const mb = MODELS.reduce((n, m) => n + m[3], 0);
  const failed = MODELS.some(([kind]) => speech[kind] === "error");
  const pct = (kind) =>
    speech[kind] === "ready" ? 100 : Math.round(speech.progress[kind] || 0);
  const overall = Math.round(
    MODELS.reduce((n, [kind, , , mb]) => n + pct(kind) * mb, 0) /
      MODELS.reduce((n, [, , , mb]) => n + mb, 0),
  );
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 25000);
    return () => clearTimeout(id);
  }, []);
  return (
    <section
      className="panel model-loader"
      role="status"
      aria-live="polite"
      aria-label="Loading Interview Studio"
    >
      <div className="model-loader-head">
        <span className="thinking-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div>
          <span className="eyebrow">GETTING READY · {overall}%</span>
          <h2>
            {failed
              ? "Voice models could not load."
              : "Loading your interview coach…"}
          </h2>
          <p>
            {failed
              ? "You can still practise by typing your answers. Voice analysis needs the models."
              : `Three open models run on this device, so your voice never leaves it. They download once (about ${mb} MB) and open instantly next time.`}
          </p>
        </div>
      </div>
      <div className="model-loader-bar" aria-hidden="true">
        <i style={{ width: `${overall}%` }} />
      </div>
      <ul className="model-loader-list">
        {MODELS.map(([kind, name, job, mb]) => (
          <li key={kind} className={speech[kind]}>
            <div>
              <strong>{name}</strong>
              <small>
                {job} · {mb} MB
              </small>
            </div>
            <span>
              {speech[kind] === "ready"
                ? "Ready"
                : speech[kind] === "error"
                  ? "Unavailable"
                  : speech[kind] === "loading"
                    ? `${pct(kind)}%`
                    : "Waiting"}
            </span>
            <i aria-hidden="true">
              <b style={{ width: `${pct(kind)}%` }} />
            </i>
          </li>
        ))}
      </ul>
      {(failed || slow) && (
        <button className="secondary" onClick={onSkip}>
          Continue with typing
        </button>
      )}
    </section>
  );
}

/**
 * A Yes / No pill: tap to flip it, or swipe the thumb left (No) or right (Yes).
 */
export function YesNoPill({ label, checked, onChange, disabled }) {
  const touch = useRef(null);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={"yes-no-pill" + (checked ? " yes" : "")}
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const from = touch.current;
        touch.current = null;
        const dx = (e.changedTouches[0]?.clientX ?? from) - from;
        if (from == null || Math.abs(dx) < 18) return;
        // A swipe sets the side it points to; skip the click that follows.
        e.preventDefault();
        onChange(dx > 0);
      }}
      onClick={() => onChange(!checked)}
    >
      <span className="yes-no-thumb" aria-hidden="true" />
      <span className="yes-no-option no">No</span>
      <span className="yes-no-option yes">Yes</span>
    </button>
  );
}

function BandChip({ band, score, pending }) {
  return (
    <span className={`band-chip band-${band}`}>
      <i aria-hidden="true" />
      {BANDS[band].label}
      {score != null && <b>{score}</b>}
      {pending && <em>· refining…</em>}
    </span>
  );
}

export default function InterviewStudio({ active, notify }) {
  const { user } = useAuth();
  const speech = useSpeech();
  // If the live model fails (e.g. a phone ran out of memory), use the
  // browser's own speech service instead.
  // Phones use the browser's speech service: the on-device models use more
  // memory than a phone browser allows, and it reloads the tab mid-answer.
  const phone = useMemo(phoneSpeech, []);
  const onDevice = speechSupported() && !phone && speech.live !== "error";
  // The studio waits for its three open models (see ModelLoader).
  const [skipLoader, setSkipLoader] = useState(false);
  const loadingModels = active && onDevice && !skipLoader && !modelsReady(speech);
  const [role, setRole] = useState("Software Engineer"),
    [experience, setExperience] = useState("Fresher"),
    [format, setFormat] = useState("behavioral"),
    [count, setCount] = useState(3),
    [adaptive, setAdaptive] = useState(true),
    // "Follow up on this answer?" — Yes starts (or continues) a deep dive.
    [digDeeper, setDigDeeper] = useState(false),
    [resume, setResume] = useState(null), // { fileName, text }
    [readingResume, setReadingResume] = useState(false),
    [preparing, setPreparing] = useState(false),
    [preparingNext, setPreparingNext] = useState(false),
    [plan, setPlan] = useState([]),
    [questions, setQuestions] = useState([]),
    [meta, setMeta] = useState({}), // i → { followUp, focus }
    [started, setStarted] = useState(false),
    [index, setIndex] = useState(0),
    [answers, setAnswers] = useState({}),
    [reviews, setReviews] = useState({}),
    [coaching, setCoaching] = useState({}),
    [ratings, setRatings] = useState({}),
    [voiceStats, setVoiceStats] = useState({}),
    [recording, setRecording] = useState(false),
    [polishing, setPolishing] = useState({}), // i → true while Whisper re-reads
    [complete, setComplete] = useState(false);
  const recognition = useRef(null),
    // Once the user picks a number of questions, a resume never changes it.
    countChosen = useRef(false),
    generation = useRef(0),
    wantRecording = useRef(false),
    prep = useRef(0),
    session = useRef(0),
    baseUsed = useRef(0),
    usedFocus = useRef(new Set()),
    meter = useRef(null),
    meterEl = useRef(null),
    timerEl = useRef(null),
    clock = useRef(null),
    answersRef = useRef({}),
    questionsRef = useRef([]),
    live = useRef(null), // on-device recording session
    coachAbort = useRef(null),
    ratingsRef = useRef({}),
    indexRef = useRef(0),
    wakeLock = useRef(null),
    resumeInput = useRef(null);
  answersRef.current = answers;
  questionsRef.current = questions;
  ratingsRef.current = ratings;
  indexRef.current = index;
  const profile = useMemo(
    () => (resume ? parseResume(resume.text) : null),
    [resume],
  );
  const transcript = answers[index] || "";
  const review = useMemo(
    () =>
      reviews[index]
        ? {
            checklist: reviewAnswer(transcript),
            rating: scoreAnswer(transcript, questions[index]),
            better: betterAnswer(questions[index], transcript),
          }
        : null,
    [reviews, index, transcript, questions],
  );

  // Restore the signed-in user's saved resume.
  useEffect(() => {
    if (!user) return;
    let live = true;
    loadResume(user.uid)
      .then((saved) => {
        if (live && saved?.text) {
          setResume({ fileName: saved.fileName, text: saved.text });
          setFormat("resume");
          if (!countChosen.current) setCount(5);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user]);

  // ---- Recording: speech-to-text + live voice analysis --------------------
  function stopRecording() {
    wantRecording.current = false;
    generation.current++;
    const liveSession = live.current;
    live.current = null;
    if (liveSession) {
      clearInterval(liveSession.loop);
      finalizeTranscript(liveSession);
    }
    const current = recognition.current;
    recognition.current = null;
    try {
      current?.stop();
    } catch {}
    clearInterval(clock.current);
    wakeLock.current?.release?.().catch?.(() => {});
    wakeLock.current = null;
    if (meterEl.current) meterEl.current.style.setProperty("--level", "0");
    const m = meter.current;
    meter.current = null;
    const stats = m?.stop?.();
    if (stats && m.index != null)
      setVoiceStats((v) => ({
        ...v,
        [m.index]: mergeVoiceStats(v[m.index], stats),
      }));
    setRecording(false);
  }
  function stop() {
    stopRecording();
    window.speechSynthesis?.cancel();
  }
  useEffect(() => {
    if (!active) stop();
    else preloadSpeech(); // download/warm the open models before they are needed
    return stop;
  }, [active]);
  function reset() {
    stop();
    prep.current++;
    session.current++;
    setPreparing(false);
    setPreparingNext(false);
    setStarted(false);
    setIndex(0);
    setAnswers({});
    setReviews({});
    setCoaching({});
    setRatings({});
    setVoiceStats({});
    setMeta({});
    setDigDeeper(false);
    setComplete(false);
  }
  function updateAt(i, text) {
    setAnswers((a) => ({ ...a, [i]: text }));
    setReviews((r) => ({ ...r, [i]: false }));
    setCoaching((c) => ({ ...c, [i]: undefined }));
  }
  const update = (text) => updateAt(index, text);

  async function addResume(file) {
    if (!file) return;
    setReadingResume(true);
    try {
      const text = await readResume(file);
      const next = { fileName: file.name, text };
      const parsed = parseResume(text);
      reset();
      setResume(next);
      if (hasResumeContent(parsed)) {
        setFormat("resume");
        if (!countChosen.current) setCount(5);
      }
      notify(
        hasResumeContent(parsed)
          ? `Resume read: ${plural(parsed.skills.length, "skill")}, ${plural(parsed.projects.length, "project")}, ${plural(parsed.experience.length, "role")} found.`
          : "Resume read, but few sections were recognised. Questions will be more general.",
      );
      if (user)
        saveResume(user.uid, next).catch(() =>
          notify(
            "Resume is ready here but could not be saved to your account.",
          ),
        );
    } catch (e) {
      notify(e.message || "Could not read this resume.");
    } finally {
      setReadingResume(false);
      if (resumeInput.current) resumeInput.current.value = "";
    }
  }
  function removeResume() {
    reset();
    setResume(null);
    setFormat("behavioral");
    if (!countChosen.current) setCount(3);
    if (user) deleteResume(user.uid).catch(() => {});
  }

  function begin(list) {
    baseUsed.current = 1;
    usedFocus.current = new Set();
    setPlan(list);
    setQuestions(list.slice(0, 1));
    setStarted(true);
  }
  function start() {
    reset();
    const n = clampCount(count);
    const resumeList = resumeQuestions(profile, role, experience, n);
    const base =
      format === "resume" && resume
        ? fill(resumeList, role, experience, n)
        : format === "mixed" && resume
          ? fill(
              mixed(resumeList, behavioral(role, experience, n), n),
              role,
              experience,
              n,
            )
          : fill(behavioral(role, experience, n), role, experience, n);
    // Questions come from Gemini only; without it, the built-in bank is used.
    if (!(resume && format !== "behavioral" && questionModelAvailable()))
      return begin(base);
    const token = ++prep.current;
    setPreparing(true);
    geminiInterviewQuestions({
      resumeText: resume.text,
      role,
      experience,
      count: n,
    })
      .then((qs) => {
        if (prep.current !== token) return;
        if (!qs) return begin(base);
        begin(
          fill(
            format === "mixed"
              ? mixed(qs, behavioral(role, experience, n), n)
              : qs,
            role,
            experience,
            n,
          ),
        );
      })
      .finally(() => prep.current === token && setPreparing(false));
  }

  // ---- Rating ---------------------------------------------------------------
  /** Instant rating now; an AI rating replaces it when it arrives. */
  /**
   * Instant rating now; then the on-device MiniLM model refines relevance and
   * Gemini (when set up) writes the better answer. Nothing blocks the UI.
   */
  function rate(i, question, answer) {
    if (!answer?.trim()) return;
    const instant = {
      ...scoreAnswer(answer, question),
      better: betterAnswer(question, answer),
      answer,
      source: "built-in",
      pending: true,
    };
    setRatings((r) =>
      r[i]?.answer === answer && !r[i]?.pending ? r : { ...r, [i]: instant },
    );
    const token = session.current;
    Promise.all([
      scoreAnswerOpen(question, answer),
      betterAnswerAI({ question, answer, role }),
    ]).then(([score, better]) => {
      if (session.current !== token || answersRef.current[i] !== answer) return;
      setRatings((r) => ({
        ...r,
        [i]: {
          ...score,
          better: better.better,
          betterBy: better.source,
          answer,
          pending: false,
        },
      }));
    });
  }

  // ---- Moving through the interview -----------------------------------------
  /**
   * The deep dive to continue after question i, if the user chose "Yes":
   * a new one on this answer's topic, or the next level of the current one.
   * After its 5–7 follow-ups the interview returns to the main questions.
   */
  function deepDiveAfter(i) {
    if (!adaptive || !digDeeper) return null;
    const m = meta[i] || {};
    if (m.followUp)
      return m.depth < m.of
        ? { topic: m.focus, depth: m.depth + 1, of: m.of, root: m.root }
        : null;
    return {
      topic: deepDiveTopic(answers[i] || "", questions[i]),
      depth: 1,
      of: deepDiveLength(),
      root: i,
    };
  }
  async function next() {
    const i = index;
    const answer = answers[i] || "";
    stopRecording();
    rate(i, questions[i], answer);
    if (i < questions.length - 1) return setIndex(i + 1);
    const total = clampCount(count);
    const token = session.current;
    const dive = deepDiveAfter(i);
    let nextQuestion,
      nextMeta = {};
    if (dive) {
      const history = questions
        .slice(dive.root, i + 1)
        .map((q, k) => ({ q, a: answers[dive.root + k] || "" }));
      let follow;
      if (questionModelAvailable()) {
        setPreparingNext(true);
        follow = await deepFollowUpAI({ ...dive, history, role });
        setPreparingNext(false);
        if (session.current !== token) return;
      } else
        follow = deepFollowUp({
          topic: dive.topic,
          depth: dive.depth,
          answer,
          asked: history.map((h) => h.q),
        });
      nextQuestion = follow.question;
      nextMeta = {
        followUp: true,
        focus: dive.topic,
        depth: dive.depth,
        of: dive.of,
        root: dive.root,
      };
    } else {
      const lastDive = meta[i]?.followUp ? meta[i].focus : null;
      if (baseUsed.current >= total) return finish();
      nextQuestion = plan[baseUsed.current];
      if (!nextQuestion) return finish();
      baseUsed.current++;
      nextMeta = lastDive ? { afterDive: lastDive } : {};
      setDigDeeper(false);
    }
    setQuestions((q) => [...q, nextQuestion]);
    setMeta((m) => ({ ...m, [i + 1]: nextMeta }));
    setIndex(i + 1);
  }

  function finish() {
    stop();
    // Rate any answer that changed since it was last rated.
    questions.forEach((q, i) => {
      const a = answers[i] || "";
      if (a.trim() && ratings[i]?.answer !== a) rate(i, q, a);
    });
    setComplete(true);
    if (user) {
      const scored = questions.map((q, i) => scoreAnswer(answers[i] || "", q));
      saveInterview(user.uid, {
        role,
        experience,
        format: FORMATS[format],
        resumeFile: resume?.fileName || null,
        questions,
        followUps: questions.map((_, i) => meta[i]?.focus || null),
        answers: questions.map((_, i) => answers[i] || ""),
        scores: scored.map((s) => s.score),
        bands: scored.map((s) => s.band),
      })
        .then(() => notify("Practice session saved to your account."))
        .catch(() =>
          notify(
            "Session kept here, but it could not be saved to your account.",
          ),
        );
    }
  }

  const joinText = (...parts) =>
    parts
      .map((p) => (p || "").trim())
      .filter(Boolean)
      .join(" ");

  /**
   * On-device recording: Moonshine transcribes the sentence being spoken every
   * 0.7 s; a pause of 0.8 s closes that sentence, so audio is never
   * re-transcribed and the text keeps up with the speaker.
   */
  async function voiceOnDevice() {
    window.speechSynthesis?.cancel();
    const token = ++generation.current;
    const i = index;
    const session = {
      token,
      i,
      base: transcript.trim(),
      committed: "",
      segStart: 0,
    };
    const m = new VoiceMeter();
    m.index = i;
    meter.current = m;
    session.meter = m;
    live.current = session;
    wantRecording.current = true;
    setRecording(true);
    try {
      await m.start((level) =>
        meterEl.current?.style.setProperty(
          "--level",
          Math.min(1, level * 9).toFixed(3),
        ),
      );
    } catch (e) {
      if (live.current === session) live.current = null;
      stopRecording();
      notify(
        e?.name === "NotAllowedError"
          ? "Microphone access was denied. You can type your answer instead."
          : "Could not start the microphone. You can type your answer instead.",
      );
      return;
    }
    if (generation.current !== token) return;
    const started = Date.now();
    clearInterval(clock.current);
    clock.current = setInterval(() => {
      if (!timerEl.current) return;
      const sec = Math.floor((Date.now() - started) / 1000);
      timerEl.current.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    }, 250);
    session.loop = setInterval(async () => {
      if (generation.current !== token) return;
      const endSec = m.capturedSec;
      const segment = m.audio(session.segStart);
      if (segment.length < 16000 * 0.5) return;
      if (!hasSpeech(segment)) {
        // Long silence: move the window forward so it is not re-read.
        if (segment.length > 16000 * 3) session.segStart = endSec - 0.5;
        return;
      }
      const tail = trailingSilence(segment);
      const closing = tail >= 0.8 || segment.length > 16000 * 14;
      const text = await transcribe(segment, { quality: "live" });
      if (generation.current !== token || text == null) return;
      if (closing) {
        session.committed = joinText(session.committed, text);
        session.segStart = endSec - Math.min(tail, 0.3);
        session.written = joinText(session.base, session.committed);
      } else session.written = joinText(session.base, session.committed, text);
      updateAt(i, session.written);
    }, 700);
  }

  /** After recording: Whisper re-reads the whole answer for the final text. */
  async function finalizeTranscript(session) {
    const m = session.meter;
    if (!m?.capturedSec) return;
    const audio = m.audio(0);
    if (!hasSpeech(audio)) return;
    const { i, base } = session;
    setPolishing((p) => ({ ...p, [i]: true }));
    const text = await withTimeout(
      transcribe(audio, { quality: "final" }),
      30000,
      null,
    );
    setPolishing((p) => ({ ...p, [i]: false }));
    if (!text) return;
    // Only replace text that the live transcription wrote (never user edits).
    const current = answersRef.current[i] || "";
    if (session.written != null && current !== session.written) return;
    const finalText = joinText(base, text);
    updateAt(i, finalText);
    if (ratingsRef.current[i]) rate(i, questionsRef.current[i], finalText);
  }

  function voice() {
    if (recording) return stopRecording();
    if (onDevice) return voiceOnDevice();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      notify(
        "Speech recognition is not available in this browser. You can type your answer below.",
      );
      return;
    }
    window.speechSynthesis?.cancel();
    const token = ++generation.current;
    const i = index;
    let base = transcript.trim(),
      restarts = 0,
      quickEnds = 0,
      listening = 0;
    wantRecording.current = true;
    // Phones: the speech service owns the microphone, so voice stats come
    // from when words arrive (see SpeechTiming), and the screen stays awake.
    const timing = phone ? new SpeechTiming() : null;
    if (timing) {
      timing.index = i;
      meter.current = timing;
      navigator.wakeLock
        ?.request?.("screen")
        .then((lock) => {
          if (generation.current === token) wakeLock.current = lock;
          else lock.release().catch(() => {});
        })
        .catch(() => {});
    }
    const listen = () => {
      const r = new SR();
      recognition.current = r;
      listening = Date.now();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (event) => {
        if (generation.current !== token) return;
        const spoken = joinRecognition(event.results);
        if (timing) {
          timing.mark();
          const el = meterEl.current;
          el?.style.setProperty("--level", "0.6");
          setTimeout(() => el?.style.setProperty("--level", "0.15"), 260);
        }
        updateAt(
          i,
          [base, spoken].filter(Boolean).join(" ").replace(/\s+/g, " "),
        );
      };
      r.onerror = (event) => {
        if (generation.current !== token) return;
        if (event.error === "no-speech" || event.error === "aborted") return; // onend restarts
        // Phone speech services drop out briefly; onend tries again.
        if (
          phone &&
          (event.error === "network" || event.error === "audio-capture") &&
          quickEnds < 3
        )
          return;
        notify(
          event.error === "not-allowed"
            ? "Microphone access was denied. You can type your answer instead."
            : "Speech recognition stopped. Your transcript is kept; you can type or try again.",
        );
        stopRecording();
      };
      r.onend = () => {
        if (generation.current !== token) return;
        // Browsers end recognition after a silence: carry on seamlessly.
        // Phones end it every few seconds, so they restart for as long as
        // the user is recording, unless it keeps ending at once.
        quickEnds = Date.now() - listening < 1000 ? quickEnds + 1 : 0;
        if (
          wantRecording.current &&
          (phone ? quickEnds < 5 : restarts < 40)
        ) {
          restarts++;
          base = (answersRef.current[i] || "").trim();
          setTimeout(
            () => {
              if (generation.current !== token || !wantRecording.current)
                return;
              try {
                listen();
              } catch {
                stopRecording();
                if (phone)
                  notify(
                    "Listening paused. Your transcript is kept: tap Answer with voice to continue.",
                  );
              }
            },
            phone ? 250 : 120,
          );
          return;
        }
        if (phone) {
          stopRecording();
          if (quickEnds >= 5)
            notify(
              "Your phone's speech service stopped listening. Your transcript is kept: tap Answer with voice to try again.",
            );
          return;
        }
        recognition.current = null;
        setRecording(false);
      };
      r.start();
    };
    try {
      listen();
      setRecording(true);
    } catch {
      stopRecording();
      notify(
        "Could not start speech recognition. You can type your answer instead.",
      );
      return;
    }
    // Live voice analysis (level meter + timer) without re-rendering React.
    const started = Date.now();
    clearInterval(clock.current);
    clock.current = setInterval(() => {
      if (timerEl.current) {
        const s = Math.floor((Date.now() - started) / 1000);
        timerEl.current.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      }
    }, 250);
    if (!phone && voiceAnalysisSupported()) {
      const m = new VoiceMeter();
      m.index = i;
      meter.current = m;
      m.start((level) =>
        meterEl.current?.style.setProperty(
          "--level",
          Math.min(1, level * 9).toFixed(3),
        ),
      ).catch(() => {
        if (meter.current === m) meter.current = null;
      });
    }
  }
  function readQuestion() {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      notify("Read aloud is unavailable in this browser.");
      return;
    }
    stop();
    const u = new window.SpeechSynthesisUtterance(questions[index]);
    u.onerror = () => notify("Question playback was unavailable.");
    window.speechSynthesis.speak(u);
  }
  async function coach() {
    const i = index;
    setCoaching((c) => ({ ...c, [i]: { status: "writing", text: "" } }));
    const controller = new AbortController();
    coachAbort.current = controller;
    try {
      const text = await geminiCoaching({
        signal: controller.signal,
        question: questions[i],
        answer: answers[i],
        role,
        resumeText: resume?.text,
        onToken: (t) =>
          setCoaching((c) => ({
            ...c,
            [i]: { status: "writing", text: (c[i]?.text || "") + t },
          })),
      });
      setCoaching((c) => ({
        ...c,
        [i]: { status: "done", text: text.trim() || c[i]?.text },
      }));
    } catch (e) {
      setCoaching((c) => ({ ...c, [i]: undefined }));
      notify(e.message || "AI coaching is unavailable right now.");
    }
  }
  const coachState = coaching[index];
  const total = clampCount(count);
  // Main (resume / behavioral) questions; deep-dive follow-ups come on top.
  const mainAt = questions.reduce(
    (list, _, i) => (meta[i]?.followUp ? list : [...list, i]),
    [],
  );
  const mainNo = mainAt.filter((i) => i <= index).length;
  const current = meta[index] || {};
  const atFrontier = started && index === questions.length - 1;
  const diveDone = current.followUp && current.depth >= current.of;
  const goingDeeper = adaptive && digDeeper && !diveDone;
  const isLast = atFrontier && !goingDeeper && mainAt.length >= total;

  // ---- Report ----------------------------------------------------------------
  const report = useMemo(() => {
    if (!complete) return null;
    const items = questions.map((q, i) => {
      const a = answers[i] || "";
      const r =
        ratings[i]?.answer === a
          ? ratings[i]
          : a.trim()
            ? { ...scoreAnswer(a, q), better: betterAnswer(q, a) }
            : null;
      return {
        q,
        a,
        r,
        meta: meta[i] || {},
        voice: voiceReport(voiceStats[i], a),
      };
    });
    const rated = items.filter((x) => x.r);
    const overall = rated.length
      ? Math.round(rated.reduce((n, x) => n + x.r.score, 0) / rated.length)
      : 0;
    const counts = { red: 0, yellow: 0, blue: 0 };
    rated.forEach((x) => counts[x.r.band]++);
    const allVoice = Object.values(voiceStats).reduce(
      (acc, s) => mergeVoiceStats(acc, s),
      null,
    );
    const voice = voiceReport(
      allVoice,
      Object.keys(voiceStats)
        .map((i) => answers[i] || "")
        .join(" "),
    );
    return {
      items,
      overall,
      band: bandFor(overall),
      counts,
      voice,
      answered: rated.length,
    };
  }, [complete, questions, answers, ratings, meta, voiceStats]);

  /** Styled PDF / Word documents: the full report, or the transcript. */
  const header = (subtitle) => [
    { type: "title", text: `Interview — ${role}` },
    { type: "subtitle", text: subtitle },
    {
      type: "meta",
      text: `${experience} · ${FORMATS[format]} · ${questions.length} question${questions.length === 1 ? "" : "s"} · ${new Date().toLocaleDateString()}`,
    },
  ];
  const questionMeta = (x) =>
    [
      x.r ? `${x.r.score}/100 · ${x.r.label}` : "Not answered",
      x.meta.followUp &&
        `Follow-up ${x.meta.depth || ""}${x.meta.of ? `/${x.meta.of}` : ""} on “${x.meta.focus}”`,
    ]
      .filter(Boolean)
      .join(" · ");
  function reportBlocks() {
    const blocks = [
      ...header(
        `Report · ${report.overall}/100 · ${BANDS[report.band].label}`,
      ),
      { type: "h", level: 1, text: "Summary" },
      {
        type: "table",
        rows: [
          ["Overall", "Strong", "Fair", "Needs work"],
          [
            `${report.overall}/100`,
            String(report.counts.blue),
            String(report.counts.yellow),
            String(report.counts.red),
          ],
        ],
      },
    ];
    if (report.voice)
      blocks.push(
        { type: "h", level: 2, text: "Voice" },
        {
          type: "table",
          rows: [
            ["Score", "Pace", "Long pauses", "Filler words", ...(report.voice.steadiness != null ? ["Steadiness"] : [])],
            [
              `${report.voice.score}/100 · ${BANDS[report.voice.band].label}`,
              `${report.voice.wpm} words/min`,
              String(report.voice.pauses),
              String(report.voice.fillers),
              ...(report.voice.steadiness != null ? [`${report.voice.steadiness}%`] : []),
            ],
          ],
        },
        ...report.voice.tips.map((t) => ({ type: "li", indent: 0, text: t })),
      );
    blocks.push({ type: "h", level: 1, text: "Questions and answers" });
    report.items.forEach((x, i) => {
      blocks.push(
        { type: "question", n: i + 1, text: x.q, meta: questionMeta(x) },
        { type: "label", text: "Your answer" },
        x.a
          ? { type: "p", text: x.a, plain: true }
          : { type: "p", text: "*No answer recorded.*" },
      );
      if (x.r) {
        if (x.r.strengths.length) {
          blocks.push({ type: "h", level: 4, text: "What worked" });
          x.r.strengths.slice(0, 4).forEach((t) => blocks.push({ type: "li", indent: 0, text: `✓ ${t}` }));
        }
        if (x.r.improvements.length) {
          blocks.push({ type: "h", level: 4, text: "How to improve" });
          x.r.improvements.forEach((t) => blocks.push({ type: "li", indent: 0, text: t }));
        }
        if (x.r.better) blocks.push(...markdownBlocks(x.r.better, { shift: 1 }));
      }
      blocks.push({ type: "rule" });
    });
    return blocks;
  }
  function transcriptBlocks(only) {
    const items = questions
      .map((q, i) => ({ q, i, a: answers[i]?.trim() }))
      .filter((x) => only == null || x.i === only);
    return [
      ...header(only == null ? "Full transcript" : `Answer ${only + 1}`),
      ...items.flatMap(({ q, i, a }) => [
        {
          type: "question",
          n: i + 1,
          text: q,
          meta: meta[i]?.followUp ? `Follow-up on “${meta[i].focus}”` : "",
        },
        { type: "label", text: "Your answer" },
        a ? { type: "p", text: a, plain: true } : { type: "p", text: "*No answer recorded.*" },
        { type: "rule" },
      ]),
    ];
  }
  const exportInterview = (format, kind, only) =>
    exportBlocks({
      format,
      blocks: kind === "report" ? reportBlocks() : transcriptBlocks(only),
      name: [
        `Interview - ${role}`,
        kind === "report"
          ? "Report"
          : only == null
            ? "Transcript"
            : `Answer ${only + 1}`,
      ],
    });
  function practiseWeak() {
    const weak = report.items
      .filter((x) => !x.r || x.r.band !== "blue")
      .map((x) => x.q);
    if (!weak.length)
      return notify("Every answer was strong. Try a longer session!");
    reset();
    setCount(weak.length);
    begin(weak);
  }

  return (
    <div hidden={!active}>
      <section className="page-title">
        <div className="eyebrow">INTERVIEW STUDIO</div>
        <h1>Meet your next chapter.</h1>
        <p>
          Practice out loud. Get deeper follow-ups, a rating for every answer
          and a voice report.
        </p>
      </section>
      {loadingModels ? (
        <ModelLoader speech={speech} onSkip={() => setSkipLoader(true)} />
      ) : (
      <div className="interview-grid">
        <section className="panel setup">
          <span className="eyebrow">01 / SET THE SCENE</span>
          <h2>Your next role.</h2>
          <div className="resume-block">
            <span className="field-label">Resume / CV (optional)</span>
            {resume ? (
              <div className="resume-card">
                <div className="resume-head">
                  <span className="document-icon">
                    <FileText size={20} />
                  </span>
                  <div>
                    <strong>{resume.fileName}</strong>
                    <small>
                      {plural(profile.skills.length, "skill")} ·{" "}
                      {plural(profile.projects.length, "project")} ·{" "}
                      {plural(profile.experience.length, "role")}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Remove resume"
                    onClick={removeResume}
                  >
                    <X size={16} />
                  </button>
                </div>
                {profile.skills.length > 0 && (
                  <div
                    className="chips"
                    aria-label="Skills found on your resume"
                  >
                    {profile.skills.slice(0, 10).map((s) => (
                      <span className="chip" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {profile.summary.length > 0 && (
                  <details className="resume-summary">
                    <summary>Resume summary</summary>
                    <ul>
                      {profile.summary.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  className="text-button"
                  disabled={readingResume}
                  onClick={() => resumeInput.current.click()}
                >
                  <RefreshCw size={14} /> Replace resume
                </button>
              </div>
            ) : (
              <button
                className="dropzone resume-drop"
                disabled={readingResume}
                onClick={() => resumeInput.current.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addResume(e.dataTransfer.files[0]);
                }}
              >
                <Plus size={20} />
                <strong aria-live="polite">
                  {readingResume
                    ? "Reading your resume…"
                    : "Add your resume for tailored questions"}
                </strong>
                <small>PDF, DOCX or TXT · up to 10 MB</small>
              </button>
            )}
            <input
              ref={resumeInput}
              type="file"
              hidden
              aria-label="Choose resume file"
              accept=".pdf,.docx,.txt"
              onChange={(e) => addResume(e.target.files[0])}
            />
          </div>
          <label>
            What role are you applying for?
            <input
              value={role}
              onChange={(e) => {
                reset();
                setRole(e.target.value);
              }}
              placeholder="e.g. Software Engineer"
            />
          </label>
          <label>
            Experience
            <select
              value={experience}
              onChange={(e) => {
                reset();
                setExperience(e.target.value);
              }}
            >
              <option>Fresher</option>
              <option>1–3 years</option>
              <option>3–5 years</option>
              <option>5+ years</option>
            </select>
          </label>
          <label>
            Practice format
            <select
              value={format}
              onChange={(e) => {
                reset();
                setFormat(e.target.value);
              }}
            >
              {Object.entries(FORMATS).map(([value, label]) => (
                <option
                  key={value}
                  value={value}
                  disabled={value !== "behavioral" && !resume}
                >
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="count-field">
            <label htmlFor="question-count">Number of questions</label>
            <div className="count-row">
              <input
                type="range"
                min={MIN_Q}
                max={MAX_Q}
                value={clampCount(count)}
                aria-label="Number of questions slider"
                onChange={(e) => {
                  reset();
                  countChosen.current = true;
                  setCount(Number(e.target.value));
                }}
              />
              <input
                id="question-count"
                type="number"
                min={MIN_Q}
                max={MAX_Q}
                value={count}
                onChange={(e) => {
                  reset();
                  countChosen.current = true;
                  setCount(e.target.value === "" ? "" : Number(e.target.value));
                }}
                onBlur={() => setCount(clampCount(count))}
              />
            </div>
          </div>
          <div className="toggle-row">
            <span>
              <strong>Deeper follow-up questions</strong>
              <small>
                After any answer, choose Yes to get 5–7 follow-ups that dig
                deeper into it, then carry on with your main questions.
              </small>
            </span>
            <YesNoPill
              label="Deeper follow-up questions"
              checked={adaptive}
              onChange={(on) => {
                reset();
                setAdaptive(on);
              }}
            />
          </div>
          <button
            className="primary"
            disabled={!role.trim() || preparing}
            onClick={start}
          >
            {preparing
              ? "Preparing your questions…"
              : started
                ? "Restart practice"
                : "Start practice"}
            <ArrowRight size={17} />
          </button>
          <p className="fine">
            {resume
              ? "Questions reference the projects, roles, skills and results on your resume."
              : "Add a resume for questions about your own projects and experience."}{" "}
            {questionModelAvailable()
              ? "Questions and model answers: Gemini."
              : "Questions: built-in question bank (add a Gemini key for tailored ones)."}
          </p>
          <SpeechStatus speech={speech} onDevice={onDevice} />
        </section>
        <section className="panel interview-main">
          <div className="section-kicker">
            <span>
              {complete
                ? "SESSION COMPLETE"
                : started
                  ? `QUESTION ${mainNo} OF ${total}` +
                    (current.followUp
                      ? ` · FOLLOW-UP ${current.depth} OF ${current.of}`
                      : "")
                  : "02 / FIND YOUR VOICE"}
            </span>
            <Mic size={20} />
          </div>
          {started && !complete && (
            <div className="interview-progress" aria-hidden="true">
              {Array.from({ length: total }, (_, k) => {
                const r = ratings[mainAt[k]];
                return (
                  <i
                    key={k}
                    className={
                      (k === mainNo - 1 ? "current " : "") +
                      (r ? `band-${r.band}` : k < mainAt.length ? "asked" : "")
                    }
                  />
                );
              })}
            </div>
          )}
          {complete && report ? (
            <div className="interview-report">
              <div className="report-hero">
                <div
                  className={`score-ring band-${report.band}`}
                  style={{ "--score": report.overall }}
                  aria-label={`Overall score ${report.overall} out of 100`}
                >
                  <strong>{report.overall}</strong>
                  <small>/ 100</small>
                </div>
                <div>
                  <h2>You showed up. Keep going.</h2>
                  <p>
                    Your {report.answered} answers are saved in this session
                    {user ? " and your account" : ""}.
                  </p>
                  <div className="band-legend">
                    <span className="band-chip band-blue">
                      <i /> Strong <b>{report.counts.blue}</b>
                    </span>
                    <span className="band-chip band-yellow">
                      <i /> Fair <b>{report.counts.yellow}</b>
                    </span>
                    <span className="band-chip band-red">
                      <i /> Needs work <b>{report.counts.red}</b>
                    </span>
                  </div>
                </div>
              </div>
              {report.voice ? (
                <div className="voice-card">
                  <div className="voice-card-head">
                    <strong>
                      <Mic size={16} /> Voice analysis
                    </strong>
                    <BandChip
                      band={report.voice.band}
                      score={report.voice.score}
                    />
                  </div>
                  <div className="voice-metrics">
                    <div>
                      <b>{report.voice.wpm}</b>
                      <small>words / min</small>
                    </div>
                    <div>
                      <b>{report.voice.pauses}</b>
                      <small>long pauses</small>
                    </div>
                    <div>
                      <b>{report.voice.fillers}</b>
                      <small>filler words</small>
                    </div>
                    {report.voice.steadiness != null && (
                      <div>
                        <b>{report.voice.steadiness}%</b>
                        <small>volume steadiness</small>
                      </div>
                    )}
                  </div>
                  <ul className="checklist">
                    {report.voice.tips.map((t) => (
                      <li key={t}>
                        <ArrowRight size={15} /> {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="fine">
                  Answer with your voice next time to get pace, pause and
                  filler-word analysis.
                </p>
              )}
              {report.items.map((x, i) => (
                <article
                  key={i}
                  className={"report-item" + (x.r ? ` band-${x.r.band}` : "")}
                >
                  <div className="report-item-head">
                    <span className="q-num">Q{i + 1}</span>
                    {x.meta.followUp && (
                      <span className="tag">
                        <CornerDownRight size={12} /> Follow-up{" "}
                        {x.meta.depth}/{x.meta.of} · {x.meta.focus}
                      </span>
                    )}
                    {x.r && (
                      <BandChip
                        band={x.r.band}
                        score={x.r.score}
                        pending={x.r.pending}
                      />
                    )}
                  </div>
                  <h3>
                    {i + 1}. {x.q}
                  </h3>
                  <p>{x.a || "No answer recorded."}</p>
                  {x.r && (
                    <details className="report-details">
                      <summary>How to make it better</summary>
                      <ul className="checklist">
                        {x.r.strengths.slice(0, 3).map((s) => (
                          <li key={s} className="good">
                            <Check size={15} /> {s}
                          </li>
                        ))}
                        {x.r.improvements.slice(0, 4).map((s) => (
                          <li key={s}>
                            <ArrowRight size={15} /> {s}
                          </li>
                        ))}
                      </ul>
                      {x.r.better && (
                        <div className="better-answer">
                          <Markdown>{x.r.better}</Markdown>
                        </div>
                      )}
                      <FeedbackButtons
                        kind="interview"
                        item={`Q: ${x.q}\nAnswer: ${x.a.slice(0, 500)}\nRating: ${x.r.score}/100 (${x.r.label})`}
                        label="Was this rating fair?"
                      />
                    </details>
                  )}
                </article>
              ))}
              <div className="button-row">
                <ExportButtons
                  label="Full transcript"
                  className="secondary"
                  notify={notify}
                  onExport={(f) => exportInterview(f, "transcript")}
                />
                <ExportButtons
                  label="Report"
                  className="secondary"
                  notify={notify}
                  onExport={(f) => exportInterview(f, "report")}
                />
                <button className="secondary" onClick={practiseWeak}>
                  <RotateCcw size={16} /> Practise weaker answers
                </button>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setComplete(false);
                  setIndex(0);
                }}
              >
                Review my answers
              </button>
            </div>
          ) : (
            <>
              <div className="interview-question">
                <div
                  className={"voice-symbol " + (recording ? "recording" : "")}
                >
                  <Mic size={32} />
                </div>
                {started && current.followUp && (
                  <div className="deep-dive-head">
                    <span className="followup-tag">
                      <CornerDownRight size={13} /> Follow-up on “
                      {current.focus}”
                    </span>
                    <span
                      className="deep-dive-steps"
                      aria-label={`Deep dive ${current.depth} of ${current.of}`}
                    >
                      {Array.from({ length: current.of }, (_, k) => (
                        <i
                          key={k}
                          className={k < current.depth ? "done" : ""}
                        />
                      ))}
                      <small>
                        {current.depth} / {current.of}
                      </small>
                    </span>
                  </div>
                )}
                {started && current.afterDive && (
                  <span className="followup-tag back">
                    <Check size={13} /> Deep dive on “{current.afterDive}”
                    done · back to your questions
                  </span>
                )}
                <h2>
                  {started
                    ? questions[index]
                    : "A little practice. A little more you."}
                </h2>
                {!started && preparing && (
                  <Thinking
                    label="Preparing your questions…"
                    detail="Reading your resume to write questions about your own projects and results."
                    lines={0}
                  />
                )}
                {!started && !preparing && (
                  <p>
                    {resume
                      ? `Your resume is ready. Start a ${total}-question session tailored to it.`
                      : `Set your role to begin a ${total}-question practice session.`}
                  </p>
                )}
              </div>
              {started && (
                <>
                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={voice}
                      disabled={preparingNext}
                    >
                      {recording ? <Square size={16} /> : <Mic size={16} />}{" "}
                      {recording ? "Stop recording" : "Answer with voice"}
                    </button>
                    <button
                      className="secondary"
                      aria-label="Read question aloud"
                      onClick={readQuestion}
                    >
                      <Volume2 size={17} />
                    </button>
                  </div>
                  <div
                    className={"live-voice" + (recording ? " on" : "")}
                    ref={meterEl}
                    aria-hidden={!recording}
                  >
                    <span className="live-dot" />
                    <span className="live-bars">
                      {Array.from({ length: 12 }, (_, i) => (
                        <i key={i} style={{ "--i": i }} />
                      ))}
                    </span>
                    <span ref={timerEl} className="live-timer">
                      0:00
                    </span>
                    <small>
                      Listening · pace, pauses and fillers are analysed
                    </small>
                  </div>
                  <p className="fine">
                    {onDevice
                      ? "Your voice is transcribed on this device by open models (Moonshine live, Whisper final). No audio is uploaded."
                      : phone
                        ? "On phones your browser's own speech service transcribes your answer: it is lighter and keeps going for long answers."
                        : "This browser can't run the on-device speech models, so its built-in speech service is used."}{" "}
                    Typing is always available.
                  </p>
                  {polishing[index] && (
                    <Thinking
                      label="Polishing your transcript…"
                      detail="Whisper is re-reading your answer on this device for the most accurate text."
                      lines={0}
                      compact
                    />
                  )}
                  <label className="transcript-label">
                    Your transcript
                    <textarea
                      value={transcript}
                      disabled={recording || preparingNext || polishing[index]}
                      onChange={(e) => update(e.target.value)}
                      placeholder="Your words will appear here. You can also type your answer."
                    />
                  </label>
                  {adaptive && atFrontier && !preparingNext && (
                    <div className="follow-choice">
                      <div>
                        <strong id="follow-choice-label">
                          {current.followUp
                            ? diveDone
                              ? "Deep dive complete"
                              : "Keep going deeper?"
                            : "Follow up on this answer?"}
                        </strong>
                        <small>
                          {current.followUp
                            ? diveDone
                              ? "Next: back to your main questions."
                              : `Yes: follow-up ${current.depth + 1} of ${current.of} on “${current.focus}”. No: back to your main questions.`
                            : "Yes: 5–7 deeper follow-ups on this topic, then back to your main questions."}
                        </small>
                      </div>
                      <YesNoPill
                        label="Follow-up questions"
                        checked={goingDeeper}
                        disabled={diveDone || recording}
                        onChange={setDigDeeper}
                      />
                    </div>
                  )}
                  {preparingNext ? (
                    <Thinking
                      label="Thinking of a deeper follow-up…"
                      detail="Picking the most interesting tech, number or decision from your answer."
                      lines={0}
                      compact
                    />
                  ) : (
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={!transcript.trim() || recording}
                        onClick={() =>
                          setReviews((r) => ({ ...r, [index]: true }))
                        }
                      >
                        Review answer <ArrowUpRight size={16} />
                      </button>
                      <button
                        className="text-button"
                        disabled={!transcript.trim() || recording}
                        onClick={next}
                      >
                        {isLast ? "Finish practice" : "Next question"}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                  {index > 0 && (
                    <button
                      className="text-button"
                      onClick={() => {
                        stopRecording();
                        setIndex((i) => i - 1);
                      }}
                    >
                      <ChevronLeft size={16} />
                      Previous question
                    </button>
                  )}
                  {review && (
                    <div className="feedback">
                      <div className="feedback-head">
                        <span className="tag">
                          Instant rating · refined by AI when on
                        </span>
                        <BandChip
                          band={review.rating.band}
                          score={review.rating.score}
                        />
                      </div>
                      <div className="score-parts" aria-label="Score breakdown">
                        {Object.entries(review.rating.parts).map(([k, v]) => (
                          <div key={k}>
                            <small>{k}</small>
                            <span className="meter">
                              <i style={{ width: `${v}%` }} />
                            </span>
                          </div>
                        ))}
                      </div>
                      <ul className="checklist">
                        {review.checklist.strengths.map((s) => (
                          <li key={s} className="good">
                            <Check size={15} /> {s}
                          </li>
                        ))}
                        {review.checklist.improvements.map((s) => (
                          <li key={s}>
                            <ArrowRight size={15} /> {s}
                          </li>
                        ))}
                      </ul>
                      <h3>A stronger answer structure</h3>
                      <p>
                        Describe the situation, explain your specific
                        contribution, and finish with the result. Add a concrete
                        example relevant to {role}.
                      </p>
                      <div className="better-answer">
                        <Markdown>{review.better}</Markdown>
                      </div>
                      {coachState?.text && (
                        <div className="ai-output" aria-live="polite">
                          <small>AI COACH</small>
                          <p
                            className={
                              coachState.status === "writing" ? "streaming" : ""
                            }
                          >
                            {coachState.text}
                          </p>
                        </div>
                      )}
                      {coachState?.status === "writing" && !coachState.text && (
                        <Thinking
                          label="Coaching your answer…"
                          detail="Checking structure and writing a stronger version."
                        />
                      )}
                      <div className="button-row">
                        {questionModelAvailable() &&
                          (coachState?.status === "writing" ? (
                            <button
                              className="secondary"
                              onClick={() => coachAbort.current?.abort()}
                            >
                              <Square size={14} /> Stop coaching
                            </button>
                          ) : (
                            <button className="secondary" onClick={coach}>
                              <Sparkles size={15} />
                              {coachState
                                ? "Coach me again"
                                : "Get AI coaching"}
                            </button>
                          ))}
                        <ExportButtons
                          label="Save this answer"
                          notify={notify}
                          disabled={!transcript.trim()}
                          onExport={(f) =>
                            exportInterview(f, "transcript", index)
                          }
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
      )}
    </div>
  );
}
