import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  pullMainCampaignNumberToSilver,
  reportSilverApiError,
  requireSilverAdmin,
} from "@/lib/silverCampaignControl";

export async function GET(request: Request) {
  const { response } = await requireSilverAdmin();
  if (response) return response;
  const searchParams = new URL(request.url).searchParams;
  const search = String(searchParams.get("search") || "").trim();
  const status = String(searchParams.get("status") || "all");
  const trust = String(searchParams.get("trust") || "all");
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "10", 10) || 10));
  const offset = (page - 1) * limit;
  const term = `%${search}%`;
  const filters = ["1=1"];
  const filterParams: Array<string> = [];
  if (search) {
    filters.push("(CAST(c.id AS CHAR)=? OR c.name LIKE ? OR u.username LIKE ?)");
    filterParams.push(search, term, term);
  }
  if (status !== "all") {
    filters.push("c.status=?");
    filterParams.push(status);
  }
  if (trust !== "all") {
    filters.push("COALESCE(u.advertiser_trust_level,'new')=?");
    filterParams.push(trust);
  }

  const [[countRow]] = await pool.query<Array<RowDataPacket & { total: number | string }>>(
    `SELECT COUNT(*) total
     FROM campaign_admin_isolation cai
     JOIN campaigns c ON c.id=cai.campaign_id
     LEFT JOIN users u ON u.id=c.user_id
     WHERE cai.management_scope='silver' AND ${filters.join(" AND ")}`,
    filterParams,
  );
  const [campaigns] = await pool.query<Array<RowDataPacket>>(
    `SELECT c.*,u.username advertiser_username,u.username,u.first_name,u.last_name,u.telegram_id,
       COALESCE(u.advertiser_trust_level,'new') advertiser_trust_level,
       c.silver_display_number,
       c.silver_display_number main_display_number,
       c.id original_campaign_id,
       'campaign' campaign_kind,c.campaign_kind source_campaign_kind,
       CASE WHEN c.type='broadcast' THEN 'BOT' ELSE 'CHANNEL' END type_label,
       GREATEST(COALESCE(c.total_budget,0)-COALESCE(c.channel_spend,0),0) calculated_remaining,
       c.budget remaining_budget,COALESCE(c.channel_spend,0) spend,
       COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id=c.id),0) impressions,
       COALESCE((SELECT COUNT(*) FROM campaign_clicks cc JOIN campaign_posts cp2 ON cp2.id=cc.post_id WHERE cp2.campaign_id=c.id),0) clicks,
       CASE WHEN c.type='clicks' AND COALESCE((SELECT COUNT(*) FROM campaign_clicks cc JOIN campaign_posts cp3 ON cp3.id=cc.post_id WHERE cp3.campaign_id=c.id),0)>0
         THEN COALESCE(c.channel_spend,0)/COALESCE((SELECT COUNT(*) FROM campaign_clicks cc JOIN campaign_posts cp4 ON cp4.id=cc.post_id WHERE cp4.campaign_id=c.id),1)
         ELSE 0 END average_cpc
     FROM (
       SELECT base_campaign.*,cai.pulled_at,
         ROW_NUMBER() OVER (ORDER BY cai.pulled_at,base_campaign.id) silver_display_number
       FROM campaign_admin_isolation cai
       JOIN campaigns base_campaign ON base_campaign.id=cai.campaign_id
       WHERE cai.management_scope='silver'
     ) c
     LEFT JOIN users u ON u.id=c.user_id
     WHERE ${filters.join(" AND ")}
     ORDER BY c.pulled_at,c.id LIMIT ? OFFSET ?`,
    [...filterParams, limit, offset],
  );
  const [[stats]] = await pool.query<Array<RowDataPacket>>(
    `SELECT COUNT(*) managed_campaigns,SUM(c.status='active') active_campaigns,
       (SELECT COUNT(*) FROM silver_ad_exempt_users WHERE active=1) exempt_users,
       (SELECT LOWER(COALESCE(value,'true'))='true' FROM settings WHERE \`key\`='silver_delivery_enabled' LIMIT 1) delivery_enabled
     FROM campaign_admin_isolation cai JOIN campaigns c ON c.id=cai.campaign_id WHERE cai.management_scope='silver'`,
  );
  const total = Number(countRow?.total || 0);
  return NextResponse.json({ campaigns, stats: stats || {}, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
}

export async function POST(request: Request) {
  const { admin, response } = await requireSilverAdmin();
  if (response) return response;
  let mainDisplayNumber = 0;
  try {
    const body = await request.json();
    mainDisplayNumber = Number(body.main_campaign_number);
    if (!Number.isInteger(mainDisplayNumber) || mainDisplayNumber <= 0) {
      return NextResponse.json(
        { error: "Enter a valid Main campaign number." },
        { status: 400 },
      );
    }
    return NextResponse.json({
      success: true,
      ...(await pullMainCampaignNumberToSilver(
        mainDisplayNumber,
        Number(admin?.id),
      )),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PULL_FAILED";
    if (code === "MAIN_CAMPAIGN_NUMBER_UNAVAILABLE") {
      return NextResponse.json(
        {
          error: `Main campaign #${mainDisplayNumber} is not currently available.`,
        },
        { status: 404 },
      );
    }
    if (
      code === "CAMPAIGN_LIST_CHANGED" ||
      code === "CAMPAIGN_MANAGEMENT_BUSY"
    ) {
      return NextResponse.json(
        { error: "Campaign list changed. Refresh and try again." },
        { status: 409 },
      );
    }
    reportSilverApiError("Unable to pull campaign", error);
    return NextResponse.json(
      { error: "Unable to pull this campaign. Please try again." },
      { status: 500 },
    );
  }
}
