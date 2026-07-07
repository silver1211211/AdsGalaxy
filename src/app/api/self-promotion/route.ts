import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export const dynamic = "force-dynamic";

type PromoAd = {
  id: number;
  enabled: number;
  status: string;
  title: string;
  description: string;
  cta_text: string;
  cta_url: string;
  image_data_url?: string | null;
  countdown_seconds: number;
  frequency_hours: number;
  max_impressions_per_user?: number | null;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function safePromoPayload(ad: PromoAd) {
  return {
    id: Number(ad.id),
    title: ad.title,
    description: ad.description,
    cta_text: ad.cta_text,
    cta_url: ad.cta_url,
    image_url: ad.image_data_url || null,
    countdown_seconds: Math.max(1, Math.min(30, Number(ad.countdown_seconds || 5))),
  };
}

async function eligibleAdForUser(userId: number) {
  const [ads]: any = await pool.query(
    `SELECT *
     FROM self_promotion_ads
     WHERE enabled = 1
       AND status = 'active'
       AND (start_at IS NULL OR start_at <= NOW())
       AND (end_at IS NULL OR end_at >= NOW())
     ORDER BY id ASC
     LIMIT 1`
  );
  const ad = ads[0] as PromoAd | undefined;
  if (!ad) return { ad: null, reason: "no_active_ad" };

  const [[state]]: any = await pool.query(
    `SELECT
       MAX(CASE WHEN event_type = 'impression' THEN created_at ELSE NULL END) as last_shown_at,
       SUM(event_type = 'impression') as impressions
     FROM self_promotion_ad_events
     WHERE ad_id = ? AND user_id = ?`,
    [ad.id, userId]
  );

  const impressions = Number(state?.impressions || 0);
  if (ad.max_impressions_per_user && impressions >= Number(ad.max_impressions_per_user)) {
    return { ad: null, reason: "max_impressions_reached" };
  }

  if (state?.last_shown_at) {
    const lastShownAt = new Date(state.last_shown_at).getTime();
    const frequencyMs = Math.max(1, Number(ad.frequency_hours || 24)) * 60 * 60 * 1000;
    if (Date.now() - lastShownAt < frequencyMs) {
      return { ad: null, reason: "frequency_window" };
    }
  }

  return { ad, reason: "eligible" };
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { ad, reason } = await eligibleAdForUser(Number(user.id));
    if (!ad) return NextResponse.json({ eligible: false, reason });
    return NextResponse.json({ eligible: true, ad: safePromoPayload(ad) });
  } catch (error: any) {
    const status = getAuthErrorStatus(error);
    console.error("Self-promotion lookup failed", { status, error: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: status === 500 ? "Failed to load promotion" : "Unauthorized" }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json().catch(() => ({}));
    const adId = Number(body.ad_id || 0);
    const eventType = clean(body.event_type);
    if (!adId || !["impression", "click", "dismissal"].includes(eventType)) {
      return NextResponse.json({ error: "Invalid tracking event" }, { status: 400 });
    }

    const [ads]: any = await pool.query("SELECT id FROM self_promotion_ads WHERE id = ? LIMIT 1", [adId]);
    if (ads.length === 0) return NextResponse.json({ error: "Promotion not found" }, { status: 404 });

    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO self_promotion_ad_events (ad_id, user_id, event_type, metadata) VALUES (?, ?, ?, ?)",
      [adId, user.id, eventType, JSON.stringify({ source: "miniapp_dashboard" })]
    );

    return NextResponse.json({ success: result.affectedRows === 1 });
  } catch (error: any) {
    const status = getAuthErrorStatus(error);
    console.error("Self-promotion tracking failed", { status, error: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: status === 500 ? "Failed to record promotion event" : "Unauthorized" }, { status });
  }
}
