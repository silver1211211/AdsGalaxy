import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export async function GET(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "all";
  const params: string[] = [];
  let where = "WHERE 1=1";
  if (status !== "all") {
    where += " AND c.status = ?";
    params.push(status);
  }

  const [rows] = await pool.query(
    `SELECT
      c.*,
      u.username,
      u.first_name,
      u.last_name,
      COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as impressions,
      COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as spend,
      COALESCE((SELECT SUM(ds.ads_galaxy_fee) FROM miniapp_daily_stats ds WHERE ds.network_name = 'AdsGalaxyInternal'), 0) as platform_fees
     FROM miniapp_rewarded_campaigns c
     LEFT JOIN users u ON c.advertiser_id = u.id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT 200`,
    params
  );

  return NextResponse.json({ campaigns: rows });
}

export async function PATCH(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const id = Number(body.id);
    const action = cleanText(body.action);
    const adminCpm = body.admin_cpm === undefined ? null : Number(body.admin_cpm);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Valid campaign id is required" }, { status: 400 });
    }

    const [beforeRows]: any = await pool.query("SELECT * FROM miniapp_rewarded_campaigns WHERE id = ?", [id]);
    if (beforeRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (action === "approve") {
      if (!Number.isFinite(adminCpm) || Number(adminCpm) <= 0) {
        return NextResponse.json({ error: "Admin CPM must be greater than 0 for approval" }, { status: 400 });
      }
      await pool.query(
        "UPDATE miniapp_rewarded_campaigns SET status = 'approved', admin_cpm = ?, approved_at = COALESCE(approved_at, NOW()) WHERE id = ?",
        [adminCpm, id]
      );
    } else if (action === "reject") {
      await pool.query("UPDATE miniapp_rewarded_campaigns SET status = 'rejected' WHERE id = ?", [id]);
    } else if (action === "pause") {
      await pool.query("UPDATE miniapp_rewarded_campaigns SET status = 'paused' WHERE id = ? AND status = 'approved'", [id]);
    } else if (action === "resume") {
      await pool.query("UPDATE miniapp_rewarded_campaigns SET status = 'approved' WHERE id = ? AND status = 'paused' AND remaining_budget > 0", [id]);
    } else if (action === "update_cpm") {
      if (!Number.isFinite(adminCpm) || Number(adminCpm) <= 0) {
        return NextResponse.json({ error: "Admin CPM must be greater than 0" }, { status: 400 });
      }
      await pool.query("UPDATE miniapp_rewarded_campaigns SET admin_cpm = ? WHERE id = ?", [adminCpm, id]);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [afterRows]: any = await pool.query("SELECT * FROM miniapp_rewarded_campaigns WHERE id = ?", [id]);
    await recordAdminActionAudit({
      adminId: admin.id,
      action: `miniapp_rewarded_${action}`,
      entityType: "miniapp_rewarded_campaign",
      entityId: id,
      reason: `admin_${action}`,
      metadata: {
        admin_username: admin.username,
        previous_state: beforeRows[0],
        new_state: afterRows[0],
      },
    });

    return NextResponse.json({ success: true, campaign: afterRows[0] });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update Mini App rewarded campaign" }, { status: 500 });
  }
}
