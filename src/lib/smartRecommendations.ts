import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

export type AutomationMode = "manual" | "recommend_only" | "semi_automatic" | "automatic";
export type RecommendationStatus = "open" | "applied" | "ignored" | "resolved";
export type RecommendationFeedback = "helpful" | "not_helpful";

type Db = typeof pool | PoolConnection;

export type SmartRecommendationInput = {
  stable_key: string;
  audience_type: "advertiser" | "publisher" | "admin";
  owner_user_id?: number | null;
  entity_type?: string | null;
  entity_id?: number | null;
  recommendation_type: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  action_label?: string | null;
  masked_subject?: string | null;
  score_explanation?: string | null;
  suggestions?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  automation_eligible?: boolean;
};

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function maskId(prefix: string, id: unknown) {
  const text = String(id || "");
  return `${prefix}...${text.slice(-4) || "0000"}`;
}

function categoryRisk(category: string) {
  const text = category.toLowerCase();
  if (/(crypto|trading|finance|loan|bet)/.test(text)) return 1.35;
  if (/(ai|education|utilities|productivity)/.test(text)) return 1.1;
  return 1;
}

function cpmSuggestions(currentCpm: number, category: string, qualityScore = 60, demandLevel = 1) {
  const qualityBoost = qualityScore >= 75 ? 1.15 : qualityScore < 45 ? 0.9 : 1;
  const base = Math.max(0.35, currentCpm || 0.5) * categoryRisk(category) * qualityBoost * demandLevel;
  return {
    minimum_viable_cpm: Number(Math.max(0.35, base * 0.85).toFixed(2)),
    recommended_cpm: Number(Math.max(0.5, base * 1.15).toFixed(2)),
    competitive_cpm: Number(Math.max(0.75, base * 1.45).toFixed(2)),
    rationale: "Based on category risk, targeting breadth, quality signals, and recent delivery availability.",
  };
}

function budgetSuggestions(cpm: number, estimatedReach = 10000, goal = "balanced") {
  const reachFactor = goal === "growth" ? 1.5 : goal === "test" ? 0.5 : 1;
  const dailyImpressions = Math.max(1000, estimatedReach * 0.12 * reachFactor);
  const dailyBudget = (dailyImpressions / 1000) * Math.max(cpm, 0.5);
  return {
    suggested_daily_budget: Number(dailyBudget.toFixed(2)),
    suggested_total_budget: Number((dailyBudget * 7).toFixed(2)),
    estimated_daily_reach: Math.round(dailyImpressions * 0.72),
    rationale: "Estimated from reach, CPM, campaign goal, and available inventory signals.",
  };
}

function scoreExplanation(kind: string, score: number, label?: string) {
  if (score >= 80) return `${kind} is strong. Recent quality, delivery, and consistency signals are healthy.`;
  if (score >= 55) return `${kind} is stable. There is room to improve delivery quality or consistency.`;
  if (score >= 35) return `${kind} needs attention. Recent signals show weak performance or elevated risk.`;
  return `${kind} is at risk. Review recent failures, quality trends, and delivery fit before scaling.`;
}

async function getAutomationMode(db: Db = pool): Promise<AutomationMode> {
  const [[row]]: any = await db.query("SELECT value FROM settings WHERE `key` = 'smart_automation_mode' LIMIT 1");
  const value = String(row?.value || "recommend_only");
  return ["manual", "recommend_only", "semi_automatic", "automatic"].includes(value) ? value as AutomationMode : "recommend_only";
}

