import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "./reward-callback-production-loader.mjs";

const lifecycle = await import("../src/lib/campaignPauseLifecycle.ts");
const route = readFileSync("src/app/api/advertiser/campaigns/[id]/route.ts", "utf8");
const page = readFileSync("src/app/advertiser/campaigns/page.tsx", "utf8");
const broadcastWorker = readFileSync("src/app/api/cron/process-broadcast/route.ts", "utf8");
const cleanupWorker = readFileSync("src/app/api/cron/retry-telegram-cleanup/route.ts", "utf8");

function blockBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing block: ${start}`);
  return source.slice(from, to);
}

test("BOT pause uses production classification without channel settlement, deletion, or lock", () => {
  assert.equal(lifecycle.pausableCampaignKind("broadcast"), "bot");
  const botPause = blockBetween(route, 'if (campaignKind === "bot")', "const [pauseResult]");
  assert.match(botPause, /SET status = 'paused'/);
  assert.match(botPause, /paused_at = NOW\(\)/);
  assert.match(botPause, /resume_locked_until = NULL/);
  assert.doesNotMatch(botPause, /settleCampaignEngagementBeforeDeletion|deleteActiveCampaignPosts|INTERVAL 1 HOUR|sendTelegramMessage/);
  assert.doesNotMatch(botPause, /broadcast_deliveries|DELETE FROM/);
  assert.match(broadcastWorker, /c\.type = 'broadcast' AND c\.status = 'active'/);
});

test("BOT resume bypasses only the channel lock and performs no immediate delivery", () => {
  assert.match(route, /campaignKind === "channel" && campaign\.pause_reason/);
  const resume = blockBetween(route, 'if (campaign.status === "paused")', 'return NextResponse.json({ error: "This campaign status cannot be toggled"');
  assert.match(resume, /SET status = 'active'/);
  assert.doesNotMatch(resume, /sendTelegramMessage|broadcast_deliveries|campaign_posts|process-broadcast|process-ads/);
});

test("CHANNEL pause queues one-time settlement and deletion while preserving the one-hour lock", () => {
  assert.equal(lifecycle.pausableCampaignKind("views"), "channel");
  assert.equal(lifecycle.pausableCampaignKind("clicks"), "channel");
  assert.match(route, /resume_locked_until = DATE_ADD\(NOW\(\), INTERVAL 1 HOUR\)/);
  assert.match(route, /cleanup_queued: true/);
  assert.match(cleanupWorker, /settleCampaignEngagementBeforeDeletion\(\s*Number\(campaign\.id\),\s*"advertiser_pause"/);
  assert.match(cleanupWorker, /deleteActiveCampaignPosts\(campaign\.id\)/);
});

test("CHANNEL resume enforces the lock with safe copy and does not post immediately", () => {
  assert.match(route, /This campaign cannot be resumed until the 1-hour pause period has ended\./);
  assert.doesNotMatch(route, /Admin can resume it earlier|unless an admin resumes it manually/);
  const resume = blockBetween(route, 'if (campaign.status === "paused")', 'return NextResponse.json({ error: "This campaign status cannot be toggled"');
  assert.match(resume, /lockedUntil\.getTime\(\) > Date\.now\(\)/);
  assert.doesNotMatch(resume, /deleteActiveCampaignPosts|sendTelegramMessage|campaign_posts/);
});

test("unsupported campaign types fail closed before destructive behavior", () => {
  assert.equal(lifecycle.pausableCampaignKind("miniapp"), null);
  assert.equal(lifecycle.campaignPauseWarning("miniapp"), null);
  assert.match(route, /if \(!campaignKind\)[\s\S]*This campaign type cannot be paused or resumed/);
  assert.ok(
    route.indexOf("if (!campaignKind)") <
      route.indexOf('if (campaign.status === "active")')
  );
});

test("BOT and CHANNEL warnings use the exact approved production copy", () => {
  assert.equal(
    lifecycle.campaignPauseWarning("broadcast"),
    "Pausing this campaign will stop new bot broadcasts. Already delivered messages will remain available. Do you want to continue?"
  );
  assert.equal(
    lifecycle.campaignPauseWarning("views"),
    "Pausing this campaign will delete all active posts from channels. You cannot resume this campaign for 1 hour. Do you want to continue?"
  );
  assert.match(page, /campaignPauseWarning\(campaign\.type\)/);
  assert.doesNotMatch(page, /unless an admin resumes it manually/);
});
