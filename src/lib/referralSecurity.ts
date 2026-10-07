/* eslint-disable @typescript-eslint/no-explicit-any -- referral rows combine legacy dynamic security columns */
import crypto from "crypto";
import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;

export type ReferralSecuritySignals = {
  ip: string;
  userAgentHash: string;
  deviceHash: string;
};

function hash(value: string) {
  return value ? crypto.createHash("sha256").update(value).digest("hex") : "";
}

function cleanIp(value: string | null) {
  return String(value || "")
    .split(",")[0]
    .trim()
    .slice(0, 64);
}

export function getReferralSecuritySignals(request?: Request | null): ReferralSecuritySignals {
  const headers = request?.headers;
  const ip = cleanIp(
    headers?.get("cf-connecting-ip")
      || headers?.get("x-real-ip")
      || headers?.get("x-forwarded-for")
      || ""
  );
  const userAgent = String(headers?.get("user-agent") || "").trim();
  const deviceId = String(headers?.get("x-adsgalaxy-device-id") || "").trim();

  return {
    ip,
    userAgentHash: hash(userAgent),
    deviceHash: hash(deviceId),
  };
}

export async function updateUserReferralSecuritySignals(userId: number, signals: ReferralSecuritySignals, db: Db = pool) {
  if (!userId || (!signals.ip && !signals.userAgentHash && !signals.deviceHash)) return;
  await db.query(
    `UPDATE users
     SET last_referral_ip = COALESCE(NULLIF(?, ''), last_referral_ip),
       last_referral_user_agent_hash = COALESCE(NULLIF(?, ''), last_referral_user_agent_hash),
       last_referral_device_hash = COALESCE(NULLIF(?, ''), last_referral_device_hash),
       last_referral_seen_at = NOW()
     WHERE id = ?`,
    [signals.ip, signals.userAgentHash, signals.deviceHash, userId]
  );
}

export async function markReferralJoinSignals(referralId: number, signals: ReferralSecuritySignals, db: Db = pool) {
  if (!referralId || (!signals.ip && !signals.userAgentHash && !signals.deviceHash)) return;
  await db.query(
    `UPDATE referrals
     SET join_ip = COALESCE(NULLIF(?, ''), join_ip),
       join_user_agent_hash = COALESCE(NULLIF(?, ''), join_user_agent_hash),
       join_device_hash = COALESCE(NULLIF(?, ''), join_device_hash)
     WHERE id = ?`,
    [signals.ip, signals.userAgentHash, signals.deviceHash, referralId]
  );
}

export async function blockReferralIfSelfDevice(referralId: number, db: Db = pool, _options: { ensureSchema?: boolean } = {}) {
  void _options;
  const [rows]: any = await db.query(
    `SELECT r.*, u.last_referral_ip, u.last_referral_user_agent_hash, u.last_referral_device_hash
     FROM referrals r
     JOIN users u ON u.id = r.invited_by
     WHERE r.id = ?
     LIMIT 1`,
    [referralId]
  );
  const referral = rows[0];
  if (!referral) return { blocked: false, reason: "no_referral" };
  if (Number(referral.self_referral_blocked || 0) === 1) {
    return { blocked: true, reason: referral.rejection_reason || "Self referral blocked" };
  }

  const sameIp = Boolean(referral.join_ip && referral.last_referral_ip && referral.join_ip === referral.last_referral_ip);
  const sameDevice = Boolean(referral.join_device_hash && referral.last_referral_device_hash && referral.join_device_hash === referral.last_referral_device_hash);
  const sameUserAgent = Boolean(referral.join_user_agent_hash && referral.last_referral_user_agent_hash && referral.join_user_agent_hash === referral.last_referral_user_agent_hash);

  const matchedSignals=[sameIp,sameDevice,sameUserAgent].filter(Boolean).length;
  if (matchedSignals === 0) {
    return { blocked: false, reason: "no_match" };
  }
  if(matchedSignals===1){
    const metadata=JSON.stringify({same_ip:sameIp,same_device:sameDevice,same_user_agent:sameUserAgent});
    await db.query(
      `INSERT INTO referral_abuse_flags
        (referral_id,referrer_id,referred_user_id,signal_key,risk_level,status,reason,metadata)
       SELECT ?,?,?,'weak_identity_signal_match','low','open','Single weak identity signal matched',?
       WHERE NOT EXISTS (
         SELECT 1 FROM referral_abuse_flags WHERE referral_id=? AND signal_key='weak_identity_signal_match' AND status='open'
       )`,
      [referralId,referral.invited_by,referral.user_id,metadata,referralId]
    );
    await db.query(
      `UPDATE referrals SET
         abuse_risk_level=CASE WHEN abuse_risk_level IN ('high','critical') THEN abuse_risk_level ELSE 'low' END,
         abuse_flags=CASE WHEN abuse_risk_level IN ('high','critical') THEN abuse_flags ELSE JSON_ARRAY('weak_identity_signal_match') END
       WHERE id=? AND self_referral_blocked=0`,
      [referralId]
    );
    return {blocked:false,reason:"weak_signal_recorded"};
  }

  const reason = "Self referral blocked: multiple corroborating identity signals matched";

  await db.query(
    `UPDATE referrals
     SET self_referral_blocked = 1,
       status = 'rejected',
       verification_status = 'rejected',
       reward_status = 'blocked',
       rejection_reason = ?,
       abuse_risk_level = 'critical',
       abuse_flags = JSON_ARRAY('corroborated_self_referral')
     WHERE id = ?`,
    [reason, referralId]
  );
  await db.query(
    `INSERT INTO referral_abuse_flags
      (referral_id, referrer_id, referred_user_id, signal_key, risk_level, status, reason, metadata)
     VALUES (?, ?, ?, 'corroborated_self_referral', 'critical', 'open', ?, ?)`,
    [
      referralId,
      referral.invited_by,
      referral.user_id,
      reason,
      JSON.stringify({ same_ip: sameIp, same_device: sameDevice, same_user_agent: sameUserAgent }),
    ]
  );

  return { blocked: true, reason };
}

export async function blockReferralForUserIfSelfDevice(userId: number, signals: ReferralSecuritySignals, db: Db = pool) {
  const [rows]: any = await db.query("SELECT id FROM referrals WHERE user_id = ? LIMIT 1", [userId]);
  const referralId = Number(rows[0]?.id || 0);
  if (!referralId) return { blocked: false, reason: "no_referral" };
  await markReferralJoinSignals(referralId, signals, db);
  return blockReferralIfSelfDevice(referralId, db);
}
