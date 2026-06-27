import { NextResponse } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { generateDeveloperApiKey, getAdminDeveloperPlatformData } from "@/lib/developerPlatform";
import pool from "@/lib/db";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(await getAdminDeveloperPlatformData());
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load developer platform data" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const action = clean(body.action);

    if (action === "update_setting") {
      await pool.query(
        `INSERT INTO developer_platform_settings (\`key\`, value, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), description = VALUES(description)`,
        [clean(body.key), clean(body.value), clean(body.description)]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "set_application_status") {
      const status = clean(body.status) || "active";
      await pool.query(
        "UPDATE developer_applications SET status = ?, suspended_at = CASE WHEN ? = 'suspended' THEN NOW() ELSE suspended_at END WHERE id = ?",
        [status, status, Number(body.application_id)]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "set_developer_status") {
      const status = clean(body.status) || "active";
      await pool.query(
        "UPDATE developer_applications SET status = ?, suspended_at = CASE WHEN ? = 'suspended' THEN NOW() ELSE suspended_at END WHERE user_id = ?",
        [status, status, Number(body.user_id)]
      );
      await pool.query(
        "UPDATE developer_api_keys SET status = CASE WHEN ? = 'suspended' THEN 'disabled' ELSE status END, disabled_at = CASE WHEN ? = 'suspended' THEN NOW() ELSE disabled_at END WHERE user_id = ?",
        [status, status, Number(body.user_id)]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "disable_key") {
      await pool.query("UPDATE developer_api_keys SET status = 'disabled', disabled_at = NOW() WHERE id = ?", [Number(body.key_id)]);
      return NextResponse.json({ success: true });
    }

    if (action === "reset_key") {
      const [[key]]: any = await pool.query("SELECT application_id, user_id, key_type, permissions FROM developer_api_keys WHERE id = ?", [Number(body.key_id)]);
      if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
      await pool.query("UPDATE developer_api_keys SET status = 'disabled', disabled_at = NOW() WHERE id = ?", [Number(body.key_id)]);
      const newKey = await generateDeveloperApiKey(Number(key.application_id), Number(key.user_id), key.key_type === "public" ? "public" : "private", JSON.parse(key.permissions || "[]"));
      return NextResponse.json({ success: true, ...newKey });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Developer platform action failed" }, { status: 500 });
  }
}
