// Safari does not support `for await (… of readableStream)`, which pdf.js v6
// uses to read page text and to decompress PDF data. Add the standard async
// iterator where it is missing.
if (
  typeof ReadableStream !== "undefined" &&
  !ReadableStream.prototype[Symbol.asyncIterator]
) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
  ReadableStream.prototype.values ??=
    ReadableStream.prototype[Symbol.asyncIterator];
}
