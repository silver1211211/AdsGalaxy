/* eslint-disable @typescript-eslint/no-explicit-any -- legacy Mini App campaign payloads are not schema-generated */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { getMiniAppPublisherCpmSettings, validateAdvertiserCpmBid } from "@/lib/miniappPublisherCpmEngine";
import { replaceCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { normalizeMiniAppCampaignCategories, validateMiniAppCampaignText } from "@/lib/miniappCampaignValidation";
import { validateOptionalDailyBudget } from "@/lib/campaignBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const id = parseInt(rawId);
    const [rows]: any = await pool.query(
      `SELECT id, campaign_name, title, description, cta_text, title_color, body_color,
         categories, image_url, logo_url, landing_url, budget, remaining_budget,
         advertiser_cpm_bid, campaign_budget_mode, daily_budget_mode, target_countries,
         countries, languages, vpn_policy, device_policy, os_policy, start_at, end_at,
         daily_budget_limit, frequency_cap_per_user, direct_placement_mode,
         direct_inventory_scope, direct_inventory_metadata, status, created_at, updated_at
       FROM miniapp_rewarded_campaigns WHERE id = ? AND advertiser_id = ?`,
      [id, user.id]
    );
    if (!rows.length) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    try {
      const [exclusions]: any = await pool.query(
        "SELECT normalized_identifier FROM campaign_inventory_exclusions WHERE campaign_type = 'miniapp' AND campaign_id = ? AND inventory_type = 'miniapp' ORDER BY id",
        [id]
      );
      rows[0].excluded_inventory = exclusions.map((row: any) => row.normalized_identifier);
    } catch (error: any) {
      if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
      rows[0].excluded_inventory = [];
    }
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
      "SELECT id, advertiser_id, campaign_name, title, description, landing_url, image_url, logo_url, budget, remaining_budget, status, pause_reason, advertiser_cpm_bid, approved_at FROM miniapp_rewarded_campaigns WHERE id = ?",
      [id]
    );
    if (!rows.length) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (rows[0].advertiser_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const prev = rows[0];

    const body = await request.json();

    if (body.action === "pause") {
      const [pauseResult]: any = await pool.query(
        `UPDATE miniapp_rewarded_campaigns
         SET status = 'paused', pause_reason = 'advertiser_paused', updated_at = NOW()
         WHERE id = ? AND advertiser_id = ? AND status = 'approved'`,
        [id, user.id]
      );
      if (pauseResult.affectedRows !== 1) return NextResponse.json({ error: "Campaign cannot be paused in its current status" }, { status: 400 });
      return NextResponse.json({ success: true, status: "paused" });
    }

    if (body.excluded_inventory !== undefined) {
      await replaceCampaignExclusions(pool, { campaignType: "miniapp", campaignId: id, inventoryType: "miniapp", identifiers: body.excluded_inventory });
    }

    if (body.action === "resume") {
      const [resumeResult]: any = await pool.query(
        `UPDATE miniapp_rewarded_campaigns c
         JOIN users u ON u.id = c.advertiser_id
         SET c.status = 'approved', c.pause_reason = NULL
         WHERE c.id = ? AND c.advertiser_id = ?
           AND c.status = 'paused' AND c.pause_reason IN ('insufficient_balance', 'advertiser_paused', 'budget_exhausted')
           AND c.remaining_budget >= (c.advertiser_cpm_bid / 1000)
           AND u.ad_balance >= (c.advertiser_cpm_bid / 1000)`,
        [id, user.id]
      );
      if (resumeResult.affectedRows !== 1) {
        return NextResponse.json({ error: "Top up the ad balance before resuming this campaign" }, { status: 400 });
      }
      return NextResponse.json({ success: true, status: "approved" });
    }

    const str = (v: unknown, fallback = "") => String(v ?? fallback).trim();
    const updates: Record<string, any> = {};

    if (body.campaign_name !== undefined) updates.campaign_name = str(body.campaign_name);
    if (body.title !== undefined) updates.title = str(body.title);
    if (body.description !== undefined) updates.description = str(body.description);
    if (body.cta_text !== undefined) updates.cta_text = str(body.cta_text) || "Learn More";
    if (body.image_url !== undefined) updates.image_url = str(body.image_url);
    if (body.logo_url !== undefined) updates.logo_url = str(body.logo_url) || null;
    if (body.landing_url !== undefined) updates.landing_url = str(body.landing_url);
    if (body.categories !== undefined) updates.categories = JSON.stringify(normalizeMiniAppCampaignCategories(body.categories));
    if (body.countries !== undefined) updates.countries = JSON.stringify(Array.isArray(body.countries) ? body.countries : (str(body.countries) ? str(body.countries).split(",").map((s: string) => s.trim()).filter(Boolean) : []));
    if (body.languages !== undefined) updates.languages = JSON.stringify(Array.isArray(body.languages) ? body.languages : (str(body.languages) ? str(body.languages).split(",").map((s: string) => s.trim()).filter(Boolean) : []));
    if (body.vpn_policy !== undefined) updates.vpn_policy = str(body.vpn_policy) || "allow_all";
    if (body.device_policy !== undefined) updates.device_policy = str(body.device_policy) || "all";
    if (body.os_policy !== undefined) updates.os_policy = str(body.os_policy) || "all";
    if (body.start_at !== undefined) updates.start_at = str(body.start_at) || null;
    if (body.end_at !== undefined) updates.end_at = str(body.end_at) || null;
    if (body.daily_budget_limit !== undefined) {
      updates.daily_budget_limit = validateOptionalDailyBudget(body.daily_budget_limit, Number(prev.budget));
    }
    if (body.frequency_cap_per_user !== undefined) updates.frequency_cap_per_user = str(body.frequency_cap_per_user) || null;
    if (body.daily_budget_mode !== undefined) updates.daily_budget_mode = body.daily_budget_mode === "unlimited" ? "unlimited" : "custom";
    if (body.advertiser_cpm_bid !== undefined) {
      const cpm = parseFloat(str(body.advertiser_cpm_bid));
      const settings = await getMiniAppPublisherCpmSettings();
      validateAdvertiserCpmBid(cpm, settings);
      updates.advertiser_cpm_bid = cpm;
      updates.admin_cpm = cpm;
    }

    if (!Object.keys(updates).length && body.excluded_inventory === undefined) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    if (!Object.keys(updates).length) return NextResponse.json({ success: true, resubmitted: false });
    updates.campaign_budget_mode = "custom";

    validateMiniAppCampaignText({
      campaignName: String(updates.campaign_name ?? prev.campaign_name),
      title: String(updates.title ?? prev.title),
      description: String(updates.description ?? prev.description),
    });

    if (updates.landing_url && !/^https?:\/\//i.test(updates.landing_url)) {
      return NextResponse.json({ error: "Landing URL must start with https://" }, { status: 400 });
    }

    const urlChanged = updates.landing_url && updates.landing_url !== prev.landing_url;
    const imageChanged = updates.image_url !== undefined && updates.image_url !== prev.image_url;
    const logoChanged = updates.logo_url !== undefined && updates.logo_url !== prev.logo_url;
    const resubmitted = !!(urlChanged || imageChanged || logoChanged);

    if (resubmitted) {
      updates.creative_review_status = "pending";
      updates.status = "pending";
      updates.requires_re_moderation = 1;
      updates.previously_approved_at = prev.approved_at || null;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
    const values = [...Object.values(updates), id];
    await pool.query(`UPDATE miniapp_rewarded_campaigns SET ${setClauses}, updated_at = NOW() WHERE id = ?`, values);

    return NextResponse.json({ success: true, resubmitted });
  } catch (error: any) {
    console.error("Miniapp campaign PATCH error:", error);
    const status = getAuthErrorStatus(error);
    const message = status === 403 ? "Unauthorized" : (error.message || "Failed to update campaign. Please try again.");
    return NextResponse.json({ error: message }, { status });
  }
}
