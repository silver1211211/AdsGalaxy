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
  "global_min_cpm",
  "global_recommended_cpm",
  "global_max_cpm",
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
    if (settings.global_min_cpm) settings.miniapp_internal_min_cpm = settings.global_min_cpm;
    if (settings.global_recommended_cpm) {
      settings.miniapp_internal_recommended_cpm = settings.global_recommended_cpm;
      settings.recommended_cpm_views = settings.global_recommended_cpm;
      settings.recommended_cpm_clicks = settings.global_recommended_cpm;
      settings.recommended_cpm_broadcast = settings.global_recommended_cpm;
    }
    if (settings.global_max_cpm) settings.miniapp_internal_max_cpm = settings.global_max_cpm;

    return NextResponse.json(settings);
  } catch (error: unknown) {
    console.error("Settings Fetch Error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}
