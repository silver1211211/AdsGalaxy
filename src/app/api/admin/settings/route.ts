import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { isMiniAppDynamicCpmSettingKey, protectedAdminSettingKeys } from "@/lib/protectedAdminSettings";
import { assertDirectRevenueSplit, channelRevenueSplitFromStored, channelStoredPolicyFromRevenueSplit, miniAppRevenueSplitFromStored } from "@/lib/revenueSplitSettings";
import { CACHE_TTL_SECONDS, cacheGetOrSet, invalidateSettingsCaches, redisKeys } from "@/lib/redisCache";

const MINIAPP_INTERNAL_SPLIT_KEYS = new Set([
  "miniapp_internal_publisher_share_percent",
  "miniapp_internal_ads_galaxy_share_percent",
  "miniapp_internal_reserve_percent",
]);
const CHANNEL_SETTLEMENT_PERCENT_KEYS = new Set(["platform_margin_percent", "safety_reserve_percent"]);
const BROADCAST_REVENUE_SPLIT_KEYS = new Set(["broadcast_publisher_share_percent", "broadcast_reserve_percent"]);
const CHANNEL_REVENUE_SPLIT_KEYS = new Set(["channel_publisher_share_percent", "channel_reserve_percent"]);
const MINIAPP_REVENUE_SPLIT_KEYS = new Set(["miniapp_publisher_cpm_v2_max_share", "miniapp_publisher_cpm_v2_reserve_share"]);
const GROWTH_REVENUE_SPLIT_KEYS = new Set(["channel_growth_publisher_share", "channel_growth_platform_share", "channel_growth_reserve_share"]);
const TEASER_REVENUE_SPLIT_KEYS = new Set(["teaser_publisher_share","teaser_platform_share","teaser_reserve_share"]);
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
  "channel_growth_cps_min",
  "channel_growth_cps_recommended",
  "channel_growth_cps_max",
  "teaser_min_cpm",
  "teaser_recommended_cpm",
  "teaser_max_cpm",
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
  ["Channel Growth CPS", "channel_growth_cps_min", "channel_growth_cps_recommended", "channel_growth_cps_max"],
  ["Teaser", "teaser_min_cpm", "teaser_recommended_cpm", "teaser_max_cpm"],
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

