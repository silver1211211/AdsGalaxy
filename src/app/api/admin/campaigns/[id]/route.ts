import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { isStandardChannelReport, getChannelReportingMetrics, channelMetricPayload } from "@/lib/channelReporting";
import { getGrowthLiveImpressions } from "@/lib/channelGrowthStatistics";
import { mainCampaignScopeSql, recordSilverAudit, requireSilverAdmin, silverCampaignScopeSql } from "@/lib/silverCampaignControl";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { ensureClassicSettlementColumns } from "@/lib/schemaGuards";
import { getCampaignClickAnalytics } from "@/lib/campaignAnalyticsAdjustments";
import { resolveCampaignPublicId } from "@/lib/campaignIdentity";

type ColumnRow = RowDataPacket & { COLUMN_NAME: string };
type GenericRow = RowDataPacket & Record<string, unknown>;

const EDITABLE_CAMPAIGN_FIELDS = {
  name: { type: "string", maxLength: 255 },
  campaign_title: { type: "string", maxLength: 255 },
  message_text: { type: "string", maxLength: 4096 },
  link: { type: "string", maxLength: 512 },
  button_text: { type: "string", maxLength: 64 },
  category: { type: "string", maxLength: 64 },
  cpm: { type: "number", min: 0 },
  cpc: { type: "number", min: 0 },
  cost_per_subscriber: { type: "number", min: 0.00000001 },
  is_prioritized: { type: "boolean" },
} as const;

type EditableCampaignField = keyof typeof EDITABLE_CAMPAIGN_FIELDS;

async function getCampaignPostColumns() {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaign_posts'
  `);

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCampaignDetailsGet(request, context, "main");
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCampaignDetailsPatch(request, context, "main");
}

async function getCampaignColumns() {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaigns'
  `);

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

