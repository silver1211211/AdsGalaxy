import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (name) => readFile(new URL(`./${name}`, import.meta.url), "utf8");

test("Teza campaign selection is paced, rotated, urgent-aware, and bid-aware", async () => {
  const placement = await read("teaserPlacement.ts");
  assert.match(placement, /c\.end_at<=DATE_ADD\(UTC_TIMESTAMP\(\),INTERVAL 24 HOUR\)/);
  assert.match(placement, /GREATEST\(c\.total_budget-c\.budget,0\)/);
  assert.match(placement, /teaser_last_placement_id ASC/);
  assert.match(placement, /c\.teaser_cpm DESC/);
  assert.doesNotMatch(placement, /ORDER BY c\.id LIMIT 50/);
});

test("Teza worker refreshes stale active-channel permissions and cleans up lost access", async () => {
  const cron = await read("teaser-cron-route.ts");
  assert.match(cron, /async function refreshTeaserPermissions/);
  assert.match(cron, /status='active' AND is_deleted=FALSE AND teaser_enabled=1/);
  assert.match(cron, /teaser_permission_checked_at<UTC_TIMESTAMP\(\)-INTERVAL 24 HOUR/);
  assert.match(cron, /getChatMember/);
  assert.match(cron, /removal_reason='permission_lost'/);
  assert.match(cron, /permissions=await refreshTeaserPermissions\(\)/);
});

test("manual and rolling permission checks both recognize channel ownership", async () => {
  const [cron, channelRoute] = await Promise.all([
    read("teaser-cron-route.ts"),
    read("channel-id-route.ts"),
  ]);
  assert.match(cron, /status==="creator"/);
  assert.match(channelRoute, /status==="creator"/);
  assert.match(channelRoute, /can_edit_messages===true/);
});

test("category reporting proportionally allocates multi-category channels", async () => {
  const analytics = await read("admin-teaser-analytics-route.ts");
  assert.match(analytics, /weight: 1 \/ assignedCategories\.length/);
  assert.match(analytics, /metricNumber\([^\n]+\) \* weight/);
  assert.match(analytics, /reporting is proportionally allocated/);
});
