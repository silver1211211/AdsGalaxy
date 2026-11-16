import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import {
  buildAdvertiserCampaignStatistics,
  buildUnifiedNonChannelCampaignStatistics,
  normalizeCampaignStatisticsRange,
} from "@/lib/advertiserCampaignStatistics";

export const dynamic = "force-dynamic";

type CampaignRow = RowDataPacket & {
  id: number;
  public_id: number | null;
  type: "views" | "clicks";
  campaign_kind: string;
  channel_spend: string | number;
  teaser_mode: string | null;
  financial_billing_mode: string | null;
  smart_reach_effective_cpm: string | null;
  smart_reach_max_cpm: string | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthenticatedUserStatus(
      request.headers.get("x-telegram-init-data"),
      { request },
    );
    const { id } = await params;
    if (!/^\d+$/.test(id) || Number(id) <= 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const kind = new URL(request.url).searchParams.get("kind") || "channel";
    if (["miniapp", "bot", "growth"].includes(kind)) {
      const ownershipSql = kind === "miniapp"
        ? "SELECT id FROM miniapp_rewarded_campaigns WHERE id=? AND advertiser_id=? LIMIT 1"
        : kind === "bot"
          ? "SELECT id FROM campaigns WHERE id=? AND user_id=? AND type='broadcast' LIMIT 1"
          : "SELECT id FROM campaigns WHERE id=? AND user_id=? AND campaign_kind='channel_growth' LIMIT 1";
      const [owned] = await pool.query<RowDataPacket[]>(ownershipSql, [id, user.id]);
      if (!owned[0]) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      const range = normalizeCampaignStatisticsRange(new URL(request.url).searchParams);
      const report = await buildUnifiedNonChannelCampaignStatistics(Number(id), kind as "miniapp" | "bot" | "growth", range);
      return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }

    const [campaigns] = await pool.query<CampaignRow[]>(
      `SELECT id,public_id,type,campaign_kind,channel_spend,teaser_mode,
              financial_billing_mode,smart_reach_effective_cpm,smart_reach_max_cpm
       FROM campaigns
       WHERE id=? AND user_id=? AND type IN ('views','clicks')
         AND campaign_kind IN ('channel','channel_growth')
       LIMIT 1`,
      [id, user.id],
    );
    const campaign = campaigns[0];
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const range = normalizeCampaignStatisticsRange(new URL(request.url).searchParams);
    const report = await buildAdvertiserCampaignStatistics(campaign, range);
    let smartReach: null | {click_spend:string;impression_spend:string;effective_cpm:string;maximum_cpm:string}=null;
    let smartImpressionByDay=new Map<string,number>();
    if(campaign.financial_billing_mode==="smart_reach"){
      const from=range.from ? `${range.from} 00:00:00` : "1000-01-01 00:00:00";
      const until=`${range.to} 23:59:59.999999`;
      const [clickRows]=await pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(advertiser_debit),0) amount
        FROM channel_unified_settlement_events WHERE campaign_id=? AND settlement_type='cpc_click'
          AND status='settled' AND created_at>=? AND created_at<=?`,[id,from,until]);
      const [impressionRows]=await pool.query<RowDataPacket[]>(`SELECT COALESCE(SUM(advertiser_charge),0) amount
        FROM channel_smart_reach_impression_billings WHERE campaign_id=?
          AND created_at>=? AND created_at<=?`,[id,from,until]);
      const [impressionDays]=await pool.query<RowDataPacket[]>(`SELECT DATE_FORMAT(created_at,'%Y-%m-%d') day,
          SUM(advertiser_charge) amount FROM channel_smart_reach_impression_billings
          WHERE campaign_id=? AND created_at>=? AND created_at<=?
          GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 31`,[id,from,until]);
      smartImpressionByDay=new Map(impressionDays.map(row=>[String(row.day),Number(row.amount||0)]));
      smartReach={click_spend:String(clickRows[0]?.amount||"0"),
        impression_spend:String(impressionRows[0]?.amount||"0"),
        effective_cpm:String(campaign.smart_reach_effective_cpm||"0.10"),
        maximum_cpm:String(campaign.smart_reach_max_cpm||"0.20")};
    }
    const impressionSpend=Number(smartReach?.impression_spend||0);
    return NextResponse.json({...report,smart_reach:smartReach,
      totals:smartReach?{...report.totals,spend:Number(report.totals.spend)+impressionSpend}:report.totals,
      daily_rows:smartReach?report.daily_rows.map(row=>({...row,
        spend:Number(row.spend)+Number(smartImpressionByDay.get(String(row.date))||0)})):report.daily_rows,
      data_available:report.data_available||impressionSpend>0}, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Advertiser campaign statistics failed", {
      code: error instanceof Error ? error.name : "UNKNOWN",
    });
    return NextResponse.json(
      { error: "Unable to load campaign statistics." },
      { status: getAuthErrorStatus(error) },
    );
  }
}
