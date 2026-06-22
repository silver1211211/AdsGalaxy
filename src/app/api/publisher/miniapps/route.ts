import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { assertMiniAppBetaAccess, MiniAppBetaAccessError } from "@/lib/miniappBetaAccess";
import { MiniAppSubmissionValidationError, validateMiniAppSubmission } from "@/lib/miniappSubmissionValidation";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    await assertMiniAppBetaAccess(user);

    const [rows] = await pool.query(
      `SELECT
        id,
        user_id,
        miniapp_name,
        miniapp_username,
        bot_id,
        webapp_url,
        miniapp_url,
        status,
        created_at,
        updated_at,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id), 0) as mediation_request_count,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.impression_confirmed = 1), 0) as confirmed_impression_count,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id), 0) as total_requests,
        COALESCE((SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = miniapps.id), 0) as total_impressions,
        NULLIF(GREATEST(
          COALESCE((SELECT MAX(mr.created_at) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(ds.updated_at) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = miniapps.id), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(iai.created_at) FROM miniapp_internal_ad_impressions iai WHERE iai.miniapp_id = miniapps.id), '1970-01-01 00:00:00')
        ), '1970-01-01 00:00:00') as last_activity_at,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.final_result = 'no_fill'), 0) as no_fill_count,
        CASE
          WHEN COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id), 0) > 0
            THEN (
              COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.impression_confirmed = 1), 0)
              / COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id), 1)
            ) * 100
          ELSE 0
        END as fill_rate,
        COALESCE((SELECT COUNT(*) FROM miniapp_ad_networks mn WHERE mn.miniapp_id = miniapps.id AND mn.enabled = TRUE), 0) as active_network_count
       FROM miniapps
       WHERE user_id = ? AND is_deleted = FALSE
       ORDER BY created_at DESC`,
      [user.id]
    );

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("Publisher Mini Apps GET Error:", error);
    const status = error instanceof MiniAppBetaAccessError ? 403 : getAuthErrorStatus(error);
    return NextResponse.json({ error: error.message || "Failed to fetch Mini Apps" }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    await assertMiniAppBetaAccess(user);
    const input = validateMiniAppSubmission(await request.json());

    const [existing]: any = await pool.query(
      "SELECT id, is_deleted FROM miniapps WHERE user_id = ? AND miniapp_username = ?",
      [user.id, input.miniapp_username]
    );

    if (existing.length > 0 && !existing[0].is_deleted) {
      return NextResponse.json({ error: "This Mini App username is already in your dashboard" }, { status: 400 });
    }

    if (existing.length > 0) {
      await pool.query(
        `UPDATE miniapps
         SET miniapp_name = ?, bot_id = ?, webapp_url = ?, miniapp_url = ?, status = 'pending', is_deleted = FALSE
         WHERE id = ? AND user_id = ?`,
        [input.miniapp_name, input.bot_id, input.webapp_url, input.miniapp_url, existing[0].id, user.id]
      );

      return NextResponse.json({ success: true, id: existing[0].id });
    }

    const [result]: any = await pool.query(
      `INSERT INTO miniapps (user_id, miniapp_name, miniapp_username, bot_id, webapp_url, miniapp_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [user.id, input.miniapp_name, input.miniapp_username, input.bot_id, input.webapp_url, input.miniapp_url]
    );

    return NextResponse.json({ success: true, id: result.insertId });
  } catch (error: any) {
    console.error("Publisher Mini Apps POST Error:", error);
    const status = error instanceof MiniAppBetaAccessError
      ? 403
      : error instanceof MiniAppSubmissionValidationError
        ? 400
        : getAuthErrorStatus(error);
    return NextResponse.json({ error: error.message || "Failed to submit Mini App" }, { status });
  }
}
