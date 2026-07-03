import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { createSystemLog } from "@/lib/systemLogs";

export const PUBLISHER_TRUST_BAN_THRESHOLD = 20;
export const PUBLISHER_AVAILABLE_BALANCE_THRESHOLD = 9.8;
export const PUBLISHER_TRUST_BAN_REASON = "Low Trust Score with Withdrawable Balance Threshold Reached";

type CandidateRow = RowDataPacket & { id: number };
type PublisherRow = RowDataPacket & {
  id: number;
  publisher_trust_score: number | string;
  publisher_risk_score: number | string;
  balance_available: number | string;
  status: string;
  is_banned: number | boolean;
};
type ChannelRow = RowDataPacket & {
  id: number;
  publisher_trust_score: number | string;
  channel_fraud_risk_score: number | string;
};

export type PublisherTrustEnforcementDetail = {
  publisher_id: number;
  trust_score: number;
  available_balance: number;
  decision: "monitoring" | "banned";
  channels_paused: number;
};

export type PublisherTrustEnforcementResult = {
  evaluationBucket: string;
  candidates: number;
  monitored: number;
  banned: number;
  skipped: number;
  failed: number;
  details: PublisherTrustEnforcementDetail[];
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function enforcementBucket(now = new Date()) {
  const bucket = new Date(Math.floor(now.getTime() / 900_000) * 900_000);
  return bucket.toISOString().slice(0, 19).replace("T", " ");
}

export async function enforcePublisherTrust(limit = 500): Promise<PublisherTrustEnforcementResult> {
  const boundedLimit = Math.min(1_000, Math.max(1, Math.floor(limit || 500)));
  const bucket = enforcementBucket();
  const [candidates] = await pool.query<CandidateRow[]>(
    `SELECT u.id
     FROM users u
     WHERE COALESCE(u.publisher_trust_score,60) <= ?
       AND COALESCE(u.is_banned,0)=0
       AND COALESCE(u.status,'active')<>'banned'
       AND EXISTS (SELECT 1 FROM channels ch WHERE ch.user_id=u.id AND ch.is_deleted=FALSE)
     ORDER BY u.id ASC LIMIT ${boundedLimit}`,
    [PUBLISHER_TRUST_BAN_THRESHOLD]
  );

  const result: PublisherTrustEnforcementResult = {
    evaluationBucket: bucket, candidates: candidates.length, monitored: 0,
    banned: 0, skipped: 0, failed: 0, details: [],
  };

  for (const candidate of candidates) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<PublisherRow[]>(
        `SELECT id,publisher_trust_score,publisher_risk_score,balance_available,status,is_banned
         FROM users WHERE id=? FOR UPDATE`,
        [candidate.id]
      );
      const publisher = rows[0];
      if (!publisher || publisher.status === "banned" || Number(publisher.is_banned) === 1) {
        await connection.rollback();
        result.skipped++;
        continue;
      }

      const trustScore = numberValue(publisher.publisher_trust_score);
      const availableBalance = numberValue(publisher.balance_available);
      if (trustScore > PUBLISHER_TRUST_BAN_THRESHOLD) {
        await connection.rollback();
        result.skipped++;
        continue;
      }

      const shouldBan = availableBalance >= PUBLISHER_AVAILABLE_BALANCE_THRESHOLD;
      const [event] = await connection.query<ResultSetHeader>(
        `INSERT IGNORE INTO publisher_trust_enforcement_events
          (publisher_id,evaluation_bucket,trust_score,available_balance,balance_threshold,decision,reason)
         VALUES (?,?,?,?,?,?,?)`,
        [publisher.id, bucket, trustScore, availableBalance, PUBLISHER_AVAILABLE_BALANCE_THRESHOLD,
          shouldBan ? "banned" : "monitoring", shouldBan ? PUBLISHER_TRUST_BAN_REASON : "balance_below_auto_ban_threshold"]
      );
      if (event.affectedRows !== 1) {
        await connection.rollback();
        result.skipped++;
        continue;
      }

      let channelsPaused = 0;
      if (shouldBan) {
        const [channels] = await connection.query<ChannelRow[]>(
          `SELECT id,publisher_trust_score,channel_fraud_risk_score
           FROM channels WHERE user_id=? AND is_deleted=FALSE FOR UPDATE`,
          [publisher.id]
        );
        const [userUpdate] = await connection.query<ResultSetHeader>(
          `UPDATE users SET status='banned',is_banned=1,banned_at=NOW(),ban_reason=?
           WHERE id=? AND COALESCE(is_banned,0)=0 AND COALESCE(status,'active')<>'banned'`,
          [PUBLISHER_TRUST_BAN_REASON, publisher.id]
        );
        if (userUpdate.affectedRows !== 1) throw new Error("publisher_ban_transition_failed");
        const [channelUpdate] = await connection.query<ResultSetHeader>(
          `UPDATE channels SET status='paused',paused_reason=?,auto_paused_at=NOW()
           WHERE user_id=? AND is_deleted=FALSE AND status<>'deleted'`,
          [PUBLISHER_TRUST_BAN_REASON, publisher.id]
        );
        channelsPaused = channelUpdate.affectedRows;

        for (const channel of channels) {
          const channelTrust = numberValue(channel.publisher_trust_score);
          const channelRisk = numberValue(channel.channel_fraud_risk_score);
          const [evaluation] = await connection.query<ResultSetHeader>(
            `INSERT INTO channel_fraud_evaluations
              (channel_id,publisher_id,evaluation_bucket,signal_count,highest_severity,
               old_trust_score,new_trust_score,old_risk_score,new_risk_score,completed_at)
             VALUES (?,?,?,1,'critical',?,?,?,?,NOW())
             ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),signal_count=signal_count+1,
               highest_severity='critical',completed_at=NOW()`,
            [channel.id, publisher.id, bucket, channelTrust, channelTrust, channelRisk, channelRisk]
          );
          await connection.query(
            `INSERT INTO channel_fraud_events
              (evaluation_id,channel_id,publisher_id,fraud_type,severity,old_trust_score,new_trust_score,
               old_risk_score,new_risk_score,reason,metadata)
             VALUES (?, ?, ?, 'publisher_trust_auto_ban', 'critical', ?, ?, ?, ?, ?, ?)`,
            [evaluation.insertId, channel.id, publisher.id, channelTrust, channelTrust, channelRisk, channelRisk,
              PUBLISHER_TRUST_BAN_REASON, JSON.stringify({ available_balance: availableBalance, balance_threshold: PUBLISHER_AVAILABLE_BALANCE_THRESHOLD, trust_threshold: PUBLISHER_TRUST_BAN_THRESHOLD })]
          );
        }
      }

      await connection.commit();
      result.details.push({ publisher_id: publisher.id, trust_score: trustScore, available_balance: availableBalance, decision: shouldBan ? "banned" : "monitoring", channels_paused: channelsPaused });
      if (shouldBan) {
        result.banned++;
        await recordAdminActionAudit({ action: "publisher_trust_auto_ban", entityType: "user", entityId: publisher.id, reason: PUBLISHER_TRUST_BAN_REASON, metadata: { trust_score: trustScore, available_balance: availableBalance, channels_paused: channelsPaused } });
      } else {
        result.monitored++;
      }
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      result.failed++;
      console.error("Publisher trust enforcement failed", { publisher_id: candidate.id, error: error instanceof Error ? error.message : "unknown_error" });
    } finally {
      connection.release();
    }
  }

  await createSystemLog({
    logType: "publisher_trust_enforcement", status: result.failed ? (result.banned || result.monitored ? "partial_failure" : "failed") : "success",
    title: "Publisher trust enforcement", summary: `${result.banned} publishers banned; ${result.monitored} monitored at or below the trust threshold`,
    periodStart: bucket, attemptedCount: result.candidates, successCount: result.banned + result.monitored,
    failedCount: result.failed, skippedCount: result.skipped, autoPausedCount: result.details.reduce((sum, item) => sum + item.channels_paused, 0),
    affectedEntities: result.details.filter((item) => item.decision === "banned").map((item) => ({ publisher_id: item.publisher_id, channels_paused: item.channels_paused })),
    metadata: { trust_threshold: PUBLISHER_TRUST_BAN_THRESHOLD, available_balance_threshold: PUBLISHER_AVAILABLE_BALANCE_THRESHOLD },
  });
  return result;
}