async function upsertRecommendations(items: SmartRecommendationInput[], db: Db = pool) {
  if (items.length === 0) return;
  const mode = await getAutomationMode(db);
  for (const item of items) {
    await db.query(
      `INSERT INTO smart_recommendations
        (stable_key, audience_type, owner_user_id, entity_type, entity_id, recommendation_type, severity, title, summary,
         action_label, masked_subject, score_explanation, suggestions, metrics, automation_eligible, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, 'rule_based')
       ON DUPLICATE KEY UPDATE
        severity = VALUES(severity),
        title = VALUES(title),
        summary = VALUES(summary),
        action_label = VALUES(action_label),
        masked_subject = VALUES(masked_subject),
        score_explanation = VALUES(score_explanation),
        suggestions = VALUES(suggestions),
        metrics = VALUES(metrics),
        automation_eligible = VALUES(automation_eligible),
        updated_at = CURRENT_TIMESTAMP`,
      [
        item.stable_key,
        item.audience_type,
        item.owner_user_id ?? null,
        item.entity_type ?? null,
        item.entity_id ?? null,
        item.recommendation_type,
        item.severity || "info",
        item.title,
        item.summary,
        item.action_label || null,
        item.masked_subject || null,
        item.score_explanation || null,
        JSON.stringify({ ...(item.suggestions || {}), automation_mode: mode }),
        JSON.stringify(item.metrics || {}),
        item.automation_eligible ? 1 : 0,
      ]
    );
  }
}

export async function refreshAdvertiserRecommendations(advertiserId: number, db: Db = pool) {
  const [campaigns]: any = await db.query(
    `SELECT id, name, type, status, budget, cpm, category, quality_score, campaign_priority_score,
            advertiser_performance_score, delivery_quality_rating, daily_budget_limit, countries, languages,
            (SELECT COUNT(*) FROM campaign_posts cp WHERE cp.campaign_id = campaigns.id) as deliveries
     FROM campaigns
     WHERE user_id = ? AND is_deleted = FALSE
     ORDER BY updated_at DESC
     LIMIT 50`,
    [advertiserId]
  );
  const [miniappCampaigns]: any = await db.query(
    `SELECT id, campaign_name as name, 'miniapp' as type, status, budget, admin_cpm as cpm,
            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(categories, '$[0]')), 'Mini App') as category,
            quality_score, campaign_priority_score, advertiser_performance_score, delivery_quality_rating,
            target_countries as countries, NULL as languages,
            (SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = miniapp_rewarded_campaigns.id) as deliveries
     FROM miniapp_rewarded_campaigns
     WHERE advertiser_id = ?
     ORDER BY updated_at DESC
     LIMIT 50`,
    [advertiserId]
  );

  const items: SmartRecommendationInput[] = [];
  for (const campaign of [...campaigns, ...miniappCampaigns]) {
    const id = Number(campaign.id);
    const cpm = toNumber(campaign.cpm);
    const quality = toNumber(campaign.quality_score, 50);
    const priority = toNumber(campaign.campaign_priority_score, 50);
    const deliveries = toNumber(campaign.deliveries);
    const name = String(campaign.name || `Campaign ${id}`);
    const category = String(campaign.category || "General");
    const suggestions = {
      cpm: cpmSuggestions(cpm, category, quality, deliveries < 5 ? 1.15 : 1),
      budget: budgetSuggestions(cpm, Math.max(5000, deliveries * 1200), deliveries < 5 ? "growth" : "balanced"),
      targeting: {
        countries: campaign.countries ? "Keep strongest countries and remove countries with weak CTR or completion." : "Start with broad countries, then narrow after 500+ impressions.",
        languages: campaign.languages ? "Keep language targeting aligned with your landing page." : "Add language targeting when your creative is language-specific.",
        inventory_types: campaign.type === "miniapp" ? ["miniapp"] : ["channel", "bot"],
      },
      creative: {
        title: name.length > 42 ? "Shorten title for faster scanning." : "Title length is acceptable.",
        cta: "Use a direct action verb tied to the reward or offer.",
        landing_url: "Check load speed, offer clarity, and Telegram-safe redirects.",
      },
    };

    if (deliveries < 5 && ["active", "approved"].includes(String(campaign.status))) {
      items.push({
        stable_key: `adv:${advertiserId}:campaign:${campaign.type}:${id}:low_delivery`,
        audience_type: "advertiser",
        owner_user_id: advertiserId,
        entity_type: campaign.type === "miniapp" ? "miniapp_campaign" : "campaign",
        entity_id: id,
        recommendation_type: "smart_cpm",
        severity: "medium",
        title: "Increase CPM to improve delivery",
        summary: `${name} has limited delivery. A higher CPM can make it eligible for more quality inventory.`,
        action_label: "Review CPM",
        masked_subject: maskId("campaign", id),
        score_explanation: scoreExplanation("Campaign health", priority),
        suggestions,
        metrics: { current_cpm: cpm, deliveries, quality_score: quality },
      });
    }
    if (quality < 55) {
      items.push({
        stable_key: `adv:${advertiserId}:campaign:${campaign.type}:${id}:creative_quality`,
        audience_type: "advertiser",
        owner_user_id: advertiserId,
        entity_type: campaign.type === "miniapp" ? "miniapp_campaign" : "campaign",
        entity_id: id,
        recommendation_type: "creative",
        severity: quality < 35 ? "high" : "medium",
        title: "Improve creative before scaling",
        summary: "Creative quality signals are below the healthy range. Use clearer copy, stronger CTA, and safer landing page messaging.",
        action_label: "Improve creative",
        masked_subject: maskId("campaign", id),
        score_explanation: scoreExplanation("Campaign creative score", quality),
        suggestions,
        metrics: { quality_score: quality, current_cpm: cpm },
      });
    }
    if (priority >= 75 && deliveries > 20) {
      items.push({
        stable_key: `adv:${advertiserId}:campaign:${campaign.type}:${id}:scale_budget`,
        audience_type: "advertiser",
        owner_user_id: advertiserId,
        entity_type: campaign.type === "miniapp" ? "miniapp_campaign" : "campaign",
        entity_id: id,
        recommendation_type: "budget",
        severity: "info",
        title: "Increase budget for a strong campaign",
        summary: `${name} has healthy delivery signals. Consider increasing budget while monitoring conversion quality.`,
        action_label: "Review budget",
        masked_subject: maskId("campaign", id),
        score_explanation: scoreExplanation("Campaign health", priority),
        suggestions,
        metrics: { campaign_priority_score: priority, deliveries },
      });
    }
  }
  await upsertRecommendations(items, db);
  return items.length;
}

