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

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM settings WHERE `key` NOT IN (?, ?, ?, ?, ?, ?, ?) ORDER BY `key` ASC",
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
    return NextResponse.json({ settings: rows });
  } catch (error) {
    console.error("Admin Settings GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { key, value } = await request.json();
    if (!key || value === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (CHANNEL_SETTLEMENT_PERCENT_KEYS.has(key)) {
      const percent = Number(value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return NextResponse.json({ error: "Channel settlement percentage must be between 0 and 100" }, { status: 400 });
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
      if (Math.abs(total - 100) > 0.000001) {
        return NextResponse.json({ error: "Mini App internal revenue split must equal 100%" }, { status: 400 });
      }
    }

    await pool.query(
      "UPDATE settings SET value = ? WHERE `key` = ?",
      [value.toString(), key]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin Settings PUT Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
