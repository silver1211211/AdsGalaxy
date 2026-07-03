/* eslint-disable @typescript-eslint/no-explicit-any -- legacy production-control payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import {
  MINIAPP_NETWORK_SETTING_KEYS,
  auditProductionAction,
  getPlatformSafetyState,
  getSettingsMap,
  upsertAdminAlert,
} from "@/lib/productionSafety";

export const dynamic = "force-dynamic";

const GLOBAL_KEYS = [
  "platform_active",
  "platform_maintenance_mode",
  "platform_read_only",
  "platform_emergency_stop",
  "platform_maintenance_message",
  "withdrawals_paused",
  "withdrawals_pause_reason",
  "withdrawal_method_BEP20_enabled",
  "withdrawal_method_TRC20_enabled",
  "withdrawal_method_TON_enabled",
  "last_cron_run",
  "last_broadcast_cron_run",
];

const NETWORK_KEYS = Object.values(MINIAPP_NETWORK_SETTING_KEYS);

function boolValue(value: unknown) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function clean(value: unknown) {
  return String(value || "").trim();
}

async function setSetting(key: string, value: string) {
  await pool.query(
    "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [key, value]
  );
}

async function countOne(sql: string, params: unknown[] = []) {
  const [[row]]: any = await pool.query(sql, params);
  return Number(row?.count || 0);
}

async function getHealthOverview() {
  const settings = await getSettingsMap([...GLOBAL_KEYS, ...NETWORK_KEYS]);
  const lastSchedulerRun = Number(settings.get("last_cron_run") || 0);
  const lastBroadcastRun = Number(settings.get("last_broadcast_cron_run") || 0);
  const now = Date.now();
  const staleScheduler = !lastSchedulerRun || now - lastSchedulerRun > 30 * 60 * 1000;
  const staleBroadcast = !lastBroadcastRun || now - lastBroadcastRun > 10 * 60 * 1000;

  if (staleScheduler) {
    await upsertAdminAlert({
      alertType: "scheduler_stopped",
      severity: "high",
      title: "Channel scheduler appears stale",
      details: "No recent channel scheduler run was recorded.",
      metadata: { last_scheduler_run: lastSchedulerRun },
    });
  }

  if (staleBroadcast) {
    await upsertAdminAlert({
      alertType: "broadcast_stopped",
      severity: "high",
      title: "Bot broadcast worker appears stale",
      details: "No recent broadcast run was recorded.",
      metadata: { last_broadcast_run: lastBroadcastRun },
    });
  }

  const networkHealth = Object.entries(MINIAPP_NETWORK_SETTING_KEYS).map(([network, key]) => ({
    network,
    enabled: boolValue(settings.get(key) ?? "1"),
  }));

  return {
    activeChannels: await countOne("SELECT COUNT(*) as count FROM channels WHERE is_deleted = FALSE AND status = 'active'"),
    pausedChannels: await countOne("SELECT COUNT(*) as count FROM channels WHERE is_deleted = FALSE AND status = 'paused'"),
    activeBots: await countOne("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status = 'active'"),
    pausedBots: await countOne("SELECT COUNT(*) as count FROM bots WHERE is_deleted = FALSE AND status = 'paused'"),
    activeMiniApps: await countOne("SELECT COUNT(*) as count FROM miniapps WHERE is_deleted = FALSE AND status IN ('approved', 'monetized')"),
    pausedMiniApps: await countOne("SELECT COUNT(*) as count FROM miniapps WHERE is_deleted = FALSE AND status = 'paused'"),
    activeAdvertisers: await countOne("SELECT COUNT(DISTINCT user_id) as count FROM campaigns WHERE status = 'active'"),
    activeCampaigns: await countOne("SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'"),
    networkHealth,
    lastSchedulerRun,
    lastBroadcastRun,
  };
}

async function getReadiness() {
  const health = await getHealthOverview();
  const checks = {
    networksConfigured: health.networkHealth.some((network) => network.enabled),
    sdkReady: await countOne("SELECT COUNT(*) as count FROM miniapps WHERE is_deleted = FALSE AND status IN ('approved', 'monetized')") >= 0,
    schedulerReady: Boolean(health.lastSchedulerRun),
    channelsHealthy: health.activeChannels > 0 && health.pausedChannels === 0,
    botsHealthy: health.activeBots > 0 || health.pausedBots === 0,
    logsWorking: await countOne("SELECT COUNT(*) as count FROM system_logs") >= 0,
    withdrawalsReady: !(await getSettingsMap(["withdrawals_paused"])).get("withdrawals_paused")?.startsWith("1"),
    campaignSystemReady: health.activeCampaigns >= 0,
  };
  return {
    ...checks,
    overallStatus: Object.values(checks).every(Boolean) ? "ready" : "attention_required",
  };
}

export async function GET(request: Request) {
  const { response } = await requireAdminPermission("read");
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const exportConfig = searchParams.get("export") === "1";

  try {
    const settings = await getSettingsMap([...GLOBAL_KEYS, ...NETWORK_KEYS]);
    const platform = await getPlatformSafetyState();
    const health = await getHealthOverview();
    const readiness = await getReadiness();
    const [alerts]: any = await pool.query("SELECT * FROM admin_alerts WHERE status = 'open' ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low'), created_at DESC LIMIT 50");
    const [audits]: any = await pool.query("SELECT * FROM admin_action_audits ORDER BY created_at DESC LIMIT 50");

    if (exportConfig) {
      const [platformConfig]: any = await pool.query("SELECT `key`, value FROM settings WHERE `key` IN (?) ORDER BY `key`", [[...GLOBAL_KEYS]]);
      const [networkConfig]: any = await pool.query("SELECT `key`, value FROM settings WHERE `key` IN (?) ORDER BY `key`", [[...NETWORK_KEYS]]);
      const [schedulerConfig]: any = await pool.query("SELECT `key`, value FROM settings WHERE `key` LIKE '%cron%' OR `key` LIKE '%scheduler%' ORDER BY `key`");
      const [referralConfig]: any = await pool.query("SELECT `key`, value FROM settings WHERE `key` LIKE '%referral%' UNION SELECT `key`, value FROM referral_growth_settings ORDER BY `key`");
      const [campaignSettings]: any = await pool.query("SELECT `key`, value FROM settings WHERE `key` LIKE '%campaign%' OR `key` LIKE '%cpm%' ORDER BY `key`");
      return NextResponse.json({ exported_at: new Date().toISOString(), platformConfig, networkConfig, schedulerConfig, referralConfig, campaignSettings });
    }

    return NextResponse.json({
      platform,
      settings: Object.fromEntries(settings),
      health,
      readiness,
      alerts,
      audits,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load production safety controls" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const body = await request.json();
    const action = clean(body.action);
    const reason = clean(body.reason);

    if (["set_platform", "set_network", "set_withdrawals"].includes(action)) {
      const dangerous = ["platform_emergency_stop", "platform_active"].includes(clean(body.key)) || action === "set_network";
      if (dangerous) {
        const permission = await requireAdminPermission("dangerous");
        if (permission.response) return permission.response;
      }
    }

    if (action === "set_platform") {
      const key = clean(body.key);
      if (!["platform_active", "platform_maintenance_mode", "platform_read_only", "platform_emergency_stop", "platform_maintenance_message"].includes(key)) {
        return NextResponse.json({ error: "Invalid platform setting" }, { status: 400 });
      }
      const value = key === "platform_maintenance_message" ? clean(body.value) : (body.value ? "1" : "0");
      await setSetting(key, value);
      await auditProductionAction({ adminId: admin?.id, action: `platform_${key}_${value === "1" ? "enabled" : "updated"}`, reason, metadata: { key, value } });
      return NextResponse.json({ success: true });
    }

    if (action === "set_network") {
      const network = clean(body.network);
      const key = MINIAPP_NETWORK_SETTING_KEYS[network];
      if (!key) return NextResponse.json({ error: "Invalid network" }, { status: 400 });
      await setSetting(key, body.enabled ? "1" : "0");
      await auditProductionAction({ adminId: admin?.id, action: body.enabled ? "network_enabled" : "network_disabled", entityType: "network", entityId: 0, reason, metadata: { network } });
      return NextResponse.json({ success: true });
    }

    if (action === "bulk_status") {
      const target = clean(body.target);
      const mode = clean(body.mode);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean) : [];
      const selectedOnly = ids.length > 0;
      const status = mode === "resume" ? "active" : "paused";
      const selectedSql = selectedOnly ? " AND id IN (?)" : "";
      const params = selectedOnly ? [ids] : [];

      if (target === "channels") {
        await pool.query(`UPDATE channels SET status = ?, paused_reason = ?, suggested_fix = ? WHERE is_deleted = FALSE${selectedSql}`, [status, status === "paused" ? reason || "Paused by admin." : null, status === "paused" ? "Paused by platform operations." : null, ...params]);
      } else if (target === "bots") {
        await pool.query(`UPDATE bots SET status = ?, paused_reason = ?, suggested_fix = ?, health_status = ? WHERE is_deleted = FALSE${selectedSql}`, [status, status === "paused" ? reason || "Paused by admin." : null, status === "paused" ? "Paused by platform operations." : null, status === "paused" ? "paused" : "active", ...params]);
      } else if (target === "miniapps") {
        await pool.query(
          `UPDATE miniapps
           SET status = CASE
             WHEN ? = 'resume' AND admin_approved_at IS NOT NULL THEN 'approved'
             WHEN ? = 'resume' THEN 'awaiting'
             ELSE 'paused'
           END
           WHERE is_deleted = FALSE${selectedSql}`,
          [mode, mode, ...params]
        );
      } else if (target === "campaigns") {
        await pool.query(`UPDATE campaigns SET status = ?, pause_reason = ? WHERE status != 'deleted'${selectedSql}`, [status, status === "paused" ? reason || "admin_paused" : null, ...params]);
      } else {
        return NextResponse.json({ error: "Invalid bulk target" }, { status: 400 });
      }

      await auditProductionAction({ adminId: admin?.id, action: `${target}_${mode}`, entityType: target, entityId: selectedOnly ? 0 : -1, reason, metadata: { selected_ids: ids } });
      return NextResponse.json({ success: true });
    }

    if (action === "set_withdrawals") {
      await setSetting("withdrawals_paused", body.paused ? "1" : "0");
      await setSetting("withdrawals_pause_reason", reason);
      await auditProductionAction({ adminId: admin?.id, action: body.paused ? "withdrawal_pause" : "withdrawal_resume", reason });
      return NextResponse.json({ success: true });
    }

    if (action === "set_withdrawal_method") {
      const method = clean(body.method).toUpperCase();
      if (!/^[A-Z0-9_]{2,20}$/.test(method)) return NextResponse.json({ error: "Invalid method" }, { status: 400 });
      await setSetting(`withdrawal_method_${method}_enabled`, body.enabled ? "1" : "0");
      await auditProductionAction({ adminId: admin?.id, action: body.enabled ? "withdrawal_method_resume" : "withdrawal_method_pause", entityType: "withdrawal_method", entityId: 0, reason, metadata: { method } });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update production safety controls" }, { status: 500 });
  }
}