async function settingsSuccess() {
  await invalidateSettingsCaches();
  return NextResponse.json({ success: true });
}

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await cacheGetOrSet(
      redisKeys.adminSettings(),
      CACHE_TTL_SECONDS.ADMIN_SETTINGS,
      async () => {
    const [rows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
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
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const visibleRows = rows.filter((row) =>
      !HIDDEN_CPM_KEYS.has(row.key)
      && !isMiniAppDynamicCpmSettingKey(row.key)
      && !CHANNEL_SETTLEMENT_PERCENT_KEYS.has(row.key)
      && !MINIAPP_INTERNAL_SPLIT_KEYS.has(row.key)
    );
    return {
      settings: visibleRows,
      revenue_splits: {
        channel: channelRevenueSplitFromStored(values.get("platform_margin_percent"), values.get("safety_reserve_percent")),
        miniapp: miniAppRevenueSplitFromStored(values.get("miniapp_publisher_cpm_v2_max_share"), values.get("miniapp_publisher_cpm_v2_reserve_share")),
      },
    };
      },
    );
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Admin Settings GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const body = await request.json();
    const atomicSettings = body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
      ? Object.entries(body.settings) as Array<[string, unknown]>
      : [];

    if (atomicSettings.length > 0) {
      const protectedKeys = protectedAdminSettingKeys(atomicSettings.map(([settingKey]) => settingKey));
      if (protectedKeys.length > 0) {
        return NextResponse.json({
          error: "Mini App dynamic CPM economic settings are read-only for administrators",
          protected_settings: protectedKeys,
        }, { status: 403 });
      }
      const suppliedKeys = new Set(atomicSettings.map(([settingKey]) => settingKey));
      if(atomicSettings.every(([key])=>TEASER_REVENUE_SPLIT_KEYS.has(key))){
        if(suppliedKeys.size!==3||[...TEASER_REVENUE_SPLIT_KEYS].some(key=>!suppliedKeys.has(key)))return NextResponse.json({error:"Teaser Publisher, Platform, and Reserve percentages must be submitted together"},{status:400});
        const values=atomicSettings.map(([,value])=>Number(value));if(values.some(value=>!Number.isFinite(value)||value<0||value>100)||Math.abs(values.reduce((sum,value)=>sum+value,0)-100)>1e-9)return NextResponse.json({error:"Teaser financial split must total exactly 100%"},{status:400});
        const conn=await pool.getConnection();try{await conn.beginTransaction();for(const [key,value] of atomicSettings)await conn.query("INSERT INTO settings (`key`,value) VALUES(?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)",[key,String(Number(value))]);await conn.commit();}catch(error){await conn.rollback();throw error;}finally{conn.release();}await recordAdminActionAudit({adminId:admin?.id,action:"teaser_revenue_split_updated",entityType:"setting_group",entityId:"teaser_revenue_split",reason:"admin_settings_update",metadata:{publisher:values[0],platform:values[1],reserve:values[2]}});return settingsSuccess();
      }
      if (atomicSettings.some(([settingKey]) => MINIAPP_INTERNAL_SPLIT_KEYS.has(settingKey))) {
        return NextResponse.json({ error: "Legacy Mini App split settings are inactive and read-only; use the dynamic CPM envelope control" }, { status: 403 });
      }
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
        return settingsSuccess();
      }

      if (atomicSettings.every(([settingKey]) => BROADCAST_REVENUE_SPLIT_KEYS.has(settingKey))) {
        if (suppliedKeys.size !== BROADCAST_REVENUE_SPLIT_KEYS.size
          || [...BROADCAST_REVENUE_SPLIT_KEYS].some((settingKey) => !suppliedKeys.has(settingKey))) {
          return NextResponse.json({ error: "Bot publisher share and reserve must be submitted together" }, { status: 400 });
        }
        const split = new Map(atomicSettings.map(([settingKey, settingValue]) => [settingKey, Number(settingValue)]));
        const publisherPercent = split.get("broadcast_publisher_share_percent")!;
        const reservePercent = split.get("broadcast_reserve_percent")!;
        if (![publisherPercent, reservePercent].every((percent) => Number.isFinite(percent) && percent >= 0 && percent <= 100)) {
          return NextResponse.json({ error: "Bot publisher share and reserve must be numbers between 0 and 100" }, { status: 400 });
        }
        if (publisherPercent + reservePercent > 100) {
          return NextResponse.json({ error: "Bot publisher share plus reserve cannot exceed 100%" }, { status: 400 });
        }
        const [currentRows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
          "SELECT `key`,value FROM settings WHERE `key` IN ('broadcast_publisher_share_percent','broadcast_reserve_percent')"
        );
        const current = new Map(currentRows.map((row) => [row.key, Number(row.value)]));
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const [settingKey, settingValue] of atomicSettings) {
            await conn.query(
              "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
              [settingKey, Number(settingValue).toString()]
            );
          }
          await conn.commit();
        } catch (error) {
          await conn.rollback().catch(() => undefined);
          throw error;
        } finally {
          conn.release();
        }
        await recordAdminActionAudit({
          adminId: admin?.id,
          action: "bot_revenue_split_updated",
          entityType: "setting_group",
          entityId: "bot_revenue_split",
          reason: "admin_settings_update",
          metadata: {
            old_split: {
              publisher_percent: current.get("broadcast_publisher_share_percent") ?? 30,
              reserve_percent: current.get("broadcast_reserve_percent") ?? 10,
            },
            new_split: {
              publisher_percent: publisherPercent,
              reserve_percent: reservePercent,
              platform_percent: 100 - publisherPercent - reservePercent,
            },
          },
        });
        return settingsSuccess();
      }

      if (atomicSettings.every(([settingKey]) => GROWTH_REVENUE_SPLIT_KEYS.has(settingKey))) {
        if (suppliedKeys.size !== 3 || [...GROWTH_REVENUE_SPLIT_KEYS].some((key) => !suppliedKeys.has(key))) return NextResponse.json({error:"All Growth shares must be submitted together"},{status:400});
        const values=atomicSettings.map(([,value])=>Number(value));
        if(values.some((value)=>!Number.isFinite(value)||value<0||value>100)||Math.abs(values.reduce((sum,value)=>sum+value,0)-100)>1e-8) return NextResponse.json({error:"Growth shares must total 100%"},{status:400});
        const conn=await pool.getConnection();try{await conn.beginTransaction();for(const [key,value] of atomicSettings)await conn.query("INSERT INTO settings (`key`,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)",[key,String(value)]);await conn.commit();}catch(error){await conn.rollback();throw error;}finally{conn.release();}
        return settingsSuccess();
      }

      if (atomicSettings.every(([settingKey]) => CHANNEL_REVENUE_SPLIT_KEYS.has(settingKey))) {
        if (suppliedKeys.size !== CHANNEL_REVENUE_SPLIT_KEYS.size
          || [...CHANNEL_REVENUE_SPLIT_KEYS].some((settingKey) => !suppliedKeys.has(settingKey))) {
          return NextResponse.json({ error: "Channel publisher share and reserve must be submitted together" }, { status: 400 });
        }
        const input = new Map(atomicSettings);
        let nextPolicy;
        try {
          nextPolicy = channelStoredPolicyFromRevenueSplit(input.get("channel_publisher_share_percent"), input.get("channel_reserve_percent"));
        } catch (error) {
          return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Channel revenue split" }, { status: 400 });
        }
        const [currentRows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
          "SELECT `key`,value FROM settings WHERE `key` IN ('platform_margin_percent','safety_reserve_percent')"
        );
        const current = new Map(currentRows.map((row) => [row.key, row.value]));
        const oldSplit = channelRevenueSplitFromStored(current.get("platform_margin_percent"), current.get("safety_reserve_percent"));
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query("INSERT INTO settings (`key`,value) VALUES ('platform_margin_percent',?) ON DUPLICATE KEY UPDATE value=VALUES(value)", [String(nextPolicy.platform_margin_percent)]);
          await conn.query("INSERT INTO settings (`key`,value) VALUES ('safety_reserve_percent',?) ON DUPLICATE KEY UPDATE value=VALUES(value)", [String(nextPolicy.safety_reserve_percent)]);
          await conn.commit();
        } catch (error) {
          await conn.rollback().catch(() => undefined);
          throw error;
        } finally {
          conn.release();
        }
        await recordAdminActionAudit({
          adminId: admin?.id,
          action: "channel_revenue_split_updated",
          entityType: "setting_group",
          entityId: "channel_revenue_split",
          reason: "admin_settings_update",
          metadata: { old_split: oldSplit, new_split: {
            publisher_percent: nextPolicy.split.publisher,
            reserve_percent: nextPolicy.split.reserve,
            platform_percent: nextPolicy.split.platform,
          } },
        });
        return settingsSuccess();
      }

      if (atomicSettings.every(([settingKey]) => MINIAPP_REVENUE_SPLIT_KEYS.has(settingKey))) {
        if (suppliedKeys.size !== MINIAPP_REVENUE_SPLIT_KEYS.size
          || [...MINIAPP_REVENUE_SPLIT_KEYS].some((settingKey) => !suppliedKeys.has(settingKey))) {
          return NextResponse.json({ error: "Mini App publisher maximum share and reserve must be submitted together" }, { status: 400 });
        }
        const input = new Map(atomicSettings);
        let nextSplit;
        try {
          nextSplit = assertDirectRevenueSplit(input.get("miniapp_publisher_cpm_v2_max_share"), input.get("miniapp_publisher_cpm_v2_reserve_share"), "Mini App");
        } catch (error) {
          return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Mini App revenue split" }, { status: 400 });
        }
        const [currentRows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
          "SELECT `key`,value FROM settings WHERE `key` IN ('miniapp_publisher_cpm_v2_max_share','miniapp_publisher_cpm_v2_reserve_share')"
        );
        const current = new Map(currentRows.map((row) => [row.key, row.value]));
        const oldSplit = miniAppRevenueSplitFromStored(current.get("miniapp_publisher_cpm_v2_max_share"), current.get("miniapp_publisher_cpm_v2_reserve_share"));
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query("INSERT INTO settings (`key`,value) VALUES ('miniapp_publisher_cpm_v2_max_share',?) ON DUPLICATE KEY UPDATE value=VALUES(value)", [String(nextSplit.publisher / 100)]);
          await conn.query("INSERT INTO settings (`key`,value) VALUES ('miniapp_publisher_cpm_v2_reserve_share',?) ON DUPLICATE KEY UPDATE value=VALUES(value)", [String(nextSplit.reserve / 100)]);
          await conn.commit();
        } catch (error) {
          await conn.rollback().catch(() => undefined);
          throw error;
        } finally {
          conn.release();
        }
        await recordAdminActionAudit({
          adminId: admin?.id,
          action: "miniapp_revenue_split_updated",
          entityType: "setting_group",
          entityId: "miniapp_revenue_split",
          reason: "admin_settings_update",
          metadata: { old_split: oldSplit, new_split: {
            publisher_percent: nextSplit.publisher,
            reserve_percent: nextSplit.reserve,
            platform_percent: nextSplit.platform,
          } },
        });
        return settingsSuccess();
      }

      return NextResponse.json({ error: "Atomic settings updates are limited to CPM groups and the Bot, Channel, or Mini App revenue split controls" }, { status: 400 });
    }

    const { key, value } = body;
    if (!key || value === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (isMiniAppDynamicCpmSettingKey(key)) {
      return NextResponse.json({
        error: "Mini App dynamic CPM economic settings are read-only for administrators",
        protected_settings: [String(key)],
      }, { status: 403 });
    }

    if (CHANNEL_SETTLEMENT_PERCENT_KEYS.has(key)) {
      return NextResponse.json({ error: "Channel revenue settings must be submitted together using the Channel revenue split control" }, { status: 403 });
    }

    if (MINIAPP_INTERNAL_SPLIT_KEYS.has(key)) {
      return NextResponse.json({ error: "Legacy Mini App split settings are inactive and read-only" }, { status: 403 });
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

    if (BROADCAST_REVENUE_SPLIT_KEYS.has(key)) {
      return NextResponse.json({ error: "Bot publisher share and reserve must be submitted together using the settings object" }, { status: 400 });
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

    return settingsSuccess();
  } catch (error) {
    console.error("Admin Settings PUT Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
