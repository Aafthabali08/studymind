import React, { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { ENGINES, testConnection, updateSettings, useAI } from "./ai/engine";
import Thinking from "./Thinking";
import { geminiAvailable } from "./ai/gemini";

const PRESETS = [
  ["Ollama", "http://localhost:11434/v1", "llama3.2"],
  ["LM Studio", "http://localhost:1234/v1", "qwen2.5-7b-instruct"],
  ["Groq", "https://api.groq.com/openai/v1", "llama-3.1-8b-instant"],
  [
    "OpenRouter",
    "https://openrouter.ai/api/v1",
    "meta-llama/llama-3.1-8b-instruct",
  ],
];

const STEPS = [
  [
    "Read page by page",
    "Text is extracted from each page so every answer can cite its page.",
  ],
  [
    "Chunk by meaning",
    "Pages are split into ~180-word chunks of whole sentences that overlap by one sentence. Single words carry no meaning; whole pages are too blurry to search.",
  ],
  [
    "Index twice",
    "A keyword index (BM25) is instant. With AI on, each chunk also gets a semantic embedding so questions match ideas, not just words.",
  ],
  [
    "Retrieve, then write",
    "Only the best 4 chunks go to the model, with the instruction to cite pages and say when the document does not cover something.",
  ],
  [
    "Summarise smartly",
    "Long documents are condensed to their most central sentences first, then written up. Much faster than reading everything, and grounded.",
  ],
];

export default function AISettings({ onDone }) {
  const ai = useAI();
  const { engine, baseUrl, model, apiKey } = ai.settings;
  const [test, setTest] = useState(null);
  const loading = ai.progress && ai[ai.progress.kind] === "loading";
  async function check() {
    setTest({ status: "testing" });
    try {
      const reply = await testConnection();
      setTest({
        status: "ok",
        message: `Connected. The model replied: "${reply.slice(0, 40)}"`,
      });
    } catch (e) {
      setTest({ status: "error", message: e.message });
    }
  }
  return (
    <div className="ai-settings">
      <h2 id="dialog-title">Your AI engine.</h2>
      <p>
        Every mode quotes your document with page citations. Stronger modes add
        written answers.
      </p>
      <div role="radiogroup" aria-label="AI engine" className="engine-list">
        {ENGINES.map((e) => (
          <label
            key={e.id}
            className={"engine" + (engine === e.id ? " chosen" : "")}
          >
            <input
              type="radio"
              name="engine"
              value={e.id}
              checked={engine === e.id}
              onChange={() => {
                setTest(null);
                updateSettings({ engine: e.id });
              }}
            />
            <span>
              <strong>
                {e.label} {engine === e.id && <Check size={14} />}
              </strong>
              <small>{e.detail}</small>
            </span>
          </label>
        ))}
      </div>
      {engine === "gemini" && !geminiAvailable() && (
        <div className="feedback" role="status">
          <strong>Gemini needs an API key.</strong>
          <p>
            Add <code>VITE_GEMINI_API_KEY=your-key</code> to{" "}
            <code>.env.local</code> (get one at aistudio.google.com/apikey) and
            restart <code>npm run dev</code>. Until then StudyMind uses its
            instant built-in engine.
          </p>
        </div>
      )}
      {engine === "local" && (
        <div className="feedback" role="status">
          {loading ? (
            <>
              <strong>Downloading open model… {ai.progress.value}%</strong>
              <div className="progress" aria-hidden="true">
                <i style={{ width: `${ai.progress.value}%` }} />
              </div>
              <p>One time only. You can keep studying while it downloads.</p>
            </>
          ) : ai.generate === "ready" ? (
            <strong>On-device model ready.</strong>
          ) : ai.generate === "error" || ai.embed === "error" ? (
            <>
              <strong>The model could not load.</strong>
              <p>{ai.error || "Try Chrome or Edge, or use Instant mode."}</p>
            </>
          ) : (
            <Thinking label="Preparing the model…" compact />
          )}
          <p className="fine">
            {typeof navigator !== "undefined" && navigator.gpu
              ? "WebGPU acceleration is available in this browser."
              : "No WebGPU here, so the model runs on the CPU (slower). Chrome or Edge on desktop is fastest."}
          </p>
        </div>
      )}
      {engine === "remote" && (
        <div className="remote-fields">
          <div className="chips" role="group" aria-label="Model server presets">
            {PRESETS.map(([label, url, m]) => (
              <button
                key={label}
                className={"chip" + (baseUrl === url ? " active" : "")}
                onClick={() => {
                  setTest(null);
                  updateSettings({ baseUrl: url, model: m });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            Server URL
            <input
              value={baseUrl}
              onChange={(e) => updateSettings({ baseUrl: e.target.value })}
            />
          </label>
          <label>
            Model name
            <input
              value={model}
              onChange={(e) => updateSettings({ model: e.target.value })}
            />
          </label>
          <label>
            API key (not needed for Ollama or LM Studio)
            <input
              type="password"
              value={apiKey}
              autoComplete="off"
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
            />
          </label>
          <p className="fine">
            The key is stored only in this browser and sent only to the server
            above. Avoid saving keys on shared computers.
          </p>
          <button
            className="secondary"
            disabled={test?.status === "testing"}
            onClick={check}
          >
            {test?.status === "testing" ? "Testing…" : "Test connection"}
          </button>
          {test?.status === "testing" && (
            <Thinking label="Waiting for the model to reply…" compact />
          )}
          {test?.message && (
            <p
              className={test.status === "error" ? "form-error" : "fine"}
              role="status"
            >
              {test.message}
            </p>
          )}
        </div>
      )}
      <details className="how-it-works">
        <summary>How StudyMind reads your documents</summary>
        <ol>
          {STEPS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}.</strong> {text}
            </li>
          ))}
        </ol>
      </details>
      <button className="primary" onClick={onDone}>
        Save and close <ArrowRight size={16} />
      </button>
    </div>
  );
}
