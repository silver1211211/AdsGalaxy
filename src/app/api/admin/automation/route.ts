import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin, requireAdminPermission } from "@/lib/adminAuth";
import { applyAutomationBulkAction, recordAutomationAudit } from "@/lib/approvalAutomation";
import { sendTelegramMessage } from "@/lib/telegram";

function clean(value: unknown) {
  return String(value || "").trim();
}

async function notifyUser(userId: number, message: string) {
  const [[user]]: any = await pool.query("SELECT telegram_id FROM users WHERE id = ?", [userId]);
  if (!user?.telegram_id) return;
  try {
    await sendTelegramMessage(user.telegram_id, message);
  } catch {
    // Best-effort notification.
  }
}

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [
    settings,
    categories,
    domains,
    policies,
    campaignQueue,
    domainQueue,
    publisherQueue,
    trafficQueue,
    audits,
  ]: any[] = await Promise.all([
    pool.query("SELECT `key`, value, description FROM automation_settings ORDER BY `key`"),
    pool.query("SELECT * FROM automation_category_rules ORDER BY category"),
    pool.query("SELECT * FROM domain_trust_rules ORDER BY updated_at DESC LIMIT 100"),
    pool.query("SELECT * FROM platform_policies ORDER BY active DESC, severity DESC, title"),
    pool.query("SELECT * FROM campaign_review_queue WHERE status = 'open' ORDER BY created_at DESC LIMIT 100"),
    pool.query("SELECT * FROM domain_review_queue WHERE status = 'open' ORDER BY created_at DESC LIMIT 100"),
    pool.query("SELECT * FROM publisher_review_queue WHERE status = 'open' ORDER BY created_at DESC LIMIT 100"),
    pool.query("SELECT * FROM traffic_review_queue WHERE status IN ('open', 'monitor') ORDER BY created_at DESC LIMIT 100").catch(() => [[]]),
    pool.query("SELECT * FROM automation_audit_logs ORDER BY created_at DESC LIMIT 100"),
  ]);

  return NextResponse.json({
    settings: settings[0],
    categories: categories[0],
    domains: domains[0],
    policies: policies[0],
    queues: {
      campaigns: campaignQueue[0],
      domains: domainQueue[0],
      publishers: publisherQueue[0],
      traffic: trafficQueue[0],
    },
    audits: audits[0],
  });
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;

  try {
    const body = await request.json();
    const action = clean(body.action);

    if (action === "update_setting") {
      await pool.query(
        "INSERT INTO automation_settings (`key`, value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), description = VALUES(description)",
        [clean(body.key), clean(body.value), clean(body.description)]
      );
      await recordAutomationAudit({ actorType: "admin", actorId: admin.id, action: "automation_setting_update", entityType: "automation_setting", reason: clean(body.key), metadata: body });
      return NextResponse.json({ success: true });
    }

    if (action === "upsert_category_rule") {
      await pool.query(
        `INSERT INTO automation_category_rules (category, decision, applies_to, reason)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE decision = VALUES(decision), reason = VALUES(reason)`,
        [clean(body.category), clean(body.decision) || "review", clean(body.applies_to) || "all", clean(body.reason)]
      );
      await recordAutomationAudit({ actorType: "admin", actorId: admin.id, action: "category_rule_update", entityType: "automation_category_rule", reason: clean(body.category), metadata: body });
      return NextResponse.json({ success: true });
    }

    if (action === "upsert_domain_rule") {
      await pool.query(
        `INSERT INTO domain_trust_rules (domain, status, notes)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes)`,
        [clean(body.domain).toLowerCase().replace(/^www\./, ""), clean(body.status) || "normal", clean(body.notes)]
      );
      await recordAutomationAudit({ actorType: "admin", actorId: admin.id, action: "domain_rule_update", entityType: "domain_trust_rule", reason: clean(body.domain), metadata: body });
      return NextResponse.json({ success: true });
    }

    if (action === "upsert_policy") {
      await pool.query(
        `INSERT INTO platform_policies (policy_key, title, body, severity, active)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), severity = VALUES(severity), active = VALUES(active)`,
        [clean(body.policy_key), clean(body.title), clean(body.body), clean(body.severity) || "medium", body.active ? 1 : 0]
      );
      await recordAutomationAudit({ actorType: "admin", actorId: admin.id, action: "policy_update", entityType: "platform_policy", reason: clean(body.policy_key), metadata: body });
      return NextResponse.json({ success: true });
    }

    if (action === "bulk_action") {
      const result = await applyAutomationBulkAction({
        action: clean(body.bulk_action),
        campaignType: clean(body.campaign_type),
        ids: Array.isArray(body.ids) ? body.ids : [],
        adminId: admin.id,
      });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === "warn_user") {
      const userId = Number(body.user_id);
      const level = clean(body.warning_level) || "warning";
      const reason = clean(body.reason) || "Policy warning";
      await pool.query(
        "INSERT INTO user_moderation_warnings (user_id, warning_level, reason, issued_by, metadata) VALUES (?, ?, ?, 'admin', ?)",
        [userId, level, reason, JSON.stringify({ admin_id: admin.id })]
      );
      await pool.query("UPDATE users SET automation_warning_level = ? WHERE id = ?", [level, userId]);
      await notifyUser(userId, `⚠️ AdsGalaxy account notice: ${level}\n\n${reason}`);
      await recordAutomationAudit({ actorType: "admin", actorId: admin.id, action: "user_warning", entityType: "user", entityId: userId, reason, metadata: { level } });
      return NextResponse.json({ success: true });
    }

    if (action === "suspend") {
      const entityType = clean(body.entity_type);
      const entityId = Number(body.entity_id);
      const scope = clean(body.scope) || "temporary";
      const reason = clean(body.reason) || "Suspended by admin";
      const suspendedUntil = clean(body.suspended_until) || null;
      await pool.query(
        `INSERT INTO automation_suspensions (entity_type, entity_id, scope, status, reason, suspended_until, created_by, created_by_id)
         VALUES (?, ?, ?, 'active', ?, ?, 'admin', ?)`,
        [entityType, entityId, scope, reason, suspendedUntil, admin.id]
      );

      if (entityType === "advertiser" || entityType === "publisher" || entityType === "user") {
        await pool.query("UPDATE users SET automation_suspension_status = ?, automation_suspended_until = ? WHERE id = ?", [scope === "permanent" ? "permanent" : "temporary", suspendedUntil, entityId]);
        await notifyUser(entityId, `⛔ Your AdsGalaxy account has been suspended.\n\nReason: ${reason}`);
      } else if (entityType === "channel") {
        await pool.query("UPDATE channels SET automation_suspension_status = ?, automation_suspended_until = ?, marketplace_visible = 0 WHERE id = ?", [scope === "permanent" ? "permanent" : "temporary", suspendedUntil, entityId]);
      } else if (entityType === "bot") {
        await pool.query("UPDATE bots SET automation_suspension_status = ?, automation_suspended_until = ?, marketplace_visible = 0 WHERE id = ?", [scope === "permanent" ? "permanent" : "temporary", suspendedUntil, entityId]);
      } else if (entityType === "miniapp") {
        await pool.query("UPDATE miniapps SET automation_suspension_status = ?, automation_suspended_until = ?, marketplace_visible = 0 WHERE id = ?", [scope === "permanent" ? "permanent" : "temporary", suspendedUntil, entityId]);
      }

      await recordAutomationAudit({ actorType: "admin", actorId: admin.id, action: "suspend", entityType, entityId, reason, metadata: { scope, suspendedUntil } });
      return NextResponse.json({ success: true });
    }

    if (action === "restore") {
      const entityType = clean(body.entity_type);
      const entityId = Number(body.entity_id);
      await pool.query("UPDATE automation_suspensions SET status = 'restored', restored_at = NOW() WHERE entity_type = ? AND entity_id = ? AND status = 'active'", [entityType, entityId]);
      if (entityType === "advertiser" || entityType === "publisher" || entityType === "user") {
        await pool.query("UPDATE users SET automation_suspension_status = 'active', automation_suspended_until = NULL WHERE id = ?", [entityId]);
        await notifyUser(entityId, "✅ Your AdsGalaxy account has been restored.");
      } else if (entityType === "channel") {
        await pool.query("UPDATE channels SET automation_suspension_status = 'active', automation_suspended_until = NULL WHERE id = ?", [entityId]);
      } else if (entityType === "bot") {
        await pool.query("UPDATE bots SET automation_suspension_status = 'active', automation_suspended_until = NULL WHERE id = ?", [entityId]);
      } else if (entityType === "miniapp") {
        await pool.query("UPDATE miniapps SET automation_suspension_status = 'active', automation_suspended_until = NULL WHERE id = ?", [entityId]);
      }
      await recordAutomationAudit({ actorType: "admin", actorId: admin.id, action: "restore", entityType, entityId, reason: "admin_restore" });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Automation action failed" }, { status: 500 });
  }
}
