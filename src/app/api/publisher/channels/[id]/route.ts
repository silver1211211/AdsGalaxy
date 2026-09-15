/* eslint-disable @typescript-eslint/no-explicit-any -- legacy channel payloads are not schema-generated */
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { logPublisherChannelError, publisherChannelError } from "@/lib/publisherChannelErrors";
import { normalizePostingTimes, normalizePostsPerDay } from "@/lib/postingTimes";
import { reactivateChannelAfterHealthCheck } from "@/lib/channelLifecycle";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { clearPrivateTrackingAssignment } from "@/lib/privateChannelTrackingOnboarding";
import { notifyChannelRemoved } from "@/lib/publisherNotifications";
import { normalizeChannelAudience } from "@/lib/channelAudience";
import { validateTeaserDailyLimit } from "@/lib/teaser";

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
    const { title, posts_per_day, audience_continents, categories, posting_times, teaser_enabled, teaser_daily_limit, action } = body;

    if(action==="check_teaser_permission"){
      const [rows]=await pool.query<Array<RowDataPacket&{chat_id:string|number}>>("SELECT chat_id FROM channels WHERE id=? AND user_id=? AND is_deleted=FALSE LIMIT 1",[id,user.id]);if(!rows[0])return publisherChannelError("CHANNEL_NOT_ACCESSIBLE",404);
      const token=String(process.env.BOT_TOKEN||"");if(!token)return NextResponse.json({error:"TELEGRAM_UNAVAILABLE"},{status:503});
      const me=await fetch(`https://api.telegram.org/bot${token}/getMe`,{signal:AbortSignal.timeout(8000)}).then(response=>response.json()) as {ok:boolean;result?:{id:number}};const member=me.ok&&me.result?await fetch(`https://api.telegram.org/bot${token}/getChatMember`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:rows[0].chat_id,user_id:me.result.id}),signal:AbortSignal.timeout(8000)}).then(response=>response.json()) as {ok:boolean;result?:{status:string;can_edit_messages?:boolean}}:null;const canEdit=Boolean(member?.ok&&(member.result?.status==="creator"||(member.result?.status==="administrator"&&member.result.can_edit_messages===true)));
      await pool.query("UPDATE channels SET teaser_status=?,teaser_permission_checked_at=NOW() WHERE id=? AND user_id=? AND teaser_enabled=1",[canEdit?"active":"needs_permission",id,user.id]);return NextResponse.json({success:true,can_edit_messages:canEdit,status:canEdit?"active":"needs_permission"});
    }

    if (action === "set_teaser_settings") {
      const enabled = Boolean(body.enabled);
      const dailyLimit = validateTeaserDailyLimit(body.daily_limit);
      const [result]: any = await pool.query(
        "UPDATE channels SET teaser_enabled=?,teaser_daily_limit=?,teaser_status=CASE WHEN ?=0 THEN 'disabled' WHEN teaser_status='disabled' THEN 'needs_permission' ELSE teaser_status END WHERE id=? AND user_id=? AND is_deleted=FALSE",
        [enabled ? 1 : 0, dailyLimit, enabled ? 1 : 0, id, user.id],
      );
      if (result.affectedRows !== 1) return publisherChannelError("CHANNEL_NOT_ACCESSIBLE", 404);
      if (!enabled) await pool.query("UPDATE teaser_placements SET status='removal_pending',removal_requested_at=COALESCE(removal_requested_at,NOW()),removal_reason='publisher_opt_out' WHERE channel_id=? AND status IN ('active','awaiting_baseline')", [id]);
      return NextResponse.json({ success: true, teaser_enabled: enabled, teaser_daily_limit: dailyLimit });
    }

    if (action === "set_marketplace_visibility") {
      const visible = body.visible ? 1 : 0;
      const [result]: any = await pool.query(
        "UPDATE channels SET marketplace_visible = ? WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [visible, id, user.id]
      );
      if (result.affectedRows === 0) {
        return publisherChannelError("CHANNEL_NOT_ACCESSIBLE", 404);
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
        return publisherChannelError("CHANNEL_NOT_ACCESSIBLE", 404);
      }

      const currentStatus = rows[0].status;
      const publisherResumableStatuses = ["paused", "bot_removed", "channel_not_found", "permission_missing"];
      if (currentStatus !== "active" && !publisherResumableStatuses.includes(currentStatus)) {
        return publisherChannelError("PERMISSION_REQUIRED", 403);
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
    if (title || posts_per_day || audience_continents || categories || posting_times || teaser_enabled !== undefined || teaser_daily_limit !== undefined) {
      let normalizedAudience: string;
      try {
        normalizedAudience = normalizeChannelAudience(audience_continents);
      } catch (error) {
        return NextResponse.json({
          error: error instanceof Error ? error.message : "Channel audience is invalid",
        }, { status: 400 });
      }
      const canStorePostingTimes = await hasPostingTimesColumn();
      const [existingRows]: any = await pool.query(
        `SELECT posts_per_day, teaser_enabled, teaser_daily_limit${canStorePostingTimes ? ", posting_times" : ""} FROM channels WHERE id = ? AND user_id = ?`,
        [id, user.id]
      );

      if (existingRows.length === 0) {
        return publisherChannelError("CHANNEL_NOT_ACCESSIBLE", 404);
      }

      const normalizedPostsPerDay = normalizePostsPerDay(posts_per_day ?? existingRows[0].posts_per_day);
      const normalizedPostingTimes = posting_times === undefined && canStorePostingTimes && existingRows[0].posting_times
        ? normalizePostingTimes(existingRows[0].posting_times, normalizedPostsPerDay)
        : normalizePostingTimes(posting_times, normalizedPostsPerDay);
      const normalizedTeaserEnabled = teaser_enabled === undefined ? Boolean(existingRows[0].teaser_enabled) : Boolean(teaser_enabled);
      const normalizedTeaserDailyLimit = validateTeaserDailyLimit(teaser_daily_limit ?? existingRows[0].teaser_daily_limit ?? 2);
      const updateColumns = [
        "title = ?",
        "posts_per_day = ?",
        "audience_continents = ?",
        "categories = ?",
        "teaser_enabled = ?",
        "teaser_daily_limit = ?",
        "teaser_status = CASE WHEN ? = 0 THEN 'disabled' WHEN teaser_status = 'disabled' THEN 'needs_permission' ELSE teaser_status END"
      ];
      const updateParams = [
        title,
        normalizedPostsPerDay,
        JSON.stringify([normalizedAudience]),
        JSON.stringify(categories || []),
        normalizedTeaserEnabled ? 1 : 0,
        normalizedTeaserDailyLimit,
        normalizedTeaserEnabled ? 1 : 0
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
      if (!normalizedTeaserEnabled) {
        await pool.query("UPDATE teaser_placements SET status='removal_pending',removal_requested_at=COALESCE(removal_requested_at,NOW()),removal_reason='publisher_opt_out' WHERE channel_id=? AND status IN ('active','awaiting_baseline')", [id]);
      }
      return NextResponse.json({ success: true, message: "Channel updated successfully" });
    }

    return publisherChannelError("INVALID_CHANNEL", 400);
  } catch (error: unknown) {
    logPublisherChannelError("update", error);
    return publisherChannelError("CHANNEL_UPDATE_FAILED", getAuthErrorStatus(error));
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

    const [titleRows] = await pool.query<RowDataPacket[]>(
      "SELECT title FROM channels WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    await pool.query(
      "UPDATE channels SET is_deleted = TRUE, status = 'deleted', paused_reason = 'Channel removed by publisher.', suggested_fix = NULL WHERE id = ? AND user_id = ?",
      [id, user.id]
    );
    await clearPrivateTrackingAssignment(id, await getChannelPrivacySchema());

    if (titleRows[0]?.title) {
      await notifyChannelRemoved(user.telegram_id, id, titleRows[0].title);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logPublisherChannelError("delete", error);
    return publisherChannelError("CHANNEL_DELETE_FAILED", getAuthErrorStatus(error));
  }
}
