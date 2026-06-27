import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";
import { getAdvertiserHistory, normalizeAdvertiserTrustLevel } from "@/lib/advertiserTrust";
import { sendTelegramMessage } from "@/lib/telegram";

export type CampaignAutomationType = "campaign" | "miniapp_rewarded";
export type AutomationDecision = "auto_approve" | "review" | "reject";

type AutomationInput = {
  campaignType: CampaignAutomationType;
  campaignId: number;
  advertiserId: number;
  advertiserTelegramId?: string | number | null;
  advertiserTrustLevel?: unknown;
  qualityScore?: unknown;
  qualityTier?: unknown;
  category?: unknown;
  categories?: unknown;
  destinationUrl?: unknown;
  creativeText?: unknown;
};

type AutomationSettings = {
  approval_mode: "manual" | "hybrid" | "automatic";
  trusted_auto_approve: boolean;
  premium_auto_approve: boolean;
  restricted_always_review: boolean;
  min_quality_score_auto_approve: number;
  max_previous_rejections_auto_approve: number;
  duplicate_creative_review_threshold: number;
  duplicate_landing_review_threshold: number;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function parseBool(value: unknown) {
  return String(value).toLowerCase() === "true" || String(value) === "1";
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
}

export function extractDomain(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase().replace(/^www\./, "");
  }
}

async function getAutomationSettings(conn?: PoolConnection): Promise<AutomationSettings> {
  const db = conn || pool;
  const [rows]: any = await db.query("SELECT `key`, value FROM automation_settings");
  const map = new Map(rows.map((row: any) => [row.key, row.value]));
  const mode = clean(map.get("approval_mode")).toLowerCase();
  return {
    approval_mode: mode === "manual" || mode === "automatic" ? mode : "hybrid",
    trusted_auto_approve: parseBool(map.get("trusted_auto_approve") ?? "true"),
    premium_auto_approve: parseBool(map.get("premium_auto_approve") ?? "true"),
    restricted_always_review: parseBool(map.get("restricted_always_review") ?? "true"),
    min_quality_score_auto_approve: toNumber(map.get("min_quality_score_auto_approve") || 75),
    max_previous_rejections_auto_approve: toNumber(map.get("max_previous_rejections_auto_approve") || 0),
    duplicate_creative_review_threshold: toNumber(map.get("duplicate_creative_review_threshold") || 2),
    duplicate_landing_review_threshold: toNumber(map.get("duplicate_landing_review_threshold") || 2),
  };
}

async function categoryDecision(categories: string[], conn?: PoolConnection) {
  if (categories.length === 0) return null;
  const db = conn || pool;
  const placeholders = categories.map(() => "?").join(", ");
  const [rows]: any = await db.query(
    `SELECT category, decision, reason FROM automation_category_rules WHERE category IN (${placeholders}) AND applies_to IN ('all', 'campaign')`,
    categories
  );
  const review = rows.find((row: any) => row.decision === "review" || row.decision === "reject");
  return review || rows[0] || null;
}

async function getDomainRule(domain: string, conn?: PoolConnection) {
  if (!domain) return null;
  const db = conn || pool;
  const [[row]]: any = await db.query("SELECT * FROM domain_trust_rules WHERE domain = ? LIMIT 1", [domain]);
  return row || null;
}

async function duplicateSignals(input: AutomationInput, domain: string, settings: AutomationSettings, conn?: PoolConnection) {
  const db = conn || pool;
  const text = clean(input.creativeText);
  const textLike = text.slice(0, 120);
  const [[creativeRow]]: any = await db.query(
    `SELECT
      (
        SELECT COUNT(*) FROM campaigns WHERE user_id = ? AND id <> ? AND LEFT(message_text, 120) = ?
      ) + (
        SELECT COUNT(*) FROM miniapp_rewarded_campaigns WHERE advertiser_id = ? AND id <> ? AND LEFT(description, 120) = ?
      ) as duplicate_count`,
    [input.advertiserId, input.campaignType === "campaign" ? input.campaignId : 0, textLike, input.advertiserId, input.campaignType === "miniapp_rewarded" ? input.campaignId : 0, textLike]
  );
  const [[domainRow]]: any = await db.query(
    `SELECT
      (
        SELECT COUNT(*) FROM campaigns WHERE user_id = ? AND id <> ? AND (link LIKE ? OR postback_url LIKE ?)
      ) + (
        SELECT COUNT(*) FROM miniapp_rewarded_campaigns WHERE advertiser_id = ? AND id <> ? AND (landing_url LIKE ? OR postback_url LIKE ?)
      ) as duplicate_count`,
    [
      input.advertiserId,
      input.campaignType === "campaign" ? input.campaignId : 0,
      `%${domain}%`,
      `%${domain}%`,
      input.advertiserId,
      input.campaignType === "miniapp_rewarded" ? input.campaignId : 0,
      `%${domain}%`,
      `%${domain}%`,
    ]
  );
  return {
    duplicate_creatives: Number(creativeRow?.duplicate_count || 0),
    duplicate_landing_pages: Number(domainRow?.duplicate_count || 0),
    creative_review: Number(creativeRow?.duplicate_count || 0) >= settings.duplicate_creative_review_threshold,
    landing_review: Number(domainRow?.duplicate_count || 0) >= settings.duplicate_landing_review_threshold,
  };
}

