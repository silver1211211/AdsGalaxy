import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getMiniAppFeePercent, isMiniAppNetworkName } from "@/lib/miniappStats";
import { recordNetworkSuccess } from "@/lib/miniappOptimization";
import { publicSdkErrorResponse, requirePublicSdkUser } from "@/lib/publicSdkAuth";
import { validateMiniappRevenue } from "@/lib/miniappRevenueValidation";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

type RequestRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  telegram_user_id: string | number;
  selected_network: string;
  impression_confirmed: number | boolean;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();
  try {
    const body = await request.json().catch(() => ({}));
    const sdkUser = await requirePublicSdkUser(request);
    const requestId = clean(body.request_id);
    const miniappId = Number(body.miniapp_id);
    const suppliedUserId = clean(body.telegram_user_id);
    if (suppliedUserId && suppliedUserId !== sdkUser.telegramUserId) {
      return NextResponse.json({ success: false, error_code: "INVALID_INIT_DATA", message: "telegram_user_id does not match authenticated user" }, { status: 403 });
    }
    const telegramUserId = sdkUser.telegramUserId;
    const country = clean(body.country).toUpperCase();

    if (!requestId || !Number.isInteger(miniappId) || miniappId <= 0) {
      return NextResponse.json({ success: false, error_code: "REQUEST_FAILED", message: "request_id and miniapp_id are required" }, { status: 400 });
    }

    await conn.beginTransaction();
    const [rows] = await conn.query<RequestRow[]>(
      `SELECT id, miniapp_id, telegram_user_id, selected_network, impression_confirmed
       FROM miniapp_mediation_requests
       WHERE request_id = ?
       FOR UPDATE`,
      [requestId]
    );
    const mediation = rows[0];
    if (!mediation || Number(mediation.miniapp_id) !== miniappId || String(mediation.telegram_user_id) !== telegramUserId) {
      await conn.rollback();
      return NextResponse.json({ success: false, error_code: "REQUEST_FAILED", message: "Ad request does not match this user" }, { status: 400 });
    }
    if (!isMiniAppNetworkName(mediation.selected_network) || mediation.selected_network === "AdsGalaxyInternal") {
      await conn.rollback();
      return NextResponse.json({ success: true, duplicate: Boolean(mediation?.impression_confirmed) });
    }
    if (Boolean(mediation.impression_confirmed)) {
      await conn.commit();
      return NextResponse.json({ success: true, duplicate: true });
    }

    const impressions = 1;
    const grossRevenue = Number(body.gross_revenue || 0);
    const feePercent = await getMiniAppFeePercent();
    const validation = await validateMiniappRevenue({
      conn,
      networkName: mediation.selected_network,
      impressions,
      grossRevenue,
    });
    if (validation.status === "rejected") {
      await conn.query(
        "UPDATE miniapp_mediation_requests SET final_result = 'revenue_rejected' WHERE id = ?",
        [mediation.id]
      );
      await conn.commit();
      return NextResponse.json({
        success: false,
        error_code: "IMPRESSION_FAILED",
        message: "Revenue validation failed",
        validation,
      }, { status: 400 });
    }

    const adsGalaxyFee = grossRevenue * feePercent / 100;
    const publisherRevenue = grossRevenue - adsGalaxyFee;
    await conn.query(
      `INSERT INTO miniapp_daily_stats
        (miniapp_id, network_name, date, impressions, gross_revenue, ads_galaxy_fee, publisher_revenue, gross_cpm, net_cpm,
         revenue_validation_status, revenue_validation_reason, revenue_validation_metadata, revenue_validated_at, revenue_review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
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
        mediation.selected_network,
        today(),
        impressions,
        grossRevenue,
        adsGalaxyFee,
        publisherRevenue,
        grossRevenue * 1000,
        publisherRevenue * 1000,
        validation.status,
        validation.reason,
        JSON.stringify(validation.metadata),
        validation.status === "suspicious" ? "pending_review" : "not_required",
      ]
    );
    if (/^[A-Z]{2}$/.test(country)) {
      await conn.query(
        `INSERT INTO miniapp_country_stats (miniapp_id, network_name, country, date, impressions)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE impressions = impressions + VALUES(impressions)`,
        [miniappId, mediation.selected_network, country, today(), impressions]
      );
    }
    await conn.query("UPDATE miniapp_mediation_requests SET impression_confirmed = 1, impression_confirmed_at = NOW(), final_result = 'displayed' WHERE id = ?", [mediation.id]);
    await recordNetworkSuccess(conn, miniappId, mediation.selected_network);
    await conn.commit();
    return NextResponse.json({ success: true, request_id: requestId, revenue_validation: validation });
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {}
    return NextResponse.json(publicSdkErrorResponse(error, "IMPRESSION_FAILED", "Impression failed"), { status: Number(error?.status || 400) });
  } finally {
    conn.release();
  }
}
