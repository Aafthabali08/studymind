import { it, expect, vi, beforeEach, afterEach } from "vitest";

const sse = (text) => ({
  ok: true,
  status: 200,
  body: {
    getReader: () => {
      let sent = false;
      return {
        read: async () =>
          sent
            ? { done: true }
            : ((sent = true),
              {
                done: false,
                value: new TextEncoder().encode(
                  `data: {"candidates":[{"content":{"parts":[{"text":"thinking…","thought":true},{"text":${JSON.stringify(text)}}]}}]}\n`,
                ),
              }),
      };
    },
  },
});
const fail = (status, message = "err") => ({
  ok: false,
  status,
  json: async () => ({ error: { message } }),
});

let gemini;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_GEMINI_API_KEY", "test-key");
  vi.resetModules();
  gemini = await import("../src/ai/gemini");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function run(promise) {
  let result, error;
  promise.then((r) => (result = r)).catch((e) => (error = e));
  await vi.advanceTimersByTimeAsync(60_000);
  return { result, error };
}

it("uses the current model, sends the key in a header, and skips thought parts", async () => {
  const fetchMock = vi.fn(async () => sse("Hello **world**"));
  vi.stubGlobal("fetch", fetchMock);
  const tokens = [];
  const { result } = await run(
    gemini.streamGemini(
      [
        { role: "system", content: "Be brief." },
        {
          role: "user",
          content: [{ text: "Hi" }, { image: "AAA", mime: "image/png" }],
        },
      ],
      { onToken: (t) => tokens.push(t) },
    ),
  );
  expect(result).toBe("Hello **world**");
  expect(tokens).toEqual(["Hello **world**"]);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toContain(
    "/models/gemini-3.8-flash:streamGenerateContent?alt=sse",
  );
  expect(url).not.toContain("test-key");
  expect(init.headers["x-goog-api-key"]).toBe("test-key");
  const body = JSON.parse(init.body);
  expect(body.systemInstruction.parts[0].text).toBe("Be brief.");
  expect(body.contents[0].parts[1]).toEqual({
    inlineData: { mimeType: "image/png", data: "AAA" },
  });
});

it("switches straight to the next model when one is overloaded", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(fail(503))
    .mockResolvedValueOnce(sse("From fallback"));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = await run(
    gemini.streamGemini([{ role: "user", content: "Hi" }]),
  );
  expect(result).toBe("From fallback");
  const urls = fetchMock.mock.calls.map(([u]) => u.match(/models\/([^:]+)/)[1]);
  expect(urls).toEqual(["gemini-3.8-flash", "gemini-3.5-flash"]);
});

const quota = (delay) => ({
  ok: false,
  status: 429,
  json: async () => ({
    error: {
      message: "You exceeded your current quota",
      details: [{ retryDelay: delay }],
    },
  }),
});
const modelOf = ([u]) => u.match(/models\/([^:]+)/)[1];

it("switches model at once on a rate limit and rests that model until it resets", async () => {
  const fetchMock = vi.fn(async (url) =>
    url.includes("gemini-3.8-flash") ? quota("300s") : sse("backup"),
  );
  vi.stubGlobal("fetch", fetchMock);
  const statuses = [];
  gemini.onRetryStatus((s) => statuses.push(s));

  const first = await run(gemini.streamGemini([{ role: "user", content: "Hi" }]));
  expect(first.result).toBe("backup");
  expect(fetchMock.mock.calls.map(modelOf)).toEqual([
    "gemini-3.8-flash",
    "gemini-3.5-flash",
  ]);
  expect(statuses).toContain(
    "Gemini is busy (Google reports high demand). Switching to gemini-3.5-flash…",
  );
  expect(gemini.getRetryStatus()).toBe("");

  // While 3.8 is resting, requests go straight to the backup: no delay.
  fetchMock.mockClear();
  await run(gemini.streamGemini([{ role: "user", content: "Again" }]));
  expect(fetchMock.mock.calls.map(modelOf)).toEqual(["gemini-3.5-flash"]);
});

it("returns to the main model after Google's reset time", async () => {
  let limited = true;
  const fetchMock = vi.fn(async (url) =>
    limited && url.includes("gemini-3.8-flash") ? quota("2s") : sse("ok"),
  );
  vi.stubGlobal("fetch", fetchMock);
  await run(gemini.streamGemini([{ role: "user", content: "Hi" }])); // + 60 s
  // (a tiny "2s" hint still rests the model for 30 s, then it is used again)
  limited = false;
  fetchMock.mockClear();
  await run(gemini.streamGemini([{ role: "user", content: "Hi" }]));
  expect(fetchMock.mock.calls.map(modelOf)).toEqual(["gemini-3.8-flash"]);
});

