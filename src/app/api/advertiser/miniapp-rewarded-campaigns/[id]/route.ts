import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const id = parseInt(rawId);
    const [rows]: any = await pool.query(
      "SELECT * FROM miniapp_rewarded_campaigns WHERE id = ? AND advertiser_id = ?",
      [id, user.id]
    );
    if (!rows.length) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (error: any) {
    console.error("Miniapp campaign GET error:", error);
    const status = getAuthErrorStatus(error);
    return NextResponse.json({ error: status === 403 ? "Unauthorized" : "Failed to fetch campaign" }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const id = parseInt(rawId);
    if (!id) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });

    const [rows]: any = await pool.query(
      "SELECT id, advertiser_id, landing_url, image_url, status FROM miniapp_rewarded_campaigns WHERE id = ?",
      [id]
    );
    if (!rows.length) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (rows[0].advertiser_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const prev = rows[0];

    const body = await request.json();

    const str = (v: unknown, fallback = "") => String(v ?? fallback).trim();
    const updates: Record<string, any> = {};

    if (body.campaign_name !== undefined) updates.campaign_name = str(body.campaign_name);
    if (body.title !== undefined) updates.title = str(body.title);
    if (body.description !== undefined) updates.description = str(body.description);
    if (body.cta_text !== undefined) updates.cta_text = str(body.cta_text) || "Learn More";
    if (body.image_url !== undefined) updates.image_url = str(body.image_url);
    if (body.landing_url !== undefined) updates.landing_url = str(body.landing_url);
    if (body.postback_url !== undefined) updates.postback_url = str(body.postback_url);
    if (body.categories !== undefined) updates.categories = JSON.stringify(Array.isArray(body.categories) ? body.categories : []);
    if (body.countries !== undefined) updates.countries = JSON.stringify(Array.isArray(body.countries) ? body.countries : (str(body.countries) ? str(body.countries).split(",").map((s: string) => s.trim()).filter(Boolean) : []));
    if (body.languages !== undefined) updates.languages = JSON.stringify(Array.isArray(body.languages) ? body.languages : (str(body.languages) ? str(body.languages).split(",").map((s: string) => s.trim()).filter(Boolean) : []));
    if (body.vpn_policy !== undefined) updates.vpn_policy = str(body.vpn_policy) || "allow_all";
    if (body.device_policy !== undefined) updates.device_policy = str(body.device_policy) || "all";
    if (body.os_policy !== undefined) updates.os_policy = str(body.os_policy) || "all";
    if (body.start_at !== undefined) updates.start_at = str(body.start_at) || null;
    if (body.end_at !== undefined) updates.end_at = str(body.end_at) || null;
    if (body.daily_budget_limit !== undefined) updates.daily_budget_limit = str(body.daily_budget_limit) || null;
    if (body.frequency_cap_per_user !== undefined) updates.frequency_cap_per_user = str(body.frequency_cap_per_user) || null;
    if (body.campaign_budget_mode !== undefined) updates.campaign_budget_mode = body.campaign_budget_mode === "unlimited" ? "unlimited" : "custom";
    if (body.daily_budget_mode !== undefined) updates.daily_budget_mode = body.daily_budget_mode === "unlimited" ? "unlimited" : "custom";
    if (body.advertiser_cpm_bid !== undefined) {
      const cpm = parseFloat(str(body.advertiser_cpm_bid));
      if (!isNaN(cpm) && cpm > 0) updates.advertiser_cpm_bid = cpm;
    }
    if (body.budget !== undefined && updates.campaign_budget_mode !== "unlimited") {
      const budget = parseFloat(str(body.budget));
      if (!isNaN(budget) && budget > 0) updates.budget = budget;
    }

    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    if (updates.landing_url && !/^https?:\/\//i.test(updates.landing_url)) {
      return NextResponse.json({ error: "Landing URL must start with https://" }, { status: 400 });
    }

    const urlChanged = updates.landing_url && updates.landing_url !== prev.landing_url;
    const imageChanged = updates.image_url && updates.image_url !== prev.image_url;
    const resubmitted = !!(urlChanged || imageChanged);

    if (resubmitted) {
      updates.creative_review_status = "pending";
      updates.status = "pending";
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
    const values = [...Object.values(updates), id];
    await pool.query(`UPDATE miniapp_rewarded_campaigns SET ${setClauses}, updated_at = NOW() WHERE id = ?`, values);

    return NextResponse.json({ success: true, resubmitted });
  } catch (error: any) {
    console.error("Miniapp campaign PATCH error:", error);
    const status = getAuthErrorStatus(error);
    const message = status === 403 ? "Unauthorized" : "Failed to update campaign. Please try again.";
    return NextResponse.json({ error: message }, { status });
  }
}
