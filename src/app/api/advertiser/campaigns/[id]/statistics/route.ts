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
  type: "views" | "clicks";
  campaign_kind: string;
  channel_spend: string | number;
  teaser_mode: string | null;
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
      `SELECT id,type,campaign_kind,channel_spend,teaser_mode
       FROM campaigns
       WHERE id=? AND user_id=? AND type IN ('views','clicks')
         AND campaign_kind='channel'
       LIMIT 1`,
      [id, user.id],
    );
    const campaign = campaigns[0];
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const range = normalizeCampaignStatisticsRange(new URL(request.url).searchParams);
    const report = await buildAdvertiserCampaignStatistics(campaign, range);
    return NextResponse.json(report, {
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
