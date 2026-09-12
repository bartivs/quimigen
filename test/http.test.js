import assert from "node:assert/strict";
import test from "node:test";
import { fetchJson, ProviderTimeoutError } from "../src/providers/http.js";

for (const phase of ["headers", "body"]) {
  test(`deadline covers ${phase} even with a caller signal, without retrying`, async (t) => {
    let calls = 0;
    const hold = setInterval(() => {}, 100);
    t.after(() => clearInterval(hold));
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      calls++;
      assert.equal(options.timeoutMs, undefined);
      const pending = () => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
      if (phase === "headers") return pending();
      return { text: pending };
    });
    await assert.rejects(fetchJson("https://example.com", {
      timeoutMs: 10, signal: new AbortController().signal, requestName: "OpenRouter",
    }), (error) => error instanceof ProviderTimeoutError && /OpenRouter/.test(error.message));
    assert.equal(calls, 1);
  });
}

test("caller cancellation is not misreported as a provider timeout", async (t) => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  t.mock.method(globalThis, "fetch", async (_url, options) => { throw options.signal.reason; });
  await assert.rejects(fetchJson("https://example.com", { signal: controller.signal }), /cancelled/);
});