export async function handleCampaignDetailsGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  managementScope: "main" | "silver" = "main"
) {
  if (managementScope === "silver") {
    const { response } = await requireSilverAdmin();
    if (response) return response;
  } else if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureClassicSettlementColumns();
    const { id: requestedId } = await params;
    const identity = managementScope === "main" ? await resolveCampaignPublicId(Number(requestedId)) : { id: Number(requestedId), public_id: Number(requestedId) };
    if (!identity) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const id = String(identity.id);
    const postColumns = await getCampaignPostColumns();
    const deletedAtExpr = postColumns.has("deleted_at") ? "cp.deleted_at" : "NULL";
    const deletedPostsExpr = postColumns.has("deleted_at")
      ? "SUM(CASE WHEN cp.status = 'deleted' OR cp.deleted_at IS NOT NULL THEN 1 ELSE 0 END)"
      : "SUM(CASE WHEN cp.status = 'deleted' THEN 1 ELSE 0 END)";
    const deleteFailedExpr = postColumns.has("delete_failed_reason")
      ? "SUM(CASE WHEN cp.status = 'delete_failed' OR cp.delete_failed_reason IS NOT NULL THEN 1 ELSE 0 END)"
      : "SUM(CASE WHEN cp.status = 'delete_failed' THEN 1 ELSE 0 END)";
    const totalViewsExpr = postColumns.has("views") ? "COALESCE(SUM(cp.views), 0)" : "0";
    const lastViewUpdateExpr = postColumns.has("last_views_update") ? "MAX(cp.last_views_update)" : "NULL";
    const placementViewsExpr = postColumns.has("views") ? "cp.views" : "0";
    const messageIdExpr = postColumns.has("message_id") ? "cp.message_id" : "NULL";
    const deleteAttemptsExpr = postColumns.has("delete_attempts") ? "cp.delete_attempts" : "NULL";
    const deleteFailedReasonExpr = postColumns.has("delete_failed_reason") ? "cp.delete_failed_reason" : "NULL";
    const cleanupAttemptedAtExpr = postColumns.has("cleanup_attempted_at") ? "cp.cleanup_attempted_at" : "NULL";
    const cleanupStatusExpr = postColumns.has("cleanup_status") ? "cp.cleanup_status" : "NULL";
    const cleanupCompletedAtExpr = postColumns.has("cleanup_completed_at") ? "cp.cleanup_completed_at" : "NULL";
    const cleanupErrorExpr = postColumns.has("cleanup_error") ? "cp.cleanup_error" : deleteFailedReasonExpr;
    const cleanupRetryCountExpr = postColumns.has("cleanup_retry_count") ? "cp.cleanup_retry_count" : deleteAttemptsExpr;
    const cleanupPendingExpr = postColumns.has("cleanup_status")
      ? "SUM(CASE WHEN cp.cleanup_status = 'pending' THEN 1 ELSE 0 END)"
      : "SUM(CASE WHEN cp.status = 'cleanup_pending' THEN 1 ELSE 0 END)";
    const cleanupSuccessExpr = postColumns.has("cleanup_status")
      ? "SUM(CASE WHEN cp.cleanup_status = 'success' THEN 1 ELSE 0 END)"
      : deletedPostsExpr;
    const cleanupRetryExpr = postColumns.has("cleanup_status")
      ? "SUM(CASE WHEN cp.cleanup_status = 'retry' THEN 1 ELSE 0 END)"
      : "0";
    const cleanupFailedExpr = postColumns.has("cleanup_status")
      ? "SUM(CASE WHEN cp.cleanup_status = 'failed' THEN 1 ELSE 0 END)"
      : deleteFailedExpr;

    const [campaignRows] = await pool.query<GenericRow[]>(`
      SELECT c.*, u.first_name, u.last_name, u.username, u.telegram_id, u.ad_balance AS advertiser_balance
      FROM campaigns c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ? AND ${managementScope === "silver" ? silverCampaignScopeSql("c") : mainCampaignScopeSql("c")}
    `, [id]);

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const isBroadcast = campaignRows[0].type === "broadcast";
    const isTeaserCampaign =
      String(campaignRows[0].teaser_mode || "none") !== "none";

    const [teaserCreativeRows] = isTeaserCampaign
      ? await pool.query<GenericRow[]>(`
          SELECT id, campaign_id, copy_text, position, active
          FROM teaser_creatives
          WHERE campaign_id = ?
            AND active = 1
          ORDER BY position ASC, id ASC
        `, [id])
      : [[] as GenericRow[]];

    const [metricsRows] = isBroadcast
      ? await pool.query<GenericRow[]>(`
        SELECT
          COUNT(*) AS total_views,
          COUNT(*) AS total_deliveries,
          COALESCE(SUM(cost), 0) AS total_spend,
          COALESCE(SUM(publisher_reward), 0) AS publisher_earnings,
          COALESCE(SUM(platform_revenue), 0) AS platform_revenue,
          COALESCE(SUM(reserve_amount), 0) AS reserve,
          MAX(last_success_at) AS last_delivery_at
        FROM broadcast_deliveries
        WHERE campaign_id = ? AND status = 'sent'
      `, [id])
      : await pool.query<GenericRow[]>(`
      SELECT
        COUNT(*) as total_posts,
        SUM(CASE WHEN cp.status IN ('active', 'posted', 'sent') THEN 1 ELSE 0 END) as active_posts,
        SUM(CASE WHEN cp.status = 'cleanup_pending' THEN 1 ELSE 0 END) as cleanup_pending_posts,
        ${cleanupPendingExpr} as cleanup_status_pending_posts,
        ${cleanupSuccessExpr} as cleanup_status_success_posts,
        ${cleanupRetryExpr} as cleanup_status_retry_posts,
        ${cleanupFailedExpr} as cleanup_status_failed_posts,
        SUM(CASE WHEN cp.status = 'settlement_pending' THEN 1 ELSE 0 END) as settlement_pending_posts,
        SUM(CASE WHEN cp.status = 'replaced' THEN 1 ELSE 0 END) as replaced_posts,
        SUM(CASE WHEN cp.status = 'already_missing' THEN 1 ELSE 0 END) as already_missing_posts,
        ${deletedPostsExpr} as deleted_posts,
        ${deleteFailedExpr} as delete_failed_posts,
        ${totalViewsExpr} as total_views,
        COUNT(DISTINCT cp.channel_id) as channels_posted_to,
        MAX(cp.created_at) as last_posted_at,
        ${lastViewUpdateExpr} as last_view_update
      FROM campaign_posts cp
      WHERE cp.campaign_id = ?
    `, [id]);

    let viewAccounting: Record<string, unknown> = {};
    if (!isBroadcast) {
      const [viewAccountingRows] = await pool.query<GenericRow[]>(`
        SELECT
          COALESCE((SELECT SUM(views) FROM campaign_posts WHERE campaign_id=?),0) raw_views,
          COALESCE((SELECT SUM(fraud_excluded_views) FROM campaign_posts WHERE campaign_id=?),0) fraud_excluded_views,
          COALESCE((SELECT SUM(waived_views) FROM channel_view_waivers WHERE campaign_id=?),0) waived_views,
          COALESCE((SELECT SUM(units) FROM channel_advertiser_debits WHERE campaign_id=? AND settlement_type='view'),0)
            + COALESCE((SELECT SUM(l.new_units) FROM channel_settlement_ledger l
              LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
              WHERE l.campaign_id=? AND l.settlement_type='view' AND a.id IS NULL),0) billable_views
      `, [id,id,id,id,id]);
      viewAccounting = viewAccountingRows[0] || {};
    }

    const clickAnalytics = await getCampaignClickAnalytics(Number(id));

    const [financialRows] = await pool.query<GenericRow[]>(
      `SELECT
        CASE WHEN c.type = 'broadcast'
          THEN COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)
          ELSE COALESCE(c.channel_spend, 0)
        END AS spend,
        (SELECT COUNT(*) FROM campaigns approved WHERE approved.user_id = c.user_id AND approved.status IN ('active', 'completed', 'budget_exhausted')) AS approved_count,
        (SELECT COUNT(*) FROM campaigns rejected WHERE rejected.user_id = c.user_id AND rejected.status = 'rejected') AS rejected_count
       FROM campaigns c WHERE c.id = ? AND ${managementScope === "silver" ? silverCampaignScopeSql("c") : mainCampaignScopeSql("c")}`,
      [id]
    );

    const [placements] = isBroadcast ? [[] as GenericRow[]] : await pool.query<GenericRow[]>(`
      SELECT
        cp.id,
        cp.channel_id,
        cp.channel_username,
        ${messageIdExpr} as message_id,
        cp.status,
        ${placementViewsExpr} as views,
        cp.created_at,
        ${deletedAtExpr} as deleted_at,
        ${deleteAttemptsExpr} as delete_attempts,
        ${deleteFailedReasonExpr} as delete_failed_reason,
        ${cleanupAttemptedAtExpr} as cleanup_attempted_at,
        ${cleanupStatusExpr} as cleanup_status,
        ${cleanupCompletedAtExpr} as cleanup_completed_at,
        ${cleanupErrorExpr} as cleanup_error,
        ${cleanupRetryCountExpr} as cleanup_retry_count,
        (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) as clicks
      FROM campaign_posts cp
      WHERE cp.campaign_id = ?
      ORDER BY cp.created_at DESC
      LIMIT 200
    `, [id]);

    const metrics = metricsRows[0] || {};
    const isGrowthCampaign = String(campaignRows[0].campaign_kind || "") === "channel_growth";
    const [growthRows] = isGrowthCampaign
      ? await pool.query<GenericRow[]>(
          `SELECT COUNT(*) verified_subscribers, COALESCE(SUM(advertiser_debit),0) subscriber_spend
           FROM channel_growth_conversions
           WHERE campaign_id=? AND status='billed' AND fraud_status='clear'`,
          [id],
        )
      : [[] as GenericRow[]];
    const growth = growthRows[0] || {};
    const rawViews = isGrowthCampaign ? await getGrowthLiveImpressions(pool, Number(id)) : Number(viewAccounting.raw_views ?? metrics.total_views ?? 0);
    const fraudExcludedViews = Number(viewAccounting.fraud_excluded_views || 0);
    const waivedViews = Number(viewAccounting.waived_views || 0);
    const billableViews = Number(viewAccounting.billable_views || 0);
    const totalViews = isGrowthCampaign ? rawViews : (campaignRows[0].type === "views" ? billableViews : rawViews);
    const outstandingValidViews = Math.max(0, rawViews - fraudExcludedViews - billableViews - waivedViews);
    const totalClicks = isGrowthCampaign ? clickAnalytics.actualTrackedClicks : clickAnalytics.displayedClicks;

    const canonical = isStandardChannelReport(campaignRows[0])
      ? (await getChannelReportingMetrics(pool, [Number(id)])).get(Number(id)) : undefined;
    const reporting = canonical ? channelMetricPayload(canonical, isGrowthCampaign) : {};
    return NextResponse.json({
      campaign: {
        ...campaignRows[0],
        display_id: Number(campaignRows[0].public_id || requestedId),
        ...financialRows[0],
        ...(canonical ? { spend: canonical.spend } : {}),
        teaser_creatives: teaserCreativeRows,
      },
      metrics: {
        ...metrics,
        total_views: totalViews,
        billable_views: billableViews,
        raw_views: rawViews,
        fraud_excluded_views: fraudExcludedViews,
        waived_views: waivedViews,
        outstanding_valid_views: outstandingValidViews,
        total_clicks: totalClicks,
        actual_tracked_clicks: clickAnalytics.actualTrackedClicks,
        historical_click_recovery_adjustment: clickAnalytics.recoveryBaseline + clickAnalytics.additiveAdjustment,
        displayed_clicks: totalClicks,
        ctr: totalViews > 0 ? (totalClicks / totalViews) * 100 : 0,
        verified_subscribers: Number(growth.verified_subscribers || 0),
        subscriber_spend: Number(growth.subscriber_spend || 0),
        effective_cps: Number(growth.verified_subscribers || 0) > 0
          ? Number(growth.subscriber_spend || 0) / Number(growth.verified_subscribers)
          : 0,
        conversion_rate: totalClicks > 0 ? (Number(growth.verified_subscribers || 0) / totalClicks) * 100 : 0,
        ...reporting,
      },
      placements: canonical && canonical.views <= 0 ? placements.map(post => ({ ...post, clicks: 0 })) : placements,
    });
  } catch (error: unknown) {
    console.error("Admin Campaign Details API Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}

export async function handleCampaignDetailsPatch(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  managementScope: "main" | "silver" = "main"
) {
  const { admin, response } = managementScope === "silver" ? await requireSilverAdmin() : await requireAdminPermission("operate");
  if (response) return response;

  try {
    await ensureClassicSettlementColumns();
    const { id: requestedId } = await params;
    const identity = managementScope === "main" ? await resolveCampaignPublicId(Number(requestedId)) : { id: Number(requestedId), public_id: Number(requestedId) };
    if (!identity) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const id = String(identity.id);
    const body = await request.json() as Record<string, unknown>;
    const teaserCreativesInput = body.teaser_creatives;
    const fields = Object.keys(body).filter((field) => field !== "teaser_creatives");
    const unknownFields = fields.filter((field) => !(field in EDITABLE_CAMPAIGN_FIELDS));
    if (unknownFields.length > 0) {
      return NextResponse.json({ error: `Unknown or read-only field: ${unknownFields[0]}` }, { status: 400 });
    }

    if (fields.length === 0 && teaserCreativesInput === undefined) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const [campaignRows] = await pool.query<GenericRow[]>(`SELECT c.* FROM campaigns c WHERE c.id = ? AND ${managementScope === "silver" ? silverCampaignScopeSql("c") : mainCampaignScopeSql("c")}`, [id]);
    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaignRows[0];
    if (isStandardChannelReport(campaign)) {
      const rateField = campaign.campaign_kind === "channel_growth" ? "cost_per_subscriber" : campaign.type === "clicks" ? "cpc" : "cpm";
      if (["cpm", "cpc", "cost_per_subscriber"].some(field => fields.includes(field) && field !== rateField)) {
        return NextResponse.json({ error: "Pricing field does not match this campaign billing model" }, { status: 400 });
      }
    } else if (fields.includes("cost_per_subscriber")) {
      return NextResponse.json({ error: "CPS is only available for Channel Growth" }, { status: 400 });
    }
    const campaignColumns = await getCampaignColumns();
    const updates: string[] = [];
    const values: unknown[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    let teaserCopies: string[] | null = null;
    let teaserCopiesChanged = false;

    if (teaserCreativesInput !== undefined) {
      if (String(campaign.teaser_mode || "none") !== "teaser_only") {
        return NextResponse.json(
          { error: "Teaser messages can only be edited for a Teaser campaign" },
          { status: 400 }
        );
      }

      if (!Array.isArray(teaserCreativesInput)) {
        return NextResponse.json(
          { error: "teaser_creatives must be an array" },
          { status: 400 }
        );
      }

      teaserCopies = teaserCreativesInput.map((value) =>
        typeof value === "string" ? value.trim() : ""
      );

      if (teaserCopies.length < 2 || teaserCopies.length > 5) {
        return NextResponse.json(
          { error: "Teaser campaigns require between 2 and 5 messages" },
          { status: 400 }
        );
      }

      if (teaserCopies.some((copy) => Array.from(copy).length < 20)) {
        return NextResponse.json(
          { error: "Each Teaser message must contain at least 20 characters" },
          { status: 400 }
        );
      }

      if (teaserCopies.some((copy) => Array.from(copy).length > 80)) {
        return NextResponse.json(
          { error: "Each Teaser message must contain at most 80 characters" },
          { status: 400 }
        );
      }

      if (teaserCopies.some((copy) => /(?:https?:\/\/|t\.me\/)/iu.test(copy))) {
        return NextResponse.json(
          { error: "Teaser messages cannot contain URLs" },
          { status: 400 }
        );
      }

      if (
        new Set(teaserCopies.map((copy) => copy.toLocaleLowerCase())).size
        !== teaserCopies.length
      ) {
        return NextResponse.json(
          { error: "Teaser messages must be unique" },
          { status: 400 }
        );
      }

      const [existingCreativeRows] = await pool.query<GenericRow[]>(`
        SELECT copy_text
        FROM teaser_creatives
        WHERE campaign_id = ?
          AND active = 1
        ORDER BY position ASC, id ASC
      `, [id]);

      const existingCopies = existingCreativeRows.map((row) =>
        String(row.copy_text || "")
      );

      teaserCopiesChanged =
        JSON.stringify(existingCopies) !== JSON.stringify(teaserCopies);

      if (teaserCopiesChanged) {
        oldValues.teaser_creatives = existingCopies;
        newValues.teaser_creatives = teaserCopies;
      }
    }

    for (const field of fields as EditableCampaignField[]) {
      if (!campaignColumns.has(field)) {
        return NextResponse.json({ error: `${field} is not available in this campaign schema` }, { status: 400 });
      }
      const config = EDITABLE_CAMPAIGN_FIELDS[field];
      const rawValue = body[field];
      let value: string | number;

      if (config.type === "string") {
        if (typeof rawValue !== "string") {
          return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
        }
        value = rawValue.trim();
        if (value.length === 0) {
          return NextResponse.json({ error: `${field} cannot be empty` }, { status: 400 });
        }
        if (value.length > config.maxLength) {
          return NextResponse.json({ error: `${field} exceeds ${config.maxLength} characters` }, { status: 400 });
        }
      } else if (config.type === "number") {
        const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
        if (!Number.isFinite(numericValue) || numericValue < config.min) {
          return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 });
        }
        value = numericValue;
      } else {
        if (typeof rawValue !== "boolean") {
          return NextResponse.json({ error: `${field} must be a boolean` }, { status: 400 });
        }
        value = rawValue ? 1 : 0;
      }

      if (String(campaign[field] ?? "") === String(value)) continue;
      oldValues[field] = campaign[field] ?? null;
      newValues[field] = value;
      updates.push(`${field} = ?`);
      values.push(value);
    }

    if (updates.length === 0 && !teaserCopiesChanged) {
      return NextResponse.json({ error: "No changes to save" }, { status: 400 });
    }

    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      const [lockedScopeRows] = await conn.query<GenericRow[]>(
        `SELECT c.id FROM campaigns c WHERE c.id=? AND ${managementScope === "silver" ? silverCampaignScopeSql("c") : mainCampaignScopeSql("c")} FOR UPDATE`,
        [id]
      );
      if (lockedScopeRows.length === 0) {
        await conn.rollback();
        return NextResponse.json({ error: "Campaign management scope changed" }, { status: 409 });
      }

      if (updates.length > 0) {
        values.push(id);
        await conn.query(
          `UPDATE campaigns
           SET ${updates.join(", ")}, updated_at = NOW()
           WHERE id = ?`,
          values
        );
      }

      if (teaserCopiesChanged && teaserCopies) {
        // Preserve each existing creative ID for its position.
        // This avoids breaking existing teaser_placement references.
        for (const [index, copy] of teaserCopies.entries()) {
          await conn.query(
            `INSERT INTO teaser_creatives
              (campaign_id, copy_text, position, active)
             VALUES (?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
               copy_text = VALUES(copy_text),
               active = 1`,
            [id, copy, index + 1]
          );
        }

        // Only positions removed by the admin are deactivated.
        await conn.query(
          `UPDATE teaser_creatives
           SET active = 0
           WHERE campaign_id = ?
             AND position > ?`,
          [id, teaserCopies.length]
        );

        // Keep legacy compatibility message synchronized to Message 1.
        await conn.query(
          `UPDATE campaigns
           SET message_text = ?, updated_at = NOW()
           WHERE id = ?`,
          [teaserCopies[0], id]
        );

        if (!("message_text" in oldValues)) {
          oldValues.message_text = campaign.message_text ?? null;
        }

        newValues.message_text = teaserCopies[0];
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    const auditInput: Parameters<typeof recordAdminActionAudit>[0] = {
      adminId: admin?.id,
      action: "campaign_edit",
      entityType: "campaign",
      entityId: id,
      reason: "admin_campaign_edit",
      metadata: {
        admin_id: admin?.id || null,
        campaign_id: id,
        edited_fields: Object.keys(newValues),
        old_values: oldValues,
        new_values: newValues,
        timestamp: new Date().toISOString(),
      },
    };
    if (managementScope === "silver") {
      await recordSilverAudit({ adminId: admin?.id, action: "campaign_edit", campaignId: Number(id), metadata: auditInput.metadata as Record<string, unknown> });
    } else {
      await recordAdminActionAudit(auditInput);
    }

    return NextResponse.json({
      success: true,
      campaign_id: id,
      updated_fields: Object.keys(newValues),
    });
  } catch (error: unknown) {
    console.error("Admin Campaign Edit API Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
