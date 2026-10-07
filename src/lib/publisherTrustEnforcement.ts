import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { createSystemLog } from "@/lib/systemLogs";
import { hasActiveUserEnforcementExemption } from "@/lib/userEnforcementExemptions";

export const PUBLISHER_TRUST_BAN_THRESHOLD = 20;
export const PUBLISHER_AVAILABLE_BALANCE_THRESHOLD = 8.4;
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
export type PublisherTrustEnforcementDetail = {
  publisher_id: number;
  trust_score: number;
  available_balance: number;
  decision: "monitoring" | "review";
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
  return now.toISOString().slice(0, 10) + " 00:00:00";
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
      if (await hasActiveUserEnforcementExemption(pool, candidate.id)) {
        result.skipped++;
        continue;
      }
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

      // Recheck inside the same locked transaction immediately before any ban
      // transition so a concurrent admin exemption always wins.
      if (await hasActiveUserEnforcementExemption(connection, publisher.id)) {
        await connection.rollback();
        result.skipped++;
        continue;
      }

      const shouldReview = availableBalance >= PUBLISHER_AVAILABLE_BALANCE_THRESHOLD;
      const [event] = await connection.query<ResultSetHeader>(
        `INSERT IGNORE INTO publisher_trust_enforcement_events
          (publisher_id,evaluation_bucket,trust_score,available_balance,balance_threshold,decision,reason)
         VALUES (?,?,?,?,?,?,?)`,
        [publisher.id, bucket, trustScore, availableBalance, PUBLISHER_AVAILABLE_BALANCE_THRESHOLD,
          "monitoring", shouldReview ? "admin_review_required" : "balance_below_review_threshold"]
      );
      if (event.affectedRows !== 1) {
        await connection.rollback();
        result.skipped++;
        continue;
      }

      if (shouldReview) {
        const [openCases] = await connection.query<RowDataPacket[]>(
          `SELECT id FROM publisher_review_queue
           WHERE publisher_id=? AND status='open' AND reason='low_trust_manual_review'
           LIMIT 1 FOR UPDATE`,
          [publisher.id]
        );
        if (!openCases[0]) {
          await connection.query(
            `INSERT INTO publisher_review_queue
              (publisher_id,inventory_type,inventory_id,risk_level,reason,status,metadata)
             VALUES (?,'publisher',NULL,'high','low_trust_manual_review','open',?)`,
            [publisher.id, JSON.stringify({
              trust_score: trustScore,
              available_balance: availableBalance,
              review_threshold: PUBLISHER_AVAILABLE_BALANCE_THRESHOLD,
              source: "publisher_trust_enforcement",
            })]
          );
        }
      }

      await connection.commit();
      result.details.push({ publisher_id: publisher.id, trust_score: trustScore, available_balance: availableBalance, decision: shouldReview ? "review" : "monitoring", channels_paused: 0 });
      result.monitored++;
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
    title: "Publisher trust review", summary: `${result.monitored} publishers monitored; automated banning is disabled`,
    periodStart: bucket, attemptedCount: result.candidates, successCount: result.monitored,
    failedCount: result.failed, skippedCount: result.skipped, autoPausedCount: result.details.reduce((sum, item) => sum + item.channels_paused, 0),
    affectedEntities: result.details.filter((item) => item.decision === "review").map((item) => ({ publisher_id: item.publisher_id, review_required: true })),
    metadata: { trust_threshold: PUBLISHER_TRUST_BAN_THRESHOLD, available_balance_threshold: PUBLISHER_AVAILABLE_BALANCE_THRESHOLD, enforcement_mode: "review_only" },
  });
  return result;
}
