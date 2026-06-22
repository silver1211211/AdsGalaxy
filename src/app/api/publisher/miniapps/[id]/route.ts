import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { assertMiniAppBetaAccess, MiniAppBetaAccessError } from "@/lib/miniappBetaAccess";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function validateMiniAppInput(body: Record<string, unknown>) {
  const miniapp_name = cleanText(body.miniapp_name);
  const miniapp_username = cleanText(body.miniapp_username).replace(/^@/, "");
  const bot_id = cleanText(body.bot_id);
  const webapp_url = cleanText(body.webapp_url);
  const miniapp_url = cleanText(body.miniapp_url);

  if (!miniapp_name || !miniapp_username || !bot_id || !webapp_url || !miniapp_url) {
    throw new Error("All Mini App fields are required");
  }

  return { miniapp_name, miniapp_username, bot_id, webapp_url, miniapp_url };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    await assertMiniAppBetaAccess(user);
    const { id } = await params;
    const input = validateMiniAppInput(await request.json());

    const [existing]: any = await pool.query(
      "SELECT id FROM miniapps WHERE user_id = ? AND miniapp_username = ? AND id <> ? AND is_deleted = FALSE",
      [user.id, input.miniapp_username, id]
    );

    if (existing.length > 0) {
      return NextResponse.json({ error: "This Mini App username is already in your dashboard" }, { status: 400 });
    }

    const [result]: any = await pool.query(
      `UPDATE miniapps
       SET miniapp_name = ?, miniapp_username = ?, bot_id = ?, webapp_url = ?, miniapp_url = ?, status = 'pending'
       WHERE id = ? AND user_id = ? AND is_deleted = FALSE`,
      [input.miniapp_name, input.miniapp_username, input.bot_id, input.webapp_url, input.miniapp_url, id, user.id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Publisher Mini Apps PATCH Error:", error);
    const status = error instanceof MiniAppBetaAccessError ? 403 : getAuthErrorStatus(error);
    return NextResponse.json({ error: error.message || "Failed to update Mini App" }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    await assertMiniAppBetaAccess(user);
    const { id } = await params;

    const [result]: any = await pool.query(
      "UPDATE miniapps SET is_deleted = TRUE WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Publisher Mini Apps DELETE Error:", error);
    const status = error instanceof MiniAppBetaAccessError ? 403 : getAuthErrorStatus(error);
    return NextResponse.json({ error: error.message || "Failed to delete Mini App" }, { status });
  }
}
