/* eslint-disable @typescript-eslint/no-explicit-any -- legacy Mini App payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { assertMiniAppBetaAccess, MiniAppBetaAccessError } from "@/lib/miniappBetaAccess";
import { MiniAppSubmissionValidationError, validateMiniAppSubmission } from "@/lib/miniappSubmissionValidation";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    await assertMiniAppBetaAccess(user);
    const { id } = await params;
    const body = await request.json();

    if (body?.action === "toggle_status") {
      const [rows]: any = await pool.query(
        "SELECT status, admin_approved_at FROM miniapps WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [id, user.id]
      );
      if (rows.length === 0) return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
      const currentStatus = rows[0].status;
      if (currentStatus === "pending" || currentStatus === "awaiting") {
        return NextResponse.json({ error: "Cannot pause a pending Mini App" }, { status: 400 });
      }
      if (currentStatus === "rejected" || (currentStatus === "paused" && !rows[0].admin_approved_at)) {
        return NextResponse.json({ error: "Mini App requires manual admin approval" }, { status: 403 });
      }
      const newStatus = currentStatus === "paused" ? "approved" : "paused";
      await pool.query(
        "UPDATE miniapps SET status = ? WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [newStatus, id, user.id]
      );
      return NextResponse.json({ success: true, status: newStatus });
    }

    if (body?.action === "set_marketplace_visibility") {
      const visible = body.visible ? 1 : 0;
      const [result]: any = await pool.query(
        "UPDATE miniapps SET marketplace_visible = ? WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [visible, id, user.id]
      );
      if (result.affectedRows === 0) {
        return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, marketplace_visible: visible });
    }

    const input = validateMiniAppSubmission(body);

    const [existing]: any = await pool.query(
      "SELECT id FROM miniapps WHERE user_id = ? AND miniapp_username = ? AND id <> ? AND is_deleted = FALSE",
      [user.id, input.miniapp_username, id]
    );

    if (existing.length > 0) {
      return NextResponse.json({ error: "This Mini App username is already in your dashboard" }, { status: 400 });
    }

    const [result]: any = await pool.query(
      `UPDATE miniapps
       SET miniapp_name = ?, miniapp_username = ?, bot_id = ?, webapp_url = ?, miniapp_url = ?,
           status = 'pending', admin_approved_at = NULL, admin_approved_by = NULL
       WHERE id = ? AND user_id = ? AND is_deleted = FALSE`,
      [input.miniapp_name, input.miniapp_username, input.bot_id, input.webapp_url, input.miniapp_url, id, user.id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Publisher Mini Apps PATCH Error:", error);
    const status = error instanceof MiniAppBetaAccessError
      ? 403
      : error instanceof MiniAppSubmissionValidationError
        ? 400
        : getAuthErrorStatus(error);
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

    const [rows]: any = await pool.query(
      "SELECT id FROM miniapps WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
      [id, user.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Mini Apps submitted for integration can only be removed by an admin." }, { status: 403 });
  } catch (error: any) {
    console.error("Publisher Mini Apps DELETE Error:", error);
    const status = error instanceof MiniAppBetaAccessError ? 403 : getAuthErrorStatus(error);
    return NextResponse.json({ error: error.message || "Failed to process Mini App delete request" }, { status });
  }
}
