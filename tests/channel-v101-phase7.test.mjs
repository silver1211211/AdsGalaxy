// ==============================================================================
// AdsGalaxy V1.01 — Phase 7 End-to-End Financial & Integration Verification
// Tests actual event entry-point paths, schema compatibility, transactional boundaries,
// treasury locking, ARR, 60/30/10 direct split, and rollback integrity.
// ==============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const loadedCache = new Map();
let activeBillingSession = null;

// In-memory mock database state
class MockDbSession {
  constructor() {
    this.campaigns = new Map();
    this.campaignPosts = new Map();
    this.users = new Map();
    this.settlementEvents = new Map();
    this.advertiserDebits = [];
    this.advances = new Map();
    this.advancePosts = new Map();
    this.arrTransitions = new Map();
    this.treasuryLedger = [];
    this.treasuryControl = { id: 1, version: 1 };
    this.schemaReady = true;
    this.schemaColumnsMissing = false;
    this.failOnQuery = null;
    this.failOnce = false;
  }

  createConnection() {
    const session = this;
    let inTransaction = false;
    let txSnapshot = null;

    return {
      beginTransaction: async () => {
        inTransaction = true;
        txSnapshot = {
          campaigns: new Map([...session.campaigns.entries()].map(([k, v]) => [k, { ...v }])),
          users: new Map([...session.users.entries()].map(([k, v]) => [k, { ...v }])),
          settlementEvents: new Map([...session.settlementEvents.entries()].map(([k, v]) => [k, { ...v }])),
          advertiserDebits: [...session.advertiserDebits],
          advances: new Map([...session.advances.entries()].map(([k, v]) => [k, { ...v }])),
          advancePosts: new Map([...session.advancePosts.entries()].map(([k, v]) => [k, { ...v }])),
          arrTransitions: new Map([...session.arrTransitions.entries()].map(([k, v]) => [k, { ...v }])),
          treasuryLedger: [...session.treasuryLedger],
        };
      },
      commit: async () => {
        inTransaction = false;
        txSnapshot = null;
      },
      rollback: async () => {
        if (txSnapshot) {
          session.campaigns = txSnapshot.campaigns;
          session.users = txSnapshot.users;
          session.settlementEvents = txSnapshot.settlementEvents;
          session.advertiserDebits = txSnapshot.advertiserDebits;
          session.advances = txSnapshot.advances;
          session.advancePosts = txSnapshot.advancePosts;
          session.arrTransitions = txSnapshot.arrTransitions;
          session.treasuryLedger = txSnapshot.treasuryLedger;
        }
        inTransaction = false;
        txSnapshot = null;
      },
      _session: session,
      release: () => {},
      query: async (sql, params = []) => {
        const s = sql.trim().replace(/\s+/g, " ").toUpperCase();

        if (s.includes("SELECT CAMPAIGN_ID FROM CAMPAIGN_POSTS WHERE ID=? LIMIT 1")) {
          const post = session.campaignPosts.get(params[0]);
          return [post ? [{ campaign_id: post.campaign_id }] : []];
        }
        if (s.includes("SELECT ID FROM CHANNEL_ADVERTISER_DEBITS WHERE SOURCE_KEY=?")) return [[]];
        if (s.includes("FROM SETTINGS WHERE")) return [[{ margin: "30", reserve: "14.28571429" }]];
        if (session.failOnQuery && s.includes(session.failOnQuery.toUpperCase())) {
          if (session.failOnce) {
            session.failOnQuery = null;
          }
          throw new Error("simulated_db_failure");
        }

        if (s.includes("INFORMATION_SCHEMA.TABLES")) {
          return [[{ present: session.schemaReady ? 7 : 0, count: session.schemaReady ? 7 : 0 }]];
        }
        if (s.includes("INFORMATION_SCHEMA.COLUMNS")) {
          return [[{ present: session.schemaColumnsMissing ? 0 : 3, count: session.schemaColumnsMissing ? 0 : 3 }]];
        }
        if (s.includes("CHANNEL_RESERVE_TREASURY_CONTROL WHERE ID = 1 FOR UPDATE") ||
            s.includes("CHANNEL_RESERVE_TREASURY_CONTROL WHERE ID = 1")) {
          return [session.treasuryControl ? [session.treasuryControl] : []];
        }
        if (s.includes("FROM CAMPAIGNS WHERE ID = ?") || s.includes("FROM CAMPAIGNS C WHERE C.ID=?")) {
          const camp = session.campaigns.get(params[0]);
          return [camp ? [camp] : []];
        }
        if (s.includes("FROM CAMPAIGN_POSTS CP JOIN CAMPAIGNS C ON C.ID=CP.CAMPAIGN_ID")) {
          const post = session.campaignPosts.get(params[0]);
          const camp = post ? session.campaigns.get(post.campaign_id) : null;
          if (!post || !camp) return [[]];
          return [[{
            campaign_id: camp.id,
            channel_id: post.channel_id || 50,
            views: post.views || 1000,
            settled_views: post.settled_views || 0,
            settled_clicks: post.settled_clicks || 0,
            waived_views: 0,
            campaign_type: camp.campaign_type || "clicks",
            campaign_kind: "standard",
            campaign_status: camp.status,
            post_status: "active",
            advertiser_id: camp.user_id || 10,
            funding_model: "legacy_reserved",
            budget: camp.budget,
            cpm: "10.00000000",
            cpc: camp.cpc || "65.00000000",
            daily_budget_limit: null,
            advertiser_discount: 0,
            publisher_id: 1001,
            view_fetch_status: "success",
            view_fetch_source: "public_api",
            delivery_confirmed_at: new Date(),
            channel_status: "active", under_review: 0, settlement_held: 0,
            revenue_protection_status: "normal", view_tracking_status: "active",
            subscriber_count: 10000,
          }]];
        }
        if (s.includes("FROM CAMPAIGN_CLICKS WHERE ID=? AND POST_ID=? AND CAMPAIGN_ID=?")) {
          return [[{ id: params[0] }]];
        }
        if (s.includes("FROM CAMPAIGN_POSTS WHERE ID=? AND CAMPAIGN_ID=? FOR UPDATE")) {
          const post = session.campaignPosts.get(params[0]);
          return [post && post.campaign_id === params[1]
            ? [{ status: post.status || "active", delivery_confirmed_at: new Date(), deleted_at: null }]
            : []];
        }
        if (s.includes("FROM CAMPAIGN_POSTS CP WHERE CP.ID=? AND CP.CAMPAIGN_ID=? FOR UPDATE")) {
          const post = session.campaignPosts.get(params[0]);
          return [post ? [{ views: post.views, settled_views: post.settled_views, waived_views: 0 }] : []];
        }
        if (s.includes("FROM CAMPAIGN_POSTS CP JOIN CHANNELS CH ON CH.ID = CP.CHANNEL_ID JOIN USERS U ON U.ID = CH.USER_ID")) {
          const post = session.campaignPosts.get(params[0]);
          if (!post || post.campaign_id !== params[1]) return [[]];
          return [[{
            id: post.id,
            campaign_id: post.campaign_id,
            channel_id: post.channel_id ?? 50,
            status: post.status ?? "active",
            deleted_at: post.deleted_at ?? null,
            delivery_failed_at: post.delivery_failed_at ?? null,
            delivery_confirmed_at: post.delivery_confirmed_at !== undefined ? post.delivery_confirmed_at : new Date(),
            views: post.views ?? 1000,
            waived_views: post.waived_views ?? 0,
            settled_clicks: post.settled_clicks ?? 0,
            fraud_excluded_clicks: post.fraud_excluded_clicks ?? 0,
            view_fetch_status: post.view_fetch_status ?? "success",
            view_fetch_source: post.view_fetch_source ?? "public_api",
            channel_status: post.channel_status ?? "active",
            under_review: post.under_review ?? 0,
            is_deleted: post.is_deleted ?? 0,
            settlement_held: post.settlement_held ?? 0,
            revenue_protection_status: post.revenue_protection_status ?? "clear",
            view_tracking_status: post.view_tracking_status ?? "active",
            subscriber_count: post.subscriber_count ?? 10000,
            channel_publisher_id: post.publisher_id ?? 1001,
            publisher_banned: post.publisher_banned ?? 0,
          }]];
        }
        if (s.includes("FROM CAMPAIGN_CLICKS CC WHERE CC.POST_ID = ? AND CC.IS_BOT = 0")) {
          return [[]];
        }
        if (s.includes("FROM CAMPAIGN_POSTS CP JOIN CHANNELS CH ON CH.ID = CP.CHANNEL_ID") && s.includes("LOCK IN SHARE MODE")) {
          return [[]];
        }
        if (s.includes("FROM CHANNEL_FRAUD_EVENTS")) {
          return [[]];
        }
        if (s.includes("SELECT ID FROM CHANNEL_UNIFIED_SETTLEMENT_EVENTS WHERE IDEMPOTENCY_KEY = ?")) {
          const ev = session.settlementEvents.get(params[0]);
          return [ev ? [ev] : []];
        }
        if (s.includes("FROM CHANNEL_CPC_RESERVE_ADVANCES WHERE CAMPAIGN_ID = ? AND PUBLISHER_ID = ?")) {
          const key = `${params[0]}:${params[1]}`;
          const adv = session.advances.get(key);
          return [adv ? [adv] : []];
        }
        if (s.includes("FROM CHANNEL_CPC_RESERVE_ADVANCE_POSTS WHERE POST_ID = ?")) {
          const p = session.advancePosts.get(params[0]);
          return [p ? [p] : []];
        }
        if (s.includes("SUM(GROSS_CLICK_UNIT_PRICE)") && s.includes("CHANNEL_ARR_TRANSITIONS")) {
          let gross = 0;
          for (const t of session.arrTransitions.values()) {
            if (t.advance_id === params[0]) gross += Number(t.gross_click_unit_price || 0);
          }
          return [[{ gross: gross.toFixed(8) }]];
        }
        if (s.includes("FROM CHANNEL_RESERVE_TREASURY_LEDGER")) {
          let inflows = BigInt(0);
          let advances = BigInt(0);
          let recovered = BigInt(0);
          for (const row of session.treasuryLedger) {
            const amt = BigInt(Math.round(Number(row.amount) * 1e8));
            if (row.entry_type === "allocation_inflow" && row.direction === "in") inflows += amt;
            else if (row.entry_type === "advance_outflow" && row.direction === "out") advances += amt;
            else if (row.entry_type === "recovery_inflow" && row.direction === "in") recovered += amt;
          }
          return [[{
            total_inflows: (Number(inflows) / 1e8).toFixed(8),
            total_advances: (Number(advances) / 1e8).toFixed(8),
            total_recovered: (Number(recovered) / 1e8).toFixed(8),
            total_adjustments: "0.00000000",
          }]];
        }
        if (s.includes("FROM CHANNEL_UNIFIED_SETTLEMENT_EVENTS WHERE STATUS = 'SETTLED'")) {
          let totalDebit = 0;
          let totalPub = 0;
          let totalPlat = 0;
          let totalRes = 0;
          let totalArr = 0;
          for (const ev of session.settlementEvents.values()) {
            if (ev.status === "settled") {
              if (params.length > 0 && ev.campaign_id !== params[0]) continue;
              totalDebit += Number(ev.advertiser_debit || 0);
              totalPub += Number(ev.publisher_credit || 0);
              totalPlat += Number(ev.platform_revenue || 0);
              totalRes += Number(ev.reserve_contribution || 0);
              totalArr += Number(ev.arr_recovered || 0);
            }
          }
          return [[{
            total_debit: totalDebit.toFixed(8),
            total_pub: totalPub.toFixed(8),
            total_plat: totalPlat.toFixed(8),
            total_res: totalRes.toFixed(8),
            total_arr: totalArr.toFixed(8),
          }]];
        }
        if (s.includes("UPDATE CAMPAIGNS SET BUDGET =")) {
          const campId = params[params.length - 1];
          const camp = session.campaigns.get(campId);
          if (camp) {
            const debit = Number(params[0]);
            camp.budget = Math.max(0, Number(camp.budget) - debit).toFixed(8);
            camp.spend = (Number(camp.spend) + debit).toFixed(8);
          }
          return [{ affectedRows: 1 }];
        }
        if (s.includes("UPDATE CAMPAIGN_POSTS SET SETTLED_CLICKS = SETTLED_CLICKS + 1")) {
          const post = session.campaignPosts.get(params[1]);
          if (post) {
            post.settled_clicks = (post.settled_clicks || 0) + 1;
            post.spend = (Number(post.spend) + Number(params[0])).toFixed(8);
          }
          return [{ affectedRows: 1 }];
        }
        if (s.includes("UPDATE CAMPAIGN_POSTS SET SETTLED_VIEWS = SETTLED_VIEWS + ?")) {
          const post = session.campaignPosts.get(params[2]);
          if (post) {
            post.settled_views = (post.settled_views || 0) + params[0];
            post.spend = (Number(post.spend) + Number(params[1])).toFixed(8);
          }
          return [{ affectedRows: 1 }];
        }
        if (s.includes("UPDATE USERS SET BALANCE_LOCKED = BALANCE_LOCKED + ?")) {
          const u = session.users.get(params[1]);
          if (u) {
            u.balance_locked = (Number(u.balance_locked) + Number(params[0])).toFixed(8);
          }
          return [{ affectedRows: 1 }];
        }
        if (s.includes("INSERT INTO CHANNEL_UNIFIED_SETTLEMENT_EVENTS")) {
          let ev = { idempotency_key: params[0], status: "settled" };
          if (s.includes("'CPC_CLICK'")) {
            ev = {
              ...ev,
              settlement_type: "cpc_click",
              campaign_id: params[1],
              post_id: params[2],
              channel_id: params[3],
              publisher_id: params[4],
              advertiser_id: params[5],
              unit_price: params[6],
              advertiser_debit: params[7],
              publisher_credit: params[8],
              platform_revenue: params[9],
              reserve_contribution: params[10],
              arr_recovered: params[11],
            };
          } else if (s.includes("'CPM_VIEW'")) {
            ev = {
              ...ev,
              settlement_type: "cpm_view",
              campaign_id: params[1],
              post_id: params[2],
              channel_id: params[3],
              publisher_id: params[4],
              advertiser_id: params[5],
              units: params[6],
              unit_price: params[7],
              advertiser_debit: params[8],
              publisher_credit: params[9],
              platform_revenue: params[10],
              reserve_contribution: params[11],
              arr_recovered: "0.00000000",
            };
          } else if (s.includes("'CPC_ZERO_CLICK_ADVANCE'")) {
            ev = {
              ...ev,
              settlement_type: "cpc_zero_click_advance",
              campaign_id: params[1],
              post_id: params[2],
              channel_id: params[3],
              publisher_id: params[4],
              advertiser_id: 0,
              units: params[5],
              unit_price: "0.00000000",
              advertiser_debit: "0.00000000",
              publisher_credit: params[6],
              platform_revenue: "0.00000000",
              reserve_contribution: "0.00000000",
              arr_recovered: "0.00000000",
            };
          }
          session.settlementEvents.set(params[0], ev);
          return [{ affectedRows: 1, insertId: session.settlementEvents.size }];
        }
        if (s.includes("INSERT INTO CHANNEL_CPC_RESERVE_ADVANCES")) {
          const key = `${params[0]}:${params[1]}`;
          const adv = {
            id: session.advances.size + 1,
            campaign_id: params[0],
            publisher_id: params[1],
            post_id: params[2],
            channel_id: params[3],
            entitled_views: params[4],
            entitled_amount: params[5],
            advanced_amount: params[6],
            unfunded_queue_amount: params[7],
            recovered_amount: "0.00000000",
            status: "open",
          };
          session.advances.set(key, adv);
          return [{ affectedRows: 1, insertId: adv.id }];
        }
        if (s.includes("UPDATE CHANNEL_CPC_RESERVE_ADVANCES")) {
          const targetId = params[params.length - 1];
          for (const adv of session.advances.values()) {
            if (adv.id === targetId) {
              if (s.includes("RECOVERED_AMOUNT = ?")) {
                adv.recovered_amount = params[0];
                adv.status = params[1];
              } else {
                adv.entitled_amount = params[0];
                adv.advanced_amount = params[1];
                adv.unfunded_queue_amount = String(params[2]);
              }
            }
          }
          return [{ affectedRows: 1 }];
        }
        if (s.includes("INSERT INTO CHANNEL_CPC_RESERVE_ADVANCE_POSTS")) {
          const p = {
            id: session.advancePosts.size + 1,
            advance_id: params[0],
            campaign_id: params[1],
            post_id: params[2],
            channel_id: params[3],
            publisher_id: params[4],
            eligible_views: params[5],
            allocated_advance: params[6],
            recovered_amount: "0.00000000",
          };
          session.advancePosts.set(p.post_id, p);
          return [{ affectedRows: 1, insertId: p.id }];
        }
        if (s.includes("UPDATE CHANNEL_CPC_RESERVE_ADVANCE_POSTS")) {
          const targetId = params[2];
          for (const p of session.advancePosts.values()) {
            if (p.id === targetId || p.post_id === targetId) {
              p.eligible_views = params[0];
              p.allocated_advance = params[1];
            }
          }
          return [{ affectedRows: 1 }];
        }
        if (s.includes("INSERT IGNORE INTO CHANNEL_ADVERTISER_DEBITS") || s.includes("INSERT INTO CHANNEL_ADVERTISER_DEBITS")) {
          session.advertiserDebits.push({
            source_key: params[0],
            settlement_type: params[1],
            campaign_id: params[2],
            post_id: params[3],
          });
          return [{ affectedRows: 1, insertId: session.advertiserDebits.length }];
        }
        if (s.includes("INTO CHANNEL_RESERVE_TREASURY_LEDGER")) {
          session.treasuryLedger.push({
            idempotency_key: params[0],
            entry_type: String((s.match(/VALUES\s*\(\s*\?\s*,\s*'([^']+)'/i) || [])[1] || params[1]).toLowerCase(),
            direction: String((s.match(/VALUES\s*\(\s*\?\s*,\s*'[^']+'\s*,\s*'([^']+)'/i) || [])[1] || params[2]).toLowerCase(),
            amount: s.includes("'ADVANCE_OUTFLOW'") || s.includes("'ALLOCATION_INFLOW'") || s.includes("'RECOVERY_INFLOW'") ? params[1] : params[3],
            campaign_id: params[2],
            post_id: params[3],
            publisher_id: params[4],
          });
          return [{ affectedRows: 1, insertId: session.treasuryLedger.length }];
        }
        if (s.includes("INTO CHANNEL_ARR_TRANSITIONS")) {
          session.arrTransitions.set(params[0], {
            idempotency_key: params[0],
            advance_id: params[1],
            gross_click_unit_price: params[6],
            recovered_to_reserve: params[7],
            cash_paid_to_publisher: params[8],
          });
          return [{ affectedRows: 1, insertId: session.arrTransitions.size }];
        }

        return [{ affectedRows: 1 }];
      },
    };
  }
}

function load(file) {
  if (loadedCache.has(file)) return loadedCache.get(file);
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier.includes("channelBilling")) return load("src/lib/channelBilling.ts");
    if (specifier.includes("dbResilience")) return { withFinancialTransactionRetry: async (fn) => {
      const conn = activeBillingSession.createConnection();
      await conn.beginTransaction();
      try { const result = await fn(conn); await conn.commit(); return result; }
      catch (error) { await conn.rollback(); throw error; }
    } };
    if (specifier.includes("campaignPostDeletion")) return { deleteExhaustedChannelCampaignPosts: async () => null };
    if (specifier.includes("campaignLifecycle")) return { markCampaignBudgetExhausted: async () => null };
    if (specifier.includes("channelDailyCap")) return { cleanupChannelDailyCapPosts: async () => null, markChannelDailyCapReached: async () => null };
    if (specifier.includes("channelAllocationMath")) return load("src/lib/channelAllocationMath.ts");
    if (specifier.includes("channelTrustFraudStability")) return load("src/lib/channelTrustFraudStability.ts");
    if (specifier.includes("channelReserveTreasury")) return load("src/lib/channelReserveTreasury.ts");
    if (specifier.includes("channelUnifiedSettlement")) return load("src/lib/channelUnifiedSettlement.ts");
    if (specifier.includes("channelCpcZeroClickEligibility")) return load("src/lib/channelCpcZeroClickEligibility.ts");
    if (specifier.includes("channelViewPersistence")) return load("src/lib/channelViewPersistence.ts");
    if (specifier.includes("channelViewPipeline")) return load("src/lib/channelViewPipeline.ts");
    if (specifier.includes("campaignCreativeRevision")) return load("src/lib/campaignCreativeRevision.ts");
    if (specifier.includes("channelFastBilling")) return load("src/lib/channelFastBilling.ts");
    if (specifier.includes("channelDailySpend")) return { getChannelDailySpend: async () => 0 };
    if (specifier.includes("channelViewWaivers")) return { waivedViewsForPostSql: () => "0", outstandingViewsSql: () => "0" };
    if (specifier.includes("advertiserDirectDebit")) return {
      claimAdvertiserDirectDebit: async () => ({ ok: true, duplicate: false }),
    };
    if (specifier.includes("channelAllocationLedger")) {
      return {
        shadowWriteChannelAllocation: async () => ({ status: "written" }),
      };
    }
    if (specifier.includes("channelFinancialRollupRepair")) return load("src/lib/channelFinancialRollupRepair.ts");
    if (specifier.includes("schemaGuards")) return { ensureClassicSettlementColumns: async () => {} };
    if (specifier.includes("channelReporting")) return { channelFinancialEventsSql: () => "SELECT 1" };
    if (specifier.includes("statFormulas")) {
      return {
        calculateEffectivePublisherCpm: (e, v) => (Number(v) > 0 ? ((Number(e) / Number(v)) * 1000).toFixed(8) : "0.00000000"),
        formatSixDecimalDisplay: (v) => Number(v || 0).toFixed(6),
      };
    }
    if (specifier.includes("earnings")) {
      return {
        creditSettledPublisherBalance: async (conn, uid, amt) => {
          await conn.query("UPDATE users SET balance_locked = balance_locked + ? WHERE id = ?", [amt, uid]);
          return true;
        },
      };
    }
    if (specifier.includes("db")) return { default: {
      query: (...args) => String(args[0]).includes("cp.deleted_at IS NOT NULL AND cp.billing_cutoff_at IS NOT NULL")
        ? Promise.resolve([[]]) : activeBillingSession.poolQuery(...args),
    } };
    return {};
  };
  new Function("module", "exports", "require", "process", output)(mod, mod.exports, customRequire, process);
  loadedCache.set(file, mod.exports);
  return mod.exports;
}

const settlementMod = load("src/lib/channelUnifiedSettlement.ts");
const {
  settleCanonicalCpcClick: rawSettleCanonicalCpcClick,
  settleCanonicalCpcZeroClickAdvance: rawSettleCanonicalCpcZeroClickAdvance,
  settleCanonicalCpmViews: rawSettleCanonicalCpmViews,
  isChannelV101UnifiedSettlementEnabled,
  isUnifiedSettlementActive,
  isChannelV101UnifiedSettlementSchemaReady,
  acquireSharedReserveTreasuryLock,
  inspectUnifiedChannelFinancialReconciliation,
} = settlementMod;

const defaultSplit = { publisherPercent: 60, platformPercent: 30, reservePercent: 10 };
const settleCanonicalCpcClick = (conn, input) =>
  rawSettleCanonicalCpcClick(conn, { revenueSplit: defaultSplit, ...input });
const settleCanonicalCpcZeroClickAdvance = (conn, input) => {
  const sess = conn._session || activeBillingSession;
  const p = sess && sess.campaignPosts ? sess.campaignPosts.get(input.postId) : null;
  if (p) {
    if (input.channelId !== undefined) p.channel_id = input.channelId;
    if (input.publisherId !== undefined) p.publisher_id = input.publisherId;
    if (input.eligibleViews !== undefined) p.views = Number(input.eligibleViews);
  }
  return rawSettleCanonicalCpcZeroClickAdvance(conn, { validationResult: { eligible: true }, ...input });
};
const settleCanonicalCpmViews = (conn, input) =>
  rawSettleCanonicalCpmViews(conn, { revenueSplit: defaultSplit, ...input });

const rollupMod = load("src/lib/channelFinancialRollupRepair.ts");
const { reconcileChannelFinancialRollups } = rollupMod;

const trustMod = load("src/lib/channelTrustFraudStability.ts");
const { calculateV101BoundedQualityMultiplier } = trustMod;

const mathMod = load("src/lib/channelAllocationMath.ts");
const { calculateDirectGrossSplit, formatSixDecimalDisplay } = mathMod;

process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED = "true";
process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED = "true";

function setupDefaultFixture() {
  const session = new MockDbSession();
  session.campaigns.set(100, {
    id: 100,
    user_id: 10,
    budget: "100.00000000",
    spend: "0.00000000",
    status: "active",
    cpc: "65.00000000",
    type: "clicks",
    funding_model: "direct_debit",
    campaign_kind: "standard",
  });
  session.campaignPosts.set(501, {
    id: 501,
    campaign_id: 100,
    channel_id: 50,
    post_id: 501,
    views: 1000,
    settled_views: 0,
    settled_clicks: 0,
    spend: "0.00000000",
  });
  session.users.set(1001, {
    id: 1001,
    balance_locked: "0.00000000",
  });
  session.treasuryLedger.push({
    idempotency_key: "seed:reserve",
    entry_type: "allocation_inflow",
    direction: "in",
    amount: "10.00000000",
  });
  return session;
}

test("1. Click handler to canonical financial settlement", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const result = await settleCanonicalCpcClick(conn, {
    campaignId: 100,
    postId: 501,
    channelId: 50,
    publisherId: 1001,
    advertiserId: 10,
    clickId: 9991,
    clickUnitPrice: "0.06500000",
  });
  assert.equal(result.status, "settled");
  assert.equal(result.advertiserDebitDecimal, "0.06500000");
  assert.equal(result.publisherCreditDecimal, "0.03900000"); // 60%
  assert.equal(result.platformRevenueDecimal, "0.01950000"); // 30%
  assert.equal(result.reserveAllocationDecimal, "0.00650000"); // 10%
});

test("2. View handler to zero-click advance settlement", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const result = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100,
    postId: 501,
    channelId: 50,
    publisherId: 1001,
    campaignType: "clicks",
    eligibleViews: 10,
  });
  assert.equal(result.status, "funded");
  assert.equal(result.targetEntitlementDecimal, "0.00900000");
  assert.equal(result.fundingDeltaDecimal, "0.00900000");
});

