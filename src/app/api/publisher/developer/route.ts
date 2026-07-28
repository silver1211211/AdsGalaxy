import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import {
  createDeveloperApplication,
  generateDeveloperApiKey,
  getDeveloperDashboard,
  manuallyRetryDeveloperWebhook,
  resetDeveloperApiKey,
  rotateDeveloperWebhookSecret,
  saveDeveloperWebhook,
} from "@/lib/developerPlatform";
import { createOrReactivateApplicationMiniappBinding } from "@/lib/miniappRewardEvents";
import pool from "@/lib/db";

const PUBLIC_DEVELOPER_ACTION_ERRORS = new Set([
  "Application not found",
  "Mini App not found",
  "Webhook not found",
  "Terminal webhook delivery not found",
  "Manual retry already queued",
  "Application or Mini App is unavailable",
  "Application and Mini App owners do not match",
  "Application environment does not match binding",
  "Mini App environment is already bound",
  "Valid application and Mini App IDs are required",
  "Invalid developer action",
]);

function clean(value: unknown) {
  return String(value || "").trim();
}

function publicDeveloperActionError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return PUBLIC_DEVELOPER_ACTION_ERRORS.has(message) ? message : "Developer action failed";
}

function publicDeveloperDashboardError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "Account restricted"
    || message.startsWith("Unauthorized:")
    || message.startsWith("Invalid initData:")
  ) {
    return message;
  }
  return "Failed to load developer data";
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    return NextResponse.json(await getDeveloperDashboard(Number(user.id)));
  } catch (error: any) {
    return NextResponse.json({ error: publicDeveloperDashboardError(error) }, { status: getAuthErrorStatus(error) });
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

    if (action === "bind_miniapp") {
      const applicationId = Number(body.application_id);
      const miniappId = Number(body.miniapp_id);
      const [apps]: any = await pool.query(
        "SELECT mode FROM developer_applications WHERE id = ? AND user_id = ? AND status = 'active'",
        [applicationId, user.id]
      );
      if (!apps[0]) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      const [miniapps]: any = await pool.query(
        "SELECT id FROM miniapps WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [miniappId, user.id]
      );
      if (!miniapps[0]) return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
      const environment = apps[0].mode === "production" ? "production" : "sandbox";
      const binding = await createOrReactivateApplicationMiniappBinding({
        applicationId,
        miniappId,
        environment,
      });
      await pool.query(
        `INSERT INTO developer_reward_action_audits
          (user_id, application_id, miniapp_id, action, metadata)
         VALUES (?, ?, ?, 'miniapp_bound', ?)`,
        [user.id, applicationId, miniappId, JSON.stringify({ environment })]
      );
      return NextResponse.json({ success: true, binding });
    }

    if (action === "rotate_webhook_secret") {
      const result = await rotateDeveloperWebhookSecret(Number(user.id), Number(body.webhook_id));
      return NextResponse.json({ success: true, ...result });
    }

    if (action === "retry_webhook_delivery") {
      const result = await manuallyRetryDeveloperWebhook(Number(user.id), Number(body.delivery_id));
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
    const authStatus = getAuthErrorStatus(error);
    const status = Number(error?.statusCode || (authStatus === 403 ? 403 : 400));
    console.error("Developer Center action failed", {
      error_name: error instanceof Error ? error.name : "UnknownError",
      error_code: typeof error?.code === "string" ? error.code : undefined,
    });
    return NextResponse.json({ error: publicDeveloperActionError(error) }, { status });
  }
}
