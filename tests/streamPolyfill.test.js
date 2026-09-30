import { it, expect, vi } from "vitest";
it("makes ReadableStream async-iterable where the browser lacks it (Safari)", async () => {
  const proto = ReadableStream.prototype;
  const native = proto[Symbol.asyncIterator];
  const nativeValues = proto.values;
  delete proto[Symbol.asyncIterator];
  delete proto.values;
  try {
    vi.resetModules();
    await import("../src/streamPolyfill");
    const stream = new ReadableStream({
      start(c) {
        c.enqueue("a");
        c.enqueue("b");
        c.close();
      },
    });
    const seen = [];
    for await (const chunk of stream) seen.push(chunk);
    expect(seen).toEqual(["a", "b"]);
    expect(stream.locked).toBe(false);
  } finally {
    proto[Symbol.asyncIterator] = native;
    proto.values = nativeValues;
  }
});
