import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const helperSource = readFileSync("src/lib/miniappSdkUrl.ts", "utf8");
const compiledHelper = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helperModule = { exports: {} };
new Function("exports", "module", compiledHelper)(helperModule.exports, helperModule);

const { buildMiniappSdkTemplateUrl, buildMiniappSdkUrl } = helperModule.exports;

function sdkPathCount(value) {
  return new URL(value).pathname.match(/\/sdk\.js/g)?.length || 0;
}

test("numeric Mini App ID 13 produces one canonical sdk.js path", () => {
  const url = buildMiniappSdkUrl(13, "https://app.adsgalaxy.online");
  assert.equal(url, "https://app.adsgalaxy.online/sdk.js?id=13");
  assert.equal(sdkPathCount(url), 1);
});

test("origin and complete SDK URL forms normalize identically", () => {
  const inputs = [
    "https://app.adsgalaxy.online",
    "https://app.adsgalaxy.online/",
    "https://app.adsgalaxy.online/sdk.js",
    "https://app.adsgalaxy.online/sdk.js/",
    "https://app.adsgalaxy.online/sdk.js/sdk.js",
  ];

  for (const input of inputs) {
    const url = buildMiniappSdkUrl("13", input);
    assert.equal(url, "https://app.adsgalaxy.online/sdk.js?id=13");
    assert.equal(sdkPathCount(url), 1);
  }
});

test("numeric IDs stay numeric and invalid IDs are safely rejected", () => {
  assert.equal(buildMiniappSdkUrl("0013", "https://app.adsgalaxy.online"), "https://app.adsgalaxy.online/sdk.js?id=13");
  assert.equal(buildMiniappSdkUrl("13x", "https://app.adsgalaxy.online"), null);
  assert.equal(buildMiniappSdkUrl(0, "https://app.adsgalaxy.online"), null);
  assert.equal(buildMiniappSdkUrl(-1, "https://app.adsgalaxy.online"), null);
  assert.equal(buildMiniappSdkUrl(1.5, "https://app.adsgalaxy.online"), null);
});

test("existing query parameters are preserved and id is replaced", () => {
  const url = buildMiniappSdkUrl(
    13,
    "https://app.adsgalaxy.online/sdk.js?version=14T&id=999#ignored",
  );
  assert.equal(url, "https://app.adsgalaxy.online/sdk.js?version=14T&id=13");
});

test("invalid configured URLs fall back safely", () => {
  assert.equal(
    buildMiniappSdkUrl(13, "not a URL", "https://app.adsgalaxy.online/"),
    "https://app.adsgalaxy.online/sdk.js?id=13",
  );
  assert.equal(
    buildMiniappSdkUrl(13, "javascript:alert(1)"),
    "https://app.adsgalaxy.online/sdk.js?id=13",
  );
});

test("documentation templates use one canonical SDK path", () => {
  const template = buildMiniappSdkTemplateUrl(
    "YOUR_MINI_APP_ID",
    "https://app.adsgalaxy.online/sdk.js/",
  );
  assert.equal(template, "https://app.adsgalaxy.online/sdk.js?id=YOUR_MINI_APP_ID");
  assert.equal(sdkPathCount(template), 1);

  for (const file of [
    "src/app/docs/publisher/miniapps/page.tsx",
    "src/app/docs/developers/page.tsx",
    "src/components/publisher/MiniAppDetailsScreen.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\$\{[^}]+\}\/sdk\.js\?id=/);
  }
});
