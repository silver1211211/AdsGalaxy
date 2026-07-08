import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mediation = readFileSync("src/lib/miniappMediationEngine.ts", "utf8");
const optimization = readFileSync("src/lib/miniappOptimization.ts", "utf8");
const internalAds = readFileSync("src/lib/miniappInternalAds.ts", "utf8");
const requestRoute = readFileSync("src/app/api/miniapp/mediation/request/route.ts", "utf8");

test("internal plus external available weights internal at 30 percent and external combined at 70 percent", () => {
  assert.match(mediation, /const INTERNAL_SHARE_WITH_EXTERNAL = 0\.3/);
  assert.match(mediation, /const EXTERNAL_SHARE_WITH_INTERNAL = 0\.7/);
  assert.match(mediation, /internal_target_share_when_external_available:\s*INTERNAL_SHARE_WITH_EXTERNAL/);
  assert.match(mediation, /external_target_share_when_internal_available:\s*EXTERNAL_SHARE_WITH_INTERNAL/);
  assert.doesNotMatch(mediation, /internal_target_share_when_external_available:\s*0\.18/);
  assert.doesNotMatch(mediation, /external_target_share_when_internal_available:\s*0\.82/);
});

test("internal-only mode still gives AdsGalaxy internal the full candidate weight", () => {
  assert.match(mediation, /network\.network_name === INTERNAL_NETWORK_NAME[\s\S]*?externalRemaining\.length > 0 \? INTERNAL_SHARE_WITH_EXTERNAL : 1/);
});

test("internal cooldown skips only AdsGalaxy internal while external candidates can continue", () => {
  assert.match(internalAds, /skipReason = "internal_user_cooldown"/);
  assert.match(internalAds, /DATE_SUB\(NOW\(\), INTERVAL \? SECOND\)/);
  assert.match(optimization, /internal_campaign_user_cooldown_seconds:\s*5/);

  const internalNoFillBlock = mediation.match(/if \(!internalCampaign\.campaign\) \{[\s\S]*?\n      \}/)?.[0] || "";
  assert.match(internalNoFillBlock, /skipped\.push\(\{ network_name: INTERNAL_NETWORK_NAME, reason: internalCampaign\.skip_reason/);
  assert.match(internalNoFillBlock, /continue;/);
  assert.doesNotMatch(internalNoFillBlock, /return/);
});

test("internal cooldown with no external candidate returns friendly message without exact seconds", () => {
  assert.match(requestRoute, /internalCooldownNoFill/);
  assert.match(requestRoute, /network\.network_name === INTERNAL_NETWORK_NAME && network\.reason === "internal_user_cooldown"/);
  assert.match(requestRoute, /!decision\.candidate_networks\.some\(\(network\) => network !== INTERNAL_NETWORK_NAME\)/);
  assert.match(requestRoute, /You’re requesting ads too quickly\. Please wait a moment and try again\./);
  assert.doesNotMatch(requestRoute, /5 seconds|5s|seconds/);
});

test("earnings, reward, impression, click, external fallback, and settlement paths are not changed here", () => {
  for (const source of [mediation, optimization, requestRoute]) {
    assert.doesNotMatch(source, /calculateMiniAppPublisherPayout\(|recordInternalAdImpression\(|recordInternalAdClick\(|settle-miniapp|publisher_revenue =|reward_eligible =/);
  }
  const cooldownBlock = internalAds.match(/const \[\[cooldownRow\]\][\s\S]*?continue;\n      \}/)?.[0] || "";
  assert.doesNotMatch(cooldownBlock, /calculateMiniAppPublisherPayout\(|recordInternalAdImpression\(|recordInternalAdClick\(|publisher_revenue|reward_eligible/);
  assert.match(mediation, /const fallbackAvailable = decision\.candidate_networks\.length > 1/);
  assert.match(mediation, /readAttemptState/);
});
