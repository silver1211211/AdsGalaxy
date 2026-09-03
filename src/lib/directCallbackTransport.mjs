import crypto from "node:crypto";
import https from "node:https";
import { lookup as systemLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const DIRECT_CALLBACK_TIMEOUT_MS = 10_000;
export const DIRECT_CALLBACK_RESPONSE_LIMIT = 64 * 1024;

function unsafeIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 2 || b === 88 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0);
}

function mappedIpv4(address) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (dotted) return dotted[1];
  const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (!hexadecimal) return null;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function unsafeIpv6(address) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = mappedIpv4(value);
  if (mapped) return unsafeIpv4(mapped);
  return value === "::" || value === "::1" || value.startsWith("fc")
    || value.startsWith("fd") || /^fe[89ab]/.test(value)
    || value.startsWith("ff") || value.startsWith("100:")
    || /^2001:0?db8:/i.test(value);
}

export function isProhibitedCallbackAddress(address, family = isIP(String(address))) {
  return family === 4 ? unsafeIpv4(String(address))
    : family === 6 ? unsafeIpv6(String(address))
      : true;
}

export function validateDirectCallbackUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /[\r\n]/.test(raw)) throw new Error("Callback URL is malformed");
  let url;
  try { url = new URL(raw); } catch { throw new Error("Callback URL is malformed"); }
  if (url.protocol !== "https:") throw new Error("Callback URL must use HTTPS");
  if (url.username || url.password) throw new Error("Callback URL must not contain credentials");
  if (url.hash) throw new Error("Callback URL must not contain a fragment");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Callback URL must use a public host");
  }
  const family = isIP(hostname.replace(/^\[|\]$/g, ""));
  if (family && isProhibitedCallbackAddress(hostname, family)) {
    throw new Error("Callback URL must not use a private or reserved address");
  }
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new Error("Callback URL uses an unsupported port");
  }
  return url;
}

export async function resolvePublicCallbackAddresses(url, resolver = systemLookup) {
  const literalFamily = isIP(url.hostname.replace(/^\[|\]$/g, ""));
  const addresses = literalFamily
    ? [{ address: url.hostname.replace(/^\[|\]$/g, ""), family: literalFamily }]
    : await resolver(url.hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0
    || addresses.some(({ address, family }) => isProhibitedCallbackAddress(address, family))) {
    throw new Error("Callback URL must resolve only to public addresses");
  }
  return addresses;
}

function defaultRequest(options, onResponse) {
  return https.request(options, onResponse);
}

export async function dispatchPinnedHttpsCallback(input, dependencies = {}) {
  const url = validateDirectCallbackUrl(input.url);
  const addresses = await resolvePublicCallbackAddresses(url, dependencies.resolve || systemLookup);
  const selected = dependencies.selectAddress ? dependencies.selectAddress(addresses) : addresses[0];
  if (!selected || isProhibitedCallbackAddress(selected.address, selected.family)) {
    throw new Error("Callback URL must resolve only to public addresses");
  }
  const requestFactory = dependencies.request || defaultRequest;
  const timeoutMs = input.timeoutMs ?? DIRECT_CALLBACK_TIMEOUT_MS;
  const maxBytes = input.maxResponseBytes ?? DIRECT_CALLBACK_RESPONSE_LIMIT;
  const body = Buffer.from(input.body, "utf8");

  return await new Promise((resolve, reject) => {
    let settled = false;
    let absoluteTimeout;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(absoluteTimeout);
      fn(value);
    };
    const request = requestFactory({
      protocol: "https:",
      hostname: url.hostname,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      servername: url.hostname,
      rejectUnauthorized: true,
      headers: {
        ...input.headers,
        Host: url.host,
        "Content-Length": String(body.byteLength),
      },
      lookup(_hostname, _options, callback) {
        callback(null, selected.address, selected.family);
      },
    }, (response) => {
      const hash = crypto.createHash("sha256");
      let finalizedHash;
      const digest = () => {
        finalizedHash ||= hash.digest("hex");
        return finalizedHash;
      };
      let bytesRead = 0;
      let truncated = false;
      response.on("data", (chunk) => {
        if (finalizedHash) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = maxBytes - bytesRead;
        if (remaining <= 0) {
          truncated = true;
          response.destroy();
          return;
        }
        const accepted = buffer.byteLength > remaining ? buffer.subarray(0, remaining) : buffer;
        hash.update(accepted);
        bytesRead += accepted.byteLength;
        if (accepted.byteLength < buffer.byteLength) {
          truncated = true;
          response.destroy();
        }
      });
      response.on("end", () => finish(resolve, {
        status: Number(response.statusCode || 0),
        ok: Number(response.statusCode || 0) >= 200 && Number(response.statusCode || 0) < 300,
        responseHash: `sha256:${digest()};bytes=${bytesRead};truncated=${truncated ? 1 : 0}`,
      }));
      response.on("error", (error) => {
        if (truncated) finish(resolve, {
          status: Number(response.statusCode || 0),
          ok: Number(response.statusCode || 0) >= 200 && Number(response.statusCode || 0) < 300,
          responseHash: `sha256:${digest()};bytes=${bytesRead};truncated=1`,
        });
        else finish(reject, error);
      });
    });
    const timeoutError = () => Object.assign(new Error("Webhook request timed out"), { name: "TimeoutError" });
    request.setTimeout(timeoutMs, () => request.destroy(timeoutError()));
    absoluteTimeout = setTimeout(() => request.destroy(timeoutError()), timeoutMs);
    request.on("error", (error) => finish(reject, error));
    request.end(body);
  });
}
