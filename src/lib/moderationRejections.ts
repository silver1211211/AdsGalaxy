import { recordChannelStatusTransitionAudit } from "@/lib/channelStatusAudit";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { applicablePolicyScopes, getPolicyDefinition, getPolicyRule, policyRuleHref, policyRuleReference, publicPolicyUrl, type PolicyRule } from "@/lib/policyRegistry";
import { createApprovedCampaignCreativeRevision } from "@/lib/campaignCreativeRevision";
import { createApprovedMiniAppCreativeRevision } from "@/lib/miniappCreativeRevision";

export type ModerationEntityType = "channel" | "bot" | "miniapp" | "campaign" | "miniapp_rewarded_campaign";
type EntityConfig = { table: string; owner: string; name: string; classifierSql: string; rejectSql: string };
const ENTITIES: Record<ModerationEntityType, EntityConfig> = {
  channel: { table: "channels", owner: "user_id", name: "title", classifierSql: "NULL campaign_kind,NULL type", rejectSql: "UPDATE channels SET status='rejected',paused_reason='Policy rejection',suggested_fix=NULL,telegram_access_version=COALESCE(telegram_access_version,0)+1 WHERE id=?" },
  bot: { table: "bots", owner: "user_id", name: "bot_name", classifierSql: "NULL campaign_kind,NULL type", rejectSql: "UPDATE bots SET status='rejected',paused_reason='Policy rejection',suggested_fix=NULL WHERE id=?" },
  miniapp: { table: "miniapps", owner: "user_id", name: "miniapp_name", classifierSql: "NULL campaign_kind,NULL type", rejectSql: "UPDATE miniapps SET status='rejected' WHERE id=?" },
  campaign: { table: "campaigns", owner: "user_id", name: "name", classifierSql: "e.campaign_kind,e.type,e.teaser_mode,e.teaser_enabled", rejectSql: "UPDATE campaigns SET status='rejected',rejection_reason=? WHERE id=?" },
  miniapp_rewarded_campaign: { table: "miniapp_rewarded_campaigns", owner: "advertiser_id", name: "campaign_name", classifierSql: "NULL campaign_kind,'miniapp_rewarded' type", rejectSql: "UPDATE miniapp_rewarded_campaigns SET status='rejected',creative_review_status='rejected',creative_review_notes=? WHERE id=?" },
};

export class ModerationError extends Error {
  constructor(public code: "MODERATION_REASON_REQUIRED" | "MODERATION_REASON_INVALID" | "MODERATION_REASON_WRONG_SCOPE" | "ENTITY_NOT_REJECTABLE" | "ENTITY_NOT_FOUND", public status: number) { super(code); }
}

type EntityRow = RowDataPacket & { id: number; owner_user_id: number; entity_name: string; status: string; campaign_kind?: string; type?: string; teaser_mode?: string; teaser_enabled?: number; telegram_id?: string | number | null };
export type StructuredRejection = {
  id: number; entity_type: ModerationEntityType; entity_id: number; owner_user_id: number;
  policy_scope: string; policy_rule_key: string; public_rule_number: number; policy_version: string;
  internal_note?: string | null; rejected_by_admin_id?: number | null; rejected_at: string; created_at: string;
};

function entityType(value: unknown): ModerationEntityType | null {
  const text = String(value || ""); return Object.hasOwn(ENTITIES, text) ? text as ModerationEntityType : null;
}

