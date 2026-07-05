import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getMiniAppFeePercent, isMiniAppNetworkName } from "@/lib/miniappStats";
import { recordNetworkSuccess } from "@/lib/miniappOptimization";
import { validateMiniappRevenue } from "@/lib/miniappRevenueValidation";
import { requireMiniappTrackingUser } from "@/lib/publicSdkAuth";

type MediationRequestRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  telegram_user_id: string | number;
  country: string | null;
  selected_network: string;
  request_id: string;
  impression_confirmed: number | boolean;
  status: string;
  is_deleted: number | boolean;
};

type NetworkRow = RowDataPacket & {
  enabled: number | boolean;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeCountry(value: unknown) {
  const country = cleanText(value).toUpperCase();
  if (!country) return null;
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("Country must be a 2-letter country code");
  }
  return country;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function assertSingleClientImpression(value: unknown) {
  if (value === undefined || value === null || value === "" || Number(value) === 1) return;
  throw new Error("Client impression confirmation must contain exactly 1 impression");
}

async function assertNetworkEnabled(conn: PoolConnection, miniappId: number, networkName: string) {
  const [rows] = await conn.query<NetworkRow[]>(
    "SELECT enabled FROM miniapp_ad_networks WHERE miniapp_id = ? AND network_name = ? LIMIT 1",
    [miniappId, networkName]
  );

  if (rows.length === 0 || !Boolean(rows[0].enabled)) {
    throw new Error("Network is not enabled for this Mini App");
  }
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();

  try {
    const body = await request.json();
    const requestId = cleanText(body.request_id);
    const miniappId = Number(body.miniapp_id);
    const networkName = cleanText(body.network_name);
    const telegramUserId = cleanText(body.telegram_user_id);
    assertSingleClientImpression(body.impressions);
    const impressions = 1;
    // Never trust browser-supplied revenue. Trusted provider imports use the internal stats endpoint.
    const grossRevenue = 0;
    const country = normalizeCountry(body.country);

    if (!requestId) {
      return NextResponse.json({ error: "request_id is required" }, { status: 400 });
    }

    if (!Number.isInteger(miniappId) || miniappId <= 0) {
      return NextResponse.json({ error: "Valid miniapp_id is required" }, { status: 400 });
    }

    if (!isMiniAppNetworkName(networkName)) {
      return NextResponse.json({ error: "Invalid network_name" }, { status: 400 });
    }

    if (!telegramUserId) {
      return NextResponse.json({ error: "telegram_user_id is required" }, { status: 400 });
    }

    const trackingUser = await requireMiniappTrackingUser(request, miniappId, telegramUserId);
    if (trackingUser.telegramUserId !== telegramUserId) {
      return NextResponse.json({ error: "telegram_user_id does not match authenticated user" }, { status: 403 });
    }

    await conn.beginTransaction();

    const [requestRows] = await conn.query<MediationRequestRow[]>(`
      SELECT
        mr.id,
        mr.miniapp_id,
        mr.telegram_user_id,
        mr.country,
        mr.selected_network,
        mr.request_id,
        mr.impression_confirmed,
        m.status,
        m.is_deleted
      FROM miniapp_mediation_requests mr
      JOIN miniapps m ON mr.miniapp_id = m.id
      WHERE mr.request_id = ?
      FOR UPDATE
    `, [requestId]);

    if (requestRows.length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "Mediation request not found" }, { status: 404 });
    }

    const mediationRequest = requestRows[0];

    if (Number(mediationRequest.miniapp_id) !== miniappId) {
      await conn.rollback();
      return NextResponse.json({ error: "request_id does not belong to this miniapp_id" }, { status: 400 });
    }

    if (String(mediationRequest.telegram_user_id) !== telegramUserId) {
      await conn.rollback();
      return NextResponse.json({ error: "telegram_user_id does not match mediation request" }, { status: 403 });
    }

    if (mediationRequest.selected_network !== networkName) {
      await conn.rollback();
      return NextResponse.json({ error: "network_name does not match selected network" }, { status: 400 });
    }

    if (mediationRequest.status !== "approved" && mediationRequest.status !== "monetized") {
      await conn.rollback();
      return NextResponse.json({ error: "Mini App is not approved for impression tracking" }, { status: 403 });
    }

    if (Boolean(mediationRequest.is_deleted)) {
      await conn.rollback();
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    if (Boolean(mediationRequest.impression_confirmed)) {
      await conn.commit();
      return NextResponse.json({
        success: true,
        user_id: telegramUserId,
        request_id: requestId,
        reward_eligible: false,
        status: "pending_provider_confirmation",
      });
    }

    await assertNetworkEnabled(conn, miniappId, networkName);

    const validation = await validateMiniappRevenue({
      conn,
      networkName,
      impressions,
      grossRevenue,
    });
    if (validation.status === "rejected") {
      await conn.query(
        "UPDATE miniapp_mediation_requests SET final_result = 'revenue_rejected' WHERE id = ?",
        [mediationRequest.id]
      );
      await conn.commit();
      return NextResponse.json({ error: "Revenue validation failed", validation }, { status: 400 });
    }

    const feePercent = await getMiniAppFeePercent();
    const adsGalaxyFee = grossRevenue * feePercent / 100;
    const publisherRevenue = grossRevenue - adsGalaxyFee;
    const grossCpm = impressions > 0 ? (grossRevenue / impressions) * 1000 : 0;
    const netCpm = impressions > 0 ? (publisherRevenue / impressions) * 1000 : 0;
    const statDate = todayDate();
    const statCountry = country;

    await conn.query(
      `INSERT INTO miniapp_daily_stats
        (miniapp_id, network_name, date, impressions, gross_revenue, ads_galaxy_fee, publisher_revenue, gross_cpm, net_cpm,
         revenue_validation_status, revenue_validation_reason, revenue_validation_metadata, revenue_validated_at, revenue_review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
        gross_cpm = CASE
          WHEN (impressions + VALUES(impressions)) > 0
            THEN ((gross_revenue + VALUES(gross_revenue)) / (impressions + VALUES(impressions))) * 1000
          ELSE 0
        END,
        net_cpm = CASE
          WHEN (impressions + VALUES(impressions)) > 0
            THEN ((publisher_revenue + VALUES(publisher_revenue)) / (impressions + VALUES(impressions))) * 1000
          ELSE 0
        END,
        impressions = impressions + VALUES(impressions),
        gross_revenue = gross_revenue + VALUES(gross_revenue),
        ads_galaxy_fee = ads_galaxy_fee + VALUES(ads_galaxy_fee),
        publisher_revenue = publisher_revenue + VALUES(publisher_revenue),
        revenue_validation_status = CASE
          WHEN revenue_validation_status = 'rejected' OR VALUES(revenue_validation_status) = 'rejected' THEN 'rejected'
          WHEN revenue_validation_status = 'suspicious' OR VALUES(revenue_validation_status) = 'suspicious' THEN 'suspicious'
          ELSE 'passed'
        END,
        revenue_validation_reason = VALUES(revenue_validation_reason),
        revenue_validation_metadata = VALUES(revenue_validation_metadata),
        revenue_validated_at = NOW(),
        revenue_review_status = CASE
          WHEN VALUES(revenue_validation_status) = 'suspicious' AND revenue_review_status = 'not_required' THEN 'pending_review'
          WHEN VALUES(revenue_validation_status) = 'passed' AND revenue_review_status = 'pending_review' THEN 'not_required'
          ELSE revenue_review_status
        END`,
      [
        miniappId,
        networkName,
        statDate,
        impressions,
        grossRevenue,
        adsGalaxyFee,
        publisherRevenue,
        grossCpm,
        netCpm,
        validation.status,
        validation.reason,
        JSON.stringify(validation.metadata),
        validation.status === "suspicious" ? "pending_review" : "not_required",
      ]
    );

    if (statCountry) {
      await conn.query(
        `INSERT INTO miniapp_country_stats (miniapp_id, network_name, country, date, impressions)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE impressions = impressions + VALUES(impressions)`,
        [miniappId, networkName, statCountry, statDate, impressions]
      );
    }

    await conn.query(
      "UPDATE miniapp_mediation_requests SET impression_confirmed = 1, impression_confirmed_at = NOW() WHERE id = ?",
      [mediationRequest.id]
    );
    await recordNetworkSuccess(conn, miniappId, networkName);

    await conn.commit();

    return NextResponse.json({
      success: true,
      user_id: telegramUserId,
      request_id: requestId,
      reward_eligible: false,
      status: "pending_provider_confirmation",
    });
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {
      // Transaction may not have started.
    }

    const message = error?.message || "Failed to confirm Mini App impression";
    const status = message.startsWith("Unauthorized") || message.startsWith("Invalid initData")
        ? 401
        : 400;
    return NextResponse.json({ error: message }, { status });
  } finally {
    conn.release();
  }
}
