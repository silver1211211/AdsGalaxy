import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { buildMiniAppAdminBreakdown, buildMiniAppReport, getMiniAppReportParams } from "@/lib/miniappReports";

function parseJsonArray(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

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
    const [diagnosticRows]: any = await pool.query(`
      SELECT request_id, selected_network, candidate_networks, skipped_networks, fallback_attempts, decision_reason, final_result, mediation_diagnostics, created_at
      FROM miniapp_mediation_requests
      WHERE miniapp_id = ?
      ORDER BY created_at DESC
      LIMIT 25
    `, [id]);

    return NextResponse.json({
      ...report,
      ...breakdown,
      network_diagnostics: diagnosticRows.map((row: any) => ({
        request_id: row.request_id,
        selected_network: row.selected_network || null,
        candidate_pool: parseJsonArray(row.candidate_networks).map(String),
        excluded_networks: parseJsonArray(row.skipped_networks),
        fallback_attempts: parseJsonArray(row.fallback_attempts),
        mediation_diagnostics: parseJsonObject(row.mediation_diagnostics),
        decision_reason: row.decision_reason,
        final_result: row.final_result,
        created_at: row.created_at,
      })),
    });
  } catch (error: unknown) {
    console.error("Admin Mini App Report Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
