import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  addSilverExemptUser,
  recordSilverAudit,
  reportSilverApiError,
  requireSilverAdmin,
} from "@/lib/silverCampaignControl";

export async function GET() {
  const { response } = await requireSilverAdmin();
  if (response) return response;
  const [users] = await pool.query<Array<RowDataPacket>>(
    `SELECT seu.user_id,seu.active,seu.reason,seu.created_at,u.username,u.first_name,u.last_name,
       (SELECT COUNT(*) FROM channels ch WHERE ch.user_id=seu.user_id AND ch.is_deleted=0) channel_count
     FROM silver_ad_exempt_users seu JOIN users u ON u.id=seu.user_id WHERE seu.active=1 ORDER BY seu.created_at DESC`,
  );
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const { admin, response } = await requireSilverAdmin();
  if (response) return response;
  try {
    const body = await request.json();
    const userId = Number(body.user_id);
    if (!Number.isInteger(userId) || userId <= 0)
      return NextResponse.json(
        { error: "Valid internal user ID required" },
        { status: 400 },
      );
    return NextResponse.json({
      success: true,
      ...(await addSilverExemptUser(
        userId,
        Number(admin?.id),
        String(body.reason || "").trim(),
      )),
    });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "EXEMPT_USER_ADD_FAILED";
    if (code === "USER_NOT_FOUND") {
      return NextResponse.json(
        { error: "No user was found with that internal user ID." },
        { status: 404 },
      );
    }
    reportSilverApiError("Unable to exempt publisher", error);
    return NextResponse.json(
      { error: "Unable to exempt this publisher. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const { admin, response } = await requireSilverAdmin();
  if (response) return response;
  const userId = Number(new URL(request.url).searchParams.get("user_id"));
  if (!Number.isInteger(userId) || userId <= 0)
    return NextResponse.json(
      { error: "Valid internal user ID required" },
      { status: 400 },
    );
  await pool.query(
    "UPDATE silver_ad_exempt_users SET active=0 WHERE user_id=? AND active=1",
    [userId],
  );
  await recordSilverAudit({
    adminId: admin?.id,
    action: "exempt_user_remove",
    targetUserId: userId,
  });
  return NextResponse.json({ success: true });
}