export async function refreshPublisherRecommendations(publisherId: number, db: Db = pool) {
  const [channels]: any = await db.query(
    `SELECT id, title, status, health_status, paused_reason, traffic_quality_score, inventory_score
     FROM channels WHERE user_id = ? AND is_deleted = FALSE LIMIT 80`,
    [publisherId]
  );
  const [bots]: any = await db.query(
    `SELECT b.id, b.bot_name, b.status, b.health_status, b.paused_reason, b.traffic_quality_score, b.inventory_score,
            (SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id AND (bu.is_active = FALSE OR bu.status != 'active')) as inactive_users
     FROM bots b WHERE b.user_id = ? AND b.is_deleted = FALSE LIMIT 80`,
    [publisherId]
  );
  const [miniapps]: any = await db.query(
    `SELECT id, miniapp_name, status, traffic_quality_score, inventory_score,
            (SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id) as requests,
            (SELECT COUNT(*) FROM miniapp_mediation_requests mr WHERE mr.miniapp_id = miniapps.id AND mr.impression_confirmed = 1) as confirmed
     FROM miniapps WHERE user_id = ? AND is_deleted = FALSE LIMIT 80`,
    [publisherId]
  );

  const items: SmartRecommendationInput[] = [];
  for (const channel of channels) {
    if (String(channel.status) !== "active" || String(channel.health_status || "active") !== "active") {
      items.push({
        stable_key: `pub:${publisherId}:channel:${channel.id}:health`,
        audience_type: "publisher",
        owner_user_id: publisherId,
        entity_type: "channel",
        entity_id: Number(channel.id),
        recommendation_type: "inventory_fix",
        severity: "high",
        title: "Fix paused channel",
        summary: "This channel is not fully healthy. Re-add the AdsGalaxy bot as admin and check posting permissions.",
        action_label: "Check channel",
        masked_subject: maskId("channel", channel.id),
        score_explanation: scoreExplanation("Channel inventory score", toNumber(channel.inventory_score, 50)),
        suggestions: { next_steps: ["Re-add AdsGalaxy bot as admin", "Confirm post permissions", "Request reactivation after fixing access"] },
        metrics: { traffic_quality_score: channel.traffic_quality_score, inventory_score: channel.inventory_score },
        automation_eligible: true,
      });
    }
  }
  for (const bot of bots) {
    if (toNumber(bot.inactive_users) > 25 || String(bot.health_status || "active") !== "active") {
      items.push({
        stable_key: `pub:${publisherId}:bot:${bot.id}:inactive_users`,
        audience_type: "publisher",
        owner_user_id: publisherId,
        entity_type: "bot",
        entity_id: Number(bot.id),
        recommendation_type: "bot_health",
        severity: toNumber(bot.inactive_users) > 100 ? "high" : "medium",
        title: "Check inactive bot users",
        summary: "Inactive or unreachable bot users are increasing. Clean inactive users and verify the bot token is healthy.",
        action_label: "Review bot users",
        masked_subject: maskId("bot", bot.id),
        score_explanation: scoreExplanation("Bot inventory score", toNumber(bot.inventory_score, 50)),
        suggestions: { next_steps: ["Remove unreachable users", "Check bot token health", "Encourage users to restart the bot"] },
        metrics: { inactive_users: bot.inactive_users, traffic_quality_score: bot.traffic_quality_score },
        automation_eligible: true,
      });
    }
  }
  for (const miniapp of miniapps) {
    const requests = toNumber(miniapp.requests);
    const completionRate = requests ? toNumber(miniapp.confirmed) / requests : 0;
    if (requests >= 20 && completionRate < 0.35) {
      items.push({
        stable_key: `pub:${publisherId}:miniapp:${miniapp.id}:completion`,
        audience_type: "publisher",
        owner_user_id: publisherId,
        entity_type: "miniapp",
        entity_id: Number(miniapp.id),
        recommendation_type: "completion_rate",
        severity: "medium",
        title: "Improve Mini App completion rate",
        summary: "Many ad requests are not becoming confirmed impressions. Review ad placement timing and avoid interrupting users too early.",
        action_label: "Review Mini App",
        masked_subject: maskId("miniapp", miniapp.id),
        score_explanation: scoreExplanation("Mini App traffic quality", toNumber(miniapp.traffic_quality_score, 60)),
        suggestions: { next_steps: ["Place rewarded ads after user intent", "Avoid repeated prompts", "Check Telegram WebApp initData availability"] },
        metrics: { requests, completion_rate: Number(completionRate.toFixed(4)), inventory_score: miniapp.inventory_score },
      });
    }
  }
  await upsertRecommendations(items, db);
  return items.length;
}

