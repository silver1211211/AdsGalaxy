import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const { posts_per_day, continents, categories, action } = body;

    // Handle status toggle
    if (action === "toggle_status") {
      const [rows]: any = await pool.query(
        "SELECT status FROM bots WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [id, user.id]
      );

      if (rows.length === 0) {
        return NextResponse.json({ error: "Bot not found" }, { status: 404 });
      }

      const currentStatus = rows[0].status;
      if (currentStatus === "pending") {
        return NextResponse.json({ error: "Cannot pause a pending bot" }, { status: 400 });
      }

      const newStatus = currentStatus === "active" ? "paused" : "active";
      await pool.query(
        "UPDATE bots SET status = ? WHERE id = ? AND user_id = ?",
        [newStatus, id, user.id]
      );
      return NextResponse.json({ success: true, status: newStatus });
    }

    // Handle general update
    if (posts_per_day !== undefined || continents !== undefined || categories !== undefined) {
      await pool.query(
        `UPDATE bots SET 
          posts_per_day = ?, 
          continents = ?,
          categories = ?
         WHERE id = ? AND user_id = ?`,
        [posts_per_day, JSON.stringify(continents), JSON.stringify(categories || []), id, user.id]
      );
      return NextResponse.json({ success: true, message: "Bot updated successfully" });
    }

    return NextResponse.json({ error: "No update fields provided" }, { status: 400 });
  } catch (error: any) {
    console.error("PATCH Bot Error:", error);
    return NextResponse.json({ error: error.message || "Failed to update bot" }, { status: getAuthErrorStatus(error) });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;

    await pool.query(
      "UPDATE bots SET is_deleted = TRUE, status = 'paused' WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE Bot Error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete bot" }, { status: getAuthErrorStatus(error) });
  }
}
