import { expect, it } from "vitest";
import {
  deepDiveLength,
  deepDiveTopic,
  deepFollowUp,
  mergeVoiceStats,
  voiceReport,
} from "../src/ai/coach";
import { joinRecognition } from "../src/ai/speech";
import { SpeechTiming } from "../src/voice";

it("deep dives are 5–7 follow-ups long", () => {
  expect(deepDiveLength(() => 0)).toBe(5);
  expect(deepDiveLength(() => 0.5)).toBe(6);
  expect(deepDiveLength(() => 0.999)).toBe(7);
});

it("picks the topic from the answer, then the question", () => {
  expect(deepDiveTopic("I built the API with Django and Redis.")).toBe("Django");
  expect(deepDiveTopic("It was fine.", "Tell me about your Kubernetes work")).toBe(
    "Kubernetes",
  );
});

it("each level goes deeper on the same topic and never repeats", () => {
  const asked = ["Tell me about a project."];
  const answers = [
    "I built a chat app with React.",
    "I wrote the socket layer myself and chose Node.js for the server.",
    "We had a bug where messages arrived twice, a race condition.",
    "Latency dropped from 900 ms to 120 ms for 2,000 users.",
    "I load tested it.",
    "Honestly I am not sure.",
    "I would add more tests.",
  ];
  for (let depth = 1; depth <= 7; depth++) {
    const f = deepFollowUp({
      topic: "React",
      depth,
      answer: answers[depth - 1],
      asked,
    });
    expect(f.focus).toBe("React");
    expect(f.question).toMatch(/React/);
    expect(asked).not.toContain(f.question);
    asked.push(f.question);
  }
  console.log(asked.slice(1).map((q, i) => `${i + 1}. ${q}`).join("\n"));
});

it("merges Android's repeated speech results into one transcript", () => {
  const r = (...texts) => texts.map((t) => [{ transcript: t }]);
  expect(joinRecognition(r("I built", "I built a dashboard", "with React"))).toBe(
    "I built a dashboard with React",
  );
  expect(joinRecognition(r("Hello there.", " General Kenobi"))).toBe(
    "Hello there. General Kenobi",
  );
  expect(joinRecognition(r("I built a dashboard", "dashboard"))).toBe(
    "I built a dashboard",
  );
});

it("measures pace and pauses on phones from when words arrive", () => {
  let now = 0;
  const t = new SpeechTiming(() => now);
  for (const at of [500, 800, 1100, 1400, 4000, 4300, 4600]) {
    now = at;
    t.mark();
  }
  now = 5000;
  const stats = t.stop();
  expect(stats.pauses).toBe(1);
  expect(stats.steadiness).toBeNull();
  const report = voiceReport(stats, "one two three four five six seven eight nine ten");
  expect(report.steadiness).toBeNull();
  expect(report.score).toBeGreaterThan(0);
  expect(mergeVoiceStats(stats, stats).steadiness).toBeNull();
});