export async function refreshAdminRecommendations(db: Db = pool) {
  const [riskyUsers]: any = await db.query(
    `SELECT id, publisher_risk_score, advertiser_risk_score, advertiser_trust_level
     FROM users
     WHERE publisher_risk_score >= 70 OR advertiser_risk_score >= 70 OR advertiser_trust_level = 'restricted'
     ORDER BY GREATEST(publisher_risk_score, advertiser_risk_score) DESC
     LIMIT 30`
  );
  const [inventory]: any = await db.query(
    `(SELECT 'channel' as type, id, user_id, traffic_quality_score, inventory_score, health_status FROM channels WHERE is_deleted = FALSE AND (traffic_quality_score < 45 OR inventory_score < 40 OR COALESCE(health_status, 'active') != 'active') LIMIT 30)
     UNION ALL
     (SELECT 'bot' as type, id, user_id, traffic_quality_score, inventory_score, health_status FROM bots WHERE is_deleted = FALSE AND (traffic_quality_score < 45 OR inventory_score < 40 OR COALESCE(health_status, 'active') != 'active') LIMIT 30)
     UNION ALL
     (SELECT 'miniapp' as type, id, user_id, traffic_quality_score, inventory_score, status as health_status FROM miniapps WHERE is_deleted = FALSE AND (traffic_quality_score < 45 OR inventory_score < 40) LIMIT 30)`
  );
  const [campaigns]: any = await db.query(
    `SELECT id, name, user_id, status, cpm, category, quality_score, advertiser_performance_score
     FROM campaigns
     WHERE is_deleted = FALSE AND status IN ('active', 'approved', 'pending') AND (cpm < 0.5 OR quality_score < 40 OR advertiser_performance_score < 40)
     ORDER BY updated_at DESC
     LIMIT 30`
  );

  const items: SmartRecommendationInput[] = [];
  for (const user of riskyUsers) {
    const risk = Math.max(toNumber(user.publisher_risk_score), toNumber(user.advertiser_risk_score));
    items.push({
      stable_key: `admin:user:${user.id}:risk`,
      audience_type: "admin",
      owner_user_id: null,
      entity_type: "user",
      entity_id: Number(user.id),
      recommendation_type: "risk_review",
      severity: risk >= 85 ? "critical" : "high",
      title: "Review high-risk account",
      summary: "Risk signals are elevated. Review recent traffic, campaign behavior, and moderation history before allowing more scale.",
      action_label: "Open review",
      masked_subject: maskId("user", user.id),
      score_explanation: scoreExplanation("Traffic and account risk", 100 - risk),
      suggestions: { admin_next_steps: ["Review traffic quality page", "Check recent campaigns and inventory", "Avoid exposing private user details in notes"] },
      metrics: { publisher_risk_score: user.publisher_risk_score, advertiser_risk_score: user.advertiser_risk_score },
    });
  }
  for (const item of inventory) {
    items.push({
      stable_key: `admin:inventory:${item.type}:${item.id}:quality`,
      audience_type: "admin",
      entity_type: String(item.type),
      entity_id: Number(item.id),
      recommendation_type: "inventory_optimization",
      severity: toNumber(item.traffic_quality_score, 60) < 35 ? "high" : "medium",
      title: "Review low-quality traffic source",
      summary: "Inventory quality or health is below the recommended operating range. Consider limiting delivery until the source improves.",
      action_label: "Review inventory",
      masked_subject: maskId(String(item.type), item.id),
      score_explanation: scoreExplanation("Inventory score", toNumber(item.inventory_score, 50)),
      suggestions: { allocation: "Give more delivery to high-completion, high-quality inventory and reduce exposure here until signals recover." },
      metrics: { traffic_quality_score: item.traffic_quality_score, inventory_score: item.inventory_score, health_status: item.health_status },
      automation_eligible: true,
    });
  }
  for (const campaign of campaigns) {
    items.push({
      stable_key: `admin:campaign:${campaign.id}:efficiency`,
      audience_type: "admin",
      entity_type: "campaign",
      entity_id: Number(campaign.id),
      recommendation_type: toNumber(campaign.cpm) < 0.5 ? "cpm_alert" : "campaign_quality",
      severity: "medium",
      title: toNumber(campaign.cpm) < 0.5 ? "CPM may be too low" : "Campaign needs quality review",
      summary: "The campaign may under-deliver or attract lower-quality allocation because CPM or quality signals are weak.",
      action_label: "Review campaign",
      masked_subject: maskId("campaign", campaign.id),
      score_explanation: scoreExplanation("Campaign health", toNumber(campaign.advertiser_performance_score, 50)),
      suggestions: { cpm: cpmSuggestions(toNumber(campaign.cpm), String(campaign.category || "General"), toNumber(campaign.quality_score, 50)) },
      metrics: { current_cpm: campaign.cpm, quality_score: campaign.quality_score, advertiser_performance_score: campaign.advertiser_performance_score },
    });
  }
  await upsertRecommendations(items, db);
  return items.length;
}

