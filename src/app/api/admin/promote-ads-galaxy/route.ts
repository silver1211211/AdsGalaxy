import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin, requireAdminPermission } from "@/lib/adminAuth";
import {
  activatePromoteCampaign, createPayoutBatch, executePayoutBatch, getPromoteCampaign,
  processPromoteCampaign, setPromoteCampaignStatus,
} from "@/lib/promoteAdsGalaxy";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const campaign = await getPromoteCampaign();
  if (!campaign) return NextResponse.json({ error: "Campaign unavailable" }, { status: 404 });
  const [[stats]]: any = await pool.query(
    `SELECT COUNT(DISTINCT pr.id) referrals,COUNT(DISTINCT ce.id) channels,
       SUM(rw.status='pending_validation') pending_validation,SUM(rw.status='qualified') qualified,
       SUM(rw.status='manual_review') manual_review,SUM(rw.status='rejected') rejected,SUM(rw.status='payable') payable,
       SUM(rw.status='paid') paid,CAST(COALESCE(SUM(CASE WHEN rw.status IN ('qualified','payable','paid') THEN rw.amount ELSE 0 END),0) AS DECIMAL(24,8)) liability
     FROM publisher_promotion_referrals pr
     LEFT JOIN publisher_promotion_channel_events ce ON ce.campaign_referral_id=pr.id
     LEFT JOIN publisher_promotion_rewards rw ON rw.campaign_referral_id=pr.id WHERE pr.campaign_id=?`, [campaign.id]
  );
  const [audits]: any = await pool.query("SELECT actor_type,action,entity_type,reason,created_at FROM publisher_promotion_audit_logs WHERE campaign_id=? ORDER BY id DESC LIMIT 100", [campaign.id]);
  return NextResponse.json({ campaign, stats, audits }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;
  try {
    const body = await request.json();
    const action = String(body.action || "");
    let result: unknown;
    if (action === "activate") result = await activatePromoteCampaign(Number(admin.id));
    else if (action === "pause") result = await setPromoteCampaignStatus("paused", Number(admin.id));
    else if (action === "resume") result = await setPromoteCampaignStatus("active", Number(admin.id));
    else if (action === "close") result = await setPromoteCampaignStatus("closed", Number(admin.id));
    else if (action === "process") result = await processPromoteCampaign();
    else if (action === "approve_payout") result = await createPayoutBatch(Number(admin.id));
    else if (action === "confirm_payment") result = await executePayoutBatch(Number(admin.id), String(body.payment_reference || ""), String(body.confirmed_amount || ""));
    else return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Promote AdsGalaxy admin action failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action failed" }, { status: 400 });
  }
}
