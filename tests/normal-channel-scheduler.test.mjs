import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const scheduleSource = read("../src/lib/channelScheduleSlots.ts");
const deliverySource = read("../src/lib/channelDelivery.ts");
const route = read("../src/app/api/cron/process-ads/route.ts");
const compile = async (source) => {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
};

const schedule = await compile(scheduleSource);
const delivery = await compile(deliverySource);
const channel = (posting_times, posts_per_day = posting_times.length) => ({ id: 7, posting_times, posts_per_day });
const at = (iso) => new Date(iso);

test("1 exact configured slot is due", () => assert.equal(schedule.evaluateChannelPostingSlot(channel(["12:00"]), at("2026-09-27T12:00:00Z"), 15).due, true));
test("2 inside grace retains original slot", () => {
  const result = schedule.evaluateChannelPostingSlot(channel(["12:00"]), at("2026-09-27T12:10:00Z"), 15);
  assert.deepEqual([result.due, result.slotDate, result.slotTime], [true, "2026-09-27", "12:00"]);
});
test("3 outside grace is not due", () => {
  const result = schedule.evaluateChannelPostingSlot(channel(["12:00"]), at("2026-09-27T12:16:00Z"), 15);
  assert.deepEqual([result.due, result.missed], [false, true]);
});
test("4 historic multi-slot recovery is removed", () => {
  assert.equal(schedule.evaluateChannelPostingSlot(channel(["10:00"]), at("2026-09-27T12:00:00Z"), 15).due, false);
  assert.doesNotMatch(route, /CHANNEL_SCHEDULER_RECOVERY_SLOTS|postingSlotHistory/);
});
test("5 multiple configured slots remain independent", () => {
  const result = schedule.evaluateChannelPostingSlot(channel(["10:00", "14:00", "18:00"]), at("2026-09-27T14:05:00Z"), 15);
  assert.deepEqual([result.due, result.slotTime], [true, "14:00"]);
});
test("6 persisted slot comes from channel evaluation, not scheduler bucket", () => {
  assert.match(route, /postingSlotDate:schedulerSchema\.hasPostSlotColumns\?channel\.postingSlotDate/);
  assert.match(route, /postingSlotTime:schedulerSchema\.hasPostSlotColumns\?`\$\{channel\.postingSlotTime\}:00`/);
});
test("7 success keeps claim and prevents a second reservation", async () => {
  let existing = null;
  let campaignPostInserts = 0;
  const conn = { query: async (sql) => {
    if (sql.includes("SELECT sc.id")) return [[existing].filter(Boolean)];
    if (sql.includes("INSERT IGNORE INTO channel_schedule_slot_claims")) { existing = { id: 11, campaign_post_id: null, released_at: null, post_status: null, delivery_confirmed_at: null, delivery_failed_at: null }; return [{ affectedRows: 1, insertId: 11 }]; }
    if (sql.includes("SET delivery_claim_key=NULL")) return [{ affectedRows: 0 }];
    if (sql.includes("INSERT IGNORE INTO campaign_posts")) { campaignPostInserts++; return [{ affectedRows: 1, insertId: 22 }]; }
    if (sql.includes("UPDATE channel_schedule_slot_claims SET campaign_post_id")) { existing.campaign_post_id = 22; existing.post_status = "pending_delivery"; return [{ affectedRows: 1 }]; }
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const input = { campaignId: 3, channelId: 7, channelUsername: "x", generation: 1, mode: "scheduled", postingSlotDate: "2026-09-27", postingSlotTime: "12:00:00" };
  assert.equal((await delivery.reserveChannelPlacement(conn, input)).claimed, true);
  assert.equal((await delivery.reserveChannelPlacement(conn, input)).claimed, false);
  assert.equal(campaignPostInserts, 1);
});
test("8 temporary Telegram failure marks failed and releases exact claim", () => {
  assert.match(route, /markScheduledPlacementFailed[\s\S]*releaseChannelScheduleSlotClaim/);
  assert.match(deliverySource, /WHERE id=\? AND campaign_post_id=\? AND channel_id=\? AND slot_date=\? AND slot_time=\?/);
});
test("9 released same slot can be reclaimed within grace", () => {
  const row = { id: 1, campaign_post_id: 2, released_at: new Date(), post_status: "delivery_failed", delivery_confirmed_at: null, delivery_failed_at: new Date() };
  assert.equal(delivery.classifyChannelScheduleSlotClaim(row), "available");
});
test("10 retry after grace is rejected", () => assert.equal(schedule.evaluateChannelPostingSlot(channel(["12:00"]), at("2026-09-27T12:20:00Z"), 15).due, false));
test("11 permanent Telegram health gate remains before reservation", () => assert.ok(route.indexOf("verifyTelegramChannelAccess") < route.indexOf("reserveChannelPlacement(conn")));
test("12 permission failure uses Prompt 2 canonical health", () => assert.match(route, /verifyTelegramChannelAccess\([\s\S]*autoPauseActive: true/));
test("13 concurrent claims are guarded by atomic unique-slot reservation", () => {
  assert.match(deliverySource, /INSERT IGNORE INTO channel_schedule_slot_claims/);
  assert.match(deliverySource, /schedule_slot_claim_exists/);
});
test("14 claim conflict cannot reach Telegram send", () => assert.ok(route.indexOf("if (!reservation.claimed)") < route.indexOf("sendTelegramMessageWithRetries(channel.chat_id")));
test("15 failed post does not count toward publisher daily capacity", () => {
  assert.match(route, /cp\.delivery_confirmed_at IS NOT NULL[\s\S]*cp\.delivery_failed_at IS NULL/);
});
test("16 midnight keeps the original prior-day identity", () => {
  const result = schedule.evaluateChannelPostingSlot(channel(["23:55"]), at("2026-09-28T00:04:00Z"), 15);
  assert.deepEqual([result.due, result.slotDate, result.slotTime], [true, "2026-09-27", "23:55"]);
});
test("17 before today's first slot is not due", () => assert.equal(schedule.evaluateChannelPostingSlot(channel(["14:00"]), at("2026-09-27T13:59:00Z"), 15).due, false));
test("18 scheduler interval defaults to one minute and ignores legacy throttle", () => {
  assert.match(route, /CHANNEL_SCHEDULER_INTERVAL_MINUTES \|\| "1"/);
  assert.doesNotMatch(route, /process\.env\.CRON_POSTS_INTERVAL/);
});
test("19 candidate paging rotates and continues beyond one batch", () => {
  assert.match(route, /startAfter/);
  assert.match(route, /await scanRange\(startAfter, null\)/);
  assert.match(route, /await scanRange\(0, startAfter\)/);
});
test("20 no campaign path creates no claim", () => assert.ok(route.indexOf("if (eligibleCampaigns.length === 0)") < route.indexOf("reserveChannelPlacement(conn")));
test("21 missed slots are observable and never delivered", () => {
  assert.match(route, /reason: "missed_schedule_slot"/);
  assert.match(route, /process-ads missed schedule slots/);
});
test("22 scheduler fix introduces no financial mutation helper", () => {
  assert.doesNotMatch(deliverySource, /wallet|earnings|settlement|advertiser_debit|publisher_credit/i);
  assert.doesNotMatch(scheduleSource, /wallet|earnings|settlement|advertiser_debit|publisher_credit/i);
});
test("23 exact cleanup cannot release a different slot", async () => {
  let captured;
  const conn = { query: async (sql, params) => { captured = { sql, params }; return [{ affectedRows: 1 }]; } };
  assert.equal(await delivery.releaseChannelScheduleSlotClaim(conn, { claimId: 1, postId: 2, channelId: 7, slotDate: "2026-09-27", slotTime: "12:00:00" }), true);
  assert.deepEqual(captured.params, [1, 2, 7, "2026-09-27", "12:00:00"]);
});
test("24 canonical Prompt 2 verifier is reused without duplicate classifier", () => {
  assert.match(route, /from "@\/lib\/telegramChannelAccess"/);
  assert.doesNotMatch(scheduleSource, /bot_removed|permission_missing|channel_not_found/);
});
test("25 in-flight and successful claims remain occupied", () => {
  assert.equal(delivery.classifyChannelScheduleSlotClaim({ id: 1, campaign_post_id: 2, released_at: null, post_status: "pending_delivery", delivery_confirmed_at: null, delivery_failed_at: null }), "in_flight");
  assert.equal(delivery.classifyChannelScheduleSlotClaim({ id: 1, campaign_post_id: 2, released_at: null, post_status: "active", delivery_confirmed_at: new Date(), delivery_failed_at: null }), "success");
});
