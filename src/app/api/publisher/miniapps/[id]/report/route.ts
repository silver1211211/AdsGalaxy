import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { buildMiniAppReport, getMiniAppReportParams } from "@/lib/miniappReports";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;

    const [rows]: any = await pool.query(
      "SELECT id FROM miniapps WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
      [id, user.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    const { startDate, endDate, dateSearch } = getMiniAppReportParams(request.url);
    const report = await buildMiniAppReport(id, startDate, endDate, dateSearch);
    return NextResponse.json(report);
  } catch (error: any) {
    console.error("Publisher Mini App Report Error:", error);
    const status = getAuthErrorStatus(error);
    return NextResponse.json({ error: error.message || "Failed to fetch Mini App report" }, { status });
  }
}
