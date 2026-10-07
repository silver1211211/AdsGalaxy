import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { acquireCronLock, releaseCronLock } from "@/lib/cronSecurity";
import { resumeAutomaticallyPausedChannel } from "@/lib/channelResumeEligibility";
import {
  reportSilverApiError,
  requireSilverAdmin,
  silverCampaignScopeSql,
} from "@/lib/silverCampaignControl";

type BudgetRow = RowDataPacket & {
  id: number;
  user_id: number;
  funding_model: string;
  status: string;
  auto_reactivate: number;
  budget: string | number;
  total_budget: string | number;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { admin, response } = await requireSilverAdmin();
  if (response || !admin) return response;
  const { id } = await params;
  const campaignId = Number(id);
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    amount?: unknown;
  } | null;
  // Preserve older clients without perpetuating the misleading budget label.
  const requestedAction = String(body?.action || "");
  const action = requestedAction === "add_balance" ? "add_budget" : requestedAction;
  const amountText = String(body?.amount ?? "").trim();
  if (
    !Number.isSafeInteger(campaignId) ||
    campaignId <= 0 ||
    !["add_budget", "set_budget_cap"].includes(action)
  )
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!/^\d+(?:\.\d{1,8})?$/.test(amountText) || Number(amountText) <= 0)
    return NextResponse.json(
      { error: "Enter a valid positive amount" },
      { status: 400 },
    );
  const lock = await acquireCronLock(`campaign-management-${campaignId}`, 600);
  if (!lock)
    return NextResponse.json(
      { error: "Campaign is currently being updated" },
      { status: 409 },
    );
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<BudgetRow[]>(
      `SELECT c.id,c.user_id,c.funding_model,c.status,c.auto_reactivate,c.budget,c.total_budget FROM campaigns c WHERE c.id=? AND ${silverCampaignScopeSql("c")} FOR UPDATE`,
      [campaignId],
    );
    const campaign = rows[0];
    if (!campaign) {
      await conn.rollback();
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }
    if (campaign.funding_model !== "direct_debit") {
      await conn.rollback();
      return NextResponse.json(
        { error: "Only direct-debit campaigns can use Silver budget controls" },
        { status: 409 },
      );
    }
    const oldBudget = Number(campaign.budget || 0),
      oldTotal = Number(campaign.total_budget || 0);
    if (action === "add_budget") {
      await conn.query(
        "UPDATE campaigns SET budget=budget+CAST(? AS DECIMAL(20,8)),total_budget=total_budget+CAST(? AS DECIMAL(20,8)),updated_at=NOW() WHERE id=?",
        [amountText, amountText, campaignId],
      );
    } else {
      const [updated] = await conn.query<ResultSetHeader>(
        `UPDATE campaigns SET budget=budget-(total_budget-CAST(? AS DECIMAL(20,8))),total_budget=CAST(? AS DECIMAL(20,8)),updated_at=NOW() WHERE id=? AND CAST(? AS DECIMAL(20,8))>=total_budget-budget AND budget>=(total_budget-CAST(? AS DECIMAL(20,8)))`,
        [amountText, amountText, campaignId, amountText, amountText],
      );
      if (updated.affectedRows !== 1) {
        await conn.rollback();
        return NextResponse.json(
          {
            error:
              "Budget cannot be lower than actual spend or committed allowance",
          },
          { status: 409 },
        );
      }
    }
    const [afterRows] = await conn.query<
      Array<
        RowDataPacket & {
          budget: string | number;
          total_budget: string | number;
        }
      >
    >("SELECT budget,total_budget FROM campaigns WHERE id=?", [campaignId]);
    const after = afterRows[0];
    await resumeAutomaticallyPausedChannel(conn, campaignId);
    await conn.query(
      "INSERT INTO silver_admin_audit_events(admin_id,action,campaign_id,metadata) VALUES(?,?,?,?)",
      [
        admin.id,
        action === "add_budget"
          ? "campaign_add_budget"
          : "campaign_edit_budget",
        campaignId,
        JSON.stringify({
          advertiser_id: campaign.user_id,
          old_remaining: oldBudget,
          old_total: oldTotal,
          new_remaining: Number(after.budget),
          new_total: Number(after.total_budget),
          direct_debit: true,
          no_immediate_wallet_debit: true,
        }),
      ],
    );
    await conn.commit();
    return NextResponse.json({
      success: true,
      budget: Number(after.budget),
      total_budget: Number(after.total_budget),
      funding_model: "direct_debit",
    });
  } catch (error) {
    await conn.rollback();
    reportSilverApiError("Unable to update campaign budget", error);
    return NextResponse.json(
      { error: "Unable to update the campaign budget. Please try again." },
      { status: 500 },
    );
  } finally {
    conn.release();
    await releaseCronLock(lock);
  }
}
