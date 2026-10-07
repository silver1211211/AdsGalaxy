import type { PoolConnection } from "mysql2/promise";

/** Persist the successful observation independently of optional diagnostics. */
export async function persistSuccessfulChannelViews(db: Pick<PoolConnection, "query">, postId: number, views: number, source: string, observedAt: Date | string | number = new Date()) {
  if (!Number.isFinite(views) || views < 0) throw new Error("invalid_view_observation");
  await db.query(`UPDATE campaign_posts SET views=GREATEST(COALESCE(views,0),?),last_views_update=?,
    view_fetch_status='success',view_fetch_error=NULL WHERE id=?`, [Math.floor(views),observedAt,postId]);
  try {
    await db.query("UPDATE campaign_posts SET view_fetch_source=? WHERE id=? AND last_views_update<=?", [source,postId,observedAt]);
  } catch (error) {
    // Preserve the full label in logs until the unapplied schema migration is installed.
    console.error("channel_view_source_metadata_failed", { postId,source,code:(error as {code?:string}).code });
  }
}
