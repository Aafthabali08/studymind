// Open-source models used on-device. Swap these ids for any compatible ONNX
// model on the Hugging Face Hub (e.g. a larger Qwen or Llama) to trade speed
// for quality.
export const MODELS = {
  // 23 MB sentence-embedding model: semantic search over chunks.
  embed: "Xenova/all-MiniLM-L6-v2",
  // ~0.5B-parameter instruction model: summaries, answers, interview questions.
  generate: "onnx-community/Qwen2.5-0.5B-Instruct",
};

// Interview Studio's open models (speech worker).
export const SPEECH_MODELS = {
  // Moonshine tiny: open speech-to-text built for real time (28 MB, 8-bit).
  live: "onnx-community/moonshine-tiny-ONNX",
  // Whisper base (English): accurate final transcript, re-reads the whole
  // answer when recording stops (74 MB, 8-bit; ~2.5 s for a 15 s answer).
  final: "onnx-community/whisper-base.en",
  // Whisper tiny (English) replaces base on phones, whose browsers close the
  // tab when memory runs short (41 MB, 8-bit; about half of base's memory).
  finalLite: "onnx-community/whisper-tiny.en",
  // MiniLM: sentence embeddings to measure how relevant an answer is (23 MB).
  embed: "Xenova/all-MiniLM-L6-v2",
};
