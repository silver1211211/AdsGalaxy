import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

const ALLOWED_TYPES = new Set([
  "channel_posting",
  "bot_broadcast_hourly",
  "channel_health",
  "bot_health",
  "system_error",
]);

const ALLOWED_STATUSES = new Set(["success", "partial_failure", "failed"]);

function parseJson(value: unknown) {
  if (!value) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
  const offset = (page - 1) * limit;
  const type = searchParams.get("type") || "all";
  const status = searchParams.get("status") || "all";
  const date = searchParams.get("date") || "";
  const search = searchParams.get("search") || "";

  try {
    const where: string[] = [];
    const params: any[] = [];

    if (type !== "all" && ALLOWED_TYPES.has(type)) {
      where.push("log_type = ?");
      params.push(type);
    }

    if (status !== "all" && ALLOWED_STATUSES.has(status)) {
      where.push("status = ?");
      params.push(status);
    }

    if (date) {
      where.push("DATE(created_at) = ?");
      params.push(date);
    }

    if (search) {
      where.push("(title LIKE ? OR summary LIKE ? OR log_type LIKE ? OR status LIKE ?)");
      const searchValue = `%${search}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const [rows]: any = await pool.query(
      `SELECT *
       FROM system_logs
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[countRow]]: any = await pool.query(
      `SELECT COUNT(*) as total FROM system_logs ${whereClause}`,
      params
    );

    const [summaryRows]: any = await pool.query(`
      SELECT log_type, status, COUNT(*) as count
      FROM system_logs
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY log_type, status
    `);

    const logs = rows.map((row: any) => ({
      ...row,
      failure_reasons: parseJson(row.failure_reasons),
      affected_entities: parseJson(row.affected_entities),
      metadata: parseJson(row.metadata),
    }));

    return NextResponse.json({
      logs,
      summary: summaryRows,
      total: Number(countRow?.total || 0),
      page,
      totalPages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / limit)),
    });
  } catch (error: any) {
    console.error("Admin System Logs API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
