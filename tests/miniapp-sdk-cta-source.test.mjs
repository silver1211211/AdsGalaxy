import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sdk = readFileSync("src/app/sdk.js/route.ts", "utf8");
const previewRuntime = readFileSync("src/lib/miniappSdkRuntime.ts", "utf8");

test("internal CTA uses Telegram link APIs and one pending click request", () => {
  assert.match(sdk, /webApp\.openTelegramLink\(url\)/);
  assert.match(sdk, /webApp\.openLink\(url\)/);
  assert.match(sdk, /window\.open\(url,"_blank","noopener,noreferrer"\)/);
  assert.match(sdk, /if\(ctaPending\)return;ctaPending=true;if\(cta\)cta\.disabled=true/);
  assert.match(sdk, /ctaPending=false;if\(cta\)cta\.disabled=false/);
});

test("internal display tracks only after its display threshold and CTA only records clicks", () => {
  assert.match(sdk, /impTimer=setTimeout\(function\(\)\{impressionSent=true;track\(\{event_type:"impression_recorded",watch_duration_seconds:1\.5\}\);\},1500\)/);
  assert.doesNotMatch(sdk, /media\.onclick=openAd/);
  assert.match(sdk, /cta\.onclick=openAd/);
  assert.match(sdk, /-webkit-line-clamp:3/);
  assert.match(previewRuntime, /agx-rewarded-desc[^`]*-webkit-line-clamp:3/);
});
