import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdminPermission("read");
  if (response) return response;
  const channelId = Number((await params).id);
  if (!Number.isInteger(channelId) || channelId <= 0) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });

  const [channels] = await pool.query<RowDataPacket[]>(
    `SELECT ch.id,ch.user_id publisher_id,ch.title,ch.username,ch.chat_id,ch.channel_type,ch.status,ch.is_deleted,
       ch.under_review,ch.publisher_trust_score trust_score,ch.channel_fraud_risk_score risk_score,
       ch.traffic_quality_score,ch.publisher_quality_index pqi,ch.trust_score_frozen_until,
       ch.settlement_excluded_until,ch.settlement_exclusion_reason,ch.health_status,ch.health_score,
       ch.health_checked_at,ch.health_failure_reason,ch.suggested_fix,ch.health_details,
       ch.last_successful_post_at,ch.last_successful_view_fetch_at,ch.last_successful_settlement_at,
       u.status publisher_status,u.is_banned publisher_is_banned,u.balance_available
     FROM channels ch JOIN users u ON u.id=ch.user_id WHERE ch.id=? LIMIT 1`, [channelId]
  );
  if (!channels.length) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  const [fraudEvents] = await pool.query<RowDataPacket[]>(
    `SELECT id,fraud_type,severity,reason,old_trust_score,new_trust_score,old_risk_score,new_risk_score,
       false_positive_at,false_positive_reason,created_at FROM channel_fraud_events
     WHERE channel_id=? ORDER BY created_at DESC LIMIT 15`, [channelId]
  );
  const [settlements] = await pool.query<RowDataPacket[]>(
    `SELECT id,settlement_type,campaign_id,post_id,new_units,advertiser_debit,publisher_credit,
       platform_revenue,reserve_amount,quality_holdback,effective_publisher_cpm,effective_publisher_cpc,
       publisher_quality_score,publisher_quality_weight,remaining_budget,created_at
     FROM channel_settlement_ledger WHERE channel_id=? ORDER BY created_at DESC LIMIT 20`, [channelId]
  );
  const [proof] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(advertiser_debit),0) advertiser_debit,COALESCE(SUM(publisher_credit),0) publisher_credit,
       COALESCE(SUM(platform_revenue),0) platform_revenue,COALESCE(SUM(reserve_amount),0) reserve_amount,
       COALESCE(SUM(quality_holdback),0) quality_holdback,
       COALESCE(SUM(advertiser_debit-publisher_credit-platform_revenue-reserve_amount),0) accounting_difference
     FROM channel_settlement_ledger WHERE channel_id=?`, [channelId]
  );
  const [audits] = await pool.query<RowDataPacket[]>(
    `SELECT id,admin_id,action,old_value,new_value,reason,created_at FROM channel_admin_action_audits
     WHERE channel_id=? ORDER BY created_at DESC LIMIT 20`, [channelId]
  );
  return NextResponse.json({ channel: channels[0], fraud_events: fraudEvents, recent_settlements: settlements, ledger_proof: proof[0], audits });
}
