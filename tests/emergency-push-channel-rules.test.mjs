import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync("src/app/api/admin/campaigns/[id]/emergency-push/route.ts", "utf8");

test("emergency push does not silently cap eligible channel inventory", () => {
  assert.doesNotMatch(route, /MAX_EMERGENCY_CHANNELS/);
  assert.match(route, /eligibleChannels,[\s\S]*skippedByExclusion/);
});

test("Emergency bypass can remove spacing only, never targeting or exclusions", () => {
  assert.match(route, /const dailyCapCondition = mode === "fill_empty_slots"/);
  assert.match(route, /channelCampaignMatchesInventory\(\{/);
  assert.match(route, /campaignExcludesChannel\(channelExclusions/);
  assert.match(route, /bypassTiming: !followRules/);
  assert.match(route, /const followRules = body\.ignore_rules !== true/);
  assert.match(route, /campaignCountries: campaign\.countries/);
  assert.match(route, /campaignLanguages: campaign\.languages/);
});

test("Fill Empty Slots consumes durable capacity without requiring a future normal slot", () => {
  assert.match(route, /selectEmergencyScheduleSlot/);
  assert.match(route, /mode,/);
  assert.match(route, /no_eligible_publisher_schedule_slot/);
  assert.match(route, /capacityLimit:mode === "fill_empty_slots"/);
  assert.doesNotMatch(route, /hasActiveUndeletedPost/);
});

test("Silver emergency reports reconcilable inventory and retry counters", () => {
  for (const field of ["activeInventorySnapshot", "exemptChannels", "inaccessibleNoPermissionChannels", "attempted", "posted", "retryAttempted", "finalFailed"])
    assert.match(route, new RegExp(field));
  assert.match(route, /processBoundedQueue\(eligibleChannels/);
});

test("Silver emergency checks master pause and final owner eligibility before send", () => {
  assert.match(route, /isCampaignDeliveryAllowed/);
  assert.ok(route.indexOf("const finalEligibility") < route.indexOf("let result = await send()"));
  assert.match(route, /Undefined is an ambiguous transport outcome and must not be retried blindly/);
  assert.match(route, /retryAttempted = true/);
});