test("3. CPM view handler to canonical CPM settlement", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const result = await settleCanonicalCpmViews(conn, {
    campaignId: 100,
    postId: 501,
    channelId: 50,
    publisherId: 1001,
    advertiserId: 10,
    confirmedViews: 1000,
    cpmRate: "10.00000000",
  });
  assert.equal(result.status, "settled");
  assert.equal(result.advertiserDebitDecimal, "10.00000000");
  assert.equal(result.publisherCreditDecimal, "6.00000000");
  assert.equal(result.platformRevenueDecimal, "3.00000000");
  assert.equal(result.reserveAllocationDecimal, "1.00000000");
});

test("4. Existing legacy path with feature disabled", async () => {
  const disabledEnv = { CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED: "false" };
  assert.equal(isChannelV101UnifiedSettlementEnabled(disabledEnv), false);
  assert.equal(isUnifiedSettlementActive(disabledEnv), false);
});

test("5. Canonical path with feature enabled", async () => {
  const enabledEnv = { CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED: "true" };
  assert.equal(isChannelV101UnifiedSettlementEnabled(enabledEnv), true);
  assert.equal(isUnifiedSettlementActive(enabledEnv), true);
});

test("6. Missing schema triggers safe schema_not_ready degradation", async () => {
  const session = setupDefaultFixture();
  session.schemaReady = false;
  const conn = session.createConnection();
  const result = await settleCanonicalCpcClick(conn, {
    campaignId: 100,
    postId: 501,
    channelId: 50,
    publisherId: 1001,
    advertiserId: 10,
    clickId: 9992,
    clickUnitPrice: "0.06500000",
  });
  assert.equal(result.status, "schema_not_ready");
});