export async function listRecommendations(input: {
  audience: "advertiser" | "publisher" | "admin";
  ownerUserId?: number | null;
  status?: string;
  type?: string;
  limit?: number;
  db?: Db;
}) {
  const db = input.db || pool;
  const where = ["audience_type = ?"];
  const params: any[] = [input.audience];
  if (input.ownerUserId) {
    where.push("owner_user_id = ?");
    params.push(input.ownerUserId);
  }
  if (input.status && input.status !== "all") {
    where.push("status = ?");
    params.push(input.status);
  }
  if (input.type && input.type !== "all") {
    where.push("recommendation_type = ?");
    params.push(input.type);
  }
  params.push(Math.min(Math.max(Number(input.limit || 80), 1), 200));
  const [rows]: any = await db.query(
    `SELECT * FROM smart_recommendations
     WHERE ${where.join(" AND ")}
     ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low', 'info'), updated_at DESC
     LIMIT ?`,
    params
  );
  return rows.map((row: any) => ({
    ...row,
    suggestions: typeof row.suggestions === "string" ? JSON.parse(row.suggestions || "{}") : row.suggestions,
    metrics: typeof row.metrics === "string" ? JSON.parse(row.metrics || "{}") : row.metrics,
  }));
}

export async function recommendationSummary(audience: "advertiser" | "publisher" | "admin", ownerUserId?: number | null, db: Db = pool) {
  const params: any[] = [audience];
  const ownerClause = ownerUserId ? "AND owner_user_id = ?" : "";
  if (ownerUserId) params.push(ownerUserId);
  const [rows]: any = await db.query(
    `SELECT status, severity, COUNT(*) as count
     FROM smart_recommendations
     WHERE audience_type = ? ${ownerClause}
     GROUP BY status, severity`,
    params
  );
  return rows;
}

