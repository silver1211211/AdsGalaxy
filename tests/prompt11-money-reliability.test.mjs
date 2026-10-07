import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const join = read("src/app/api/publisher/verify-join/route.ts");
const deposits = read("src/app/api/advertiser/deposits/route.ts");
const depositStatus = read("src/app/api/advertiser/deposits/[track_id]/route.ts");
const depositCredit = read("src/lib/depositBonus.ts");
const callback = read("src/app/api/webhooks/oxapay/deposits/route.ts");
const withdrawals = read("src/app/api/publisher/withdrawals/route.ts");
const networks = read("src/lib/withdrawalNetworks.ts");
const migration = read("db/migrations/20260928_0152_money_reliability.sql");

test("join reward locks the user and uses a durable unique ledger key", () => {
  assert.match(join, /SELECT join_rewarded FROM users WHERE id = \? FOR UPDATE/);
  assert.match(join, /join_channel_reward:\$\{user\.id\}/);
  assert.match(join, /INSERT IGNORE INTO referral_reward_ledger/);
  assert.match(join, /withFinancialTransactionRetry/);
});

test("deposit invoice creation reserves before the provider request", () => {
  const reservation = deposits.indexOf("creation_state,provider_status");
  const provider = deposits.lastIndexOf("await fetch(OXAPAY_API_URL");
  assert.ok(reservation >= 0 && provider > reservation);
  assert.match(deposits, /uq_deposit_creation_key|creation_idempotency_key/);
  assert.match(migration, /UNIQUE INDEX uq_deposit_creation_key/);
});

test("ambiguous deposit creation never opens a second invoice", () => {
  assert.match(deposits, /DEPOSIT_CREATION_IN_PROGRESS/);
  assert.match(deposits, /creation_state='ambiguous'/);
  assert.match(deposits, /IDEMPOTENCY_KEY_CONFLICT/);
});

test("local cancellation remains reconcilable and paid is authoritative", () => {
  assert.match(depositStatus, /local_canceled_at=NOW\(\)/);
  assert.doesNotMatch(depositStatus, /status === "canceled"\) \{/);
  assert.match(depositCredit, /"canceled"/);
  assert.match(callback, /providerStatus === "paid"/);
  assert.match(callback, /confirmDepositCredit/);
});

test("OxaPay callback authenticates the exact raw body", () => {
  assert.match(callback, /createHmac\("sha512", key\)\.update\(raw\)/);
  assert.match(callback, /timingSafeEqual/);
  assert.match(callback, /return new Response\("ok"\)/);
});

test("withdrawal networks fail closed and validate address families", () => {
  assert.match(networks, /UNSUPPORTED_WITHDRAWAL_NETWORK/);
  assert.match(networks, /decoded\.length !== 25/);
  assert.match(networks, /\^0x\[0-9a-fA-F\]\{40\}\$/);
  assert.doesNotMatch(withdrawals, /NETWORK_FEES\[network\] \?\? 0/);
});

test("withdrawal retry is bound to user key and request fingerprint", () => {
  assert.match(withdrawals, /hashUserIdempotencyKey\(Number\(user\.id\), idempotencyRaw\)/);
  assert.match(withdrawals, /request_fingerprint/);
  assert.match(withdrawals, /IDEMPOTENCY_KEY_CONFLICT/);
  assert.match(migration, /UNIQUE INDEX uq_withdrawal_idempotency/);
});

test("withdrawal notification is queued before financial commit", () => {
  assert.match(withdrawals, /enqueuePlatformNotification\(connection/);
  assert.match(withdrawals, /withdrawal_submitted:\$\{withdrawalId\}/);
  assert.doesNotMatch(withdrawals, /sendTelegramMessage/);
});
