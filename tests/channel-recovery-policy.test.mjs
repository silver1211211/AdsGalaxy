import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyRejectionHistory,
  recoveryDecision,
  retryDelayMs,
  usernameUpdateAllowed,
} from "../scripts/channel-recovery-policy.mjs";

const at = (minute) => `2026-09-02T10:${String(minute).padStart(2, "0")}:00Z`;

test("username changed but permanent chat ID still valid is safe to update", () => {
  assert.equal(usernameUpdateAllowed({ channelChatId: "-1001", collisionChatId: null }), true);
});

test("channel_not_found recovers by permanent Telegram ID", () => {
  assert.deepEqual(recoveryDecision({ currentStatus: "channel_not_found", telegramHealthy: true }), { status: "active", reason: "recovered_by_chat_id" });
});

test("bot removed then re-added recovers", () => {
  assert.equal(recoveryDecision({ currentStatus: "bot_removed", telegramHealthy: true }).reason, "bot_readded");
});

test("restored posting permission recovers", () => {
  assert.equal(recoveryDecision({ currentStatus: "permission_missing", telegramHealthy: true }).reason, "permission_restored");
});

test("technical rejection after a technical failure can recover", () => {
  const history = [{ action: "reject", old_value: { status: "bot_removed" }, created_at: at(2) }];
  const kind = classifyRejectionHistory("rejected", history);
  assert.equal(kind, "technical_rejection");
  assert.equal(recoveryDecision({ currentStatus: "rejected", telegramHealthy: true, rejectionKind: kind }).status, "active");
});

test("manual policy rejection cannot auto-reactivate", () => {
  const history = [{ action: "reject", old_value: { status: "pending" }, created_at: at(2) }];
  const kind = classifyRejectionHistory("rejected", history);
  assert.equal(kind, "policy_rejection");
  assert.equal(recoveryDecision({ currentStatus: "rejected", telegramHealthy: true, rejectionKind: kind }).status, "rejected");
});

test("ambiguous rejection stays in manual review", () => {
  assert.equal(recoveryDecision({ currentStatus: "rejected", telegramHealthy: true, rejectionKind: "ambiguous_rejection" }).reason, "manual_review_required");
});

test("healthy active channel remains active", () => {
  assert.equal(recoveryDecision({ currentStatus: "active", telegramHealthy: true }).status, "active");
});

test("disconnected active channel does not get falsely recovered", () => {
  assert.equal(recoveryDecision({ currentStatus: "active", telegramHealthy: false }).status, "active");
});

test("username collision on a different permanent ID cannot hijack inventory", () => {
  assert.equal(usernameUpdateAllowed({ channelChatId: "-1001", collisionChatId: "-1002" }), false);
});

test("Telegram 429 obeys retry_after with a safety margin", () => {
  assert.equal(retryDelayMs({ parameters: { retry_after: 12 } }, 1), 13_000);
});

test("normal channel health checks cache getMe and honor retry_after", () => {
  const source = readFileSync(new URL("../src/lib/channelLifecycle.ts", import.meta.url), "utf8");
  assert.match(source, /let botIdPromise/);
  assert.match(source, /parameters\?\.retry_after/);
  assert.match(source, /Math\.max\(lastResult\.retryAfterMs/);
});

test("sync source mutates no financial table", () => {
  const source = readFileSync(new URL("../scripts/sync-channel-identities.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /UPDATE\s+(users|withdrawals|channel_settlement_ledger|ad_settlements|ad_settlements_views)/i);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+(withdrawals|channel_settlement_ledger|ad_settlements|ad_settlements_views)/i);
});
