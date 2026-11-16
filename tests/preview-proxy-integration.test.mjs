import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
function load(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier === "node:crypto" || specifier === "crypto") return crypto;
    if (specifier === "@/lib/previewAuth" || specifier.includes("previewAuth")) return load("src/lib/previewAuth.ts");
    if (specifier === "next/server") {
      return {
        NextResponse: {
          next: (opts) => ({ type: "next", ...opts, headers: new Map() }),
          redirect: (url, status = 307) => ({ type: "redirect", url: String(url), status }),
          json: (data, opts = {}) => ({ type: "json", data, status: opts.status || 200 }),
        },
      };
    }
    return require(specifier);
  };
  const fn = new Function("require", "module", "exports", output);
  fn(customRequire, mod, mod.exports);
  return mod.exports;
}

const previewAuth = load("src/lib/previewAuth.ts");
const { createPreviewSessionToken, PREVIEW_COOKIE_NAME } = previewAuth;
const proxyModule = load("src/proxy.ts");
const { proxy } = proxyModule;

function createMockRequest({
  pathname = "/",
  search = "",
  host = "preview.adsgalaxy.online",
  method = "GET",
  cookies = {},
  headers = {},
}) {
  const cookieMap = new Map(Object.entries(cookies));
  const headerMap = new Map(
    Object.entries({
      host,
      ...headers,
    })
  );

  return {
    method,
    url: `https://${host}${pathname}${search}`,
    nextUrl: {
      pathname,
      search,
    },
    cookies: {
      get: (name) => (cookieMap.has(name) ? { name, value: cookieMap.get(name) } : undefined),
    },
    headers: {
      get: (name) => headerMap.get(name.toLowerCase()) || null,
    },
  };
}

test("1. proxy: unauthenticated page request on preview domain redirects to /preview-login", () => {
  const req = createMockRequest({ pathname: "/publisher", host: "preview.adsgalaxy.online" });
  const res = proxy(req);

  assert.equal(res.type, "redirect");
  assert.ok(res.url.includes("/preview-login?redirect=%2Fpublisher"), "Redirects to preview login with target");
});

test("2. proxy: unauthenticated API request on preview domain returns 401 JSON", () => {
  const req = createMockRequest({ pathname: "/api/publisher/stats", host: "preview.adsgalaxy.online" });
  const res = proxy(req);

  assert.equal(res.type, "json");
  assert.equal(res.status, 401);
  assert.equal(res.data.code, "PREVIEW_UNAUTHENTICATED");
  assert.equal(res.data.loginUrl, "/preview-login");
});

test("3. proxy: exempt paths (login, logout, HMR, assets) bypass preview authentication", () => {
  const exemptPaths = [
    "/preview-login",
    "/api/preview/login",
    "/api/preview/logout",
    "/api/preview/session",
    "/_next/webpack-hmr",
    "/_next/static/chunks/main.js",
    "/_next/image?url=logo.png",
    "/favicon.ico",
    "/fonts/Geist-Latin.woff2",
  ];

  for (const path of exemptPaths) {
    const req = createMockRequest({ pathname: path, host: "preview.adsgalaxy.online" });
    const res = proxy(req);
    assert.notEqual(res.type, "redirect", `Path ${path} should not redirect`);
    assert.notEqual(res.status, 401, `Path ${path} should not return 401`);
  }
});

test("4. proxy: authenticated session unlocks preview and allows page access", () => {
  process.env.PREVIEW_ACCESS_PASSWORD = "CorrectPassword123!";
  const validToken = createPreviewSessionToken();

  const req = createMockRequest({
    pathname: "/publisher",
    host: "preview.adsgalaxy.online",
    cookies: { [PREVIEW_COOKIE_NAME]: validToken },
  });

  const res = proxy(req);
  assert.equal(res.type, "next", "Allows authenticated request to proceed to page");
});

test("5. proxy: production hostname traffic does not require preview auth", () => {
  const origAuth = process.env.PREVIEW_AUTH_ENABLED;
  delete process.env.PREVIEW_AUTH_ENABLED;

  try {
    const req = createMockRequest({ pathname: "/publisher", host: "adsgalaxy.online" });
    const res = proxy(req);
    assert.notEqual(res.type, "redirect", "Production host should not redirect to preview-login");
  } finally {
    if (origAuth) process.env.PREVIEW_AUTH_ENABLED = origAuth;
  }
});

test("6. proxy: safe read-only preview blocks mutating financial/campaign APIs with 403", () => {
  process.env.NODE_ENV = "development";
  process.env.ENABLE_LOCAL_MINIAPP_DEV = "true";
  process.env.PREVIEW_ACCESS_PASSWORD = "CorrectPassword123!";
  const validToken = createPreviewSessionToken();

  // Non-safe mutating POST (e.g. campaign creation or balance debit)
  const req = createMockRequest({
    pathname: "/api/advertiser/campaigns",
    method: "POST",
    host: "preview.adsgalaxy.online",
    cookies: { [PREVIEW_COOKIE_NAME]: validToken },
    headers: { "x-telegram-init-data": "adsgalaxy-local-miniapp-dev:" },
  });

  const res = proxy(req);
  assert.equal(res.type, "json");
  assert.equal(res.status, 403);
  assert.equal(res.data.code, "PREVIEW_READ_ONLY", "Blocks mutating POST on preview account");
});
