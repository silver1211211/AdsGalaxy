import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import {
  createDeveloperApplication,
  generateDeveloperApiKey,
  getDeveloperDashboard,
  resetDeveloperApiKey,
  saveDeveloperWebhook,
} from "@/lib/developerPlatform";
import pool from "@/lib/db";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    return NextResponse.json(await getDeveloperDashboard(Number(user.id)));
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load developer dashboard" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const body = await request.json();
    const action = clean(body.action);

    if (action === "create_application") {
      const result = await createDeveloperApplication(Number(user.id), {
        name: body.name,
        platform: body.platform,
        mode: body.mode,
        permissions: body.permissions,
        allowedIps: body.allowed_ips,
        allowedOrigins: body.allowed_origins,
        webhookUrl: body.webhook_url,
      });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === "generate_key") {
      const applicationId = Number(body.application_id);
      const [apps]: any = await pool.query("SELECT permissions FROM developer_applications WHERE id = ? AND user_id = ?", [applicationId, user.id]);
      if (apps.length === 0) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      const key = await generateDeveloperApiKey(applicationId, Number(user.id), clean(body.key_type) === "public" ? "public" : "private", body.permissions || JSON.parse(apps[0].permissions || "[]"));
      return NextResponse.json({ success: true, ...key });
    }

    if (action === "reset_key") {
      const key = await resetDeveloperApiKey(Number(body.key_id), Number(user.id));
      return NextResponse.json({ success: true, ...key });
    }

    if (action === "disable_key") {
      await pool.query("UPDATE developer_api_keys SET status = 'disabled', disabled_at = NOW() WHERE id = ? AND user_id = ?", [Number(body.key_id), user.id]);
      return NextResponse.json({ success: true });
    }

    if (action === "save_webhook") {
      const result = await saveDeveloperWebhook(Number(user.id), {
        applicationId: Number(body.application_id),
        url: body.url,
        events: body.events,
      });
      return NextResponse.json({ success: true, ...result });
    }

    if (action === "update_application") {
      await pool.query(
        `UPDATE developer_applications
         SET name = ?, platform = ?, mode = ?, permissions = ?, allowed_ips = ?, allowed_origins = ?, webhook_url = ?
         WHERE id = ? AND user_id = ?`,
        [
          clean(body.name) || "AdsGalaxy App",
          clean(body.platform) || "telegram_mini_app",
          clean(body.mode) === "production" ? "production" : "sandbox",
          JSON.stringify(body.permissions || ["read_only", "reporting"]),
          clean(body.allowed_ips),
          clean(body.allowed_origins),
          clean(body.webhook_url) || null,
          Number(body.application_id),
          user.id,
        ]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid developer action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Developer action failed" }, { status: getAuthErrorStatus(error) === 403 ? 403 : 400 });
  }
}
