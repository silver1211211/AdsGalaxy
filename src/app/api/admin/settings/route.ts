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
const MIN_ADS_GALAXY_SHARE_PERCENT = 15;
const MIN_RESERVE_PERCENT = 10;
const CPM_SETTING_KEYS = new Set([
  "min_cpm_views",
  "recommended_cpm_views",
  "max_cpm_views",
  "min_cpm_clicks",
  "recommended_cpm_clicks",
  "max_cpm_clicks",
  "min_cpm_broadcast",
  "recommended_cpm_broadcast",
  "max_cpm_broadcast",
  "miniapp_internal_min_cpm",
  "miniapp_internal_recommended_cpm",
  "miniapp_internal_max_cpm",
]);
const HIDDEN_CPM_KEYS = new Set([
  "global_min_cpm",
  "global_recommended_cpm",
  "global_max_cpm",
]);

const CPM_GROUPS = [
  ["Channel views", "min_cpm_views", "recommended_cpm_views", "max_cpm_views"],
  ["Channel clicks", "min_cpm_clicks", "recommended_cpm_clicks", "max_cpm_clicks"],
  ["Bot broadcast", "min_cpm_broadcast", "recommended_cpm_broadcast", "max_cpm_broadcast"],
  ["Mini App", "miniapp_internal_min_cpm", "miniapp_internal_recommended_cpm", "miniapp_internal_max_cpm"],
] as const;

function validateCpmGroup(label: string, minValue: unknown, recommendedValue: unknown, maxValue: unknown) {
  const min = Number(minValue ?? 0);
  const recommended = Number(recommendedValue ?? 0);
  const max = Number(maxValue ?? 0);
  if (![min, recommended, max].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error(`${label} CPM values must be non-negative numbers`);
  }
  if (max > 0 && min > max) {
    throw new Error(`${label} Minimum CPM cannot exceed Maximum CPM`);
  }
  if (recommended < min || (max > 0 && recommended > max)) {
    throw new Error(`${label} Recommended CPM must stay between Minimum CPM and Maximum CPM`);
  }
}

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
    const visibleRows = rows.filter((row) => !HIDDEN_CPM_KEYS.has(row.key));
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
      if (atomicSettings.every(([settingKey]) => CPM_SETTING_KEYS.has(settingKey))) {
        const [rows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
          "SELECT `key`, value FROM settings WHERE `key` IN (?)",
          [[...CPM_SETTING_KEYS]]
        );
        const values = new Map(rows.map((row) => [row.key, row.value]));
        for (const [settingKey, settingValue] of atomicSettings) {
          values.set(settingKey, String(settingValue));
        }
        try {
          for (const [label, minKey, recommendedKey, maxKey] of CPM_GROUPS) {
            if (suppliedKeys.has(minKey) || suppliedKeys.has(recommendedKey) || suppliedKeys.has(maxKey)) {
              validateCpmGroup(label, values.get(minKey), values.get(recommendedKey), values.get(maxKey));
            }
          }
        } catch (error) {
          return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid CPM settings" }, { status: 400 });
        }

        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const [settingKey, settingValue] of atomicSettings) {
            const value = Number(settingValue);
            await conn.query(
              "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
              [settingKey, value.toString()]
            );
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

      if (atomicSettings.some(([settingKey]) => !MINIAPP_INTERNAL_SPLIT_KEYS.has(settingKey))) {
        return NextResponse.json({ error: "Atomic settings updates are limited to CPM groups or Mini App revenue split settings" }, { status: 400 });
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

    if (CPM_SETTING_KEYS.has(key)) {
      const cpm = Number(value);
      if (!Number.isFinite(cpm) || cpm < 0) {
        return NextResponse.json({ error: "CPM setting must be a non-negative number" }, { status: 400 });
      }
      const [rows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
        "SELECT `key`, value FROM settings WHERE `key` IN (?)",
        [[...CPM_SETTING_KEYS]]
      );
      const values = new Map(rows.map((row) => [row.key, Number(row.value || 0)]));
      values.set(key, cpm);
      try {
        for (const [label, minKey, recommendedKey, maxKey] of CPM_GROUPS) {
          if (key === minKey || key === recommendedKey || key === maxKey) {
            validateCpmGroup(label, values.get(minKey), values.get(recommendedKey), values.get(maxKey));
          }
        }
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid CPM setting" }, { status: 400 });
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

    if (CPM_SETTING_KEYS.has(key)) {
      await pool.query(
        "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [key, value.toString()]
      );
    } else {
      await pool.query(
        "UPDATE settings SET value = ? WHERE `key` = ?",
        [value.toString(), key]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin Settings PUT Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
