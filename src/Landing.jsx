import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  FileText,
  GraduationCap,
  Image,
  Lock,
  Mic,
  Sparkles,
  Upload,
} from "lucide-react";
import React, { lazy, Suspense } from "react";
// The code highlighter loads after the page appears (keeps first load small).
const CodeBlock = lazy(() =>
  import("./Markdown").then((m) => ({ default: m.CodeBlock })),
);

const FEATURES = [
  [
    Upload,
    "Upload many PDFs at once",
    "Text, pages and figures are read in seconds and saved privately to your account.",
  ],
  [
    Sparkles,
    "Ask Gemini, anywhere",
    "A help bot that reads your screen, the page you're on, or a whole document — images included.",
  ],
  [
    FileText,
    "Detailed notes",
    "Headings, sub-headings, clear paragraphs, figures from your PDF and highlighted code.",
  ],
  [
    GraduationCap,
    "2, 5 & 8-mark questions",
    "An exam question bank sorted by marks, with model answers and page references.",
  ],
  [
    CalendarDays,
    "One plan for all your PDFs",
    "Topics balanced across your days and hours, with revision days built in.",
  ],
  [
    Image,
    "Figures kept",
    "Diagrams and pictures from your PDFs appear in summaries, notes and answers.",
  ],
];

/** Public demo page. Every action asks the visitor to log in or sign up. */
export default function Landing({ onAuth, setupMissing }) {
  return (
    <>
      <section className="welcome landing-hero">
        <div>
          <div className="eyebrow">
            <span className="short-line" /> YOUR PERSONAL LEARNING SPACE
          </div>
          <h1>
            A little curiosity. <br />
            <span>A lot of possibility.</span>
          </h1>
          <p>
            Upload your PDFs, get detailed notes, exam questions by marks, study
            plans and a Gemini tutor that sees what you see.
          </p>
          <div className="button-row landing-cta">
            <button className="primary" onClick={() => onAuth("signup")}>
              Sign up free <ArrowRight size={16} />
            </button>
            <button className="secondary" onClick={() => onAuth("signin")}>
              Log in
            </button>
          </div>
          {setupMissing && (
            <p className="fine">
              Sign-in is not configured in this build. Add your Firebase keys to
              .env.local.
            </p>
          )}
        </div>
      </section>

      <section className="demo-preview panel" aria-label="Preview of StudyMind">
        <div className="section-kicker">
          <span>DEMO · WHAT YOU GET AFTER UPLOADING</span>
          <Lock size={16} />
        </div>
        <div className="demo-grid">
          <div className="demo-notes">
            <div className="eyebrow">DETAILED NOTES</div>
            <h3>Neural Networks</h3>
            <p>
              A neural network is built from layers of connected neurons. Each
              neuron weighs its inputs and passes the result through an
              activation function <em>(p. 3)</em>.
            </p>
            <Suspense
              fallback={
                <pre className="code-fallback">
                  {
                    "def train(model, data):\n    for x, y in data:\n        loss = model(x) - y\n    return loss"
                  }
                </pre>
              }
            >
              <CodeBlock
                lang="python"
                code={
                  "def train(model, data):\n    for x, y in data:\n        loss = model(x) - y\n    return loss"
                }
              />
            </Suspense>
          </div>
          <div className="demo-questions">
            <div className="eyebrow">QUESTION BANK · BY MARKS</div>
            {[
              ["2 marks", "Define overfitting."],
              ["5 marks", "Explain backpropagation with a suitable example."],
              [
                "8 marks",
                "Discuss the architecture and training of neural networks.",
              ],
            ].map(([marks, q]) => (
              <div className="question-card demo-q" key={q}>
                <div className="question-head">
                  <span className="q-text">{q}</span>
                  <span className="tag">{marks}</span>
                </div>
              </div>
            ))}
            <button className="text-button" onClick={() => onAuth("signup")}>
              Try it with your own PDFs <ArrowUpRight size={15} />
            </button>
          </div>
        </div>
      </section>

      <section className="feature-grid" aria-label="Features">
        {FEATURES.map(([Icon, title, text]) => (
          <button
            key={title}
            className="feature-card"
            onClick={() => onAuth("signup")}
          >
            <span className="document-icon">
              <Icon size={20} />
            </span>
            <h3>{title}</h3>
            <p>{text}</p>
          </button>
        ))}
      </section>

      <section className="dark-card locked-card">
        <div className="section-kicker">
          <span>INTERVIEW STUDIO</span>
          <Lock size={18} />
        </div>
        <div>
          <h2>
            Big opportunity? <br />
            Be ready for it.
          </h2>
          <p>
            Resume-based questions, voice answers and AI coaching. Unlocks after
            you log in or sign up.
          </p>
          <button className="light-button" onClick={() => onAuth("signin")}>
            <Lock size={14} /> Log in to unlock <Mic size={15} />
          </button>
        </div>
      </section>
    </>
  );
}