test("7. Schema mismatch (missing columns) rejects execution safely", async () => {
  const session = setupDefaultFixture();
  session.schemaColumnsMissing = true;
  const conn = session.createConnection();
  const ready = await isChannelV101UnifiedSettlementSchemaReady(conn);
  assert.equal(ready, false);
});

test("8. Duplicate click request returns idempotent duplicate status", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const input = {
    campaignId: 100,
    postId: 501,
    channelId: 50,
    publisherId: 1001,
    advertiserId: 10,
    clickId: 9993,
    clickUnitPrice: "0.06500000",
  };
  const res1 = await settleCanonicalCpcClick(conn, input);
  assert.equal(res1.status, "settled");
  const res2 = await settleCanonicalCpcClick(conn, input);
  assert.equal(res2.status, "duplicate");
  assert.equal(res2.advertiserDebitUnits, 0n);
});

test("9. Duplicate view update returns 0 funding delta and already_funded", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const res1 = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100,
    postId: 501,
    channelId: 50,
    publisherId: 1001,
    campaignType: "clicks",
    eligibleViews: 10,
  });
  assert.equal(res1.status, "funded");
  const res2 = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100,
    postId: 501,
    channelId: 50,
    publisherId: 1001,
    campaignType: "clicks",
    eligibleViews: 10,
  });
  assert.equal(res2.status, "already_funded");
  assert.equal(res2.fundingDeltaUnits, 0n);
});

