import { resample, TARGET_RATE } from "./audio";

// Microphone analysis with the Web Audio API. Samples loudness every 100 ms
// (cheap, no rendering) to measure speaking time, pauses and steadiness. The
// live level is written straight to a CSS variable by the caller, so the meter
// animates without React re-renders.
const SAMPLE_MS = 100,
  PAUSE_SEC = 1.5;

// Batches 128-sample render quanta into ~4096-sample chunks before posting,
// so the main thread gets ~12 messages per second instead of ~375.
const WORKLET_SOURCE = `
class StudyMindCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.filled = 0;
    this.port.onmessage = () => this.flush();
  }
  flush() {
    if (this.filled) this.port.postMessage(this.buffer.slice(0, this.filled));
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled === this.buffer.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("studymind-capture", StudyMindCapture);
`;
let workletUrl;
const workletURL = () =>
  (workletUrl ||= URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
  ));

export const voiceAnalysisSupported = () =>
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  Boolean(window.AudioContext || window.webkitAudioContext);

export class VoiceMeter {
  async start(onLevel) {
    this.samples = [];
    this.stopped = false;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
    });
    // Stopped while the permission prompt was open: release the mic at once.
    if (this.stopped) return stream.getTracks().forEach((t) => t.stop());
    this.stream = stream;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    // Raw audio for on-device speech recognition, captured off the main
    // thread by an AudioWorklet (ScriptProcessor fallback for old browsers).
    // A muted gain node keeps the graph running without echoing the mic.
    this.chunks = [];
    this.rate = this.ctx.sampleRate;
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    mute.connect(this.ctx.destination);
    if (this.ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      await this.ctx.audioWorklet.addModule(workletURL());
      if (this.stopped) return;
      const node = new AudioWorkletNode(this.ctx, "studymind-capture");
      node.port.onmessage = (e) => this.chunks.push(e.data);
      source.connect(node);
      node.connect(mute);
      this.node = node;
    } else {
      const processor = this.ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) =>
        this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(processor);
      processor.connect(mute);
      this.processor = processor;
    }
    const buffer = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const v of buffer) sum += v * v;
      const rms = Math.sqrt(sum / buffer.length);
      this.samples.push(rms);
      onLevel?.(rms);
    }, SAMPLE_MS);
  }

  /** Seconds of raw audio captured so far. */
  get capturedSec() {
    const n = (this.chunks || []).reduce((t, c) => t + c.length, 0);
    return this.rate ? n / this.rate : 0;
  }

  /** Captured audio from `fromSec` onwards, resampled to 16 kHz for the models. */
  audio(fromSec = 0) {
    const chunks = this.chunks || [];
    if (!chunks.length) return new Float32Array(0);
    const total = chunks.reduce((t, c) => t + c.length, 0);
    const start = Math.max(0, Math.floor(fromSec * this.rate));
    const raw = new Float32Array(Math.max(0, total - start));
    let offset = 0,
      written = 0;
    for (const c of chunks) {
      const end = offset + c.length;
      if (end > start) {
        const from = Math.max(0, start - offset);
        raw.set(c.subarray(from), written);
        written += c.length - from;
      }
      offset = end;
    }
    return resample(raw, this.rate, TARGET_RATE);
  }

  /** Stops the microphone and returns loudness statistics. */
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.processor) this.processor.onaudioprocess = null;
    if (this.node) {
      this.node.port.postMessage("flush");
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    const samples = this.samples || [];
    this.samples = [];
    if (!samples.length) return null;
    // Speech threshold: above the room's noise floor (quietest 5%), but never
    // above half the loud level, so non-stop talkers are still measured.
    const sorted = [...samples].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.05)] || 0;
    const loudLevel = sorted[Math.floor(sorted.length * 0.9)] || 0;
    const threshold = Math.min(
      Math.max(0.012, floor * 2.5),
      Math.max(loudLevel * 0.5, 0.012),
    );
    const step = SAMPLE_MS / 1000;
    let speaking = 0,
      pauses = 0,
      longest = 0,
      silence = 0,
      heard = false;
    const loud = [];
    for (const s of samples) {
      if (s >= threshold) {
        if (heard && silence >= PAUSE_SEC) pauses++;
        longest = Math.max(longest, heard ? silence : 0);
        silence = 0;
        heard = true;
        speaking += step;
        loud.push(s);
      } else silence += step;
    }
    const mean = loud.reduce((n, v) => n + v, 0) / (loud.length || 1);
    const sd = Math.sqrt(
      loud.reduce((n, v) => n + (v - mean) ** 2, 0) / (loud.length || 1),
    );
    return {
      durationSec: samples.length * step,
      speakingSec: speaking,
      pauses,
      longestPauseSec: Math.round(longest * 10) / 10,
      avgVolume: mean,
      // 1 = very steady volume, 0 = very uneven.
      steadiness: loud.length
        ? Math.max(0, Math.min(1, 1 - sd / (mean || 1) / 1.2))
        : 0,
    };
  }
}

/**
 * Voice statistics on phones, where the browser's speech service holds the
 * microphone (opening it a second time for Web Audio makes recognition stop
 * after a few seconds). Speaking time and pauses come from when words arrive;
 * volume steadiness cannot be measured, so it is left out (null).
 */
export class SpeechTiming {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.started = now();
    this.marks = [];
  }
  /** Call whenever the recogniser hears words. */
  mark() {
    this.marks.push(this.now());
  }
  stop() {
    const end = this.now();
    const durationSec = (end - this.started) / 1000;
    if (!this.marks.length) return null;
    let speaking = 0,
      pauses = 0,
      longest = 0;
    // Words arrive in bursts while someone talks; a gap longer than
    // PAUSE_SEC between bursts is a pause.
    let prev = this.marks[0] - 1000;
    for (const t of this.marks) {
      const gap = (t - prev) / 1000;
      if (gap >= PAUSE_SEC) {
        pauses++;
        longest = Math.max(longest, gap);
        speaking += 1;
      } else speaking += gap;
      prev = t;
    }
    return {
      durationSec,
      speakingSec: Math.min(durationSec, speaking),
      pauses,
      longestPauseSec: Math.round(longest * 10) / 10,
      avgVolume: 0,
      steadiness: null,
    };
  }
}
