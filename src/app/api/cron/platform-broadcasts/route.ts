/* eslint-disable @typescript-eslint/no-explicit-any -- database-backed queue rows are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { deleteTelegramMessage, sendTelegramMessage } from "@/lib/telegram";
import { audit, classifyTelegramFailure, discoverRecipients, PLATFORM_BROADCAST_MAX_ATTEMPTS, PLATFORM_BROADCAST_QUIET_SCANS, PLATFORM_BROADCAST_QUIET_SECONDS, syncBroadcastCounts } from "@/lib/platformBroadcast";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const CLAIM_LIMIT = Math.min(200, Math.max(1, Number(process.env.PLATFORM_BROADCAST_CLAIM_LIMIT || 150)));
const SENDS_PER_SECOND = Math.min(5, Math.max(1, Number(process.env.TELEGRAM_GLOBAL_SENDS_PER_SECOND || 5)));

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function deliver(broadcast: any, recipient: any) {
  const photo = broadcast.image_path || undefined;
  const result = await sendTelegramMessage(recipient.telegram_id, broadcast.message_html, {
    parse_mode: "HTML", photo, timeoutMs: 10_000,
    reply_markup: broadcast.button_text && broadcast.button_url ? { inline_keyboard: [[{ text: broadcast.button_text, url: broadcast.button_url }]] } : undefined,
  });
  if (result?.ok) {
    await pool.query("UPDATE platform_broadcast_recipients SET status='sent',sent_at=NOW(),lease_expires_at=NULL,telegram_message_id=? WHERE id=? AND status='sending'", [result.result?.message_id || null, recipient.id]);
    return;
  }
  const failure = classifyTelegramFailure(result);
  const retry = failure.retry && Number(recipient.attempts) + 1 < PLATFORM_BROADCAST_MAX_ATTEMPTS;
  const status = retry ? "queued" : failure.category === "blocked" ? "blocked" : "failed";
  await pool.query(`UPDATE platform_broadcast_recipients SET status=?,failed_at=IF(? IN ('failed','blocked'),NOW(),failed_at),lease_expires_at=NULL,
    next_retry_at=IF(?='queued',DATE_ADD(NOW(),INTERVAL ? SECOND),NULL),last_error_code=?,last_error_category=? WHERE id=?`,
    [status, status, status, failure.delay, String(result?.error_code || "network"), failure.category, recipient.id]);
}

async function processRecallBatch(limit = 100) {
  const [rows]: any = await pool.query(
    `SELECT id,telegram_id,telegram_message_id,deletion_attempts FROM platform_broadcast_recipients
     WHERE deletion_status='delete_pending' AND telegram_message_id IS NOT NULL
       AND (deletion_next_retry_at IS NULL OR deletion_next_retry_at<=NOW())
     ORDER BY id LIMIT ?`, [limit]);
  let deleted = 0;
  for (let offset = 0; offset < rows.length; offset += SENDS_PER_SECOND) {
    const started = Date.now();
    await Promise.all(rows.slice(offset, offset + SENDS_PER_SECOND).map(async (row: any) => {
      const attempts = Number(row.deletion_attempts || 0) + 1;
      const result = await deleteTelegramMessage(row.telegram_id, Number(row.telegram_message_id));
      if (result?.ok) {
        deleted++;
        await pool.query("UPDATE platform_broadcast_recipients SET deletion_status='deleted',deletion_attempts=?,deleted_at=NOW(),deletion_error=NULL WHERE id=? AND deletion_status='delete_pending'", [attempts, row.id]);
        return;
      }
      const description = String(result?.description || "Telegram delete request failed").slice(0, 500);
      const unavailable = /message to delete not found|message can't be deleted/i.test(description);
      const failure = classifyTelegramFailure(result);
      const retry = !unavailable && failure.retry && attempts < 3;
      await pool.query(
        `UPDATE platform_broadcast_recipients SET deletion_status=?,deletion_attempts=?,deletion_error=?,
           deletion_next_retry_at=IF(?='delete_pending',DATE_ADD(NOW(),INTERVAL ? SECOND),NULL)
         WHERE id=? AND deletion_status='delete_pending'`,
        [retry ? "delete_pending" : unavailable ? "not_found" : "delete_failed", attempts, description,
          retry ? "delete_pending" : unavailable ? "not_found" : "delete_failed", failure.delay, row.id]);
    }));
    const elapsed = Date.now() - started;
    if (elapsed < 1_000 && offset + SENDS_PER_SECOND < rows.length) await wait(1_000 - elapsed);
  }
  return { attempted: rows.length, deleted };
}

export async function GET(request: Request) {
  const denied = requireCronSecret(request); if (denied) return denied;
  const lock = await acquireCronLock("platform-broadcasts", 75); if (!lock) return NextResponse.json({ skipped: "locked" });
  const startedAt = Date.now(); let processed = 0;
  try {
    const recall = await processRecallBatch();
    await pool.query(`UPDATE platform_broadcast_recipients r JOIN platform_broadcasts b ON b.id=r.broadcast_id
      SET r.status='queued',r.sending_at=NULL,r.lease_expires_at=NULL
      WHERE r.status='sending' AND r.lease_expires_at<NOW() AND b.status IN ('queued','running')`);
    const [broadcasts]: any = await pool.query("SELECT * FROM platform_broadcasts WHERE status IN ('queued','running','pausing') ORDER BY id LIMIT 1");
    const broadcast = broadcasts[0]; if (!broadcast) return NextResponse.json({ processed: 0, recall });
    if (broadcast.status === "pausing") { await pool.query("UPDATE platform_broadcasts SET status='paused',paused_at=NOW() WHERE id=?", [broadcast.id]); await syncBroadcastCounts(broadcast.id); await audit(broadcast.id, "paused"); return NextResponse.json({ paused: broadcast.id }); }
    await pool.query("UPDATE platform_broadcasts SET status='running',started_at=COALESCE(started_at,NOW()) WHERE id=?", [broadcast.id]);
    if (!broadcast.started_at) await audit(broadcast.id, "started");

    // Discover a bounded first tranche before claiming so a newly queued job can
    // begin delivery in this worker tick without scanning the whole user table.
    if (Number(broadcast.discovered_count || 0) === 0) {
      await discoverRecipients(broadcast.id);
    }

    const connection = await pool.getConnection(); let recipients: any[] = [];
    try {
      await connection.beginTransaction();
      const [rows]: any = await connection.query(`SELECT * FROM platform_broadcast_recipients WHERE broadcast_id=? AND status='queued'
        AND (next_retry_at IS NULL OR next_retry_at<=NOW()) ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`, [broadcast.id, CLAIM_LIMIT]);
      recipients = rows;
      if (rows.length) { const ids = rows.map((row: any) => row.id); await connection.query(`UPDATE platform_broadcast_recipients
        SET status='sending',sending_at=NOW(),lease_expires_at=DATE_ADD(NOW(),INTERVAL 90 SECOND),attempts=attempts+1 WHERE id IN (${ids.map(() => "?").join(",")})`, ids); }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }

    for (let offset = 0; offset < recipients.length; offset += SENDS_PER_SECOND) {
      const secondStarted = Date.now(); await Promise.all(recipients.slice(offset, offset + SENDS_PER_SECOND).map(recipient => deliver(broadcast, recipient))); processed += Math.min(SENDS_PER_SECOND, recipients.length - offset);
      const elapsed = Date.now() - secondStarted; if (elapsed < 1_000) await wait(1_000 - elapsed);
    }

    await syncBroadcastCounts(broadcast.id);
    const [pending]: any = await pool.query("SELECT COUNT(*) count FROM platform_broadcast_recipients WHERE broadcast_id=? AND status IN ('queued','sending')", [broadcast.id]);
    if (!Number(pending[0].count)) {
      const added = await discoverRecipients(broadcast.id);
      if (added) await pool.query("UPDATE platform_broadcasts SET quiet_since=NULL,quiet_scan_count=0 WHERE id=?", [broadcast.id]);
      else {
        await pool.query("UPDATE platform_broadcasts SET quiet_since=COALESCE(quiet_since,NOW()),quiet_scan_count=quiet_scan_count+1 WHERE id=?", [broadcast.id]);
        const [fresh]: any = await pool.query("SELECT quiet_scan_count FROM platform_broadcasts WHERE id=?", [broadcast.id]);
        if (Number(fresh[0].quiet_scan_count) >= PLATFORM_BROADCAST_QUIET_SCANS) {
          const [done]: any = await pool.query(`UPDATE platform_broadcasts SET status='completed',completed_at=NOW(),
            sent_count=(SELECT COUNT(*) FROM platform_broadcast_recipients WHERE broadcast_id=? AND status='sent'),
            failed_count=(SELECT COUNT(*) FROM platform_broadcast_recipients WHERE broadcast_id=? AND status='failed'),
            blocked_count=(SELECT COUNT(*) FROM platform_broadcast_recipients WHERE broadcast_id=? AND status='blocked')
            WHERE id=? AND TIMESTAMPDIFF(SECOND,quiet_since,NOW())>=?`, [broadcast.id, broadcast.id, broadcast.id, broadcast.id, PLATFORM_BROADCAST_QUIET_SECONDS]);
          if (done.affectedRows) await audit(broadcast.id, "completed");
        }
      }
    }
    return NextResponse.json({ broadcast: broadcast.id, processed, throughput: processed ? Number((processed / Math.max(1, (Date.now() - startedAt) / 1000)).toFixed(1)) : 0 });
  } catch (error) { console.error("Platform broadcast worker", error); return NextResponse.json({ error: "Worker failed" }, { status: 500 }); }
  finally { await releaseCronLock(lock); }
}