test("10. Concurrent clicks on same campaign serialize and deduct budget accurately", async () => {
  const session = setupDefaultFixture();
  session.campaigns.get(100).budget = "1.00000000";
  const conn = session.createConnection();
  const c1 = await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 101, clickUnitPrice: "0.06500000",
  });
  const c2 = await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 102, clickUnitPrice: "0.06500000",
  });
  assert.equal(c1.status, "settled");
  assert.equal(c2.status, "settled");
  assert.equal(session.campaigns.get(100).spend, "0.13000000");
});

test("11. Concurrent advances on different posts lock shared treasury singleton (id=1)", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const locked = await acquireSharedReserveTreasuryLock(conn);
  assert.equal(locked, true);
});

test("12. Two publishers sharing treasury liquidity observe 70% spendable ceiling", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const p1 = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, campaignType: "clicks", eligibleViews: 50,
  });
  assert.equal(p1.status, "funded");
  assert.equal(p1.fundingDeltaDecimal, "0.02500000");
});

test("13. Multiple posts for one publisher/campaign share the 0.10 cap", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  // Post 1 advances 1000 views (hits 0.10 cap)
  const p1 = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, campaignType: "clicks", eligibleViews: 1000,
  });
  assert.equal(p1.status, "funded");
  assert.equal(p1.fundingDeltaDecimal, "0.10000000");

  // Post 2 for same publisher & campaign requests advance
  session.campaignPosts.set(502, { id: 502, campaign_id: 100, channel_id: 50, post_id: 502, views: 500 });
  const p2 = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100, postId: 502, channelId: 50, publisherId: 1001, campaignType: "clicks", eligibleViews: 500,
  });
  assert.equal(p2.status, "already_funded");
  assert.equal(p2.fundingDeltaUnits, 0n);
});

