import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { assertMiniAppBetaAccess, MiniAppBetaAccessError } from "@/lib/miniappBetaAccess";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function validateMiniAppInput(body: Record<string, unknown>) {
  const miniapp_name = cleanText(body.miniapp_name);
  const miniapp_username = cleanText(body.miniapp_username).replace(/^@/, "");
  const bot_id = cleanText(body.bot_id);
  const webapp_url = cleanText(body.webapp_url);
  const miniapp_url = cleanText(body.miniapp_url);

  if (!miniapp_name || !miniapp_username || !bot_id || !webapp_url || !miniapp_url) {
    throw new Error("All Mini App fields are required");
  }

  return { miniapp_name, miniapp_username, bot_id, webapp_url, miniapp_url };
}

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
        COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.final_result = 'no_fill'), 0) as no_fill_count,
        CASE
          WHEN COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id), 0) > 0
            THEN (
              COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.impression_confirmed = 1), 0)
              / COALESCE((SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id), 1)
            ) * 100
          ELSE 0
        END as fill_rate,
        COALESCE((SELECT GROUP_CONCAT(network_name ORDER BY FIELD(network_name, 'AdsGram', 'Monetag', 'AdExium', 'RichAds') SEPARATOR ', ') FROM miniapp_ad_networks mn WHERE mn.miniapp_id = miniapps.id AND mn.enabled = TRUE), '') as enabled_network_names,
        COALESCE((SELECT COUNT(*) FROM miniapp_network_health mh WHERE mh.miniapp_id = miniapps.id AND mh.temporarily_disabled_until IS NOT NULL AND mh.temporarily_disabled_until > NOW()), 0) as temporarily_disabled_network_count,
        COALESCE((SELECT SUM(mh.recent_failures) FROM miniapp_network_health mh WHERE mh.miniapp_id = miniapps.id), 0) as recent_network_failures,
        COALESCE((SELECT
          CASE
            WHEN fs.locked_until IS NOT NULL AND fs.locked_until > NOW() THEN 'Locked'
            WHEN fs.next_allowed_opportunity > fs.opportunity_count THEN 'Delayed'
            ELSE 'Active'
          END
         FROM miniapp_network_frequency_state fs
         WHERE fs.miniapp_id = miniapps.id AND fs.network_name = 'Monetag'), 'Active') as monetag_status,
        COALESCE((SELECT fs.opportunity_count FROM miniapp_network_frequency_state fs WHERE fs.miniapp_id = miniapps.id AND fs.network_name = 'Monetag'), 0) as monetag_opportunity_count,
        COALESCE((SELECT fs.next_allowed_opportunity FROM miniapp_network_frequency_state fs WHERE fs.miniapp_id = miniapps.id AND fs.network_name = 'Monetag'), 15) as monetag_next_allowed_opportunity,
        (SELECT fs.locked_until FROM miniapp_network_frequency_state fs WHERE fs.miniapp_id = miniapps.id AND fs.network_name = 'Monetag') as monetag_locked_until
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
    const input = validateMiniAppInput(await request.json());

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
    const status = error instanceof MiniAppBetaAccessError ? 403 : getAuthErrorStatus(error);
    return NextResponse.json({ error: error.message || "Failed to submit Mini App" }, { status });
  }
}