it("walks the whole backup chain when several models are limited or overloaded", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (url.includes("gemini-3.8-flash")) return quota("27s");
    if (url.includes("gemini-3.5-flash:")) return quota("40s");
    if (url.includes("gemini-3.7-flash")) return fail(503);
    return sse("lite answer");
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result } = await run(
    gemini.streamGemini([{ role: "user", content: "Hi" }]),
  );
  expect(result).toBe("lite answer");
  expect(fetchMock.mock.calls.map(modelOf)).toEqual([
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
  ]);
});

it("moves straight on when a model is retired for this key (404)", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(fail(404))
    .mockResolvedValueOnce(sse("ok"));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = await run(
    gemini.streamGemini([{ role: "user", content: "Hi" }]),
  );
  expect(result).toBe("ok");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("stops immediately on a bad key and explains Google's busy errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => fail(400, "API key not valid")),
  );
  const bad = await run(gemini.streamGemini([{ role: "user", content: "Hi" }]));
  expect(bad.error.message).toMatch(/rejected the request: API key not valid/);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => fail(503)),
  );
  const busy = await run(
    gemini.streamGemini([{ role: "user", content: "Hi" }]),
  );
  expect(busy.error.message).toMatch(/Gemini is busy right now/);
  expect(fetch).toHaveBeenCalledTimes(6); // 5 models, last one retried once
  expect(gemini.getRetryStatus()).toBe("");
});

it("parses JSON replies, even inside code fences", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => sse('```json\n{"two":[1]}\n```')),
  );
  const { result } = await run(
    gemini.geminiJSON([{ role: "user", content: "x" }]),
  );
  expect(result).toEqual({ two: [1] });
  expect(gemini.imagePart("data:image/jpeg;base64,QUJD")).toEqual({
    image: "QUJD",
    mime: "image/jpeg",
  });
});

it("asks for low thinking by default, medium when requested, and passes temperature", async () => {
  const fetchMock = vi.fn(async () => sse("ok"));
  vi.stubGlobal("fetch", fetchMock);
  await run(gemini.streamGemini([{ role: "user", content: "Hi" }]));
  await run(
    gemini.streamGemini([{ role: "user", content: "Hi" }], {
      thinking: "medium",
      temperature: 0.6,
    }),
  );
  const configs = fetchMock.mock.calls.map(
    ([, init]) => JSON.parse(init.body).generationConfig,
  );
  expect(configs[0].thinkingConfig).toEqual({ thinkingLevel: "low" });
  expect(configs[0].temperature).toBe(0.3);
  expect(configs[1].thinkingConfig).toEqual({ thinkingLevel: "medium" });
  expect(configs[1].temperature).toBe(0.6);
});

it("repeats the request without the thinking setting if a model rejects it", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      fail(400, "Thinking level MEDIUM is not supported for this model."),
    )
    .mockResolvedValueOnce(sse("fine"));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = await run(
    gemini.streamGemini([{ role: "user", content: "Hi" }], {
      thinking: "medium",
    }),
  );
  expect(result).toBe("fine");
  const [first, second] = fetchMock.mock.calls.map(([u, init]) => ({
    model: modelOf([u]),
    config: JSON.parse(init.body).generationConfig,
  }));
  expect(first.model).toBe(second.model);
  expect(first.config.thinkingConfig).toBeDefined();
  expect(second.config.thinkingConfig).toBeUndefined();
});

it("skips a model that has not started answering after 15 seconds", async () => {
  const fetchMock = vi.fn((url, init) =>
    url.includes("gemini-3.8-flash")
      ? new Promise((_, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          ),
        )
      : Promise.resolve(sse("from backup")),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { result } = await run(
    gemini.streamGemini([{ role: "user", content: "Hi" }]),
  );
  expect(result).toBe("from backup");
  expect(fetchMock.mock.calls.map(modelOf)).toEqual([
    "gemini-3.8-flash",
    "gemini-3.5-flash",
  ]);
});

it("still lets the user cancel a request that is waiting", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          ),
        ),
    ),
  );
  const controller = new AbortController();
  const pending = gemini.streamGemini([{ role: "user", content: "Hi" }], {
    signal: controller.signal,
  });
  await vi.advanceTimersByTimeAsync(2000);
  controller.abort();
  const { result } = await run(pending);
  expect(result).toBe("");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("repairs slightly broken JSON from the model", async () => {
  const { parseLooseJSON } = gemini;
  expect(parseLooseJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(parseLooseJSON('Here you go: {questions:[{type:"tf",prompt:"x",answer:true,},]}')).toEqual({
    questions: [{ type: "tf", prompt: "x", answer: true }],
  });
  expect(parseLooseJSON("{'a': 'it\\'s'}".replace("{'a'", '{"a"'))).toEqual({ a: "it's" });
  // Cut off in the middle of the third item: the first two are kept.
  expect(
    parseLooseJSON('{"questions":[{"type":"tf","answer":true},{"type":"tf","answer":false},{"type":"tf","pro'),
  ).toEqual({ questions: [{ type: "tf", answer: true }, { type: "tf", answer: false }] });
  expect(() => parseLooseJSON("no json here")).toThrow();
});
