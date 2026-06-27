import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

type Db = typeof pool | PoolConnection;

export const MINIAPP_NETWORK_SETTING_KEYS: Record<string, string> = {
  AdsGalaxyInternal: "network_adsgalaxy_internal_enabled",
  AdsGram: "network_adsgram_enabled",
  Monetag: "network_monetag_enabled",
  RichAds: "network_richads_enabled",
  AdExium: "network_adexium_enabled",
  GigaPub: "network_gigapub_enabled",
};

const DEFAULT_MAINTENANCE_MESSAGE =
  "AdsGalaxy is in maintenance mode. You can view data, but new actions are temporarily paused.";

function enabled(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on", "active", "enabled"].includes(String(value).toLowerCase());
}

export async function getSettingsMap(keys: string[], db: Db = pool) {
  if (keys.length === 0) return new Map<string, string>();
  const [rows] = await db.query<RowDataPacket[]>("SELECT `key`, value FROM settings WHERE `key` IN (?)", [keys]);
  return new Map(rows.map((row) => [String(row.key), String(row.value ?? "")]));
}

export async function getPlatformSafetyState(db: Db = pool) {
  const settings = await getSettingsMap([
    "platform_active",
    "platform_maintenance_mode",
    "platform_read_only",
    "platform_emergency_stop",
    "platform_maintenance_message",
  ], db);

  return {
    platformActive: enabled(settings.get("platform_active"), true),
    maintenanceMode: enabled(settings.get("platform_maintenance_mode")),
    readOnly: enabled(settings.get("platform_read_only")),
    emergencyStop: enabled(settings.get("platform_emergency_stop")),
    message: settings.get("platform_maintenance_message") || DEFAULT_MAINTENANCE_MESSAGE,
  };
}

export async function requireUserWritesAllowed() {
  const state = await getPlatformSafetyState();
  if (!state.platformActive || state.maintenanceMode || state.readOnly || state.emergencyStop) {
    return NextResponse.json({
      error: state.emergencyStop ? "AdsGalaxy is temporarily paused by emergency stop." : state.message,
      maintenance_mode: state.maintenanceMode,
      read_only: state.readOnly,
      emergency_stop: state.emergencyStop,
    }, { status: 423 });
  }
  return null;
}

export async function requireAdServingAllowed() {
  const state = await getPlatformSafetyState();
  if (!state.platformActive || state.emergencyStop) {
    return NextResponse.json({
      success: false,
      error_code: "PLATFORM_PAUSED",
      message: state.emergencyStop ? "Ad serving is paused by emergency stop." : "Ad serving is temporarily paused.",
    }, { status: 503 });
  }
  return null;
}

export async function requireWithdrawalsAllowed(method?: string | null) {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const platformBlock = await requireUserWritesAllowed();
  if (platformBlock) return platformBlock;

  const keys = ["withdrawals_paused", "withdrawals_pause_reason"];
  if (normalizedMethod) keys.push(`withdrawal_method_${normalizedMethod}_enabled`);
  const settings = await getSettingsMap(keys);
  const reason = settings.get("withdrawals_pause_reason") || "Withdrawals are temporarily paused.";

  if (enabled(settings.get("withdrawals_paused"))) {
    return NextResponse.json({ error: reason }, { status: 423 });
  }

  if (normalizedMethod && settings.has(`withdrawal_method_${normalizedMethod}_enabled`) && !enabled(settings.get(`withdrawal_method_${normalizedMethod}_enabled`), true)) {
    return NextResponse.json({ error: `${normalizedMethod} withdrawals are temporarily paused. ${reason}` }, { status: 423 });
  }

  return null;
}

export async function getDisabledMiniappNetworks(db: Db = pool) {
  const settings = await getSettingsMap(Object.values(MINIAPP_NETWORK_SETTING_KEYS), db);
  return new Set(
    Object.entries(MINIAPP_NETWORK_SETTING_KEYS)
      .filter(([, key]) => !enabled(settings.get(key), true))
      .map(([network]) => network)
  );
}

export async function isMiniappNetworkGloballyDisabled(networkName?: string | null, db: Db = pool) {
  if (!networkName) return false;
  return (await getDisabledMiniappNetworks(db)).has(networkName);
}

export async function upsertAdminAlert(input: {
  alertType: string;
  severity?: "low" | "medium" | "high" | "critical";
  title: string;
  details?: string | null;
  entityType?: string | null;
  entityId?: number | string | null;
  metadata?: Record<string, unknown>;
}, db: Db = pool) {
  await db.query(
    `INSERT INTO admin_alerts (alert_type, severity, title, details, entity_type, entity_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.alertType,
      input.severity || "medium",
      input.title.slice(0, 160),
      input.details || null,
      input.entityType || null,
      input.entityId || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  ).catch(() => undefined);
}

export async function auditProductionAction(input: {
  adminId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number | string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) {
  await recordAdminActionAudit({
    adminId: input.adminId,
    action: input.action,
    entityType: input.entityType || "platform",
    entityId: input.entityId || 0,
    reason: input.reason,
    metadata: input.metadata,
  });
}