export async function rejectEntityWithPolicy(input: { entityType: unknown; entityId: unknown; ruleKey: unknown; internalNote?: unknown; publicRuleNumber?: unknown; adminId: number }) {
  const type = entityType(input.entityType);
  const id = Number(input.entityId);
  const ruleKey = String(input.ruleKey || "").trim();
  const note = String(input.internalNote || "").trim();
  if (!ruleKey) throw new ModerationError("MODERATION_REASON_REQUIRED", 400);
  if (!type || !Number.isInteger(id) || id <= 0 || note.length > 300) throw new ModerationError("MODERATION_REASON_INVALID", 400);
  const rule = getPolicyRule(ruleKey);
  if (!rule || rule.status !== "active") throw new ModerationError("MODERATION_REASON_INVALID", 400);
  if (input.publicRuleNumber !== undefined && Number(input.publicRuleNumber) !== rule.public_number) throw new ModerationError("MODERATION_REASON_INVALID", 400);

  const cfg = ENTITIES[type];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<EntityRow[]>(
      `SELECT e.id,e.${cfg.owner} owner_user_id,e.${cfg.name} entity_name,e.status,${cfg.classifierSql},u.telegram_id
       FROM ${cfg.table} e LEFT JOIN users u ON u.id=e.${cfg.owner} WHERE e.id=? LIMIT 1 FOR UPDATE`, [id]
    );
    const row = rows[0];
    if (!row) throw new ModerationError("ENTITY_NOT_FOUND", 404);
    if (["deleted", "completed", "rejected"].includes(String(row.status).toLowerCase())) throw new ModerationError("ENTITY_NOT_REJECTABLE", 409);
    const scopes = applicablePolicyScopes(type, row);
    if (!scopes.includes(rule.scope)) throw new ModerationError("MODERATION_REASON_WRONG_SCOPE", 400);
    const reference = policyRuleReference(rule);
    if (type === "campaign") {
      const [[campaign]] = await conn.query<Array<RowDataPacket & Record<string,unknown>>>(
        "SELECT * FROM campaigns WHERE id=? FOR UPDATE",[id]);
      const hadApproval=Boolean(campaign.approved_creative_revision_id)||campaign.status==='active';
      if(campaign.pending_creative_revision_id)await conn.query(
        "UPDATE campaign_creative_revisions SET review_status='rejected',review_reason=?,reviewed_at=UTC_TIMESTAMP(6) WHERE id=? AND campaign_id=? AND review_status='pending'",
        [reference,campaign.pending_creative_revision_id,id]);
      if(hadApproval){
        if(!campaign.approved_creative_revision_id){
          const [copies]=await conn.query<Array<RowDataPacket & {copy_text:string}>>(
            "SELECT copy_text FROM teaser_creatives WHERE campaign_id=? AND active=1 ORDER BY position",[id]);
          const approvedId=await createApprovedCampaignCreativeRevision(conn,{
            campaignId:id,campaign,teaserVariants:copies.map(copy=>copy.copy_text)});
          await conn.query("UPDATE campaigns SET approved_creative_revision_id=? WHERE id=?",[approvedId,id]);
        }
        await conn.query(`UPDATE campaigns SET status='paused',pause_reason='moderation_cleanup',
          rejection_reason=?,pending_creative_revision_id=NULL,status_before_creative_review=NULL,
          telegram_cleanup_status='pending',updated_at=UTC_TIMESTAMP(6) WHERE id=?`,[reference,id]);
        await conn.query(`UPDATE campaign_posts SET status='cleanup_pending',cleanup_status='pending'
          WHERE campaign_id=? AND status IN ('active','posted','sent','delete_failed')
            AND delivery_confirmed_at IS NOT NULL AND deleted_at IS NULL`,[id]);
        await conn.query(`UPDATE teaser_placements SET status='removal_pending',
          removal_requested_at=COALESCE(removal_requested_at,UTC_TIMESTAMP(6)),
          removal_reason='moderation_rejected' WHERE campaign_id=?
          AND status IN ('active','awaiting_baseline')`,[id]);
        await conn.query(`UPDATE broadcast_deliveries SET cleanup_status='pending',
          cleanup_next_retry_at=UTC_TIMESTAMP(6) WHERE campaign_id=? AND status='sent'
            AND telegram_message_id IS NOT NULL AND deleted_at IS NULL AND cleanup_status IS NULL`,[id]);
      }else await conn.query(cfg.rejectSql,[reference,id]);
    } else if(type === "miniapp_rewarded_campaign") {
      const [[campaign]]=await conn.query<Array<RowDataPacket & Record<string,unknown>>>(
        "SELECT * FROM miniapp_rewarded_campaigns WHERE id=? FOR UPDATE",[id]);
      const hadApproval=Boolean(campaign.approved_creative_revision_id||campaign.approved_at);
      if(campaign.pending_creative_revision_id)await conn.query(
        "UPDATE miniapp_creative_revisions SET review_status='rejected',review_reason=?,reviewed_at=UTC_TIMESTAMP(6) WHERE id=? AND campaign_id=? AND review_status='pending'",
        [reference,campaign.pending_creative_revision_id,id]);
      let approvedId=Number(campaign.approved_creative_revision_id||0);
      if(hadApproval&&!approvedId)approvedId=await createApprovedMiniAppCreativeRevision(conn,id,campaign);
      await conn.query(`UPDATE miniapp_rewarded_campaigns SET status=?,pause_reason=?,
        creative_review_status='rejected',creative_review_notes=?,
        approved_creative_revision_id=?,pending_creative_revision_id=NULL,
        status_before_creative_review=NULL,creative_review_started_at=UTC_TIMESTAMP(6),
        updated_at=UTC_TIMESTAMP(6) WHERE id=?`,
        [hadApproval?'paused':'rejected',hadApproval?'moderation_rejected':null,reference,
          approvedId||null,id]);
    } else await conn.query(cfg.rejectSql, [id]);
    if (type === "channel") {
      await recordChannelStatusTransitionAudit(conn, {
        channelId: id,
        previousStatus: String(row.status),
        newStatus: "rejected",
        sourceWorker: "admin_moderation_rejection",
        reasonCode: `policy_rejection:${rule.rule_key}`,
        reasonText: note || reference || "Policy rejection",
        evidenceClassification: "manual",
        actorType: "admin",
        actorId: input.adminId || null,
        transitionIntent: "manual",
        notificationGenerated: true,
        metadata: { rule_key: rule.rule_key, public_rule_number: rule.public_number },
      });
    }
    const [result] = await conn.query<import("mysql2/promise").ResultSetHeader>(
      `INSERT INTO moderation_rejections
       (entity_type,entity_id,owner_user_id,policy_scope,policy_rule_key,public_rule_number,policy_version,internal_note,rejected_by_admin_id,rejected_at)
       VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
      [type, id, row.owner_user_id, rule.scope, rule.rule_key, rule.public_number, rule.policy_version, note || null, input.adminId]
    );
    await conn.commit();
    return { id: result.insertId, entity: row, rule, reference, policy_url: publicPolicyUrl(rule) };
  } catch (error) {
    try { await conn.rollback(); } catch { /* original error remains authoritative */ }
    throw error;
  } finally { conn.release(); }
}

export function moderationNotificationHtml(kind: "publisher" | "advertiser", entityName: string, rule: PolicyRule) {
  const safeName = entityName.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char] || char);
  const noun = kind === "publisher" ? "property" : "campaign";
  return `❌ <b>${kind === "publisher" ? "Property" : "Campaign"} Rejected</b>\n\nYour ${noun} <b>${safeName}</b> was not approved.\n\nRejection reason: <a href="${publicPolicyUrl(rule)}">${policyRuleReference(rule)}</a>`;
}

export async function listModerationHistory(typeValue: unknown, idValue: unknown, pageValue: unknown = 1, limitValue: unknown = 20, conn: Pick<PoolConnection, "query"> | typeof pool = pool) {
  const type = entityType(typeValue); const id = Number(idValue);
  if (!type || !Number.isInteger(id) || id <= 0) throw new ModerationError("ENTITY_NOT_FOUND", 404);
  const page = Math.max(1, Number(pageValue) || 1); const limit = Math.min(50, Math.max(1, Number(limitValue) || 20));
  const [rows] = await conn.query<Array<StructuredRejection & RowDataPacket>>(
    "SELECT * FROM moderation_rejections WHERE entity_type=? AND entity_id=? ORDER BY rejected_at DESC,id DESC LIMIT ? OFFSET ?",
    [type, id, limit, (page - 1) * limit]
  );
  return rows;
}

export async function getOwnerRejection(type: ModerationEntityType, entityId: number, ownerUserId: number, currentStatus: string) {
  if (String(currentStatus).toLowerCase() !== "rejected") return null;
  const [rows] = await pool.query<Array<StructuredRejection & RowDataPacket>>(
    "SELECT * FROM moderation_rejections WHERE entity_type=? AND entity_id=? AND owner_user_id=? ORDER BY rejected_at DESC,id DESC LIMIT 1",
    [type, entityId, ownerUserId]
  );
  const row = rows[0]; if (!row) return null;
  const rule = getPolicyRule(row.policy_rule_key); if (!rule) return null;
  const policyUrl = rule.status === "active" && rule.public_number === row.public_rule_number
    ? policyRuleHref(rule)
    : rule.policy_path;
  return { public_rule_number: row.public_rule_number, policy_name: getPolicyDefinition(rule.scope)?.name || "Ads Galaxy Policy", policy_url: policyUrl, rejected_at: row.rejected_at };
}
