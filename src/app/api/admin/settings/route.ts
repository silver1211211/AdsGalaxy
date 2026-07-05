import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";

const MINIAPP_INTERNAL_SPLIT_KEYS = new Set([
  "miniapp_internal_publisher_share_percent",
  "miniapp_internal_ads_galaxy_share_percent",
  "miniapp_internal_reserve_percent",
]);
const CHANNEL_SETTLEMENT_PERCENT_KEYS = new Set(["platform_margin_percent", "safety_reserve_percent"]);
const GLOBAL_CPM_KEYS = new Set(["global_min_cpm", "global_recommended_cpm", "global_max_cpm"]);
const MIN_ADS_GALAXY_SHARE_PERCENT = 15;
const MIN_RESERVE_PERCENT = 10;
const CPM_ALIAS_KEYS = new Set([
  "miniapp_internal_min_cpm",
  "miniapp_internal_recommended_cpm",
  "miniapp_internal_max_cpm",
  "recommended_cpm_views",
  "recommended_cpm_clicks",
  "recommended_cpm_broadcast",
]);

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [rows] = await pool.query<Array<RowDataPacket & { key: string }>>(
      "SELECT * FROM settings WHERE `key` NOT IN (?, ?, ?, ?, ?, ?, ?) AND `key` NOT LIKE 'miniapp_category_cpm_adjustment_%' ORDER BY `key` ASC",
      [
        "last_cron_run", 
        "last_settlement_run", 
        "last_views_check", 
        "last_settlement_views_run", 
        "last_subscriber_cron_run", 
        "last_unlock_cron_run",
        "last_system_logs_cleanup_run"
      ]
    );
    const visibleRows = rows.filter((row) => !CPM_ALIAS_KEYS.has(row.key));
    return NextResponse.json({ settings: visibleRows });
  } catch (error) {
    console.error("Admin Settings GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const body = await request.json();
    const atomicSettings = body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
      ? Object.entries(body.settings) as Array<[string, unknown]>
      : [];

    if (atomicSettings.length > 0) {
      const suppliedKeys = new Set(atomicSettings.map(([settingKey]) => settingKey));
      if (atomicSettings.some(([settingKey]) => !MINIAPP_INTERNAL_SPLIT_KEYS.has(settingKey))) {
        return NextResponse.json({ error: "Atomic settings updates are limited to Mini App revenue split settings" }, { status: 400 });
      }
      if (suppliedKeys.size !== MINIAPP_INTERNAL_SPLIT_KEYS.size
        || [...MINIAPP_INTERNAL_SPLIT_KEYS].some((settingKey) => !suppliedKeys.has(settingKey))) {
        return NextResponse.json({ error: "Publisher, AdsGalaxy, and reserve percentages must be submitted together" }, { status: 400 });
      }

      const split = new Map(atomicSettings.map(([settingKey, settingValue]) => [settingKey, Number(settingValue)]));
      if ([...split.values()].some((percent) => !Number.isFinite(percent) || percent < 0 || percent > 100)) {
        return NextResponse.json({ error: "Revenue split percentages must be numbers between 0 and 100" }, { status: 400 });
      }
      const publisherPercent = split.get("miniapp_internal_publisher_share_percent")!;
      const platformPercent = split.get("miniapp_internal_ads_galaxy_share_percent")!;
      const reservePercent = split.get("miniapp_internal_reserve_percent")!;
      if (platformPercent < MIN_ADS_GALAXY_SHARE_PERCENT) {
        return NextResponse.json({ error: `AdsGalaxy platform share must be at least ${MIN_ADS_GALAXY_SHARE_PERCENT}%` }, { status: 400 });
      }
      if (reservePercent < MIN_RESERVE_PERCENT) {
        return NextResponse.json({ error: `Reserve share must be at least ${MIN_RESERVE_PERCENT}%` }, { status: 400 });
      }
      if (Math.abs(publisherPercent + platformPercent + reservePercent - 100) > 0.000001) {
        return NextResponse.json({ error: "Mini App internal revenue split must equal 100%" }, { status: 400 });
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const [settingKey, settingValue] of atomicSettings) {
          const [result] = await conn.query(
            "UPDATE settings SET value = ? WHERE `key` = ?",
            [Number(settingValue).toString(), settingKey]
          );
          if (!("affectedRows" in result) || result.affectedRows !== 1) {
            throw new Error(`Required revenue split setting is missing: ${settingKey}`);
          }
        }
        await conn.commit();
      } catch (error) {
        await conn.rollback().catch(() => undefined);
        throw error;
      } finally {
        conn.release();
      }
      return NextResponse.json({ success: true });
    }

    const { key, value } = body;
    if (!key || value === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (CHANNEL_SETTLEMENT_PERCENT_KEYS.has(key)) {
      const percent = Number(value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return NextResponse.json({ error: "Channel settlement percentage must be between 0 and 100" }, { status: 400 });
      }
    }

    if (GLOBAL_CPM_KEYS.has(key)) {
      const cpm = Number(value);
      if (!Number.isFinite(cpm) || cpm < 0) {
        return NextResponse.json({ error: "CPM setting must be a non-negative number" }, { status: 400 });
      }
      const [rows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
        "SELECT `key`, value FROM settings WHERE `key` IN ('global_min_cpm', 'global_recommended_cpm', 'global_max_cpm')"
      );
      const values = new Map(rows.map((row) => [row.key, Number(row.value || 0)]));
      values.set(key, cpm);
      const min = Number(values.get("global_min_cpm") || 0);
      const recommended = Number(values.get("global_recommended_cpm") || 0);
      const max = Number(values.get("global_max_cpm") || 0);
      if (max > 0 && min > max) {
        return NextResponse.json({ error: "Minimum CPM cannot exceed Maximum CPM" }, { status: 400 });
      }
      if (recommended < min || (max > 0 && recommended > max)) {
        return NextResponse.json({ error: "Recommended CPM must stay between Minimum CPM and Maximum CPM" }, { status: 400 });
      }
    }

    if (MINIAPP_INTERNAL_SPLIT_KEYS.has(key)) {
      const [rows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
        "SELECT `key`, value FROM settings WHERE `key` IN (?, ?, ?)",
        [
          "miniapp_internal_publisher_share_percent",
          "miniapp_internal_ads_galaxy_share_percent",
          "miniapp_internal_reserve_percent",
        ]
      );
      const nextValues = new Map(rows.map((row) => [row.key, Number(row.value || 0)]));
      nextValues.set(key, Number(value));
      const total = Number(nextValues.get("miniapp_internal_publisher_share_percent") || 0)
        + Number(nextValues.get("miniapp_internal_ads_galaxy_share_percent") || 0)
        + Number(nextValues.get("miniapp_internal_reserve_percent") || 0);
      const platformPercent = Number(nextValues.get("miniapp_internal_ads_galaxy_share_percent") || 0);
      const reservePercent = Number(nextValues.get("miniapp_internal_reserve_percent") || 0);
      if (platformPercent < MIN_ADS_GALAXY_SHARE_PERCENT) {
        return NextResponse.json({ error: `AdsGalaxy platform share must be at least ${MIN_ADS_GALAXY_SHARE_PERCENT}%` }, { status: 400 });
      }
      if (reservePercent < MIN_RESERVE_PERCENT) {
        return NextResponse.json({ error: `Reserve share must be at least ${MIN_RESERVE_PERCENT}%` }, { status: 400 });
      }
      if (Math.abs(total - 100) > 0.000001) {
        return NextResponse.json({ error: "Mini App internal revenue split must equal 100%; submit all three split settings together using the settings object" }, { status: 400 });
      }
    }

    await pool.query(
      "UPDATE settings SET value = ? WHERE `key` = ?",
      [value.toString(), key]
    );

    if (key === "global_min_cpm") {
      await pool.query(
        "INSERT INTO settings (`key`, value) VALUES ('miniapp_internal_min_cpm', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [value.toString()]
      );
    } else if (key === "global_max_cpm") {
      await pool.query(
        "INSERT INTO settings (`key`, value) VALUES ('miniapp_internal_max_cpm', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [value.toString()]
      );
    } else if (key === "global_recommended_cpm") {
      await pool.query(
        `INSERT INTO settings (\`key\`, value) VALUES
          ('miniapp_internal_recommended_cpm', ?),
          ('recommended_cpm_views', ?),
          ('recommended_cpm_clicks', ?),
          ('recommended_cpm_broadcast', ?),
          ('global_recommended_cpm_manual_override', '1')
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [value.toString(), value.toString(), value.toString(), value.toString()]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin Settings PUT Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