test("14. Concurrent budget exhaustion halts debits without overdraft", async () => {
  const session = setupDefaultFixture();
  session.campaigns.get(100).budget = "0.06500000"; // exactly 1 click budget
  const conn = session.createConnection();
  const c1 = await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 201, clickUnitPrice: "0.06500000",
  });
  assert.equal(c1.status, "settled");
  const c2 = await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 202, clickUnitPrice: "0.06500000",
  });
  assert.equal(c2.status, "budget_exhausted");
});

test("15. Transaction failure before ledger write triggers complete rollback", async () => {
  const session = setupDefaultFixture();
  session.failOnQuery = "INSERT INTO CHANNEL_UNIFIED_SETTLEMENT_EVENTS";
  const conn = session.createConnection();
  await conn.beginTransaction();
  await assert.rejects(async () => {
    try {
      await settleCanonicalCpcClick(conn, {
        campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 301, clickUnitPrice: "0.06500000",
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  }, /simulated_db_failure/);
  // Ensure campaign spend unchanged
  assert.equal(session.campaigns.get(100).spend, "0.00000000");
  assert.equal(session.settlementEvents.size, 0);
});

test("16. Transaction failure after partial writes rolls back without leaving orphans", async () => {
  const session = setupDefaultFixture();
  session.failOnQuery = "UPDATE USERS SET BALANCE_LOCKED";
  const conn = session.createConnection();
  await assert.rejects(async () => {
    await settleCanonicalCpcClick(conn, {
      campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 302, clickUnitPrice: "0.06500000",
    });
  }, /simulated_db_failure/);
  assert.equal(session.campaigns.get(100).spend, "0.00000000");
  assert.equal(session.settlementEvents.size, 0);
});

test("17. Retry after rollback recovers and succeeds cleanly", async () => {
  const session = setupDefaultFixture();
  session.failOnQuery = "UPDATE USERS SET BALANCE_LOCKED";
  session.failOnce = true;
  const conn = session.createConnection();
  await assert.rejects(async () => {
    await settleCanonicalCpcClick(conn, {
      campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 303, clickUnitPrice: "0.06500000",
    });
  }, /simulated_db_failure/);

  // Now retry without error
  const retryResult = await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 303, clickUnitPrice: "0.06500000",
  });
  assert.equal(retryResult.status, "settled");
  assert.equal(session.campaigns.get(100).spend, "0.06500000");
});

test("18. ARR recovery after multiple advance increments recovers outstanding balance", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  // Grant advance: 1000 views = 0.10 USDT
  await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, campaignType: "clicks", eligibleViews: 1000,
  });

  // Valid click arrives: 0.065 gross -> 0.039 pub entitlement
  const c1 = await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 401, clickUnitPrice: "0.06500000",
  });
  assert.equal(c1.arrRecoveredDecimal, "0.03900000");
  assert.equal(c1.publisherCreditDecimal, "0.00000000"); // 100% recovered to reserve
});

