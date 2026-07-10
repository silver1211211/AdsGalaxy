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

test("share-cap internal last resort is only evaluated after the post-filter external pool is empty", () => {
  assert.match(internalAds, /ignoreNetworkShareCap\?: boolean/);
  assert.match(internalAds, /input\.ignoreNetworkShareCap === true && cap\.reason === "internal_share_cap_reached"/);
  assert.match(internalAds, /!cap\.allowed && !bypassingReachedNetworkShareCap/);
  assert.match(mediation, /const externalCandidatePoolEmpty = !candidatePool\.some\(\(network\) => network\.network_name !== INTERNAL_NETWORK_NAME\)/);
  assert.match(mediation, /internalShareCapSkipIndex >= 0[\s\S]*?externalCandidatePoolEmpty[\s\S]*?!attempted\.has\(INTERNAL_NETWORK_NAME\)/);
  assert.match(mediation, /ignoreNetworkShareCap: true/);
  assert.match(mediation, /internal_last_resort: internalLastResortUsed/);
  assert.match(mediation, /internal_last_resort_reason: internalLastResortUsed \? "external_pool_empty_after_share_cap" : null/);
});

test("last-resort re-evaluation preserves its actual internal rejection reason", () => {
  assert.match(mediation, /skipped\[internalShareCapSkipIndex\] = \{ network_name: INTERNAL_NETWORK_NAME, reason: internalLastResortUnavailableReason \}/);
  assert.match(mediation, /internal_last_resort_unavailable/);
});

test("internal cooldown skips only AdsGalaxy internal while external candidates can continue", () => {
  const selectionSource = internalAds.match(/export async function selectInternalRewardedCampaign[\s\S]*?\n}\n\nexport async function recordInternalAdImpression/)?.[0] || "";
  const cooldownPosition = selectionSource.indexOf("const [[cooldownRow]]");
  const campaignLoopPosition = selectionSource.indexOf("for (const row of campaigns)");

  assert.ok(cooldownPosition >= 0);
  assert.ok(cooldownPosition < campaignLoopPosition);
  assert.match(selectionSource, /skip_reason: "internal_user_cooldown"/);
  assert.match(internalAds, /DATE_SUB\(NOW\(\), INTERVAL \? SECOND\)/);
  assert.match(selectionSource, /WHERE miniapp_id = \?\s*AND telegram_user_id = \?/);
  assert.doesNotMatch(selectionSource, /skipReason = "internal_user_cooldown"/);
  assert.match(optimization, /internal_campaign_user_cooldown_seconds:\s*5/);

  const internalNoFillBlock = mediation.match(/if \(!internalCampaign\.campaign\) \{[\s\S]*?\n      \}/)?.[0] || "";
  assert.match(internalNoFillBlock, /skipped\.push\(\{ network_name: INTERNAL_NETWORK_NAME, reason: internalCampaign\.skip_reason/);
  assert.match(internalNoFillBlock, /continue;/);
  assert.doesNotMatch(internalNoFillBlock, /return/);
});

test("impression-time cooldown serializes a Mini App/user pair before financial writes", () => {
  assert.match(internalAds, /SELECT GET_LOCK\(\?, 5\) AS acquired/);
  assert.match(internalAds, /SELECT id FROM miniapps WHERE id = \? FOR UPDATE/);
  assert.match(internalAds, /WHERE miniapp_id = \?\s*AND telegram_user_id = \?\s*AND created_at >= DATE_SUB\(NOW\(\), INTERVAL \? SECOND\)/);
  assert.match(internalAds, /return \{ duplicate: false, insufficient_balance: false, cooldown: true \}/);
  assert.ok(internalAds.indexOf("SELECT GET_LOCK") < internalAds.indexOf("UPDATE users SET ad_balance"));
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
