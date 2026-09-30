import { it, expect, vi } from "vitest";
import {
  extractTopics,
  followUpQuestion,
  scoreAnswer,
  betterAnswer,
  voiceReport,
  mergeVoiceStats,
  withTimeout,
  parseJSONReply,
} from "../src/ai/coach";

const strong =
  "During my final-year project our library app was too slow for 300 students. I profiled the API, " +
  "I added Redis caching and I rewrote two SQL queries. As a result, response time dropped from 2 seconds to 300 ms " +
  "and complaints stopped. I learned to measure before optimising.";

it("finds technologies, numbers and challenges in an answer", () => {
  const t = extractTopics(strong + " The deadline was tight.");
  expect(t.tech).toEqual(expect.arrayContaining(["Redis", "SQL"]));
  expect(t.metrics.join(" ")).toMatch(/300 students|300 ms/);
  expect(t.challenge).toBe("deadline");
});

it("asks deeper follow-ups and never repeats a focus", () => {
  const used = new Set();
  const first = followUpQuestion(strong, used);
  expect(first.focus).toBe("Redis");
  expect(first.question).toMatch(/Redis/);
  used.add("redis");
  const second = followUpQuestion(strong, used);
  expect(second.focus).toBe("SQL");
  expect(followUpQuestion("Too short to dig into.")).toBeNull();
});

it("rates answers red, yellow or blue", () => {
  expect(
    scoreAnswer(
      strong,
      "Tell me about a performance problem you solved in a project.",
    ).band,
  ).toBe("blue");
  expect(
    scoreAnswer("um basically we did it", "Tell me about a project.").band,
  ).toBe("red");
  const mid = scoreAnswer(
    "In my second year I worked on a website for a local shop with two classmates. I made the product pages and " +
      "the contact form, and I tested it on phones. The owner said it looked good and customers could find items more easily.",
    "Describe a project you worked on.",
  );
  expect(mid.band).toBe("yellow");
  expect(mid.improvements.join(" ")).toMatch(/measurable result|specifics/);
});

it("rewrites an answer into STAR using the candidate's own sentences", () => {
  const md = betterAnswer("Tell me about a problem.", strong);
  expect(md).toMatch(/\*\*Situation:\*\* During my final-year project/);
  expect(md).toMatch(/\*\*Action:\*\* I profiled the API/);
  expect(md).toMatch(/\*\*Result:\*\* .*300 ms/);
  expect(betterAnswer("Q", "It was fine.")).toMatch(
    /\*➕ Add: a measurable result/,
  );
});

it("keeps a scene-setting opener as the situation even when it names the work", () => {
  const md = betterAnswer(
    "Walk me through your experience.",
    "In my last role I built a React and TypeScript dashboard used by 2,000 support agents. " +
      "The page loaded slowly, so I profiled it, split the bundle with lazy loading and moved heavy filtering into a web worker. " +
      "I also added caching with React Query. " +
      "As a result, load time dropped from 6 seconds to 1.8 seconds and support tickets about slowness fell by 40%.",
  );
  expect(md).toMatch(/\*\*Situation:\*\* In my last role I built a React/);
  expect(md).toMatch(/\*\*Action:\*\* The page loaded slowly, so I profiled it.*I also added caching/);
  expect(md).toMatch(/\*\*Result:\*\* As a result, load time dropped/);
  expect(md).toMatch(/\*\*Task:\*\* \*➕ Add: your goal/);
  expect(md).not.toMatch(/\?\*/); // no question-style placeholders
});

it("rates the voice from pace, pauses, fillers and steadiness", () => {
  const good = voiceReport(
    {
      durationSec: 60,
      speakingSec: 50,
      pauses: 1,
      longestPauseSec: 2,
      avgVolume: 0.1,
      steadiness: 0.85,
    },
    Array.from({ length: 115 }, () => "word").join(" "),
  );
  expect(good.wpm).toBe(138);
  expect(good.band).toBe("blue");
  const rushed = voiceReport(
    {
      durationSec: 30,
      speakingSec: 20,
      pauses: 6,
      longestPauseSec: 4,
      avgVolume: 0.1,
      steadiness: 0.3,
    },
    "um like basically " + Array.from({ length: 80 }, () => "word").join(" "),
  );
  expect(rushed.band).toBe("red");
  expect(rushed.tips.join(" ")).toMatch(/fast|filler|pauses|volume/);
  expect(voiceReport(null, "x")).toBeNull();
  expect(
    mergeVoiceStats(
      {
        durationSec: 10,
        speakingSec: 8,
        pauses: 1,
        longestPauseSec: 2,
        avgVolume: 0.1,
        steadiness: 0.8,
      },
      {
        durationSec: 10,
        speakingSec: 6,
        pauses: 2,
        longestPauseSec: 3,
        avgVolume: 0.2,
        steadiness: 0.6,
      },
    ),
  ).toMatchObject({
    durationSec: 20,
    speakingSec: 14,
    pauses: 3,
    longestPauseSec: 3,
  });
});

it("never waits longer than the time limit and parses messy JSON replies", async () => {
  vi.useFakeTimers();
  const slow = new Promise(() => {});
  const result = withTimeout(slow, 7000, "fallback");
  vi.advanceTimersByTime(7000);
  expect(await result).toBe("fallback");
  vi.useRealTimers();
  expect(parseJSONReply('```json\n{"score": 80}\n```')).toEqual({ score: 80 });
  expect(parseJSONReply("no json here")).toBeNull();
});

it("never uses the result sentence as the situation, and finds the task", () => {
  const md = betterAnswer(
    "Tell me more.",
    "The shop owner wanted online orders before a festival. I built the order form in two days and I tested it with ten friends. As a result the shop took 60 orders in the first week.",
  );
  expect(md).toMatch(/\*\*Situation:\*\* The shop owner wanted online orders/);
  expect(md).toMatch(/\*\*Result:\*\* As a result the shop took 60 orders/);
  expect(md).toMatch(/\*\*Action:\*\* I built the order form/);
});
