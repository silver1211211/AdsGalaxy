import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthErrorStatus } from "@/lib/auth";
import { authenticatePublisherAsset, PublisherAssetError, publisherAssetErrorResponse } from "@/lib/publisherAssetOnboarding";
import { buildMiniAppReport, getMiniAppReportParams } from "@/lib/miniappReports";
import type { RowDataPacket } from "mysql2/promise";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await authenticatePublisherAsset(request);
    const { id } = await params;

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM miniapps WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
      [id, user.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    const { startDate, endDate, dateSearch } = getMiniAppReportParams(request.url);
    const report = await buildMiniAppReport(id, startDate, endDate, dateSearch);
    return NextResponse.json(report);
  } catch (error: unknown) {
    if (error instanceof PublisherAssetError) return publisherAssetErrorResponse(error);
    console.error("Publisher Mini App Report Error:", error);
    const status = getAuthErrorStatus(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to fetch Mini App report" }, { status });
  }
}
