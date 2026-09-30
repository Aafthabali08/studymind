// Interview Studio's on-device open models, in their own worker so they never
// wait behind anything else:
//   live speech-to-text  – Moonshine tiny (built for real time: ~0.15 s per clip)
//   final transcript     – Whisper tiny.en (more accurate: re-reads the answer)
//   answer scoring       – MiniLM sentence embeddings (relevance)
import { pipeline, env } from "@huggingface/transformers";
import { SPEECH_MODELS } from "./models";

env.allowLocalModels = false;

const MODEL_FOR = {
  live: SPEECH_MODELS.live,
  final: SPEECH_MODELS.final,
  embed: SPEECH_MODELS.embed,
};
const loading = {};
const post = (message) => self.postMessage(message);

function load(kind) {
  loading[kind] ||= (async () => {
    post({ type: "status", kind, status: "loading" });
    try {
      const progress_callback = (p) =>
        p.status === "progress_total" &&
        post({ type: "progress", kind, progress: Math.round(p.progress) });
      const model =
        kind === "embed"
          ? await pipeline("feature-extraction", MODEL_FOR.embed, {
              dtype: "q8",
              progress_callback,
            })
          : await pipeline("automatic-speech-recognition", MODEL_FOR[kind], {
              dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
              device: "wasm",
              progress_callback,
            });
      post({ type: "status", kind, status: "ready" });
      return model;
    } catch (error) {
      delete loading[kind];
      post({ type: "status", kind, status: "error", message: error.message });
      throw error;
    }
  })();
  return loading[kind];
}

async function handle({ type, ...data }) {
  if (type === "load") return Boolean(await load(data.kind));
  if (type === "transcribe") {
    const kind = data.quality === "final" ? "final" : "live";
    const asr = await load(kind);
    const started = performance.now();
    const out = await asr(
      data.audio,
      kind === "final" && data.audio.length > 16000 * 28
        ? { chunk_length_s: 30, stride_length_s: 5 }
        : {},
    );
    return {
      text: out.text || "",
      ms: Math.round(performance.now() - started),
      kind,
    };
  }
  if (type === "embed") {
    const embed = await load("embed");
    return (
      await embed(data.texts, { pooling: "mean", normalize: true })
    ).tolist();
  }
  throw new Error(`Unknown speech task: ${type}`);
}

self.addEventListener("message", async ({ data }) => {
  try {
    post({ id: data.id, type: "result", result: await handle(data) });
  } catch (error) {
    post({
      id: data.id,
      type: "error",
      message: error.message || String(error),
    });
  }
});
