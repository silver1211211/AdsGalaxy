import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [rows] = await pool.query("SELECT * FROM campaign_limits ORDER BY budget_threshold ASC");
    return NextResponse.json({ limits: rows });
  } catch (error) {
    console.error("Admin Placement Logic GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { budget_threshold, daily_placement_limit } = await request.json();
    if (budget_threshold === undefined || daily_placement_limit === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [result]: any = await pool.query(
      "INSERT INTO campaign_limits (budget_threshold, daily_placement_limit) VALUES (?, ?)",
      [budget_threshold, daily_placement_limit]
    );

    return NextResponse.json({ success: true, id: result.insertId });
  } catch (error: any) {
    console.error("Admin Placement Logic POST Error:", error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: "A rule for this budget threshold already exists" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, budget_threshold, daily_placement_limit } = await request.json();
    if (!id || budget_threshold === undefined || daily_placement_limit === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await pool.query(
      "UPDATE campaign_limits SET budget_threshold = ?, daily_placement_limit = ? WHERE id = ?",
      [budget_threshold, daily_placement_limit, id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin Placement Logic PUT Error:", error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: "A rule for this budget threshold already exists" }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    await pool.query("DELETE FROM campaign_limits WHERE id = ?", [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin Placement Logic DELETE Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
