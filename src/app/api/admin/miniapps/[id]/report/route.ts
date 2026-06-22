import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { buildMiniAppAdminBreakdown, buildMiniAppReport, getMiniAppReportParams } from "@/lib/miniappReports";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const [rows]: any = await pool.query(
      "SELECT id FROM miniapps WHERE id = ? AND is_deleted = FALSE",
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    const { startDate, endDate, dateSearch } = getMiniAppReportParams(request.url);
    const [report, breakdown] = await Promise.all([
      buildMiniAppReport(id, startDate, endDate, dateSearch),
      buildMiniAppAdminBreakdown(id, startDate, endDate, dateSearch),
    ]);

    return NextResponse.json({ ...report, ...breakdown });
  } catch (error: unknown) {
    console.error("Admin Mini App Report Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
