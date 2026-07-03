import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { creditUserLockedBalance } from "@/lib/earnings";
import { recordPayoutSafetyCheck } from "@/lib/revenueProtection";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

type DailyStatRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  user_id: number;
  network_name: string;
  date: string;
  impressions: string | number;
  publisher_revenue: string | number;
  gross_revenue: string | number;
  ads_galaxy_fee?: string | number;
  reserve_revenue?: string | number;
  revenue_validation_status?: string;
  revenue_review_status?: string;
};

type InternalLedgerRow = RowDataPacket & {
  impressions: string | number;
  gross_revenue: string | number;
  ads_galaxy_fee: string | number;
  reserve_revenue: string | number;
  publisher_revenue: string | number;
};
type SettingRow = RowDataPacket & { value: string };

function moneyMatches(left: unknown, right: unknown) {
  return Math.abs(toNumber(left) - toNumber(right)) <= 0.00000001;
}

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function normalizeSuspiciousRevenueBehavior(value: unknown) {
  const behavior = String(value || "review").trim().toLowerCase();
  return behavior === "allow" || behavior === "block" || behavior === "review" ? behavior : "review";
}

export async function GET(_req: NextRequest) {
  const unauthorized = requireCronSecret(_req);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("settle-miniapp", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Mini App settlement cron is already running" }, { status: 409 });
  }

  try {
    const [behaviorRows] = await pool.query<SettingRow[]>(
      "SELECT value FROM revenue_protection_settings WHERE `key` = 'suspicious_revenue_settlement_behavior' LIMIT 1"
    );
    const behaviorRow = behaviorRows[0];
    const suspiciousRevenueBehavior = normalizeSuspiciousRevenueBehavior(behaviorRow?.value);
    const externalRevenueValidationCondition = suspiciousRevenueBehavior === "allow"
      ? "(ds.revenue_validation_status = 'passed' OR ds.revenue_validation_status = 'suspicious')"
      : suspiciousRevenueBehavior === "review"
        ? "(ds.revenue_validation_status = 'passed' OR (ds.revenue_validation_status = 'suspicious' AND ds.revenue_review_status = 'approved'))"
        : "ds.revenue_validation_status = 'passed'";

    const [statsToSettle] = await pool.query<DailyStatRow[]>(`
      SELECT
        ds.id,
        ds.miniapp_id,
        m.user_id,
        ds.network_name,
        ds.date,
        ds.impressions,
        ds.gross_revenue,
        ds.ads_galaxy_fee,
        ds.reserve_revenue,
        ds.publisher_revenue,
        ds.revenue_validation_status,
        ds.revenue_review_status
      FROM miniapp_daily_stats ds
      JOIN miniapps m ON ds.miniapp_id = m.id
      LEFT JOIN miniapp_earnings_settlements s ON s.daily_stat_id = ds.id
      WHERE s.id IS NULL
        AND m.status IN ('approved', 'monetized')
        AND m.is_deleted = FALSE
        AND ds.publisher_revenue > 0
        AND ds.date < CURDATE()
        AND (ds.network_name = 'AdsGalaxyInternal' OR ${externalRevenueValidationCondition})
      ORDER BY ds.date ASC, ds.id ASC
      LIMIT 500
    `);

    const conn = await pool.getConnection();
    const results = {
      scanned: statsToSettle.length,
      settled: 0,
      skipped: 0,
      total_locked: 0,
    };

    try {
      for (const stat of statsToSettle) {
        await conn.beginTransaction();

        try {
          const [lockedStats] = await conn.query<DailyStatRow[]>(`
            SELECT
              ds.id,
              ds.miniapp_id,
              m.user_id,
              ds.network_name,
              ds.date,
              ds.impressions,
              ds.gross_revenue,
              ds.ads_galaxy_fee,
              ds.reserve_revenue,
              ds.publisher_revenue,
              ds.revenue_validation_status,
              ds.revenue_review_status
            FROM miniapp_daily_stats ds
            JOIN miniapps m ON ds.miniapp_id = m.id
            WHERE ds.id = ?
              AND m.status IN ('approved', 'monetized')
              AND m.is_deleted = FALSE
              AND ds.date < CURDATE()
              AND (ds.network_name = 'AdsGalaxyInternal' OR ${externalRevenueValidationCondition})
            FOR UPDATE
          `, [stat.id]);

          if (lockedStats.length === 0) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const lockedStat = lockedStats[0];
          const rawPublisherRevenue = toNumber(lockedStat.publisher_revenue);
          let publisherRevenue = rawPublisherRevenue;
          let expectedPublisherRevenue = rawPublisherRevenue;
          let expectedPlatformRevenue = toNumber(lockedStat.ads_galaxy_fee);
          let expectedReserveRevenue = toNumber(lockedStat.reserve_revenue);
          let advertiserPaid = toNumber(lockedStat.gross_revenue);
          if (lockedStat.network_name === "AdsGalaxyInternal") {
            const [ledgerRows] = await conn.query<InternalLedgerRow[]>(
              `SELECT COUNT(*) AS impressions,
                 COALESCE(SUM(cost), 0) AS gross_revenue,
                 COALESCE(SUM(ads_galaxy_revenue), 0) AS ads_galaxy_fee,
                 COALESCE(SUM(reserve_revenue), 0) AS reserve_revenue,
                 COALESCE(SUM(publisher_revenue), 0) AS publisher_revenue
               FROM miniapp_internal_ad_impressions
               WHERE miniapp_id = ? AND DATE(created_at) = ?`,
              [lockedStat.miniapp_id, lockedStat.date]
            );
            const ledger = ledgerRows[0];
            const reconciled = Number(ledger?.impressions || 0) === Math.floor(toNumber(lockedStat.impressions))
              && moneyMatches(ledger?.gross_revenue, lockedStat.gross_revenue)
              && moneyMatches(ledger?.ads_galaxy_fee, lockedStat.ads_galaxy_fee)
              && moneyMatches(ledger?.reserve_revenue, lockedStat.reserve_revenue)
              && moneyMatches(ledger?.publisher_revenue, lockedStat.publisher_revenue);
            if (!reconciled) {
              await conn.query(
                `UPDATE miniapp_daily_stats
                 SET revenue_validation_status = 'rejected',
                     revenue_validation_reason = 'internal_impression_ledger_mismatch',
                     revenue_validated_at = NOW()
                 WHERE id = ?`,
                [lockedStat.id]
              );
              await conn.commit();
              results.skipped++;
              continue;
            }
            advertiserPaid = toNumber(ledger.gross_revenue);
            publisherRevenue = toNumber(ledger.publisher_revenue);
            expectedPublisherRevenue = publisherRevenue;
            expectedPlatformRevenue = toNumber(ledger.ads_galaxy_fee);
            expectedReserveRevenue = toNumber(ledger.reserve_revenue);
            await conn.query(
              `UPDATE miniapp_daily_stats
               SET revenue_validation_status = 'passed', revenue_validation_reason = NULL,
                   revenue_validation_metadata = ?, revenue_validated_at = NOW(), revenue_review_status = 'not_required'
               WHERE id = ?`,
              [JSON.stringify({ source: "server_internal_impression_ledger", reconciled: true }), lockedStat.id]
            );
          }

          if (publisherRevenue <= 0) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const safetyCheck = await recordPayoutSafetyCheck({
            settlementType: "miniapp_daily",
            settlementId: Number(lockedStat.id),
            publisherId: Number(lockedStat.user_id),
            advertiserPaid,
            publisherShare: publisherRevenue,
            platformShare: toNumber(lockedStat.ads_galaxy_fee),
            reserveShare: toNumber(lockedStat.reserve_revenue),
            expectedPublisherShare: expectedPublisherRevenue,
            expectedPlatformShare: expectedPlatformRevenue,
            expectedReserveShare: expectedReserveRevenue,
            metadata: {
              miniapp_id: lockedStat.miniapp_id,
              network_name: lockedStat.network_name,
              daily_stat_id: lockedStat.id,
            },
          });
          if (safetyCheck.status !== "passed") {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const [insertResult] = await conn.query<ResultSetHeader>(`
            INSERT IGNORE INTO miniapp_earnings_settlements
              (miniapp_id, user_id, daily_stat_id, network_name, date, impressions, publisher_revenue, status, locked_at, unlock_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'locked', NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY))
          `, [
            lockedStat.miniapp_id,
            lockedStat.user_id,
            lockedStat.id,
            lockedStat.network_name,
            lockedStat.date,
            Math.max(0, Math.floor(toNumber(lockedStat.impressions))),
            publisherRevenue,
          ]);

          if (insertResult.affectedRows !== 1) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const credited = await creditUserLockedBalance(conn, lockedStat.user_id, publisherRevenue);
          if (!credited) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          await conn.commit();
          results.settled++;
          results.total_locked += publisherRevenue;
        } catch (error) {
          await conn.rollback();
          results.skipped++;
          console.error("Mini App settlement failed", { daily_stat_id: stat.id, error });
        }
      }
    } finally {
      conn.release();
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    console.error("Mini App Settlement Cron Error:", error);
    const message = error instanceof Error ? error.message : "Mini App settlement failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
