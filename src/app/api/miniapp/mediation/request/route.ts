import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { recordMiniappAdOpportunity } from "@/lib/miniappMonetagProtection";
import { createMediationAttempt } from "@/lib/miniappMediationEngine";
import type { MiniAppAdFormat } from "@/lib/miniappNetworkAdapters";
import { assertMiniAppOwnerBetaAccess, MiniAppBetaAccessError } from "@/lib/miniappBetaAccess";

type MiniAppRow = RowDataPacket & {
  id: number;
  status: string;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeAdFormat(value: unknown): MiniAppAdFormat {
  const adFormat = cleanText(value) || "rewarded";
  if (adFormat !== "rewarded" && adFormat !== "interstitial" && adFormat !== "banner") {
    throw new Error("Invalid ad_format");
  }
  return adFormat;
}

function normalizeCountry(value: unknown) {
  const country = cleanText(value).toUpperCase();
  if (!country) return null;
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("Country must be a 2-letter country code");
  }
  return country;
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();

  try {
    const body = await request.json();
    const miniappId = Number(body.miniapp_id);
    const telegramUserId = cleanText(body.telegram_user_id);
    const country = normalizeCountry(body.country);
    const adFormat = normalizeAdFormat(body.ad_format);

    if (!Number.isInteger(miniappId) || miniappId <= 0) {
      return NextResponse.json({ error: "Valid miniapp_id is required" }, { status: 400 });
    }

    if (!telegramUserId) {
      return NextResponse.json({ error: "telegram_user_id is required" }, { status: 400 });
    }

    const initData = request.headers.get("x-telegram-init-data");
    if (initData) {
      const authenticatedUser = await getAuthenticatedUser(initData);
      if (String(authenticatedUser.telegram_id) !== telegramUserId) {
        return NextResponse.json({ error: "telegram_user_id does not match authenticated user" }, { status: 403 });
      }
    }

    const [miniapps] = await pool.query<MiniAppRow[]>(
      "SELECT id, status FROM miniapps WHERE id = ? AND is_deleted = FALSE",
      [miniappId]
    );

    if (miniapps.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    if (miniapps[0].status !== "approved" && miniapps[0].status !== "monetized") {
      return NextResponse.json({ error: "Mini App is not approved for mediation" }, { status: 403 });
    }

    await assertMiniAppOwnerBetaAccess(miniappId);

    await conn.beginTransaction();

    const monetagProtection = await recordMiniappAdOpportunity(miniappId, telegramUserId, conn);
    const decision = await createMediationAttempt({
      conn,
      miniappId,
      telegramUserId,
      country,
      adFormat,
    });

    await conn.commit();

    if (!decision.success) {
      return NextResponse.json({
        success: false,
        error_code: decision.error_code,
        message: "No ad available right now.",
        request_id: decision.request_id,
        enabled_networks: decision.enabled_networks,
        attempted_networks: decision.attempted_networks,
        skipped_networks: decision.skipped_networks,
        fallback_available: false,
        ad_format: decision.ad_format,
        decision_reason: decision.decision_reason,
        monetag_protection: monetagProtection,
      }, { status: 200 });
    }

    return NextResponse.json({
      success: true,
      miniapp_id: miniappId,
      selected_network: decision.selected_network,
      network_placement_id: decision.network_placement_id || "",
      internal_ad: decision.internal_ad || null,
      enabled_networks: decision.enabled_networks,
      candidate_networks: decision.candidate_networks,
      attempted_networks: decision.attempted_networks,
      skipped_networks: decision.skipped_networks,
      fallback_attempts: decision.fallback_attempts,
      fallback_available: decision.fallback_available,
      request_id: decision.request_id,
      ad_format: decision.ad_format,
      decision_reason: decision.decision_reason,
      monetag_protection: monetagProtection,
    });
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {
      // Transaction may not have started.
    }

    const message = error?.message || "Failed to create mediation request";
    const status = error instanceof MiniAppBetaAccessError
      ? 403
      : message.startsWith("Unauthorized") || message.startsWith("Invalid initData")
        ? 401
        : 400;
    return NextResponse.json({ error: message }, { status });
  } finally {
    conn.release();
  }
}
