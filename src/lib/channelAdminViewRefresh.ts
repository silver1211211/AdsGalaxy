import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getPrivatePostViews } from "@/lib/telegramMtproto";

type PostRow = RowDataPacket & {
  id: number; message_id: number | string; views: number | string | null;
  chat_id: string; username: string | null; channel_type: "public" | "private";
  tracking_account: number | null;
};

type CampaignPostRow = PostRow & { channel_id: number };

function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function publicViews(username: string, messageId: number | string) {
  const base = process.env.PHP_VIEWS_API_URL || "https://php.adsgalaxy.online/views/api.php";
  const response = await fetch(`${base}?channel=${encodeURIComponent(username.replace(/^@/, ""))}&post=${encodeURIComponent(String(messageId))}`, {
    cache: "no-store", signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json() as { status?: string; views?: unknown };
  const views = Number(data.views);
  if (!response.ok || data.status !== "success" || !Number.isFinite(views) || views < 0) throw new Error(String(data.status || `http_${response.status}`));
  return Math.floor(views);
}

export async function refreshChannelViews(channelId: number, limit = 25) {
  const [posts] = await pool.query<PostRow[]>(
    `SELECT cp.id,cp.message_id,cp.views,ch.chat_id,ch.username,ch.channel_type,ch.tracking_account
     FROM campaign_posts cp JOIN channels ch ON ch.id=cp.channel_id
     WHERE cp.channel_id=? AND cp.status='active' AND cp.deleted_at IS NULL
       AND cp.delivery_failed_at IS NULL AND cp.delivery_confirmed_at IS NOT NULL
       AND cp.message_id IS NOT NULL AND ch.is_deleted=FALSE
     ORDER BY cp.last_views_update IS NULL DESC,cp.last_views_update ASC LIMIT ?`,
    [channelId, Math.min(50, Math.max(1, limit))]
  );
  let updated = 0;
  let failed = 0;
  const errors: Array<{ post_id: number; error: string }> = [];
  for (const post of posts) {
    try {
      let fetched: number;
      let source: string;
      if (post.channel_type === "private") {
        const result = await getPrivatePostViews(post.chat_id, post.message_id, { preferredAccount: post.tracking_account, rotationSeed: post.id });
        if (!result.ok) throw new Error(result.code);
        fetched = result.views;
        source = "admin_mtproto_private";
      } else {
        if (!post.username) throw new Error("missing_public_username");
        fetched = await publicViews(post.username, post.message_id);
        source = "admin_public_api";
      }
      await pool.query(
        `UPDATE campaign_posts SET views=GREATEST(COALESCE(views,0),?),last_views_update=NOW(),
         view_fetch_status='success',view_fetch_error=NULL,view_fetch_source=? WHERE id=?`,
        [Math.max(Number(post.views || 0), fetched), source, post.id]
      );
      await pool.query("UPDATE channels SET last_successful_view_fetch_at=NOW() WHERE id=?", [channelId]);
      updated++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "view_refresh_failed";
      failed++;
      errors.push({ post_id: post.id, error: message });
      await pool.query("UPDATE campaign_posts SET last_views_update=NOW(),view_fetch_status='failed',view_fetch_error=? WHERE id=?", [message.slice(0, 500), post.id]);
    }
    await wait(350);
  }
  return { checked: posts.length, updated, failed, errors };
}

// Best-effort, bounded view refresh scoped to a single campaign's still-live posts
// (which may span multiple channels), used to reduce staleness before a campaign
// pause/delete settles outstanding engagement. Mirrors refreshChannelViews's fetch
// logic exactly; kept as a separate function so the channel-scoped tool above is
// untouched.
export async function refreshCampaignViews(campaignId: number, limit = 50) {
  const [posts] = await pool.query<CampaignPostRow[]>(
    `SELECT cp.id,cp.message_id,cp.views,cp.channel_id,ch.chat_id,ch.username,ch.channel_type,ch.tracking_account
     FROM campaign_posts cp JOIN channels ch ON ch.id=cp.channel_id
     WHERE cp.campaign_id=? AND cp.status='active' AND cp.deleted_at IS NULL
       AND cp.delivery_failed_at IS NULL AND cp.delivery_confirmed_at IS NOT NULL
       AND cp.message_id IS NOT NULL AND ch.is_deleted=FALSE
     ORDER BY cp.last_views_update IS NULL DESC,cp.last_views_update ASC LIMIT ?`,
    [campaignId, Math.min(50, Math.max(1, limit))]
  );
  let updated = 0;
  let failed = 0;
  const errors: Array<{ post_id: number; error: string }> = [];
  for (const post of posts) {
    try {
      let fetched: number;
      let source: string;
      if (post.channel_type === "private") {
        const result = await getPrivatePostViews(post.chat_id, post.message_id, { preferredAccount: post.tracking_account, rotationSeed: post.id });
        if (!result.ok) throw new Error(result.code);
        fetched = result.views;
        source = "pre_deletion_mtproto_private";
      } else {
        if (!post.username) throw new Error("missing_public_username");
        fetched = await publicViews(post.username, post.message_id);
        source = "pre_deletion_public_api";
      }
      await pool.query(
        `UPDATE campaign_posts SET views=GREATEST(COALESCE(views,0),?),last_views_update=NOW(),
         view_fetch_status='success',view_fetch_error=NULL,view_fetch_source=? WHERE id=?`,
        [Math.max(Number(post.views || 0), fetched), source, post.id]
      );
      await pool.query("UPDATE channels SET last_successful_view_fetch_at=NOW() WHERE id=?", [post.channel_id]);
      updated++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "view_refresh_failed";
      failed++;
      errors.push({ post_id: post.id, error: message });
      await pool.query("UPDATE campaign_posts SET last_views_update=NOW(),view_fetch_status='failed',view_fetch_error=? WHERE id=?", [message.slice(0, 500), post.id]);
    }
    await wait(350);
  }
  return { checked: posts.length, updated, failed, errors };
}
