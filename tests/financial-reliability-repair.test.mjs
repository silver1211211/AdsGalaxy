import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const retry = read("src/lib/dbResilience.ts");
const billingSource = read("src/lib/channelBilling.ts");
const billingJs = ts.transpileModule(billingSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const billing = await import(`data:text/javascript;base64,${Buffer.from(billingJs).toString("base64")}`);
const fast = read("src/lib/channelFastBilling.ts");
const settlement = read("src/lib/channelSettlement.ts");
const daily = read("src/lib/channelDailyCap.ts");
const dailySpend = read("src/lib/channelDailySpend.ts");
const fraud = read("src/lib/channelFraudBilling.ts");
const miniapp = read("src/app/api/cron/settle-miniapp/route.ts");
const click = read("src/app/api/clicks/[id]/[postId]/route.ts");
const direct = read("src/lib/directDebitLifecycle.ts");
const reconciliation = read("src/lib/channelFinancialReconciliation.ts");
const advertiserRoute = read("src/app/api/advertiser/campaigns/[id]/route.ts");
const adminActions = read("src/app/api/admin/campaigns/[id]/actions/route.ts");

test("F1 deadlocks are retryable", () => assert.match(retry, /ER_LOCK_DEADLOCK/));
test("F2 lock wait timeouts are retryable", () => assert.match(retry, /ER_LOCK_WAIT_TIMEOUT/));
test("F3 errno 1213 is retryable", () => assert.match(retry, /1_213/));
test("F4 errno 1205 is retryable", () => assert.match(retry, /1_205/));
test("F4b SQLSTATE 40001 is retryable", () => assert.match(retry, /sqlState === "40001"/));
test("F5 financial retries are bounded to four", () => assert.match(retry, /Math\.min\(4,[\s\S]*options\.attempts \?\? 4/));
test("F6 each retry obtains a fresh connection", () => assert.match(retry, /for \(let attempt[\s\S]*pool\.getConnection\(\)/));
test("F7 failed attempts fully roll back", () => assert.match(retry, /await connection\.rollback\(\)/));
test("F8 retries use exponential delay with jitter", () => assert.match(retry, /2 \*\*[\s\S]*Math\.random/));

test("V1 view unit price is CPM divided by 1000", () => assert.equal(billing.getChannelUnitPrice({ type: "views", cpm: 6.2 }), 0.0062));
test("V2 view debit precision is eight decimals", () => assert.equal(billing.calculateChannelAdvertiserDebit({ type: "views", units: 3, cpm: 6.2 }), 0.0186));
test("V3 view fast debit retries transaction", () => assert.match(fast, /channel_view_debit/));
test("V4 legacy settlement re-reads locked post on retry", () => assert.match(settlement, /Re-read and lock authoritative campaign\/post counters on every retry/));
test("V5 settlement excludes waived views", () => assert.match(settlement, /totalViews - oldViews - waivedViews/));
test("V6 view source key stays deterministic", () => assert.match(fast, /`view:\$\{postId\}:\$\{confirmedViews\}`/));

test("C1 configured CPC is per thousand clicks", () => assert.equal(billing.getChannelUnitPrice({ type: "clicks", cpc: 50 }), 0.05));
test("C2 one click costs CPC divided by 1000", () => assert.equal(billing.calculateChannelAdvertiserDebit({ type: "clicks", units: 1, cpc: 50 }), 0.05));
test("C3 click source key is the durable click row id", () => assert.match(fast, /`click:\$\{clickId\}`/));
test("C4 click attribution is written before debit", () => assert.ok(click.indexOf("clickRecorded = await recordLegacyCampaignClick") < click.indexOf("await debitChannelClick")));
test("C5 redirect survives financial failure", () => assert.match(click, /Click tracking failed; redirect preserved/));

test("P1 requested pending drain limit is not silently clamped to 100", () => assert.match(fast, /Math\.min\(5000/));
test("P2 each pending batch is bounded to 100", () => assert.match(fast, /Math\.min\(100, limit - candidates\)/));
test("P3 pending credits paginate by durable id", () => assert.match(fast, /id>\?[\s\S]*lastId/));
test("P4 pending credit uses retry helper", () => assert.match(fast, /channel_pending_publisher_credit/));
test("P5 pending row is locked with skip locked", () => assert.match(fast, /FOR UPDATE SKIP LOCKED/));
test("P6 settled update requires pending state", () => assert.match(fast, /WHERE id=\? AND publisher_status='pending'/));
test("P7 drain reports failures", () => assert.match(fast, /failed, batches/));
test("P8 lifecycle verifies no pending rows remain", () => assert.match(settlement, /pending_fast_debit_publisher_credit_failed/));

test("D1 canonical daily accounting uses UTC", () => { assert.match(fast, /getChannelDailySpend/); assert.match(dailySpend, /created_at>=UTC_DATE\(\)/); });
test("D2 daily cap transition stores UTC day", () => assert.match(daily, /daily_cap_billing_date=UTC_DATE\(\)/));
test("D3 daily cap reset compares UTC day", () => assert.match(daily, /daily_cap_billing_date<UTC_DATE\(\)/));
test("D4 click affordability uses CPC per thousand", () => { assert.match(daily, /channelNextUnitSql/); assert.equal(billing.getChannelUnitPrice({ type: 'clicks', cpc: 50 }), 0.05); });
test("D5 direct-debit reactivation uses canonical SQL unit price", () => assert.match(direct, /channelUnitPriceSql/));
test("D6 daily-cap state transitions retry", () => assert.match(daily, /channel_daily_cap_reconciliation/));

test("B1 direct debit source key remains unique and deterministic", () => assert.match(fast, /sourceKey: `channel:\$\{input\.sourceKey\}`/));
test("B2 budget update requires enough budget", () => assert.match(fast, /WHERE id=\? AND status='active' AND budget>=\?/));
test("B3 campaign is locked before post", () => assert.ok(fast.indexOf("SELECT id FROM campaigns WHERE id=? FOR UPDATE") < fast.indexOf("FROM campaign_posts cp JOIN campaigns")));
test("B4 legacy settlement uses same campaign-first lock order", () => assert.match(settlement, /All channel money paths acquire campaign before post\/account rows/));

test("PC1 Mini App internal settlement retries", () => assert.match(miniapp, /miniapp_internal_publisher_settlement/));
test("PC2 Mini App external settlement retries", () => assert.match(miniapp, /miniapp_external_publisher_settlement/));
test("PC3 internal settlement idempotency key remains impression id", () => assert.match(miniapp, /miniapp_internal_publisher_settlements[\s\S]*impression_id/));
test("PC4 external settlement uses insert ignore before credit", () => assert.ok(miniapp.indexOf("INSERT IGNORE INTO miniapp_earnings_settlements") < miniapp.lastIndexOf("creditUserLockedBalance")));
test("PC5 payout safety check uses the active transaction", () => assert.match(miniapp, /recordPayoutSafetyCheck\([\s\S]*\}, conn\)/));

test("FR1 fraud adjustment retries", () => assert.match(fraud, /channel_fraud_billing_adjustment/));
test("FR2 fraud adjustment locks campaign first", () => assert.match(fraud, /Canonical lock order: campaign -> post -> account ids -> ledgers/));
test("FR3 fraud reversal is unique per settlement", () => assert.match(fraud, /INSERT IGNORE INTO channel_fraud_billing_adjustments/));
test("FR4 retry counters update only after commit", () => assert.ok(fraud.indexOf("adjustedSettlements += result.adjusted") > fraud.indexOf("withFinancialTransactionRetry")));

test("I1 advertiser update route uses canonical unit pricing", () => assert.match(advertiserRoute, /getChannelUnitPrice/));
test("I2 admin resume uses canonical unit pricing", () => assert.match(adminActions, /getChannelUnitPrice/));
test("I3 reconciliation helper is explicitly read-only", () => assert.match(reconciliation, /Read-only proof helper/));
test("I4 reconciliation separates direct debit and ledger totals", () => assert.match(reconciliation, /direct_debit_minus_ledger/));
test("I5 no reconciliation mutation is present", () => assert.doesNotMatch(reconciliation, /\b(?:UPDATE|INSERT|DELETE)\b/i));
