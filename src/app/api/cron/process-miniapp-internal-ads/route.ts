import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

type CampaignRow = RowDataPacket & {
  id: number;
};

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("process-miniapp-internal-ads", 900);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Mini App internal ads cron is already running" }, { status: 409 });
  }

  try {
    const [completed] = await pool.query(`
      UPDATE miniapp_rewarded_campaigns
      SET status = 'completed'
      WHERE status = 'approved'
        AND remaining_budget <= 0
        AND campaign_budget_mode != 'unlimited'
    `);

    const [readyCampaigns] = await pool.query<CampaignRow[]>(`
      SELECT id
      FROM miniapp_rewarded_campaigns
      WHERE status = 'approved'
        AND (remaining_budget > 0 OR campaign_budget_mode = 'unlimited')
        AND admin_cpm > 0
      ORDER BY created_at ASC
      LIMIT 100
    `);

    return NextResponse.json({
      success: true,
      ready_campaigns: readyCampaigns.length,
      completed_exhausted: (completed as any).affectedRows || 0,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Mini App internal ad processing failed" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