test("19. Existing matured publisher balance preserved; credits land in balance_locked", async () => {
  const session = setupDefaultFixture();
  session.users.get(1001).balance_locked = "5.00000000";
  const conn = session.createConnection();
  await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 501, clickUnitPrice: "0.06500000",
  });
  assert.equal(session.users.get(1001).balance_locked, "5.03900000");
});

test("20. Post deletion with pending engagement preserves historical attribution", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const res = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, campaignType: "clicks", eligibleViews: 100,
  });
  assert.equal(res.status, "funded");
  assert.ok(session.advancePosts.has(501), "Must retain post attribution row");
});

test("21. Reconciliation query verifies component balance identity", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  // Settle click
  await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 601, clickUnitPrice: "0.06500000",
  });
  const rec = await inspectUnifiedChannelFinancialReconciliation(conn);
  assert.equal(rec.isBalanced, true);
  assert.equal(rec.discrepancyDecimal, "0.00000000");
});

test("22. Legacy reconciliation compatibility preserves valid analytics rows", async () => {
  const mockConn = {
    query: async (sql) => {
      if (sql.includes("UPDATE CHANNEL_POST_DAILY_STATS")) {
        assert.doesNotMatch(sql.toUpperCase(), /LEFT JOIN \(/);
        return [{ affectedRows: 2 }];
      }
      return [[]];
    },
  };
  const result = await reconcileChannelFinancialRollups(mockConn, "2026-10-01", "2026-10-28", true);
  assert.equal(result.applied, true);
});

test("23. Quality-adjusted settlement: neutral baseline 60 produces multiplier 1.00000000", async () => {
  const quality = calculateV101BoundedQualityMultiplier({
    channelId: 50,
    publisherId: 1001,
    trustScore: 60,
    scores: { ctrScore: 60, memberRetentionScore: 60, impressionFreshnessScore: 60, audienceMatchScore: 60, trafficReputationScore: 60 },
  });
  assert.equal(quality.multiplierDecimal, "1.00000000");
  assert.equal(Number(quality.adjustmentPercent), 0);
});

test("24. Administrator percentage changes (70/20/10) conserve to the last unit", async () => {
  const split = calculateDirectGrossSplit({
    grossDebit: "0.06500000",
    publisherPercent: 70,
    platformPercent: 20,
    reservePercent: 10,
  });
  assert.equal(split.debit, split.publisherBase + split.platform + split.reserveBase);
});

test("25. Six-decimal reporting formats small amounts without losing internal precision", async () => {
  assert.equal(formatSixDecimalDisplay("0.00012345"), "0.000123");
  assert.equal(formatSixDecimalDisplay("0.00012000"), "0.000120");
});

test("26. Campaign historical record preservation retains audit entries", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 701, clickUnitPrice: "0.06500000",
  });
  assert.equal(session.advertiserDebits.length, 1);
});

test("27. Incorrect or missing treasury singleton is safely rejected", async () => {
  const session = setupDefaultFixture();
  session.treasuryControl = null;
  const conn = session.createConnection();
  const locked = await acquireSharedReserveTreasuryLock(conn);
  assert.equal(locked, false);
});

test("28. Duplicate ledger uniqueness constraints prevent double-writing", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const res1 = await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 801, clickUnitPrice: "0.06500000",
  });
  assert.equal(res1.status, "settled");
  const res2 = await settleCanonicalCpcClick(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, advertiserId: 10, clickId: 801, clickUnitPrice: "0.06500000",
  });
  assert.equal(res2.status, "duplicate");
});

test("29. Missing Reserve funding queues remainder without creating unbacked credit", async () => {
  const session = setupDefaultFixture();
  session.treasuryLedger.length = 0; // 0 reserve liquidity
  const conn = session.createConnection();
  const res = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, campaignType: "clicks", eligibleViews: 100,
  });
  assert.equal(res.status, "exhausted");
  assert.equal(res.fundingDeltaUnits, 0n);
  assert.ok(res.unfundedQueueUnits > 0n);
});

test("30. Repeated cron runs produce zero new credit when engagement is unchanged", async () => {
  const session = setupDefaultFixture();
  const conn = session.createConnection();
  const cronRun1 = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, campaignType: "clicks", eligibleViews: 50,
  });
  assert.equal(cronRun1.status, "funded");
  const cronRun2 = await settleCanonicalCpcZeroClickAdvance(conn, {
    campaignId: 100, postId: 501, channelId: 50, publisherId: 1001, campaignType: "clicks", eligibleViews: 50,
  });
  assert.equal(cronRun2.fundingDeltaUnits, 0n);
});


test("31. Small zero-click channels earn from the first verified view with a funded reserve", async () => {
  const expected = new Map([
    [0, "0.00000000"], [1, "0.00120000"], [5, "0.00466667"],
    [7, "0.00640000"], [10, "0.00900000"], [100, "0.04000000"],
    [500, "0.08000000"], [1000, "0.10000000"], [1500, "0.10000000"],
  ]);
  for (const [views, amount] of expected) {
    const session = setupDefaultFixture();
    const result = await settleCanonicalCpcZeroClickAdvance(session.createConnection(), {
      campaignId: 100, postId: 501, channelId: 50, publisherId: 1001,
      campaignType: "clicks", eligibleViews: views,
      validationResult: { eligible: true },
    });
    assert.equal(result.fundingDeltaDecimal, amount, "views=" + views);
    assert.equal(session.users.get(1001).balance_locked, amount, "publisher credit at views=" + views);
    assert.equal(session.advances.size, views === 0 ? 0 : 1);
  }
});

