import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizePostingTimes, normalizePostsPerDay } from "@/lib/postingTimes";
import { reactivateChannelAfterHealthCheck } from "@/lib/channelLifecycle";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { clearPrivateTrackingAssignment } from "@/lib/privateChannelTrackingOnboarding";

async function hasPostingTimesColumn() {
  const [rows]: any = await pool.query(`
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'channels'
      AND COLUMN_NAME = 'posting_times'
    LIMIT 1
  `);

  return rows.length > 0;
}

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
    const { title, posts_per_day, audience_continents, categories, posting_times, action } = body;

    if (action === "set_marketplace_visibility") {
      const visible = body.visible ? 1 : 0;
      const [result]: any = await pool.query(
        "UPDATE channels SET marketplace_visible = ? WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [visible, id, user.id]
      );
      if (result.affectedRows === 0) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, marketplace_visible: visible });
    }

    // If it's a status toggle action
    if (action === "toggle_status") {
      const [rows]: any = await pool.query(
        "SELECT status, chat_id FROM channels WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
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

      if (newStatus === "active") {
        await reactivateChannelAfterHealthCheck(id, rows[0].chat_id);
        return NextResponse.json({ success: true, status: "active" });
      }

      await pool.query(
        "UPDATE channels SET status = ?, paused_reason = ?, suggested_fix = ? WHERE id = ? AND user_id = ?",
        [newStatus, "Paused by publisher.", "Reactivate when you want AdsGalaxy to resume posting.", id, user.id]
      );
      return NextResponse.json({ success: true, status: newStatus });
    }

    // Otherwise, handle general edit
    if (title || posts_per_day || audience_continents || categories || posting_times) {
      const canStorePostingTimes = await hasPostingTimesColumn();
      const [existingRows]: any = await pool.query(
        `SELECT posts_per_day${canStorePostingTimes ? ", posting_times" : ""} FROM channels WHERE id = ? AND user_id = ?`,
        [id, user.id]
      );

      if (existingRows.length === 0) {
        return NextResponse.json({ error: "Channel not found" }, { status: 404 });
      }

      const normalizedPostsPerDay = normalizePostsPerDay(posts_per_day ?? existingRows[0].posts_per_day);
      const normalizedPostingTimes = posting_times === undefined && canStorePostingTimes && existingRows[0].posting_times
        ? normalizePostingTimes(existingRows[0].posting_times, normalizedPostsPerDay)
        : normalizePostingTimes(posting_times, normalizedPostsPerDay);
      const updateColumns = [
        "title = ?",
        "posts_per_day = ?",
        "audience_continents = ?",
        "categories = ?"
      ];
      const updateParams = [
        title,
        normalizedPostsPerDay,
        JSON.stringify(audience_continents),
        JSON.stringify(categories || [])
      ];

      if (canStorePostingTimes) {
        updateColumns.push("posting_times = ?");
        updateParams.push(JSON.stringify(normalizedPostingTimes));
      } else {
        console.warn("channels.posting_times column is missing; channel posting times edit was validated but not stored");
      }

      updateParams.push(id, user.id);

      await pool.query(
        `UPDATE channels SET ${updateColumns.join(", ")} WHERE id = ? AND user_id = ?`,
        updateParams
      );
      return NextResponse.json({ success: true, message: "Channel updated successfully" });
    }

    return NextResponse.json({ error: "No update fields provided" }, { status: 400 });
  } catch (error: any) {
    console.error("PATCH Channel Error:", error);
    return NextResponse.json({ error: error.message || "Failed to update channel" }, { status: getAuthErrorStatus(error) });
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
      "UPDATE channels SET is_deleted = TRUE, status = 'deleted', paused_reason = 'Channel removed by publisher.', suggested_fix = NULL WHERE id = ? AND user_id = ?",
      [id, user.id]
    );
    await clearPrivateTrackingAssignment(id, await getChannelPrivacySchema());

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE Channel Error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete channel" }, { status: getAuthErrorStatus(error) });
  }
}