export async function recordAutomationAudit(input: {
  actorType: string;
  actorId?: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  decision?: string | null;
  ruleUsed?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}, conn?: PoolConnection) {
  const db = conn || pool;
  await db.query(
    `INSERT INTO automation_audit_logs
      (actor_type, actor_id, action, entity_type, entity_id, decision, rule_used, reason, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.actorType,
      input.actorId || null,
      input.action,
      input.entityType,
      input.entityId || null,
      input.decision || null,
      input.ruleUsed || null,
      input.reason || null,
      JSON.stringify(input.metadata || {}),
    ]
  );
}

async function enqueueCampaignReview(input: AutomationInput, riskLevel: string, reason: string, ruleUsed: string, metadata: Record<string, unknown>, conn?: PoolConnection) {
  const db = conn || pool;
  await db.query(
    `INSERT INTO campaign_review_queue
      (campaign_type, campaign_id, advertiser_id, risk_level, reason, rule_used, status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
     ON DUPLICATE KEY UPDATE risk_level = VALUES(risk_level), reason = VALUES(reason), rule_used = VALUES(rule_used), metadata = VALUES(metadata)`,
    [input.campaignType, input.campaignId, input.advertiserId, riskLevel, reason, ruleUsed, JSON.stringify(metadata)]
  );
}

async function enqueueDomainReview(domain: string, riskLevel: string, reason: string, metadata: Record<string, unknown>, conn?: PoolConnection) {
  if (!domain) return;
  const db = conn || pool;
  await db.query(
    "INSERT INTO domain_review_queue (domain, risk_level, reason, metadata) VALUES (?, ?, ?, ?)",
    [domain, riskLevel, reason, JSON.stringify(metadata)]
  );
}

async function notifyUser(telegramId: unknown, message: string) {
  if (!telegramId) return;
  try {
    await sendTelegramMessage(String(telegramId), message);
  } catch {
    // Notifications are best-effort and must not block moderation decisions.
  }
}

export async function evaluateCampaignAutomation(input: AutomationInput, conn?: PoolConnection) {
  const db = conn || pool;
  const settings = await getAutomationSettings(conn);
  const trust = normalizeAdvertiserTrustLevel(input.advertiserTrustLevel);
  const qualityScore = toNumber(input.qualityScore);
  const categories = [...parseJsonArray(input.categories), clean(input.category)].filter(Boolean);
  const domain = extractDomain(input.destinationUrl);
  const history = await getAdvertiserHistory(input.advertiserId, conn);
  const domainRule = await getDomainRule(domain, conn);
  const catRule = await categoryDecision(categories, conn);
  const duplicates = await duplicateSignals(input, domain, settings, conn);
  const reasons: string[] = [];
  let decision: AutomationDecision = "review";
  let ruleUsed = "hybrid_default_review";
  let riskLevel = "medium";

  await db.query(
    `INSERT INTO domain_trust_rules (domain, status, campaign_count)
     VALUES (?, 'normal', 1)
     ON DUPLICATE KEY UPDATE campaign_count = campaign_count + 1`,
    [domain || "unknown"]
  );

  if (settings.approval_mode === "manual") {
    reasons.push("Approval mode is manual");
    ruleUsed = "mode_manual";
  } else if (domainRule?.status === "blocked") {
    decision = "reject";
    riskLevel = "critical";
    reasons.push("Domain is blocked");
    ruleUsed = "domain_blocked";
  } else if (settings.restricted_always_review && trust === "restricted") {
    reasons.push("Restricted advertiser always requires review");
    ruleUsed = "trust_restricted_review";
    riskLevel = "high";
  } else if (domainRule?.status === "watchlist") {
    reasons.push("Domain is on watchlist");
    ruleUsed = "domain_watchlist_review";
    riskLevel = "high";
  } else if (catRule?.decision === "review") {
    reasons.push(catRule.reason || `${catRule.category} requires review`);
    ruleUsed = "category_review";
  } else if (duplicates.creative_review || duplicates.landing_review) {
    reasons.push("Repeated creative or landing page detected");
    ruleUsed = duplicates.creative_review ? "duplicate_creative_review" : "duplicate_landing_review";
  } else if (qualityScore < settings.min_quality_score_auto_approve) {
    reasons.push("Creative quality below auto-approval threshold");
    ruleUsed = "quality_threshold_review";
  } else if (history.rejected_campaigns > settings.max_previous_rejections_auto_approve) {
    reasons.push("Previous rejection history requires review");
    ruleUsed = "history_rejections_review";
  } else if (settings.approval_mode === "automatic") {
    decision = "auto_approve";
    ruleUsed = "mode_automatic_validation_passed";
    reasons.push("Automatic mode and validation passed");
  } else if ((trust === "premium" && settings.premium_auto_approve) || (trust === "trusted" && settings.trusted_auto_approve) || domainRule?.status === "trusted" || catRule?.decision === "auto_approve") {
    decision = "auto_approve";
    ruleUsed = trust === "premium" ? "trust_premium_auto" : trust === "trusted" ? "trust_trusted_auto" : domainRule?.status === "trusted" ? "domain_trusted_auto" : "category_auto_approve";
    reasons.push("Matched auto-approval rule");
  } else {
    reasons.push("No auto-approval rule matched");
  }

  const reason = reasons.join("; ");
  const targetTable = input.campaignType === "campaign" ? "campaigns" : "miniapp_rewarded_campaigns";
  const approvedStatus = input.campaignType === "campaign" ? "active" : "approved";

  if (decision === "auto_approve") {
    await db.query(
      `UPDATE ${targetTable}
       SET status = ?, automation_decision = ?, automation_rule_used = ?, automation_review_reason = ?, automation_checked_at = NOW()
       ${input.campaignType === "miniapp_rewarded" ? ", creative_review_status = 'approved', approved_at = COALESCE(approved_at, NOW())" : ""}
       WHERE id = ?`,
      [approvedStatus, decision, ruleUsed, reason, input.campaignId]
    );
    await db.query("UPDATE domain_trust_rules SET approval_count = approval_count + 1 WHERE domain = ?", [domain || "unknown"]);
    await notifyUser(input.advertiserTelegramId, `✅ Your campaign was approved automatically.\n\nReason: ${reason}`);
  } else {
    await db.query(
      `UPDATE ${targetTable}
       SET automation_decision = ?, automation_rule_used = ?, automation_review_reason = ?, automation_checked_at = NOW()
       WHERE id = ?`,
      [decision, ruleUsed, reason, input.campaignId]
    );
    await enqueueCampaignReview(input, riskLevel, reason, ruleUsed, { trust, qualityScore, categories, domain, domain_status: domainRule?.status || "normal", duplicates }, conn);
    if (domainRule?.status === "watchlist" || domainRule?.status === "blocked") {
      await enqueueDomainReview(domain, riskLevel, reason, { campaign_type: input.campaignType, campaign_id: input.campaignId }, conn);
    }
    await notifyUser(input.advertiserTelegramId, decision === "reject"
      ? `❌ Your campaign could not be approved automatically.\n\nReason: ${reason}`
      : `⚠️ Your campaign requires manual review.\n\nReason: ${reason}`);
  }

  await recordAutomationAudit({
    actorType: "automation",
    action: "campaign_approval_evaluated",
    entityType: input.campaignType,
    entityId: input.campaignId,
    decision,
    ruleUsed,
    reason,
    metadata: { trust, qualityScore, categories, domain, domain_status: domainRule?.status || "normal", duplicates, settings_mode: settings.approval_mode },
  }, conn);

  return { decision, ruleUsed, reason, riskLevel };
}

export async function applyAutomationBulkAction(input: {
  action: string;
  campaignType?: string;
  ids: number[];
  adminId?: number;
}, conn?: PoolConnection) {
  const db = conn || pool;
  const ids = input.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return { affected: 0 };
  const placeholders = ids.map(() => "?").join(", ");

  if (["approve", "reject", "pause", "resume"].includes(input.action)) {
    const table = input.campaignType === "miniapp_rewarded" ? "miniapp_rewarded_campaigns" : "campaigns";
    const statusMap: Record<string, string> = input.campaignType === "miniapp_rewarded"
      ? { approve: "approved", reject: "rejected", pause: "paused", resume: "approved" }
      : { approve: "active", reject: "rejected", pause: "paused", resume: "active" };
    const [result]: any = await db.query(`UPDATE ${table} SET status = ? WHERE id IN (${placeholders})`, [statusMap[input.action], ...ids]);
    await recordAutomationAudit({
      actorType: "admin",
      actorId: input.adminId,
      action: `bulk_${input.action}`,
      entityType: table,
      reason: "admin_bulk_action",
      metadata: { ids },
    }, conn);
    return { affected: Number(result.affectedRows || 0) };
  }

  if (["feature", "hide"].includes(input.action)) {
    const visible = input.action === "feature" ? 1 : 0;
    for (const table of ["channels", "bots", "miniapps"]) {
      await db.query(`UPDATE ${table} SET marketplace_visible = ? WHERE id IN (${placeholders})`, [visible, ...ids]);
    }
    await recordAutomationAudit({
      actorType: "admin",
      actorId: input.adminId,
      action: `bulk_${input.action}_inventory`,
      entityType: "inventory",
      reason: "admin_bulk_action",
      metadata: { ids },
    }, conn);
    return { affected: ids.length };
  }

  throw new Error("Unsupported bulk action");
}