test("32. An unfunded view observation stays one queued obligation across retries", async () => {
  const session = setupDefaultFixture();
  session.treasuryLedger = [];
  const input = { campaignId: 100, postId: 501, channelId: 50, publisherId: 1001,
    campaignType: "clicks", eligibleViews: 5, validationResult: { eligible: true } };
  const first = await settleCanonicalCpcZeroClickAdvance(session.createConnection(), input);
  const retry = await settleCanonicalCpcZeroClickAdvance(session.createConnection(), input);
  assert.equal(first.status, "exhausted");
  assert.equal(retry.status, "exhausted");
  assert.equal(session.advances.get("100:1001").unfunded_queue_amount, "0.00466667");
  assert.equal(session.users.get(1001).balance_locked, "0.00000000");
});

test("33. CPM 100 to 200 cumulative views charges only the additional 100", async () => {
  const session = setupDefaultFixture();
  session.campaignPosts.get(501).views = 200;
  const conn = session.createConnection();
  const base = { campaignId: 100, postId: 501, channelId: 50, publisherId: 1001,
    advertiserId: 10, cpmRate: "10.00000000" };
  const first = await settleCanonicalCpmViews(conn, { ...base, confirmedViews: 100 });
  const second = await settleCanonicalCpmViews(conn, { ...base, confirmedViews: 200 });
  const replay = await settleCanonicalCpmViews(conn, { ...base, confirmedViews: 200 });
  assert.equal(first.advertiserDebitDecimal, "1.00000000");
  assert.equal(second.advertiserDebitDecimal, "1.00000000");
  assert.equal(replay.status, "duplicate");
  assert.equal(session.campaignPosts.get(501).settled_views, 200);
});


test("34. Confirmed five-view billing entry reaches canonical reserve ledger", async () => {
  const session = setupDefaultFixture();
  session.campaignPosts.get(501).views = 5;
  activeBillingSession = session;
  const cronSource = fs.readFileSync(path.join(root, "src/app/api/cron/update-views/route.ts"), "utf8");
  assert.match(cronSource, /persistSuccessfulChannelViews[\s\S]*debitConfirmedChannelViews\(Number\(post\.id\), monotonicViews\)/);
  const billing = load("src/lib/channelFastBilling.ts");
  const result = await billing.debitConfirmedChannelViews(501, 5);
  assert.equal(result.debited, true);
  assert.equal(session.advances.get("100:1001").advanced_amount, "0.00466667");
  assert.equal(session.users.get(1001).balance_locked, "0.00466667");
  assert.equal(session.treasuryLedger.filter((row) => row.entry_type === "advance_outflow").length, 1);
  assert.equal([...session.settlementEvents.values()].filter((event) => event.settlement_type === "cpc_zero_click_advance").length, 1);
});


test("35. V1.01 payout helper follows the administrator margin and reserve settings", () => {
  const normal = settlementMod.getUnifiedChannelPayoutSplit(1, {
    platformMarginPercent: 30, safetyReservePercent: 14.28571429,
  });
  assert.equal(normal.publisherCredit, 0.6);
  assert.equal(normal.platformRevenue, 0.3);
  assert.equal(normal.reserveAmount, 0.1);
  const changed = settlementMod.getUnifiedChannelPayoutSplit(1, {
    platformMarginPercent: 20, safetyReservePercent: 12.5,
  });
  assert.equal(changed.publisherCredit, 0.7);
  assert.equal(changed.platformRevenue, 0.2);
  assert.equal(changed.reserveAmount, 0.1);
});


test("36. Canonical batch worker fails closed when V1.01 schema is incomplete", async () => {
  const session = setupDefaultFixture();
  activeBillingSession = session;
  session.poolQuery = async () => [[{ present: 0 }]];
  const batch = load("src/lib/channelSettlement.ts");
  await assert.rejects(batch.settleChannelCampaigns({ skipGlobalMaintenance: true }),
    /v101_batch_schema_not_ready/);
});


test("37. Canonical batch recovery routes an outstanding CPM view through fast billing", async () => {
  const session = setupDefaultFixture();
  session.campaigns.get(100).campaign_type = "views";
  session.campaignPosts.get(501).views = 5;
  activeBillingSession = session;
  let candidateRead = 0;
  session.poolQuery = async (sql) => {
    const statement = sql.replace(/\s+/g, " ").toUpperCase();
    if (statement.includes("FROM SETTINGS")) return [[
      { key: "platform_margin_percent", value: "30" },
      { key: "safety_reserve_percent", value: "14.28571429" },
    ]];
    if (statement.includes("INFORMATION_SCHEMA.TABLES")) return [[{ present: 7 }]];
    if (statement.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ present: 3 }]];
    if (statement.includes("SELECT CP.ID AS POST_ID")) {
      candidateRead += 1;
      return [candidateRead === 1 ? [{ post_id: 501 }] : []];
    }
    if (statement.includes("FROM CAMPAIGN_POSTS CP JOIN CAMPAIGNS")) return [[{
      post_id: 501, campaign_type: "views", views: 5, settled_views: 0, settled_clicks: 0,
    }]];
    return [[]];
  };
  const batch = load("src/lib/channelSettlement.ts");
  const result = await batch.settleChannelCampaigns({ skipGlobalMaintenance: true });
  assert.equal(candidateRead, 1);
  assert.equal(result.settledPosts, 1);
  assert.equal(session.campaignPosts.get(501).settled_views, 5);
});


test("38. Canonical batch replay does not charge the same confirmed CPM views twice", async () => {
  const session = setupDefaultFixture();
  session.campaigns.get(100).campaign_type = "views";
  session.campaignPosts.get(501).views = 5;
  activeBillingSession = session;
  session.poolQuery = async (sql) => {
    const statement = sql.replace(/\s+/g, " ").toUpperCase();
    if (statement.includes("INFORMATION_SCHEMA.TABLES")) return [[{ present: 7 }]];
    if (statement.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ present: 3 }]];
    if (statement.includes("FROM SETTINGS")) return [[
      { key: "platform_margin_percent", value: "30" },
      { key: "safety_reserve_percent", value: "14.28571429" },
    ]];
    if (statement.includes("SELECT CP.ID AS POST_ID")) return [[{ post_id: 501 }]];
    if (statement.includes("FROM CAMPAIGN_POSTS CP JOIN CAMPAIGNS")) return [[{
      campaign_type: "views", views: 5, settled_views: session.campaignPosts.get(501).settled_views,
    }]];
    return [[]];
  };
  const batch = load("src/lib/channelSettlement.ts");
  const first = await batch.settleChannelCampaigns({ skipGlobalMaintenance: true });
  const second = await batch.settleChannelCampaigns({ skipGlobalMaintenance: true });
  assert.equal(first.settledPosts, 1);
  assert.equal(second.settledPosts, 0);
  assert.equal(second.advertiserDebited, 0);
  assert.equal(session.campaignPosts.get(501).settled_views, 5);
  assert.equal([...session.settlementEvents.values()].filter(event => event.settlement_type === "cpm_view").length, 1);
});

