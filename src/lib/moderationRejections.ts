import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { applicablePolicyScopes, getPolicyDefinition, getPolicyRule, policyRuleHref, policyRuleReference, publicPolicyUrl, type PolicyRule } from "@/lib/policyRegistry";

export type ModerationEntityType = "channel" | "bot" | "miniapp" | "campaign" | "miniapp_rewarded_campaign";
type EntityConfig = { table: string; owner: string; name: string; classifierSql: string; rejectSql: string };
const ENTITIES: Record<ModerationEntityType, EntityConfig> = {
  channel: { table: "channels", owner: "user_id", name: "title", classifierSql: "NULL campaign_kind,NULL type", rejectSql: "UPDATE channels SET status='rejected',paused_reason='Policy rejection',suggested_fix=NULL WHERE id=?" },
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
    if (type === "campaign" || type === "miniapp_rewarded_campaign") await conn.query(cfg.rejectSql, [reference, id]);
    else await conn.query(cfg.rejectSql, [id]);
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
