import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function clean(value: unknown) {
  return String(value || "").trim();
}

function intInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function nullableDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error("Invalid date value"), { statusCode: 400 });
  }
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function validateUrl(value: unknown) {
  const text = clean(value);
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("CTA URL must use http or https");
    }
    return url.toString();
  } catch {
    throw Object.assign(new Error("CTA URL must be a valid http/https URL"), { statusCode: 400 });
  }
}

async function getActiveAd() {
  const [rows]: any = await pool.query("SELECT * FROM self_promotion_ads ORDER BY id ASC LIMIT 1");
  return rows[0] || null;
}

export async function GET() {
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const ad = await getActiveAd();
    const [[stats]]: any = await pool.query(
      `SELECT
         SUM(event_type = 'impression') as impressions,
         SUM(event_type = 'click') as clicks,
         SUM(event_type = 'dismissal') as dismissals,
         MAX(created_at) as last_event_at
       FROM self_promotion_ad_events
       WHERE ad_id = ?`,
      [ad?.id || 0]
    );

    const impressions = Number(stats?.impressions || 0);
    const clicks = Number(stats?.clicks || 0);
    return NextResponse.json({
      ad,
      stats: {
        impressions,
        clicks,
        dismissals: Number(stats?.dismissals || 0),
        ctr: impressions > 0 ? clicks / impressions : 0,
        last_event_at: stats?.last_event_at || null,
      },
    });
  } catch (error) {
    console.error("Admin Self Promotion GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const contentType = request.headers.get("content-type") || "";
    const input: Record<string, unknown> = {};
    let imageDataUrl: string | null | undefined;
    let imageMimeType: string | null | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      for (const [key, value] of formData.entries()) {
        if (key !== "image") input[key] = value;
      }
      const image = formData.get("image");
      if (image instanceof File && image.size > 0) {
        if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
          return NextResponse.json({ error: "Image must be PNG, JPG, or WEBP" }, { status: 400 });
        }
        if (image.size > MAX_IMAGE_BYTES) {
          return NextResponse.json({ error: "Image cannot exceed 1MB" }, { status: 400 });
        }
        const bytes = Buffer.from(await image.arrayBuffer());
        imageDataUrl = `data:${image.type};base64,${bytes.toString("base64")}`;
        imageMimeType = image.type;
      }
      if (clean(input.remove_image) === "1") {
        imageDataUrl = null;
        imageMimeType = null;
      }
    } else {
      Object.assign(input, await request.json());
    }

    const title = clean(input.title);
    const description = clean(input.description);
    const ctaText = clean(input.cta_text);
    const ctaUrl = validateUrl(input.cta_url);
    if (!title || !description || !ctaText) {
      return NextResponse.json({ error: "Title, description, and CTA text are required" }, { status: 400 });
    }

    const enabled = clean(input.enabled) === "1" || input.enabled === true ? 1 : 0;
    const status = clean(input.status) || "active";
    if (!["active", "paused", "draft"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const countdownSeconds = intInRange(input.countdown_seconds, 5, 1, 30);
    const frequencyHours = intInRange(input.frequency_hours, 24, 1, 720);
    const maxImpressions = clean(input.max_impressions_per_user)
      ? intInRange(input.max_impressions_per_user, 1, 1, 1000)
      : null;
    const startAt = nullableDate(input.start_at);
    const endAt = nullableDate(input.end_at);

    const current = await getActiveAd();
    if (!current) {
      await pool.query(
        `INSERT INTO self_promotion_ads
          (enabled, status, title, description, cta_text, cta_url, image_data_url, image_mime_type, countdown_seconds, frequency_hours, start_at, end_at, max_impressions_per_user)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [enabled, status, title, description, ctaText, ctaUrl, imageDataUrl ?? null, imageMimeType ?? null, countdownSeconds, frequencyHours, startAt, endAt, maxImpressions]
      );
    } else {
      await pool.query(
        `UPDATE self_promotion_ads
         SET enabled = ?, status = ?, title = ?, description = ?, cta_text = ?, cta_url = ?,
             image_data_url = CASE WHEN ? THEN ? ELSE image_data_url END,
             image_mime_type = CASE WHEN ? THEN ? ELSE image_mime_type END,
             countdown_seconds = ?, frequency_hours = ?, start_at = ?, end_at = ?, max_impressions_per_user = ?
         WHERE id = ?`,
        [
          enabled,
          status,
          title,
          description,
          ctaText,
          ctaUrl,
          imageDataUrl !== undefined ? 1 : 0,
          imageDataUrl,
          imageMimeType !== undefined ? 1 : 0,
          imageMimeType,
          countdownSeconds,
          frequencyHours,
          startAt,
          endAt,
          maxImpressions,
          current.id,
        ]
      );
    }

    const updated = await getActiveAd();
    await recordAdminActionAudit({
      adminId: admin?.id,
      action: "self_promotion_ad_updated",
      entityType: "self_promotion_ad",
      entityId: updated?.id,
      metadata: { enabled, status, cta_url: ctaUrl },
    });

    return NextResponse.json({ success: true, ad: updated });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("Admin Self Promotion PUT Error:", error?.message || error);
    return NextResponse.json({ error: status === 500 ? "Internal Server Error" : error.message }, { status });
  }
}
