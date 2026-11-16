import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
test("legacy referral payouts and popup are retired while the channel reward remains", () => {
  const sprint = read("src/lib/referralSprint.ts");
  assert.match(sprint, /function legacyReferralRewardsEnabled\(\)\s*\{\s*return false/);
  assert.match(sprint, /legacy_referral_rewards_retired/);
  assert.doesNotMatch(read("src/components/layout/DashboardLayout.tsx"), /<ReferralSprintPopup/);
  assert.doesNotMatch(read("src/app/api/cron/unlock-balances/route.ts"), /INSERT IGNORE INTO referral_commission_ledger/);
  assert.match(read("src/app/api/publisher/verify-join/route.ts"), /join_channel_reward:/);
});
test("referral page preserves link and history without competition", () => {
  const page = read("src/app/publisher/referral/page.tsx");
  assert.match(page, /api\/publisher\/referral-link/);
  assert.match(page, /earningsHistory/);
  assert.doesNotMatch(page, /GAMIFICATION & ACHIEVEMENTS|Join Sprint/);
});

import vm from "node:vm";
import ts from "typescript";
test("an existing publisher code is never replaced", async () => {
  let writes = 0;
  const db = { async query(sql) {
    if (sql.includes("SELECT referral_code")) return [[{ referral_code: "REF770190998629F", telegram_id: "770190998629" }]];
    if (sql.includes("SELECT value FROM settings")) return [[{ value: "Ads_Galaxy_bot" }]];
    writes++; throw new Error("unexpected referral code rewrite");
  } };
  const output = ts.transpileModule(read("src/lib/publisherReferralLink.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => {
    if (name === "@/lib/db") return db;
    throw new Error(name);
  }, process });
  const result = await exports.getPublisherReferralLink(42);
  assert.equal(result.referralCode, "REF770190998629F");
  assert.equal(result.referralLink, "https://t.me/Ads_Galaxy_bot?start=REF770190998629F");
  assert.equal(writes, 0);
});

test("a missing publisher code is created once and reused", async () => {
  let code = ""; let writes = 0;
  const db = { async query(sql, params) {
    if (sql.includes("SELECT referral_code")) return [[{ referral_code: code, telegram_id: "8001" }]];
    if (sql.includes("SELECT value FROM settings")) return [[{ value: "Ads_Galaxy_bot" }]];
    if (sql.includes("UPDATE users")) { writes++; code = params[0]; return [{ affectedRows: 1 }]; }
    throw new Error(sql);
  } };
  const output = ts.transpileModule(read("src/lib/publisherReferralLink.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => {
    if (name === "@/lib/db") return db;
    throw new Error(name);
  }, process });
  const first = await exports.getPublisherReferralLink(42);
  const second = await exports.getPublisherReferralLink(42);
  assert.equal(first.referralCode, "AGX8001");
  assert.equal(second.referralLink, first.referralLink);
  assert.equal(writes, 1);
});
