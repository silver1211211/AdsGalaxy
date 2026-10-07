import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import pool from "@/lib/db";
import { getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { MiniAppSubmissionValidationError, validateMiniAppSubmission } from "@/lib/miniappSubmissionValidation";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import { notifyMiniAppSubmitted } from "@/lib/publisherNotifications";
import { getMiniAppAggregateStatsByIds } from "@/lib/miniappReports";
import { safeQueuePublisherWelcome } from "@/lib/supportMessages";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { authenticatePublisherAsset, PublisherAssetError, publisherAssetErrorResponse, publisherAssetTelemetry } from "@/lib/publisherAssetOnboarding";
import { verifyPublicBotIdentity } from "@/lib/telegramBotIdentity";

type ExistingMiniAppRow = RowDataPacket & {
  id: number;
  user_id: number;
  is_deleted: boolean | number;
  status: string;
  miniapp_name: string;
  bot_id: string;
  telegram_bot_id: string;
  webapp_url: string;
  miniapp_url: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUserStatus(initData, { request });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        id,
        user_id,
        miniapp_name,
        miniapp_username,
        bot_id,
        telegram_bot_id,
        webapp_url,
        miniapp_url,
        CASE
          WHEN status = 'awaiting' THEN 'pending'
          WHEN status = 'monetized' THEN 'approved'
          ELSE status
        END as status,
        created_at,
        updated_at,
        marketplace_visible,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.parent_request_id IS NULL), 0) as mediation_request_count,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.impression_confirmed = 1), 0) as confirmed_impression_count,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.parent_request_id IS NULL), 0) as total_requests,
        COALESCE((SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = miniapps.id), 0) as total_impressions,
        COALESCE((SELECT SUM(ds.publisher_revenue) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = miniapps.id), 0) as total_revenue,
        CASE WHEN COALESCE((SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = miniapps.id), 0) > 0
          THEN COALESCE((SELECT SUM(ds.publisher_revenue) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = miniapps.id), 0)
            / (SELECT SUM(ds.impressions) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = miniapps.id) * 1000
          ELSE 0 END as average_cpm,
        NULLIF(GREATEST(
          COALESCE((SELECT MAX(mr.created_at) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(ds.updated_at) FROM miniapp_daily_stats ds WHERE ds.miniapp_id = miniapps.id), '1970-01-01 00:00:00'),
          COALESCE((SELECT MAX(iai.created_at) FROM miniapp_internal_ad_impressions iai WHERE iai.miniapp_id = miniapps.id), '1970-01-01 00:00:00')
        ), '1970-01-01 00:00:00') as last_activity_at,
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.parent_request_id IS NULL AND mr.final_result = 'no_fill'), 0) as no_fill_count,
        CASE
          WHEN COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.parent_request_id IS NULL), 0) > 0
            THEN (
              COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.impression_confirmed = 1), 0)
              / COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.parent_request_id IS NULL), 1)
            ) * 100
          ELSE 0
        END as fill_rate
       FROM miniapps
       WHERE user_id = ? AND is_deleted = FALSE
       ORDER BY created_at DESC`,
      [user.id]
    );

    const statsById = await getMiniAppAggregateStatsByIds(rows.map((row) => row.id));
    return NextResponse.json(rows.map((row) => ({
      ...row,
      ...(statsById.get(Number(row.id)) || {}),
    })));
  } catch (error: unknown) {
    console.error("Publisher Mini Apps GET Error:", error);
    const status = getAuthErrorStatus(error);
    return NextResponse.json({ error: errorMessage(error, "Failed to fetch Mini Apps") }, { status });
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  let publisherId: number | undefined;
  publisherAssetTelemetry("miniapp_onboarding", { requestId, stage: "attempt", result: "started" });
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const user = await authenticatePublisherAsset(request);
    publisherId = Number(user.id);
    publisherAssetTelemetry("miniapp_onboarding", { requestId, publisherId, stage: "auth", result: "success" });
    const input = validateMiniAppSubmission(await request.json());
    const identity = await verifyPublicBotIdentity(input.miniapp_username, input.bot_id);
    if (identity.id !== input.telegram_bot_id || identity.username.toLowerCase() !== input.miniapp_username.toLowerCase()) {
      throw new PublisherAssetError("BOT_ID_MISMATCH", "The Bot Username and Bot ID do not identify the same Telegram bot.");
    }
    input.miniapp_username = identity.username;
    input.bot_id = identity.id;
    input.telegram_bot_id = identity.id;
    publisherAssetTelemetry("miniapp_onboarding", { requestId, publisherId, stage: "telegram_identity", result: "success", botUsername: identity.username, telegramBotId: identity.id });

    const connection = await pool.getConnection();
    let id: number;
    let idempotent = false;
    let reactivated = false;
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query<ExistingMiniAppRow[]>(
        "SELECT id,user_id,is_deleted,status,miniapp_name,bot_id,telegram_bot_id,webapp_url,miniapp_url FROM miniapps WHERE miniapp_username = ? FOR UPDATE",
        [input.miniapp_username],
      );
      const current = existing[0];
      if (current && Number(current.user_id) !== Number(user.id)) throw new PublisherAssetError("MINIAPP_OWNED_BY_ANOTHER_PUBLISHER", "This Mini App belongs to another publisher account.", 409);
      const same = current && !current.is_deleted && current.miniapp_name === input.miniapp_name && String(current.bot_id) === input.bot_id && String(current.telegram_bot_id) === input.telegram_bot_id && current.webapp_url === input.webapp_url && current.miniapp_url === input.miniapp_url;
      if (same) { id = current.id; idempotent = true; }
      else if (current) {
        await connection.query(
        `UPDATE miniapps
         SET miniapp_name = ?, bot_id = ?, telegram_bot_id = ?, webapp_url = ?, miniapp_url = ?, status = 'pending',
             admin_approved_at = NULL, admin_approved_by = NULL, is_deleted = FALSE
         WHERE id = ? AND user_id = ?`,
          [input.miniapp_name, input.bot_id, input.telegram_bot_id, input.webapp_url, input.miniapp_url, current.id, user.id],
        );
        id = current.id; reactivated = Boolean(current.is_deleted);
      } else {
        const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO miniapps (user_id, miniapp_name, miniapp_username, bot_id, telegram_bot_id, webapp_url, miniapp_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [user.id, input.miniapp_name, input.miniapp_username, input.bot_id, input.telegram_bot_id, input.webapp_url, input.miniapp_url],
        );
        id = result.insertId;
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined); throw error;
    } finally { connection.release(); }
    publisherAssetTelemetry("miniapp_onboarding", { requestId, publisherId, stage: "persist", result: idempotent ? "idempotent_success" : reactivated ? "reactivated" : "success", botUsername: identity.username, telegramBotId: identity.id });
    if (!idempotent) after(async () => {
      try { await notifyMiniAppSubmitted(String(user.telegram_id), id, input.miniapp_name); } catch { /* post-commit only */ }
      try { await safeQueuePublisherWelcome(user.id); } catch { /* post-commit only */ }
    });
    const response = NextResponse.json({ success: true, id, already_registered: idempotent });
    response.headers.set("X-Request-Id", requestId);
    return response;
  } catch (error: unknown) {
    const status = error instanceof PublisherAssetError ? error.status : error instanceof MiniAppSubmissionValidationError
        ? 400
        : getAuthErrorStatus(error);
    const code = error instanceof PublisherAssetError ? error.code : "MINIAPP_CREATE_FAILED";
    publisherAssetTelemetry("miniapp_onboarding", { requestId, publisherId, stage: "response", result: "failed", code });
    const response = error instanceof PublisherAssetError ? publisherAssetErrorResponse(error) : NextResponse.json({ error: status === 401 || status === 403 ? "Please reopen AdsGalaxy to verify your session." : errorMessage(error, "Failed to submit Mini App") }, { status });
    response.headers.set("X-Request-Id", requestId);
    return response;
  }
}