export async function updateRecommendation(id: number, input: { status?: RecommendationStatus; feedback?: RecommendationFeedback }, db: Db = pool) {
  const fields: string[] = [];
  const params: any[] = [];
  if (input.status && ["open", "applied", "ignored", "resolved"].includes(input.status)) {
    fields.push("status = ?");
    params.push(input.status);
    if (input.status === "applied") fields.push("applied_at = NOW()");
    if (input.status === "ignored") fields.push("ignored_at = NOW()");
    if (input.status === "resolved") fields.push("resolved_at = NOW()");
  }
  if (input.feedback && ["helpful", "not_helpful"].includes(input.feedback)) {
    fields.push("feedback = ?", "feedback_at = NOW()");
    params.push(input.feedback);
  }
  if (fields.length === 0) return;
  params.push(id);
  await db.query(`UPDATE smart_recommendations SET ${fields.join(", ")} WHERE id = ?`, params);
}

export async function getSmartSettings(db: Db = pool) {
  const [rows]: any = await db.query(
    "SELECT `key`, value FROM settings WHERE `key` IN ('smart_automation_mode', 'smart_recommendations_enabled', 'smart_alerts_enabled', 'smart_low_risk_auto_apply_enabled', 'smart_ai_provider')"
  );
  return Object.fromEntries(rows.map((row: any) => [row.key, row.value]));
}

export async function updateSmartAutomationMode(mode: AutomationMode, db: Db = pool) {
  if (!["manual", "recommend_only", "semi_automatic", "automatic"].includes(mode)) {
    throw new Error("Invalid automation mode");
  }
  await db.query(
    "INSERT INTO settings (`key`, value) VALUES ('smart_automation_mode', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [mode]
  );
}

export { budgetSuggestions, cpmSuggestions, scoreExplanation };
