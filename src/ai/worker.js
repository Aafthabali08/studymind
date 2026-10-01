// Runs open-source models in the browser (Transformers.js + ONNX Runtime) off
// the main thread. Models download once from the Hugging Face Hub and are then
// cached by the browser, so documents never leave the device.
import {
  pipeline,
  env,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";
import { MODELS } from "./models";

env.allowLocalModels = false;

const loading = {};
const stops = new Map();
const post = (message) => self.postMessage(message);

function load(kind) {
  loading[kind] ||= (async () => {
    const progress_callback = (p) => {
      if (p.status === "progress_total")
        post({ type: "progress", kind, progress: Math.round(p.progress) });
    };
    post({ type: "status", kind, status: "loading" });
    try {
      let model;
      if (kind === "embed") {
        model = await pipeline("feature-extraction", MODELS.embed, {
          dtype: "q8",
          progress_callback,
        });
      } else {
        // 8-bit on the CPU: the 4-bit WebGPU build (q4f16) wrote repeated
        // nonsense ("GRADIENTS GRADIENTS…") and never stopped, while q8
        // answers correctly.
        model = await pipeline("text-generation", MODELS.generate, {
          device: "wasm",
          dtype: "q8",
          progress_callback,
        });
      }
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

async function handle({ id, type, ...data }) {
  if (type === "abort") return stops.get(data.target)?.interrupt();
  if (type === "load") return Boolean(await load(data.kind));
  if (type === "embed") {
    const extractor = await load("embed");
    const output = await extractor(data.texts, {
      pooling: "mean",
      normalize: true,
    });
    return output.tolist();
  }
  if (type === "generate") {
    const generator = await load("generate");
    const stop = new InterruptableStoppingCriteria();
    stops.set(id, stop);
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => post({ id, type: "token", text }),
    });
    try {
      const output = await generator(data.messages, {
        max_new_tokens: data.maxTokens || 320,
        do_sample: false,
        repetition_penalty: 1.1,
        streamer,
        stopping_criteria: stop,
      });
      return output[0].generated_text.at(-1).content;
    } finally {
      stops.delete(id);
    }
  }
  throw new Error(`Unknown AI task: ${type}`);
}

self.addEventListener("message", async ({ data }) => {
  try {
    const result = await handle(data);
    if (data.type !== "abort") post({ id: data.id, type: "result", result });
  } catch (error) {
    post({
      id: data.id,
      type: "error",
      message: error.message || String(error),
    });
  }
});
