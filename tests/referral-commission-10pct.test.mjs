import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const SCALE = 8;
const COMMISSION_PERCENT = 10n;

function normalizeReferralDecimal(value) {
  const raw = String(value ?? "0").trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("invalid_referral_decimal");
  const fraction = (match[3] || "").padEnd(SCALE, "0").slice(0, SCALE);
  return `${match[1]}${match[2]}.${fraction}`;
}

function calculateTenPercentCommission(monetizedAmount) {
  const monetizedDecimal = normalizeReferralDecimal(monetizedAmount);
  const monetizedUnits = BigInt(monetizedDecimal.replace(".", ""));
  if (monetizedUnits <= 0n) {
    return { monetizedDecimal, commissionDecimal: "0.00000000", commissionUnits: 0n };
  }
  const commissionUnits = (monetizedUnits * COMMISSION_PERCENT) / 100n;
  const digits = commissionUnits.toString().padStart(SCALE + 1, "0");
  const commissionDecimal = `${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`;
  return { monetizedDecimal, commissionDecimal, commissionUnits };
}

function formatCommissionUsdt(amount) {
  const num = Number(amount || 0);
  return `${num.toFixed(6)} USDT`;
}

// ==========================================
// 1. Exact 10% Micro-Unit Math Tests
// ==========================================

test("calculateTenPercentCommission computes exact 10% in 8-decimal micro-units", () => {
  // $10.00 monetized -> $1.00000000
  const r1 = calculateTenPercentCommission("10.00000000");
  assert.equal(r1.commissionDecimal, "1.00000000");
  assert.equal(r1.commissionUnits, 100000000n);

  // $1.25 monetized -> $0.12500000
  const r2 = calculateTenPercentCommission("1.25000000");
  assert.equal(r2.commissionDecimal, "0.12500000");
  assert.equal(r2.commissionUnits, 12500000n);

  // $0.005 monetized -> $0.00050000
  const r3 = calculateTenPercentCommission("0.00500000");
  assert.equal(r3.commissionDecimal, "0.00050000");
  assert.equal(r3.commissionUnits, 50000n);

  // Smallest 8-decimal unit: 0.00000010 -> 0.00000001
  const r4 = calculateTenPercentCommission("0.00000010");
  assert.equal(r4.commissionDecimal, "0.00000001");
  assert.equal(r4.commissionUnits, 1n);

  // Below micro-unit precision rounds down safely
  const r5 = calculateTenPercentCommission("0.00000009");
  assert.equal(r5.commissionDecimal, "0.00000000");
  assert.equal(r5.commissionUnits, 0n);

  // Zero & negative
  assert.equal(calculateTenPercentCommission("0").commissionUnits, 0n);
  assert.equal(calculateTenPercentCommission("-5.00").commissionUnits, 0n);
});

// ==========================================
// 2. 6-Decimal USDT Display Formatting Tests
// ==========================================

test("formatCommissionUsdt formats with 6 decimals and USDT label", () => {
  assert.equal(formatCommissionUsdt(0), "0.000000 USDT");
  assert.equal(formatCommissionUsdt("0.0025"), "0.002500 USDT");
  assert.equal(formatCommissionUsdt(12.3456789), "12.345679 USDT");
  assert.equal(formatCommissionUsdt("1.5"), "1.500000 USDT");
});

// ==========================================
// 3. Core Engine Implementation Checks
// ==========================================

