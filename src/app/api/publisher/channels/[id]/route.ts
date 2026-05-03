import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

// PATCH: Update channel status OR Edit channel info
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const { title, posts_per_day, audience_continents, action } = body;

    // If it's a status toggle action
    if (action === "toggle_status") {
      const [rows]: any = await pool.query(
        "SELECT status FROM channels WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [id, user.id]
      );

      if (rows.length === 0) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }

      const currentStatus = rows[0].status;
      if (currentStatus === "pending") {
        return NextResponse.json({ error: "Cannot pause a pending channel" }, { status: 400 });
      }

      const newStatus = currentStatus === "active" ? "paused" : "active";
      await pool.query(
        "UPDATE channels SET status = ? WHERE id = ? AND user_id = ?",
        [newStatus, id, user.id]
      );
      return NextResponse.json({ success: true, status: newStatus });
    }

    // Otherwise, handle general edit
    if (title || posts_per_day || audience_continents) {
      await pool.query(
        `UPDATE channels SET 
          title = ?, 
          posts_per_day = ?, 
          audience_continents = ? 
         WHERE id = ? AND user_id = ?`,
        [title, posts_per_day, JSON.stringify(audience_continents), id, user.id]
      );
      return NextResponse.json({ success: true, message: "Channel updated successfully" });
    }

    return NextResponse.json({ error: "No update fields provided" }, { status: 400 });
  } catch (error: any) {
    console.error("PATCH Channel Error:", error);
    return NextResponse.json({ error: error.message || "Failed to update channel" }, { status: 500 });
  }
}

// DELETE: Soft-remove channel
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;

    await pool.query(
      "UPDATE channels SET is_deleted = TRUE, status = 'paused' WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE Channel Error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete channel" }, { status: 500 });
  }
}