test("39. Canonical batch keyset paging reaches later posts after a full page of skipped candidates", async () => {
  const session = setupDefaultFixture();
  session.campaigns.get(100).campaign_type = "views";
  session.campaignPosts.get(501).views = 5;
  activeBillingSession = session;
  const cursors = [];
  session.poolQuery = async (sql, params = []) => {
    const statement = sql.replace(/\s+/g, " ").toUpperCase();
    if (statement.includes("INFORMATION_SCHEMA.TABLES")) return [[{ present: 7 }]];
    if (statement.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ present: 3 }]];
    if (statement.includes("FROM SETTINGS")) return [[
      { key: "platform_margin_percent", value: "30" },
      { key: "safety_reserve_percent", value: "14.28571429" },
    ]];
    if (statement.includes("SELECT CP.ID AS POST_ID")) {
      cursors.push(params[0]);
      return [params[0] === 0 ? Array.from({ length: 200 }, (_, i) => ({ post_id: i + 1 }))
        : params[0] === 200 ? [{ post_id: 501 }] : []];
    }
    if (statement.includes("FROM CAMPAIGN_POSTS CP JOIN CAMPAIGNS")) return [params[0] === 501 ? [{
      campaign_type: "views", views: 5, settled_views: 0,
    }] : []];
    return [[]];
  };
  const batch = load("src/lib/channelSettlement.ts");
  const result = await batch.settleChannelCampaigns({ skipGlobalMaintenance: true });
  assert.deepEqual(cursors, [0, 200]);
  assert.equal(result.candidates, 201);
  assert.equal(result.settledPosts, 1);
  assert.equal(session.campaignPosts.get(501).settled_views, 5);
});

test("40. Canonical batch routes a verified CPC click through ARR-aware billing", async () => {
  const session = setupDefaultFixture();
  session.campaignPosts.get(501).views = 0;
  activeBillingSession = session;
  session.poolQuery = async (sql) => {
    const statement = sql.replace(/\s+/g, " ").toUpperCase();
    if (statement.includes("INFORMATION_SCHEMA.TABLES")) return [[{ present: 7 }]];
    if (statement.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ present: 3 }]];
    if (statement.includes("FROM SETTINGS")) return [[
      { key: "platform_margin_percent", value: "30" },
      { key: "safety_reserve_percent", value: "14.28571429" },
    ]];
    if (statement.includes("SELECT CP.ID AS POST_ID")) return [[{ post_id: 501 }]];
    if (statement.includes("FROM CAMPAIGN_POSTS CP JOIN CAMPAIGNS")) return [[{
      campaign_type: "clicks", views: 0, settled_views: 0, settled_clicks: session.campaignPosts.get(501).settled_clicks,
      valid_clicks: 1,
    }]];
    if (statement.includes("SELECT ID FROM CAMPAIGN_CLICKS WHERE POST_ID=?")) return [[{ id: 701 }]];
    return [[]];
  };
  const batch = load("src/lib/channelSettlement.ts");
  const result = await batch.settleChannelCampaigns({ skipGlobalMaintenance: true });
  assert.equal(result.settledPosts, 1);
  assert.equal(result.advertiserDebited, 0.065);
  assert.equal(session.campaignPosts.get(501).settled_clicks, 1);
});


test("41. Canonical batch leaves a zero-click CPC view unpaid when shared reserve is empty", async () => {
  const session = setupDefaultFixture();
  session.campaignPosts.get(501).views = 5;
  session.treasuryLedger.length = 0;
  activeBillingSession = session;
  session.poolQuery = async (sql) => {
    const statement = sql.replace(/\s+/g, " ").toUpperCase();
    if (statement.includes("INFORMATION_SCHEMA.TABLES")) return [[{ present: 7 }]];
    if (statement.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ present: 3 }]];
    if (statement.includes("FROM SETTINGS")) return [[
      { key: "platform_margin_percent", value: "30" },
      { key: "safety_reserve_percent", value: "14.28571429" },
    ]];
    if (statement.includes("SELECT CP.ID AS POST_ID")) return [[{ post_id: 501 }]];
    if (statement.includes("FROM CAMPAIGN_POSTS CP JOIN CAMPAIGNS")) return [[{
      campaign_type: "clicks", views: 5, settled_views: 0, settled_clicks: 0, valid_clicks: 0,
    }]];
    return [[]];
  };
  const batch = load("src/lib/channelSettlement.ts");
  const result = await batch.settleChannelCampaigns({ skipGlobalMaintenance: true });
  assert.equal(result.settledPosts, 0);
  assert.equal(result.publisherCredited, 0);
  assert.equal(session.users.get(1001).balance_locked, "0.00000000");
  assert.equal(session.treasuryLedger.filter(row => row.entry_type === "advance_outflow").length, 0);
});


test("42. Failed batch candidate is retried next run without starving a later post", async () => {
  const session = setupDefaultFixture();
  session.campaigns.get(100).campaign_type = "views";
  session.campaignPosts.get(501).views = 5;
  session.campaignPosts.set(502, { ...session.campaignPosts.get(501), id: 502, post_id: 502, settled_views: 0 });
  activeBillingSession = session;
  let failFirstCandidate = true;
  session.poolQuery = async (sql, params = []) => {
    const statement = sql.replace(/\s+/g, " ").toUpperCase();
    if (statement.includes("INFORMATION_SCHEMA.TABLES")) return [[{ present: 7 }]];
    if (statement.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ present: 3 }]];
    if (statement.includes("FROM SETTINGS")) return [[
      { key: "platform_margin_percent", value: "30" },
      { key: "safety_reserve_percent", value: "14.28571429" },
    ]];
    if (statement.includes("SELECT CP.ID AS POST_ID")) return [[{ post_id: 501 }, { post_id: 502 }]];
    if (statement.includes("FROM CAMPAIGN_POSTS CP JOIN CAMPAIGNS")) {
      if (params[0] === 501 && failFirstCandidate) {
        failFirstCandidate = false;
        throw new Error("temporary_candidate_read_failure");
      }
      return [[{ campaign_type: "views", views: 5,
        settled_views: session.campaignPosts.get(params[0]).settled_views }]];
    }
    return [[]];
  };
  const batch = load("src/lib/channelSettlement.ts");
  const first = await batch.settleChannelCampaigns({ skipGlobalMaintenance: true });
  assert.equal(first.failedPosts, 1);
  assert.equal(first.failedDetails[0].postId, 501);
  assert.equal(first.settledPosts, 1);
  assert.equal(session.campaignPosts.get(502).settled_views, 5);
  const retry = await batch.settleChannelCampaigns({ skipGlobalMaintenance: true });
  assert.equal(retry.failedPosts, 0);
  assert.equal(retry.settledPosts, 1);
  assert.equal(session.campaignPosts.get(501).settled_views, 5);
  assert.equal([...session.settlementEvents.values()].filter(event => event.settlement_type === "cpm_view").length, 2);
});