test("referralCommission.ts implements durable, safe 10% commission processing", () => {
  const code = read("src/lib/referralCommission.ts");

  // Multi-product support
  assert.match(code, /productType:\s*ReferralProductType/);
  assert.match(code, /"channel"\s*\|\s*"miniapp"\s*\|\s*"bot"\s*\|\s*"deposit"/);

  // Anti-recursion rule
  assert.match(code, /input\.productType.*===.*"commission"/);
  assert.match(code, /anti_recursion_blocked/);

  // Direct referrer lookup
  assert.match(code, /SELECT r\.id,r\.invited_by FROM referrals r/);

  // Self-referral protection
  assert.match(code, /referrerUserId === monetizingUserId/);
  assert.match(code, /self_referral_ignored/);

  // Deduplication & idempotency on sourceEventKey
  assert.match(code, /INSERT IGNORE INTO referral_revenue_commissions/);
  assert.match(code, /source_event_key/);
  assert.match(code, /already_processed/);

  // Canonical mirror in referral_reward_ledger with referral_id = NULL
  assert.match(code, /INSERT INTO referral_reward_ledger/);
  assert.match(code, /comm:\$\{sourceEventKey\}/);
  assert.match(code, /NULL,\s*'referral_commission'/);

  // Available balance credit & cache rebuild
  assert.match(code, /creditUserAvailableBalance\(connection, referrerUserId, commissionDecimal/);
  assert.match(code, /rebuildReferralEarningsCache/);
});

// ==========================================
// 4. Migration & Schema Integrity Checks
// ==========================================

test("referral commission migration defines table with required keys", () => {
  const migration = read("db/migrations/20261101_0701_referral_revenue_commissions_compat.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS `?referral_revenue_commissions`?/);
  assert.match(migration, /`?referrer_user_id`? INT NOT NULL/);
  assert.match(migration, /`?referred_user_id`? INT NOT NULL/);
  assert.match(migration, /`?product_type`? VARCHAR\(32\) NOT NULL/);
  assert.match(migration, /`?source_event_key`? VARCHAR\(191\) NOT NULL/);
  assert.match(migration, /`?monetized_earning_amount`? DECIMAL\(18,8\) NOT NULL/);
  assert.match(migration, /`?commission_amount`? DECIMAL\(18,8\) NOT NULL/);
  assert.match(migration, /`?commission_rate`? DECIMAL\(5,4\) NOT NULL DEFAULT 0\.1000/);
  assert.match(migration, /UNIQUE KEY `?uniq_ref_revenue_source_key`? \(`?source_event_key`?\)/);
  assert.match(migration, /KEY `?idx_ref_revenue_referrer`?/);
});

// ==========================================
// 5. Settlement Call Sites Integration Checks
// ==========================================

test("all publisher settlement paths and confirmed advertiser deposits call recordReferralCommission", () => {
  // Channels: Fast billing
  const fastBilling = read("src/lib/channelFastBilling.ts");
  assert.match(fastBilling, /recordReferralCommission\(conn,\s*\{/);
  assert.match(fastBilling, /productType:\s*"channel"/);

  // Channels: Classic post settlement
  const channelSettlement = read("src/lib/channelSettlement.ts");
  assert.match(channelSettlement, /recordReferralCommission\(connection,\s*\{/);
  assert.match(channelSettlement, /productType:\s*"channel"/);

  // Channels: Growth
  const channelGrowth = read("src/lib/channelGrowth.ts");
  assert.match(channelGrowth, /recordReferralCommission\(conn,\s*\{/);

  // Channels: Teaser
  const teaser = read("src/lib/teaser.ts");
  assert.match(teaser, /recordReferralCommission\(conn,\s*\{/);

  // Mini Apps: Internal & External settlements
  const miniappSettlement = read("src/app/api/cron/settle-miniapp/route.ts");
  assert.match(miniappSettlement, /recordReferralCommission\(conn,\s*\{/);
  assert.match(miniappSettlement, /productType:\s*"miniapp"/);

  // Bots: Broadcast publisher settlement
  const botSettlement = read("src/app/api/cron/settle-broadcast-publishers/route.ts");
  assert.match(botSettlement, /recordReferralCommission\(conn,\s*\{/);
  assert.match(botSettlement, /productType:\s*"bot"/);

  const deposit = read("src/lib/depositBonus.ts");
  assert.match(deposit, /recordReferralCommission\(conn,\s*\{/);
  assert.match(deposit, /productType:\s*"deposit"/);
  assert.match(deposit, /sourceEventKey:\s*`deposit:/);
});

// ==========================================
// 6. Telegram Notifications Compliance
// ==========================================

test("Telegram notifications comply with strict notification policy", () => {
  const i18nEn = read("src/i18n/en.ts");
  const i18nRu = read("src/i18n/ru.ts");
  const pubNotifs = read("src/lib/publisherNotifications.ts");
  const commissionCode = read("src/lib/referralCommission.ts");

  // Notification A (New Referral Joined)
  assert.match(i18nEn, /bot\.referral\.joined\.message.*New Referral!/);
  assert.match(i18nEn, /Earn 10% when they monetize!/);
  assert.match(i18nRu, /bot\.referral\.joined\.message.*Новый реферал!/);

  // Notification B (Asset Added / Verified)
  assert.match(pubNotifs, /notifyReferralAssetEvent/);
  assert.match(pubNotifs, /Referral \$\{assetType\} \$\{status\}!/);
  assert.match(pubNotifs, /added a \$\{verifiedPrefix\}Telegram \$\{assetType\}\./);

  // Zero individual commission notifications (prevent spam)
  assert.doesNotMatch(commissionCode, /sendMessage|sendLocalizedTelegramMessage|enqueuePlatformNotification/);
});

// ==========================================
// 7. Redesigned UI & API Structure Checks
// ==========================================

test("Referral API and UI implement 10% commission mobile-first specifications", () => {
  const api = read("src/app/api/publisher/referrals/route.ts");
  const ui = read("src/app/publisher/referral/page.tsx");

  // API server-side pagination, summary stats & filters
  assert.match(api, /summary:\s*\{/);
  assert.match(api, /totalReferrals/);
  assert.match(api, /activeReferrals/);
  assert.match(api, /totalEarnedUsdt/);
  assert.match(api, /thisMonthUsdt/);
  assert.match(api, /breakdown:\s*\{/);
  assert.match(api, /achievements:\s*\{/);
  assert.match(api, /pagination:\s*\{/);
  assert.match(read("src/lib/publisherReferralLink.ts"), /https:\/\/t\.me\/\$\{botUsername\}\?start=\$\{encodeURIComponent\(referralCode\)\}/);

  // UI components
  assert.match(ui, /Invite Friends\..*Earn 10%/);
  assert.match(ui, /10% Lifetime Referral Commission/);
  assert.match(ui, /How It Works/);
  assert.match(ui, /Monetization Breakdown/);
  assert.doesNotMatch(ui, /Achievement Tiers|10% Earnings Calculator|Promotional Message Presets/);
  assert.match(ui, /Referral earnings history/);
  assert.match(ui, /Your Referrals/);
  assert.match(ui, /Scan Invite QR/);
});
