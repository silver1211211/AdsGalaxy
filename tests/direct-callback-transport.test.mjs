import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  dispatchPinnedHttpsCallback,
  isProhibitedCallbackAddress,
  resolvePublicCallbackAddresses,
  validateDirectCallbackUrl,
} from "../src/lib/directCallbackTransport.mjs";

function fakeTransport({ status = 204, chunks = [], neverRespond = false } = {}) {
  const calls = [];
  function request(options, onResponse) {
    const req = new EventEmitter();
    let timeoutHandler;
    req.setTimeout = (_ms, handler) => { timeoutHandler = handler; return req; };
    req.destroy = (error) => queueMicrotask(() => req.emit("error", error));
    req.end = (body) => {
      calls.push({ options, body });
      if (neverRespond) return;
      const response = Readable.from(chunks);
      response.statusCode = status;
      response.destroy = () => queueMicrotask(() => response.emit("error", new Error("response stopped")));
      queueMicrotask(() => onResponse(response));
    };
    return req;
  }
  return { request, calls };
}

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
const callbackInput = {
  url: "https://callbacks.example:8443/reward?source=agx",
  body: '{"event_id":"rwe_1"}',
  headers: { "Content-Type": "application/json", "x-adsgalaxy-event": "reward.eligible" },
};

test("URL policy rejects unsafe schemes, credentials, fragments, local names, and mapped private IPv6", () => {
  for (const value of [
    "http://example.com/x", "https://u:p@example.com/x", "https://example.com/x#fragment",
    "https://localhost/x", "https://service.local/x", "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://[::ffff:127.0.0.1]/x",
    "https://example.com/\r\nx-injected: yes",
  ]) assert.throws(() => validateDirectCallbackUrl(value));
  assert.equal(isProhibitedCallbackAddress("::ffff:7f00:1", 6), true);
});

test("all DNS answers are validated and any unsafe answer rejects the destination", async () => {
  const url = validateDirectCallbackUrl("https://callbacks.example/reward");
  await assert.rejects(resolvePublicCallbackAddresses(url, async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.7", family: 4 },
  ]), /public addresses/);
});

test("dispatcher pins the validated address while preserving Host, SNI, and TLS verification", async () => {
  const fake = fakeTransport();
  const result = await dispatchPinnedHttpsCallback(callbackInput, { resolve: publicDns, request: fake.request });
  assert.equal(result.status, 204);
  assert.equal(fake.calls.length, 1);
  const { options } = fake.calls[0];
  assert.equal(options.hostname, "callbacks.example");
  assert.equal(options.servername, "callbacks.example");
  assert.equal(options.headers.Host, "callbacks.example:8443");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.port, 8443);
  assert.equal(options.path, "/reward?source=agx");
  await new Promise((resolve, reject) => options.lookup("callbacks.example", {}, (error, address, family) => {
    if (error) return reject(error);
    assert.equal(address, "93.184.216.34");
    assert.equal(family, 4);
    resolve();
  }));
});

test("3xx is returned as failure and is never followed", async () => {
  const fake = fakeTransport({ status: 302 });
  const result = await dispatchPinnedHttpsCallback(callbackInput, { resolve: publicDns, request: fake.request });
  assert.equal(result.ok, false);
  assert.equal(result.status, 302);
  assert.equal(fake.calls.length, 1);
});

test("a redirect response cannot cause localhost to be contacted", async () => {
  const fake = fakeTransport({ status: 307 });
  await dispatchPinnedHttpsCallback(callbackInput, { resolve: publicDns, request: fake.request });
  assert.deepEqual(fake.calls.map(({ options }) => options.hostname), ["callbacks.example"]);
});

test("DNS rebinding cannot change the socket address after validation", async () => {
  let resolutions = 0;
  const fake = fakeTransport();
  await dispatchPinnedHttpsCallback(callbackInput, {
    resolve: async () => {
      resolutions += 1;
      return [{ address: resolutions === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
    },
    request: fake.request,
  });
  assert.equal(resolutions, 1);
  const options = fake.calls[0].options;
  options.lookup("callbacks.example", {}, (_error, address) => assert.equal(address, "93.184.216.34"));
});

test("response hashing is bounded at 64 KiB", async () => {
  const fake = fakeTransport({ status: 200, chunks: [Buffer.alloc(70 * 1024, 1)] });
  const result = await dispatchPinnedHttpsCallback(callbackInput, { resolve: publicDns, request: fake.request });
  assert.match(result.responseHash, /bytes=65536;truncated=1$/);
});

test("ten-second request timeout rejects with a safe timeout error", async () => {
  const fake = fakeTransport({ neverRespond: true });
  await assert.rejects(
    dispatchPinnedHttpsCallback({ ...callbackInput, timeoutMs: 5 }, { resolve: publicDns, request: fake.request }),
    (error) => error.name === "TimeoutError"
  );
});
