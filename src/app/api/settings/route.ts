import { NextResponse } from "next/server";
import pool from "@/lib/db";
import type { RowDataPacket } from "mysql2/promise";

type PublicSettingRow = RowDataPacket & { key: string; value: string };

const PUBLIC_SETTING_KEYS = [
  "footer_year",
  "footer_brand",
  "footer_rights_text",
  "min_subscribers",
  "min_withdraw",
  "max_withdraw",
  "recommended_cpm_views",
  "recommended_cpm_clicks",
  "recommended_cpm_broadcast",
  "miniapp_internal_min_cpm",
  "miniapp_internal_recommended_cpm",
  "miniapp_internal_max_cpm",
] as const;

export async function GET() {
  try {
    const [rows] = await pool.query<PublicSettingRow[]>(
      "SELECT `key`, value FROM settings WHERE `key` IN (?)",
      [PUBLIC_SETTING_KEYS]
    );
    const settings = rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    return NextResponse.json(settings);
  } catch (error: unknown) {
    console.error("Settings Fetch Error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}
