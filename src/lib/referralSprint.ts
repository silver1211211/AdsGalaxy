import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { blockReferralIfSelfDevice, ensureReferralSecuritySchema } from "@/lib/referralSecurity";

type Db = typeof pool | PoolConnection;

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function toInt(value: unknown, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanChannelUsername(value: unknown) {
  return String(value || "AdsGalaxy_News")
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "");
}

function maskedUser(userId: unknown) {
  return `User #${Number(userId || 0)}`;
}

function maskedMember(userId: unknown) {
  return `Member #${Number(userId || 0)}`;
}

function makeReferralCode(userId: number) {
  return `AGX${userId}`;
}

async function getSettings(db: Db = pool) {
  const [rows]: any = await db.query("SELECT `key`, value FROM referral_growth_settings");
  return new Map<string, string>(rows.map((row: any) => [String(row.key), String(row.value)]));
}

function getSetting(settings: Map<string, string>, key: string, fallback: string) {
  return settings.get(key) || fallback;
}

async function columnExists(db: Db, table: string, column: string): Promise<boolean> {
  const [[row]]: any = await db.query(
    "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  return Number(row?.cnt || 0) > 0;
}

async function ensureReferralGrowthSchema(db: Db = pool) {
  const cols: Array<{ name: string; def: string }> = [
    { name: "status",              def: "VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER invited_by" },
    { name: "verification_status", def: "VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER status" },
    { name: "reward_status",       def: "VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER verification_status" },
    { name: "reward_amount",       def: "DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER reward_status" },
    { name: "required_channel",    def: "VARCHAR(255) NULL AFTER reward_amount" },
    { name: "verified_at",         def: "DATETIME NULL AFTER required_channel" },
    { name: "reward_paid_at",      def: "DATETIME NULL AFTER verified_at" },
    { name: "rejection_reason",    def: "VARCHAR(255) NULL AFTER reward_paid_at" },
    { name: "abuse_risk_level",    def: "VARCHAR(20) NOT NULL DEFAULT 'low' AFTER rejection_reason" },
    { name: "abuse_flags",         def: "LONGTEXT NULL AFTER abuse_risk_level" },
    { name: "sprint_id",           def: "BIGINT UNSIGNED NULL AFTER abuse_flags" },
    { name: "created_at",          def: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP" },
    { name: "updated_at",          def: "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" },
  ];
  for (const { name, def } of cols) {
    if (!(await columnExists(db, "referrals", name))) {
      await db.query(`ALTER TABLE referrals ADD COLUMN \`${name}\` ${def}`);
    }
  }
}

export async function ensureReferralGrowthSettingDefaults(db: Db = pool, repairSchema = true) {
  if (repairSchema) await ensureReferralGrowthSchema(db);
  await db.query(
    `INSERT INTO referral_growth_settings (\`key\`, value, description) VALUES
      ('referral_sprint_enabled', '1', 'Enable Referral Sprint, Team League, Team Rewards, popup, and growth UI'),
      ('referral_join_reward_amount', '0.005', 'Reward paid when a referred user first joins AdsGalaxy'),
      ('referral_verification_reward_amount', '0.010', 'Additional reward paid after the referred user verifies required channel membership'),
      ('referral_sprint_popup_interval_seconds', '86400', 'Minimum seconds before the Referral Sprint popup is shown again after dismissal'),
      ('referral_sprint_popup_interval_hours', '24', 'Minimum hours before the Referral Sprint popup is shown again after dismissal'),
      ('referral_reward_amount', '0.015', 'Total displayed referral reward: join reward plus channel verification bonus')
     ON DUPLICATE KEY UPDATE description = VALUES(description)`
  );
}

function sprintEnabled(settings: Map<string, string>) {
  return getSetting(settings, "referral_sprint_enabled", "1") === "1";
}

export function getReferralJoinRewardAmount(settings: Map<string, string>) {
  return toNumber(getSetting(settings, "referral_join_reward_amount", "0.005"));
}

export function getReferralVerificationRewardAmount(settings: Map<string, string>) {
  return toNumber(getSetting(settings, "referral_verification_reward_amount", "0.010"));
}

export function getReferralTotalRewardAmount(settings: Map<string, string>) {
  return Number((getReferralJoinRewardAmount(settings) + getReferralVerificationRewardAmount(settings)).toFixed(8));
}

async function isReferralSprintEnabled(db: Db = pool) {
  const settings = await getSettings(db);
  return sprintEnabled(settings);
}

async function createGrowthNotification(
  conn: Db,
  input: {
    userId: number;
    type: string;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  }
) {
  await conn.query(
    `INSERT INTO referral_growth_notifications
      (user_id, notification_type, title, message, metadata)
     VALUES (?, ?, ?, ?, ?)`,
    [input.userId, input.type, input.title, input.message, input.metadata ? JSON.stringify(input.metadata) : null]
  );
}

async function creditReferralReward(
  conn: PoolConnection,
  input: {
    userId: number;
    referralId?: number | null;
    sprintId?: number | null;
    rewardType: string;
    amount: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }
) {
  if (input.amount <= 0) return false;
  const [ledgerResult]: any = await conn.query(
    `INSERT IGNORE INTO referral_reward_ledger
      (user_id, referral_id, sprint_id, reward_type, amount, status, reason, metadata)
     VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)`,
    [
      input.userId,
      input.referralId || null,
      input.sprintId || null,
      input.rewardType,
      input.amount,
      input.reason,
      JSON.stringify(input.metadata || {}),
    ]
  );
  if (ledgerResult.affectedRows !== 1) return false;

  await conn.query(
    "UPDATE users SET balance_available = balance_available + ?, total_referral_earnings = total_referral_earnings + ? WHERE id = ?",
    [input.amount, input.amount, input.userId]
  );
  return true;
}

export async function recordReferralSprintAudit(input: {
  actorType?: string;
  actorId?: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `INSERT INTO referral_sprint_audit_logs
      (actor_type, actor_id, action, entity_type, entity_id, reason, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.actorType || "system",
      input.actorId || null,
      input.action,
      input.entityType,
      input.entityId || null,
      input.reason || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
}

async function notifyUser(userId: number, message: string, db: Db = pool) {
  const [[user]]: any = await db.query("SELECT telegram_id FROM users WHERE id = ?", [userId]);
  if (!user?.telegram_id) return;
  try {
    await sendTelegramMessage(String(user.telegram_id), message);
  } catch {
    // Best-effort referral notification.
  }
}

export async function notifyReferralAudience(message: string, sprintId?: number, db: Db = pool) {
  const [rows]: any = sprintId
    ? await db.query(
      `SELECT DISTINCT u.id, u.telegram_id
       FROM users u
       LEFT JOIN referrals r ON r.invited_by = u.id
       WHERE u.telegram_id IS NOT NULL
         AND (r.sprint_id = ? OR u.referral_code IS NOT NULL)
       LIMIT 500`,
      [sprintId]
    )
    : await db.query("SELECT id, telegram_id FROM users WHERE telegram_id IS NOT NULL AND referral_code IS NOT NULL LIMIT 500");

  for (const row of rows) {
    try {
      await sendTelegramMessage(String(row.telegram_id), message);
    } catch {
      // Best-effort bulk referral notification.
    }
  }
}

export async function ensureActiveReferralSprint(db: Db = pool) {
  if (!(await isReferralSprintEnabled(db))) return null;

  const [active]: any = await db.query("SELECT * FROM referral_sprints WHERE status = 'active' ORDER BY ends_at ASC LIMIT 1");
  if (active.length > 0) return active[0];

  const settings = await getSettings(db);
  const duration = Math.max(1, toInt(getSetting(settings, "sprint_duration_days", "14"), 14));
  const first = toNumber(getSetting(settings, "sprint_first_place_reward", "10"));
  const second = toNumber(getSetting(settings, "sprint_second_place_reward", "5"));
  const third = toNumber(getSetting(settings, "sprint_third_place_reward", "2"));
  const teamFirst = toNumber(getSetting(settings, "team_best_reward", "15"));
  const teamSecond = toNumber(getSetting(settings, "team_second_reward", "8"));
  const teamThird = toNumber(getSetting(settings, "team_third_reward", "4"));
  const autoRestart = getSetting(settings, "sprint_auto_restart", "1") === "1" ? 1 : 0;

  const [result]: any = await db.query(
    `INSERT INTO referral_sprints
      (name, status, starts_at, ends_at, duration_days, first_place_reward, second_place_reward, third_place_reward, best_team_reward, second_team_reward, third_team_reward, auto_restart)
     VALUES ('Referral Sprint', 'active', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?, ?, ?, ?, ?, ?, ?)`,
    [duration, duration, first, second, third, teamFirst, teamSecond, teamThird, autoRestart]
  );

  const [rows]: any = await db.query("SELECT * FROM referral_sprints WHERE id = ?", [result.insertId]);
  await recordReferralSprintAudit({
    action: "sprint_started",
    entityType: "referral_sprint",
    entityId: Number(result.insertId),
    reason: "active_sprint_created",
    metadata: { duration, first, second, third, autoRestart },
  });
  await notifyReferralAudience(`Referral Sprint started\n\nInvite friends, earn verified referral rewards, and compete for bonus rewards. This sprint ends in ${duration} days.`, Number(result.insertId), db);
  return rows[0];
}

export async function getReferralLeaderboard(sprintId: number, limit = 25) {
  const [rows]: any = await pool.query(
    `SELECT
       r.invited_by as user_id,
       COUNT(*) as referral_count,
       COALESCE(SUM(r.reward_amount), 0) as referral_rewards
     FROM referrals r
     WHERE r.sprint_id = ?
       AND r.verification_status = 'verified'
       AND r.reward_status = 'paid'
     GROUP BY r.invited_by
     ORDER BY referral_count DESC, referral_rewards DESC, r.invited_by ASC
     LIMIT ?`,
    [sprintId, limit]
  );

  return rows.map((row: any, index: number) => ({
    ...row,
    rank: index + 1,
    display_name: maskedUser(row.user_id),
  }));
}

async function ensureTeamNamePool(db: Db = pool) {
  const names = [
    "Nova", "Titan", "Phoenix", "Orion", "Apex", "Sentinel", "Nebula", "Vanguard", "Dynasty", "Falcon",
    "Comet", "Eclipse", "Zenith", "Pulse", "Summit", "Atlas", "Vector", "Stellar", "Aurora", "Quantum",
    "Voyager", "Pioneer", "Crown", "Meteor", "Rocket", "Galaxy", "Solar", "Lunar", "Cosmos", "Vertex",
    "Prism", "Ignite", "Fusion", "Orbit", "Striker", "Velocity", "Radiant", "Legacy", "Momentum", "Horizon",
    "Infinity", "Ascend", "Beacon", "Mirage", "Thunder", "Blaze", "Catalyst", "Odyssey", "Nexus", "Empire",
  ];
  for (const name of names) {
    await db.query("INSERT IGNORE INTO referral_team_name_pool (name) VALUES (?)", [name]);
  }
}

async function createReferralTeam(conn: PoolConnection, capacity: number) {
  await ensureTeamNamePool(conn);
  const [names]: any = await conn.query(
    "SELECT * FROM referral_team_name_pool WHERE status = 'available' ORDER BY id ASC LIMIT 1 FOR UPDATE"
  );
  if (names.length === 0) {
    throw new Error("No referral team names available. Add more team names before expanding the league.");
  }

  const name = names[0].name;
  await conn.query("UPDATE referral_team_name_pool SET status = 'reserved', reserved_at = NOW() WHERE id = ?", [names[0].id]);
  const [result]: any = await conn.query(
    "INSERT INTO referral_teams (name, status, capacity) VALUES (?, 'active', ?)",
    [name, capacity]
  );
  return { id: Number(result.insertId), name, capacity };
}

async function ensureActiveTeams(conn: PoolConnection, settings: Map<string, string>) {
  const seedCount = Math.max(1, toInt(getSetting(settings, "active_team_seed_count", "3"), 3));
  const capacity = Math.max(1, toInt(getSetting(settings, "team_capacity", "50"), 50));
  const [[countRow]]: any = await conn.query("SELECT COUNT(*) as count FROM referral_teams WHERE status = 'active'");
  const missing = Math.max(0, seedCount - toInt(countRow?.count, 0));
  for (let i = 0; i < missing; i += 1) {
    await createReferralTeam(conn, capacity);
  }
}

async function getVerifiedReferralCount(userId: number, db: Db = pool) {
  const [[row]]: any = await db.query(
    "SELECT COUNT(*) as count FROM referrals WHERE invited_by = ? AND verification_status = 'verified' AND reward_status = 'paid'",
    [userId]
  );
  return toInt(row?.count, 0);
}

async function ensureTeamMembership(userId: number, verifiedCount: number, conn: PoolConnection, settings: Map<string, string>, sprintId?: number) {
  const unlockAt = Math.max(1, toInt(getSetting(settings, "team_league_unlock_referrals", "10"), 10));
  if (verifiedCount < unlockAt) return null;

  const [existing]: any = await conn.query(
    `SELECT tm.*, t.name, t.capacity
     FROM referral_team_memberships tm
     JOIN referral_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
     LIMIT 1`,
    [userId]
  );
  if (existing.length > 0) return { ...existing[0], unlocked_now: false };

  await ensureActiveTeams(conn, settings);
  const capacity = Math.max(1, toInt(getSetting(settings, "team_capacity", "50"), 50));
  const [teams]: any = await conn.query(
    `SELECT t.id, t.name, t.capacity, COUNT(tm.user_id) as members
     FROM referral_teams t
     LEFT JOIN referral_team_memberships tm ON tm.team_id = t.id
     WHERE t.status = 'active'
     GROUP BY t.id, t.name, t.capacity
     HAVING members < t.capacity
     ORDER BY members ASC, RAND()
     LIMIT 1`
  );
  const team = teams[0] || await createReferralTeam(conn, capacity);
  await conn.query("INSERT IGNORE INTO referral_team_memberships (team_id, user_id) VALUES (?, ?)", [team.id, userId]);
  await recordReferralSprintAudit({
    action: "team_league_unlocked",
    entityType: "referral_team",
    entityId: Number(team.id),
    reason: "verified_referral_threshold",
    metadata: { user_id: userId, verified_referrals: verifiedCount, sprint_id: sprintId || null },
  });
  return { ...team, team_id: team.id, unlocked_now: true };
}

async function getActiveBoostMultiplier(userId: number, teamId?: number | null, db: Db = pool) {
  const [rows]: any = await db.query(
    `SELECT multiplier, name, team_id
     FROM referral_growth_events
     WHERE status = 'active'
       AND starts_at <= NOW()
       AND ends_at > NOW()
       AND (team_id IS NULL OR team_id = ?)
     ORDER BY multiplier DESC`,
    [teamId || null]
  );
  const multiplier = rows.reduce((value: number, row: any) => value * Math.max(1, toNumber(row.multiplier)), 1);
  return { multiplier, events: rows.map((row: any) => ({ name: row.name, multiplier: toNumber(row.multiplier), team_id: row.team_id })) };
}

async function awardEligibleUserMilestones(conn: PoolConnection, userId: number, verifiedCount: number, sprintId: number) {
  const [milestones]: any = await conn.query(
    "SELECT * FROM referral_milestones WHERE scope = 'user' AND status = 'active' AND threshold_count <= ? ORDER BY threshold_count ASC",
    [verifiedCount]
  );
  const awarded: any[] = [];
  for (const milestone of milestones) {
    const [claim]: any = await conn.query(
      `INSERT IGNORE INTO referral_milestone_claims
        (milestone_id, user_id, sprint_id, amount, reward_type, status, paid_at, metadata)
       VALUES (?, ?, ?, ?, ?, 'paid', NOW(), ?)`,
      [
        milestone.id,
        userId,
        sprintId,
        toNumber(milestone.reward_amount),
        milestone.reward_type,
        JSON.stringify({ threshold_count: milestone.threshold_count, label: milestone.reward_label }),
      ]
    );
    if (claim.affectedRows > 0) {
      if (["withdrawable_balance", "bonus_reward", "mystery_reward"].includes(String(milestone.reward_type))) {
        await creditReferralReward(conn, {
          userId,
          sprintId,
          rewardType: `milestone_${milestone.id}`,
          amount: toNumber(milestone.reward_amount),
          reason: "referral_milestone",
          metadata: { threshold_count: milestone.threshold_count, reward_type: milestone.reward_type },
        });
      }
      awarded.push(milestone);
    }
  }
  return awarded;
}

async function awardFirstReferralBonus(conn: PoolConnection, userId: number, settings: Map<string, string>, sprintId: number) {
  const [[user]]: any = await conn.query("SELECT first_referral_bonus_paid FROM users WHERE id = ? FOR UPDATE", [userId]);
  if (Number(user?.first_referral_bonus_paid || 0) === 1) return false;
  const amount = toNumber(getSetting(settings, "first_referral_bonus_amount", "0.05"));
  await conn.query("UPDATE users SET first_referral_bonus_paid = 1 WHERE id = ?", [userId]);
  await creditReferralReward(conn, {
    userId,
    sprintId,
    rewardType: "first_referral_bonus",
    amount,
    reason: "first_verified_referral",
  });
  return amount > 0;
}

export async function processReferralJoinReward(referralId: number) {
  const conn = await pool.getConnection();
  try {
    await ensureReferralSecuritySchema(conn);
    await conn.beginTransaction();
    const [rows]: any = await conn.query(
      `SELECT r.*, u.telegram_id as referrer_telegram_id
       FROM referrals r
       JOIN users u ON u.id = r.invited_by
       WHERE r.id = ?
       LIMIT 1
       FOR UPDATE`,
      [referralId]
    );

    if (rows.length === 0) {
      await conn.commit();
      return { paid: false, reason: "no_referral" };
    }

    const referral = rows[0];
    if (Number(referral.self_referral_blocked || 0) === 1) {
      await conn.commit();
      return { paid: false, reason: "self_referral_blocked" };
    }

    const selfDevice = await blockReferralIfSelfDevice(Number(referral.id), conn, { ensureSchema: false });
    if (selfDevice.blocked) {
      await conn.commit();
      return { paid: false, reason: "self_referral_blocked", referral_reward: selfDevice };
    }

    const settings = await getSettings(conn);
    const joinRewardAmount = getReferralJoinRewardAmount(settings);
    if (referral.reward_status === "paid" || toNumber(referral.reward_amount) >= joinRewardAmount) {
      await conn.commit();
      return { paid: false, reason: "already_paid" };
    }

    const growthEnabled = sprintEnabled(settings);
    const activeSprint = growthEnabled ? await ensureActiveReferralSprint(conn) : null;
    const configuredNewsChannel = process.env.TELEGRAM_NEWS_CHANNEL || process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News";
    const requiredChannel = getSetting(settings, "required_channel_url", `https://t.me/${configuredNewsChannel.replace(/^@/, "")}`);

    const credited = await creditReferralReward(conn, {
      userId: Number(referral.invited_by),
      referralId: Number(referral.id),
      sprintId: activeSprint ? Number(activeSprint.id) : null,
      rewardType: "referral_join",
      amount: joinRewardAmount,
      reason: "referred_user_joined",
      metadata: {
        referred_user_id: referral.user_id,
        next_step: "required_channel_verification",
      },
    });

    if (credited) {
      await conn.query(
        `UPDATE referrals
         SET status = 'joined',
           reward_status = 'join_paid',
           reward_amount = reward_amount + ?,
           required_channel = ?,
           sprint_id = COALESCE(sprint_id, ?)
         WHERE id = ?`,
        [joinRewardAmount, requiredChannel, activeSprint?.id || null, referral.id]
      );

      await createGrowthNotification(conn, {
        userId: Number(referral.invited_by),
        type: "referral_joined",
        title: "Referral joined",
        message: "Your referral joined AdsGalaxy. The instant join reward was added to your balance.",
        metadata: { referral_id: referral.id, amount: joinRewardAmount },
      });
    }

    await conn.commit();
    return credited
      ? { paid: true, amount: joinRewardAmount, referral_id: referral.id }
      : { paid: false, reason: "already_paid" };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function getAllUserMilestones(db: Db = pool) {
  const [rows]: any = await db.query(
    "SELECT * FROM referral_milestones WHERE scope = 'user' AND status = 'active' ORDER BY threshold_count ASC"
  );
  return rows as any[];
}

async function getNextUserMilestone(verifiedCount: number, db: Db = pool) {
  const [rows]: any = await db.query(
    "SELECT * FROM referral_milestones WHERE scope = 'user' AND status = 'active' AND threshold_count > ? ORDER BY threshold_count ASC LIMIT 1",
    [verifiedCount]
  );
  return rows[0] || null;
}

async function getTeamLeagueSummary(userId: number, sprintId: number, verifiedCount: number, settings: Map<string, string>) {
  const unlockAt = Math.max(1, toInt(getSetting(settings, "team_league_unlock_referrals", "10"), 10));
  const [membershipRows]: any = await pool.query(
    `SELECT tm.team_id, t.name, t.capacity, tm.joined_at
     FROM referral_team_memberships tm
     JOIN referral_teams t ON t.id = tm.team_id
     WHERE tm.user_id = ?
     LIMIT 1`,
    [userId]
  );
  const membership = membershipRows[0] || null;

  const [leaderboard]: any = await pool.query(
    `SELECT
       t.id as team_id,
       t.name,
       t.capacity,
       COUNT(DISTINCT tm.user_id) as members,
       COUNT(DISTINCT r_all.id) as total_referrals,
       COUNT(DISTINCT r_sprint.id) as sprint_referrals
     FROM referral_teams t
     LEFT JOIN referral_team_memberships tm ON tm.team_id = t.id
     LEFT JOIN referrals r_all ON r_all.invited_by = tm.user_id AND r_all.verification_status = 'verified' AND r_all.reward_status = 'paid'
     LEFT JOIN referrals r_sprint ON r_sprint.invited_by = tm.user_id AND r_sprint.sprint_id = ? AND r_sprint.verification_status = 'verified' AND r_sprint.reward_status = 'paid'
     WHERE t.status = 'active'
     GROUP BY t.id, t.name, t.capacity
     ORDER BY sprint_referrals DESC, total_referrals DESC, members DESC, t.id ASC
     LIMIT 25`,
    [sprintId]
  );
  const rankedTeams = leaderboard.map((row: any, index: number) => ({ ...row, rank: index + 1 }));
  const currentTeam = membership ? rankedTeams.find((team: any) => Number(team.team_id) === Number(membership.team_id)) || membership : null;

  let mvp = null;
  let contribution = 0;
  if (membership) {
    const [mvpRows]: any = await pool.query(
      `SELECT tm.user_id, COUNT(r.id) as sprint_referrals
       FROM referral_team_memberships tm
       LEFT JOIN referrals r ON r.invited_by = tm.user_id AND r.sprint_id = ? AND r.verification_status = 'verified' AND r.reward_status = 'paid'
       WHERE tm.team_id = ?
       GROUP BY tm.user_id
       ORDER BY sprint_referrals DESC, tm.user_id ASC
       LIMIT 1`,
      [sprintId, membership.team_id]
    );
    const [[mine]]: any = await pool.query(
      "SELECT COUNT(*) as count FROM referrals WHERE invited_by = ? AND sprint_id = ? AND verification_status = 'verified' AND reward_status = 'paid'",
      [userId, sprintId]
    );
    const teamSprintReferrals = toNumber(currentTeam?.sprint_referrals);
    contribution = teamSprintReferrals > 0 ? Math.round((toNumber(mine?.count) / teamSprintReferrals) * 100) : 0;
    mvp = mvpRows[0] ? { display_name: maskedMember(mvpRows[0].user_id), sprint_referrals: toInt(mvpRows[0].sprint_referrals, 0) } : null;
  }

  return {
    unlocked: Boolean(membership),
    unlock_at: unlockAt,
    referrals_needed: Math.max(0, unlockAt - verifiedCount),
    current_team: currentTeam ? { ...currentTeam, mvp, contribution_percent: contribution } : null,
    leaderboard: rankedTeams,
  };
}

export async function getReferralGrowthSummary(userId: number) {
  const settings = await getSettings();
  const growthEnabled = sprintEnabled(settings);
  const sprint = growthEnabled ? await ensureActiveReferralSprint() : null;
  const [userRows]: any = await pool.query("SELECT referral_code, total_referral_earnings FROM users WHERE id = ?", [userId]);
  const user = userRows[0] || {};
  let referralCode = user.referral_code;
  if (!referralCode) {
    referralCode = makeReferralCode(userId);
    await pool.query("UPDATE users SET referral_code = ? WHERE id = ?", [referralCode, userId]);
  }

  const [[stats]]: any = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END), 0) as today_referrals,
       COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END), 0) as weekly_referrals,
       COALESCE(SUM(CASE WHEN sprint_id = ? THEN 1 ELSE 0 END), 0) as sprint_referrals,
       COUNT(*) as total_referrals,
       COALESCE(SUM(CASE WHEN verification_status = 'verified' AND reward_status = 'paid' THEN 1 ELSE 0 END), 0) as verified_referrals,
       COALESCE(SUM(CASE WHEN reward_status = 'paid' THEN reward_amount ELSE 0 END), 0) as referral_earnings
     FROM referrals
     WHERE invited_by = ?`,
    [sprint?.id || 0, userId]
  );
  const [history]: any = await pool.query(
    `SELECT
       r.id,
       r.status,
       r.verification_status,
       r.reward_status,
       r.reward_amount,
       r.created_at,
       r.verified_at,
       r.reward_paid_at,
       r.rejection_reason,
       r.user_id
     FROM referrals r
     WHERE r.invited_by = ?
     ORDER BY r.created_at DESC
     LIMIT 100`,
    [userId]
  );
  const [notifications]: any = await pool.query(
    `SELECT id, notification_type, title, message, status, created_at
     FROM referral_growth_notifications
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";
  const newsChannel = process.env.TELEGRAM_NEWS_CHANNEL || process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News";
  const defaultRequiredChannelUrl = `https://t.me/${newsChannel.replace(/^@/, "")}`;
  const verifiedCount = toInt(stats?.verified_referrals, 0);

  if (!growthEnabled || !sprint) {
    return {
      mode: "classic",
      sprint_enabled: false,
      referral_code: referralCode,
      referral_link: `https://t.me/${botUsername}?startapp=${referralCode}`,
      reward_amount: getReferralTotalRewardAmount(settings),
      referral_join_reward_amount: getReferralJoinRewardAmount(settings),
      referral_verification_reward_amount: getReferralVerificationRewardAmount(settings),
      required_channel_url: getSetting(settings, "required_channel_url", defaultRequiredChannelUrl),
      total_earnings: toNumber(user.total_referral_earnings || stats?.referral_earnings),
      stats: {
        total_referrals: toInt(stats?.total_referrals, 0),
        verified_referrals: verifiedCount,
        referral_earnings: toNumber(stats?.referral_earnings),
      },
      referrals: history.map((row: any) => ({ ...row, display_name: maskedMember(row.user_id) })),
      notifications,
    };
  }

  const leaderboard = await getReferralLeaderboard(Number(sprint.id), 50);
  const currentRank = leaderboard.find((row: any) => Number(row.user_id) === Number(userId))?.rank || null;
  const nextMilestone = await getNextUserMilestone(verifiedCount);
  const allMilestones = await getAllUserMilestones();
  const todayReferrals = toInt(stats?.today_referrals, 0);
  const teamLeague = await getTeamLeagueSummary(userId, Number(sprint.id), verifiedCount, settings);
  const boost = await getActiveBoostMultiplier(userId, teamLeague.current_team?.team_id || null);
  const nearWinnerGap = Math.max(1, toInt(getSetting(settings, "near_winner_gap_referrals", "2"), 2));
  const thirdPlaceCount = toInt(leaderboard[2]?.referral_count, 0);
  const userSprintCount = toInt(stats?.sprint_referrals, 0);
  const alerts = [
    currentRank && currentRank <= 3 ? "You are currently in the Top 3 for this Referral Sprint." : null,
    !currentRank && thirdPlaceCount > 0 && Math.max(0, thirdPlaceCount - userSprintCount + 1) <= nearWinnerGap
      ? `You are ${Math.max(1, thirdPlaceCount - userSprintCount + 1)} referrals away from Top 3.`
      : null,
    nextMilestone && Math.max(0, toInt(nextMilestone.threshold_count) - verifiedCount) <= nearWinnerGap
      ? "You are close to your next referral milestone."
      : null,
    teamLeague.current_team && Number(teamLeague.current_team.rank || 99) <= 2
      ? "Your team is close to first place."
      : null,
  ].filter(Boolean);

  return {
    mode: "sprint",
    sprint_enabled: true,
    referral_code: referralCode,
    referral_link: `https://t.me/${botUsername}?startapp=${referralCode}`,
    reward_amount: getReferralTotalRewardAmount(settings),
    referral_join_reward_amount: getReferralJoinRewardAmount(settings),
    referral_verification_reward_amount: getReferralVerificationRewardAmount(settings),
    required_channel_url: getSetting(settings, "required_channel_url", defaultRequiredChannelUrl),
    total_earnings: toNumber(user.total_referral_earnings),
    stats,
    progress: {
      current_referrals: verifiedCount,
      next_milestone: nextMilestone,
      referrals_needed: nextMilestone ? Math.max(0, toInt(nextMilestone.threshold_count) - verifiedCount) : 0,
      reward_available: nextMilestone ? toNumber(nextMilestone.reward_amount) : 0,
    },
    daily_milestones: allMilestones.map((m: any) => ({
      id: m.id,
      label: m.reward_label || `${m.threshold_count} referrals today`,
      threshold: toInt(m.threshold_count),
      reward: toNumber(m.reward_amount),
      reward_type: m.reward_type,
      today_progress: todayReferrals,
      completed_today: todayReferrals >= toInt(m.threshold_count),
    })),
    team_league: teamLeague,
    boost,
    alerts,
    notifications,
    current_rank: currentRank,
    sprint,
    leaderboard,
    top_winners: [
      { rank: 1, reward_amount: toNumber(sprint.first_place_reward), ...(leaderboard[0] || {}) },
      { rank: 2, reward_amount: toNumber(sprint.second_place_reward), ...(leaderboard[1] || {}) },
      { rank: 3, reward_amount: toNumber(sprint.third_place_reward), ...(leaderboard[2] || {}) },
    ],
    referrals: history.map((row: any) => ({ ...row, display_name: maskedMember(row.user_id) })),
  };
}

async function detectReferralAbuse(referral: any, conn: PoolConnection) {
  const flags: Array<{ key: string; risk: string; reason: string }> = [];
  if (Number(referral.user_id) === Number(referral.invited_by)) {
    flags.push({ key: "self_referral", risk: "critical", reason: "Self referral detected" });
  }

  const [[daily]]: any = await conn.query(
    "SELECT COUNT(*) as count FROM referrals WHERE invited_by = ? AND created_at >= CURDATE()",
    [referral.invited_by]
  );
  const settings = await getSettings(conn);
  const threshold = Math.max(1, toInt(getSetting(settings, "referral_mass_creation_threshold_daily", "25"), 25));
  if (toNumber(daily?.count) >= threshold) {
    flags.push({ key: "mass_referral_creation", risk: "high", reason: "Daily referral creation rate exceeded configured threshold" });
  }

  const [[loop]]: any = await conn.query(
    "SELECT COUNT(*) as count FROM referrals WHERE user_id = ? AND invited_by = ?",
    [referral.invited_by, referral.user_id]
  );
  if (toNumber(loop?.count) > 0) {
    flags.push({ key: "referral_loop", risk: "high", reason: "Reciprocal referral loop detected" });
  }

  if (flags.length === 0) return { allowed: true, flags };

  for (const flag of flags) {
    await conn.query(
      `INSERT INTO referral_abuse_flags
        (referral_id, referrer_id, referred_user_id, signal_key, risk_level, reason, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [referral.id, referral.invited_by, referral.user_id, flag.key, flag.risk, flag.reason, JSON.stringify({ referral_id: referral.id })]
    );
  }
  await conn.query(
    "UPDATE referrals SET abuse_risk_level = ?, abuse_flags = ?, status = CASE WHEN ? = 'critical' THEN 'rejected' ELSE status END, rejection_reason = CASE WHEN ? = 'critical' THEN ? ELSE rejection_reason END WHERE id = ?",
    [
      flags.some((flag) => flag.risk === "critical") ? "critical" : "high",
      JSON.stringify(flags),
      flags.some((flag) => flag.risk === "critical") ? "critical" : "high",
      flags.some((flag) => flag.risk === "critical") ? "critical" : "high",
      flags[0].reason,
      referral.id,
    ]
  );

  return { allowed: !flags.some((flag) => flag.risk === "critical"), flags };
}

export async function processVerifiedReferralForUser(userId: number) {
  const conn = await pool.getConnection();
  try {
    await ensureReferralSecuritySchema(conn);
    await conn.beginTransaction();
    const [rows]: any = await conn.query(
      `SELECT r.*, u.telegram_id as referrer_telegram_id
       FROM referrals r
       JOIN users u ON u.id = r.invited_by
       WHERE r.user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [userId]
    );

    if (rows.length === 0) {
      await conn.commit();
      return { paid: false, reason: "no_referral" };
    }

    const referral = rows[0];
    if (Number(referral.self_referral_blocked || 0) === 1) {
      await conn.commit();
      return { paid: false, reason: "self_referral_blocked" };
    }

    const selfDevice = await blockReferralIfSelfDevice(Number(referral.id), conn, { ensureSchema: false });
    if (selfDevice.blocked) {
      await conn.commit();
      return { paid: false, reason: "self_referral_blocked", referral_reward: selfDevice };
    }

    if (referral.reward_status === "paid") {
      await conn.commit();
      return { paid: false, reason: "already_paid" };
    }

    const abuse = await detectReferralAbuse(referral, conn);
    if (!abuse.allowed) {
      await conn.commit();
      return { paid: false, reason: "abuse_blocked", abuse };
    }

    const settings = await getSettings(conn);
    const growthEnabled = sprintEnabled(settings);
    const activeSprint = growthEnabled ? await ensureActiveReferralSprint(conn) : null;
    const configuredNewsChannel = process.env.TELEGRAM_NEWS_CHANNEL || process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News";
    const requiredChannel = getSetting(settings, "required_channel_url", `https://t.me/${configuredNewsChannel.replace(/^@/, "")}`);
    const joinRewardAmount = getReferralJoinRewardAmount(settings);
    let existingReferralRewardAmount = toNumber(referral.reward_amount);
    if (existingReferralRewardAmount < joinRewardAmount) {
      const joinCredited = await creditReferralReward(conn, {
        userId: Number(referral.invited_by),
        referralId: Number(referral.id),
        sprintId: activeSprint ? Number(activeSprint.id) : null,
        rewardType: "referral_join",
        amount: joinRewardAmount,
        reason: "referred_user_joined",
        metadata: {
          referred_user_id: userId,
          credited_during: "channel_verification",
        },
      });
      if (joinCredited) {
        existingReferralRewardAmount = Number((existingReferralRewardAmount + joinRewardAmount).toFixed(8));
      }
    }
    const verificationRewardAmount = getReferralVerificationRewardAmount(settings);
    const rewardAmount = verificationRewardAmount;
    const finalReferralRewardAmount = Number((existingReferralRewardAmount + rewardAmount).toFixed(8));

    await conn.query(
      `UPDATE referrals
       SET status = 'verified',
         verification_status = 'verified',
         reward_status = 'paid',
         reward_amount = ?,
         required_channel = ?,
         verified_at = COALESCE(verified_at, NOW()),
         reward_paid_at = NOW(),
         sprint_id = COALESCE(sprint_id, ?)
       WHERE id = ?`,
      [finalReferralRewardAmount, requiredChannel, activeSprint?.id || null, referral.id]
    );

    await creditReferralReward(conn, {
      userId: Number(referral.invited_by),
      referralId: Number(referral.id),
      sprintId: activeSprint ? Number(activeSprint.id) : null,
      rewardType: "verified_referral",
      amount: rewardAmount,
      reason: "verified_required_channel",
      metadata: {
        referred_user_id: userId,
        required_channel: requiredChannel,
        base_amount: verificationRewardAmount,
        total_referral_reward_amount: finalReferralRewardAmount,
      },
    });

    const verifiedCount = await getVerifiedReferralCount(Number(referral.invited_by), conn);
    const sprintId = activeSprint ? Number(activeSprint.id) : 0;
    const firstBonusPaid = verifiedCount === 1 ? await awardFirstReferralBonus(conn, Number(referral.invited_by), settings, sprintId) : false;
    const milestones = growthEnabled ? await awardEligibleUserMilestones(conn, Number(referral.invited_by), verifiedCount, sprintId) : [];
    const team = growthEnabled ? await ensureTeamMembership(Number(referral.invited_by), verifiedCount, conn, settings, sprintId) : null;
    await createGrowthNotification(conn, {
      userId: Number(referral.invited_by),
      type: "referral_joined",
      title: "Referral verified",
      message: "Your referral joined the required channel. The verification bonus was added to your balance.",
      metadata: { referral_id: referral.id, amount: rewardAmount, total_amount: finalReferralRewardAmount },
    });

    await conn.commit();
    await notifyUser(Number(referral.invited_by), `Referral verified\n\nYou earned an additional $${rewardAmount.toFixed(3)} after channel verification. Total for this referral: $${finalReferralRewardAmount.toFixed(3)}.`);
    if (firstBonusPaid) {
      await notifyUser(Number(referral.invited_by), "First referral bonus unlocked\n\nYour one-time first verified referral bonus was added to your withdrawable balance.");
    }
    for (const milestone of milestones) {
      await notifyUser(Number(referral.invited_by), `Milestone reached\n\n${milestone.reward_label || `${milestone.threshold_count} verified referrals`} unlocked $${toNumber(milestone.reward_amount).toFixed(2)}.`);
    }
    if (team?.unlocked_now) {
      await notifyUser(Number(referral.invited_by), `Team League unlocked\n\nYou joined Team ${team.name}. Your membership is permanent for league rewards.`);
    }
    await recordReferralSprintAudit({
      action: "referral_reward_paid",
      entityType: "referral",
      entityId: Number(referral.id),
      reason: "verified_required_channel",
      metadata: { referrer_id: referral.invited_by, referred_user_id: userId, amount: rewardAmount, total_amount: finalReferralRewardAmount, milestones: milestones.length, team_id: team?.team_id || team?.id || null },
    });
    return { paid: true, amount: rewardAmount, referral_id: referral.id };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function paySprintWinner(conn: PoolConnection, sprint: any, winner: any, rank: number, amount: number) {
  if (!winner || amount <= 0 || toNumber(winner.referral_count) <= 0) return false;
  const [winnerResult]: any = await conn.query(
    `INSERT IGNORE INTO referral_sprint_winners
      (sprint_id, user_id, rank_position, referral_count, reward_amount, reward_status, paid_at)
     VALUES (?, ?, ?, ?, ?, 'paid', NOW())`,
    [sprint.id, winner.user_id, rank, winner.referral_count, amount]
  );
  if (winnerResult.affectedRows !== 1) return false;

  const [ledgerResult]: any = await conn.query(
    `INSERT IGNORE INTO referral_reward_ledger
      (user_id, referral_id, sprint_id, reward_type, amount, status, reason, metadata)
     VALUES (?, NULL, ?, ?, ?, 'paid', 'sprint_winner', ?)`,
    [winner.user_id, sprint.id, `sprint_rank_${rank}`, amount, JSON.stringify({ rank, referral_count: winner.referral_count })]
  );
  if (ledgerResult.affectedRows !== 1) return false;

  await conn.query(
    "UPDATE users SET balance_available = balance_available + ?, total_referral_earnings = total_referral_earnings + ? WHERE id = ?",
    [amount, amount, winner.user_id]
  );
  await notifyUser(Number(winner.user_id), `Referral Sprint reward won\n\nRank #${rank}: $${amount.toFixed(2)} has been added to your withdrawable balance.`, conn);
  return true;
}

async function payTeamSprintReward(conn: PoolConnection, sprint: any, team: any, rank: number, amount: number) {
  if (!team || amount <= 0 || toNumber(team.referral_count) <= 0) return false;
  const [rewardResult]: any = await conn.query(
    `INSERT IGNORE INTO referral_team_rewards
      (sprint_id, team_id, rank_position, referral_count, reward_amount, reward_status, paid_at)
     VALUES (?, ?, ?, ?, ?, 'paid', NOW())`,
    [sprint.id, team.team_id, rank, team.referral_count, amount]
  );
  if (rewardResult.affectedRows === 0) return false;

  const [members]: any = await conn.query("SELECT user_id FROM referral_team_memberships WHERE team_id = ?", [team.team_id]);
  if (members.length === 0) return false;
  const perMemberAmount = Number((amount / members.length).toFixed(8));
  for (const member of members) {
    await creditReferralReward(conn, {
      userId: Number(member.user_id),
      sprintId: Number(sprint.id),
      rewardType: `team_sprint_rank_${rank}`,
      amount: perMemberAmount,
      reason: "team_sprint_reward",
      metadata: { team_id: team.team_id, rank, team_reward_pool: amount, member_count: members.length },
    });
    await notifyUser(Number(member.user_id), `Team reward won\n\nTeam ${team.name} finished #${rank}. Your share of the team reward was added to your withdrawable balance.`, conn);
  }
  return true;
}

async function awardEligibleTeamMilestones(conn: PoolConnection, teamId: number, sprintId: number) {
  const [[stats]]: any = await conn.query(
    `SELECT COUNT(r.id) as referrals
     FROM referral_team_memberships tm
     JOIN referrals r ON r.invited_by = tm.user_id AND r.verification_status = 'verified' AND r.reward_status = 'paid'
     WHERE tm.team_id = ?`,
    [teamId]
  );
  const referralCount = toInt(stats?.referrals, 0);
  const [milestones]: any = await conn.query(
    "SELECT * FROM referral_milestones WHERE scope = 'team' AND status = 'active' AND threshold_count <= ? ORDER BY threshold_count ASC",
    [referralCount]
  );
  let paid = 0;
  for (const milestone of milestones) {
    const [claim]: any = await conn.query(
      `INSERT IGNORE INTO referral_milestone_claims
        (milestone_id, team_id, sprint_id, amount, reward_type, status, paid_at, metadata)
       VALUES (?, ?, ?, ?, ?, 'paid', NOW(), ?)`,
      [
        milestone.id,
        teamId,
        sprintId,
        toNumber(milestone.reward_amount),
        milestone.reward_type,
        JSON.stringify({ threshold_count: milestone.threshold_count, referrals: referralCount }),
      ]
    );
    if (claim.affectedRows === 0) continue;
    const [members]: any = await conn.query("SELECT user_id FROM referral_team_memberships WHERE team_id = ?", [teamId]);
    const perMemberAmount = members.length > 0 ? Number((toNumber(milestone.reward_amount) / members.length).toFixed(8)) : 0;
    for (const member of members) {
      await creditReferralReward(conn, {
        userId: Number(member.user_id),
        sprintId,
        rewardType: `team_milestone_${milestone.id}`,
        amount: perMemberAmount,
        reason: "team_referral_milestone",
        metadata: { team_id: teamId, threshold_count: milestone.threshold_count, member_count: members.length },
      });
      await notifyUser(Number(member.user_id), `Team milestone reached\n\nYour team unlocked ${milestone.reward_label || `${milestone.threshold_count} team referrals`}.`, conn);
    }
    paid += 1;
  }
  return paid;
}

export async function finalizeExpiredReferralSprints(actorId?: number | null) {
  if (!(await isReferralSprintEnabled())) {
    return { finalized: 0, rewards_paid: 0, next_created: false, disabled: true };
  }

  const conn = await pool.getConnection();
  const results: any = { finalized: 0, rewards_paid: 0, next_created: false };
  try {
    await conn.beginTransaction();
    const [sprints]: any = await conn.query("SELECT * FROM referral_sprints WHERE status = 'active' AND ends_at <= NOW() FOR UPDATE");
    for (const sprint of sprints) {
      const [leaderboard]: any = await conn.query(
        `SELECT invited_by as user_id, COUNT(*) as referral_count
         FROM referrals
         WHERE sprint_id = ? AND verification_status = 'verified' AND reward_status = 'paid'
         GROUP BY invited_by
         ORDER BY referral_count DESC, invited_by ASC
         LIMIT 3`,
        [sprint.id]
      );
      const rewards = [toNumber(sprint.first_place_reward), toNumber(sprint.second_place_reward), toNumber(sprint.third_place_reward)];
      for (let i = 0; i < 3; i += 1) {
        const paid = await paySprintWinner(conn, sprint, leaderboard[i], i + 1, rewards[i]);
        if (paid) results.rewards_paid += 1;
      }
      const [teamLeaderboard]: any = await conn.query(
        `SELECT t.id as team_id, t.name, COUNT(r.id) as referral_count
         FROM referral_teams t
         JOIN referral_team_memberships tm ON tm.team_id = t.id
         LEFT JOIN referrals r ON r.invited_by = tm.user_id
          AND r.sprint_id = ?
          AND r.verification_status = 'verified'
          AND r.reward_status = 'paid'
         WHERE t.status = 'active'
         GROUP BY t.id, t.name
         ORDER BY referral_count DESC, t.id ASC
         LIMIT 3`,
        [sprint.id]
      );
      const teamRewards = [toNumber(sprint.best_team_reward), toNumber(sprint.second_team_reward), toNumber(sprint.third_team_reward)];
      for (let i = 0; i < 3; i += 1) {
        const paid = await payTeamSprintReward(conn, sprint, teamLeaderboard[i], i + 1, teamRewards[i]);
        if (paid) results.rewards_paid += 1;
      }
      const [teams]: any = await conn.query("SELECT id FROM referral_teams WHERE status = 'active'");
      for (const team of teams) {
        results.rewards_paid += await awardEligibleTeamMilestones(conn, Number(team.id), Number(sprint.id));
      }
      await conn.query("UPDATE referral_sprints SET status = 'archived', archived_at = NOW(), rewards_paid_at = NOW() WHERE id = ?", [sprint.id]);
      results.finalized += 1;

      if (Number(sprint.auto_restart) === 1) {
        const settings = await getSettings(conn);
        const duration = Math.max(1, toInt(getSetting(settings, "sprint_duration_days", String(sprint.duration_days || 14)), 14));
        await conn.query(
          `INSERT INTO referral_sprints
            (name, status, starts_at, ends_at, duration_days, first_place_reward, second_place_reward, third_place_reward, best_team_reward, second_team_reward, third_team_reward, auto_restart)
           VALUES ('Referral Sprint', 'active', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            duration,
            duration,
            toNumber(getSetting(settings, "sprint_first_place_reward", String(sprint.first_place_reward))),
            toNumber(getSetting(settings, "sprint_second_place_reward", String(sprint.second_place_reward))),
            toNumber(getSetting(settings, "sprint_third_place_reward", String(sprint.third_place_reward))),
            toNumber(getSetting(settings, "team_best_reward", String(sprint.best_team_reward || 15))),
            toNumber(getSetting(settings, "team_second_reward", String(sprint.second_team_reward || 8))),
            toNumber(getSetting(settings, "team_third_reward", String(sprint.third_team_reward || 4))),
            getSetting(settings, "sprint_auto_restart", "1") === "1" ? 1 : 0,
          ]
        );
        results.next_created = true;
      }
    }
    await conn.commit();
    if (results.finalized > 0) {
      await recordReferralSprintAudit({
        actorType: actorId ? "admin" : "system",
        actorId: actorId || null,
        action: "sprints_finalized",
        entityType: "referral_sprint",
        reason: "expired_sprints_processed",
        metadata: results,
      });
    }
    return results;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function notifyReferralSprintEndingSoon() {
  if (!(await isReferralSprintEnabled())) return { notified: false, reason: "sprint_disabled" };

  const [rows]: any = await pool.query(
    `SELECT *
     FROM referral_sprints
     WHERE status = 'active'
       AND ends_at > NOW()
       AND ends_at <= DATE_ADD(NOW(), INTERVAL 24 HOUR)
     ORDER BY ends_at ASC
     LIMIT 1`
  );
  if (rows.length === 0) return { notified: false, reason: "no_sprint_ending_soon" };

  const sprint = rows[0];
  const [auditRows]: any = await pool.query(
    "SELECT id FROM referral_sprint_audit_logs WHERE action = 'sprint_ending_soon_notice' AND entity_id = ? LIMIT 1",
    [sprint.id]
  );
  if (auditRows.length > 0) return { notified: false, reason: "already_notified" };

  await notifyReferralAudience("Referral Sprint ending soon\n\nYou have less than 24 hours to climb the leaderboard and compete for bonus rewards.", Number(sprint.id));
  await recordReferralSprintAudit({
    action: "sprint_ending_soon_notice",
    entityType: "referral_sprint",
    entityId: Number(sprint.id),
    reason: "less_than_24_hours_remaining",
  });
  return { notified: true, sprint_id: Number(sprint.id) };
}

export async function getAdminReferralGrowthData() {
  await ensureReferralGrowthSettingDefaults();
  const settingsMap = await getSettings();
  const enabled = sprintEnabled(settingsMap);
  if (enabled) await ensureActiveReferralSprint();
  const [settings]: any = await pool.query("SELECT `key`, value, description FROM referral_growth_settings ORDER BY `key`");
  const [sprints]: any = await pool.query("SELECT * FROM referral_sprints ORDER BY starts_at DESC LIMIT 20");
  const activeSprint = enabled ? sprints.find((sprint: any) => sprint.status === "active") || null : null;
  const leaderboard = enabled && activeSprint ? await getReferralLeaderboard(Number(activeSprint.id), 50) : [];
  const [history]: any = await pool.query(
    `SELECT w.*
     FROM referral_sprint_winners w
     ORDER BY w.created_at DESC
     LIMIT 50`
  );
  const [teamRewards]: any = await pool.query(
    `SELECT tr.*, t.name
     FROM referral_team_rewards tr
     JOIN referral_teams t ON t.id = tr.team_id
     ORDER BY tr.created_at DESC
     LIMIT 50`
  );
  const [teams]: any = await pool.query(
    `SELECT t.*, COUNT(tm.user_id) as members
     FROM referral_teams t
     LEFT JOIN referral_team_memberships tm ON tm.team_id = t.id
     GROUP BY t.id
     ORDER BY t.status ASC, t.created_at ASC
     LIMIT 100`
  );
  const [teamNames]: any = await pool.query("SELECT name, status, reserved_at FROM referral_team_name_pool ORDER BY id ASC LIMIT 100");
  const [milestones]: any = await pool.query("SELECT * FROM referral_milestones ORDER BY scope, threshold_count ASC");
  const [events]: any = await pool.query("SELECT e.*, t.name as team_name FROM referral_growth_events e LEFT JOIN referral_teams t ON t.id = e.team_id ORDER BY e.created_at DESC LIMIT 100");
  const [abuse]: any = await pool.query("SELECT * FROM referral_abuse_flags WHERE status = 'open' ORDER BY FIELD(risk_level, 'critical', 'high', 'medium', 'low'), created_at DESC LIMIT 100");
  const [audits]: any = await pool.query("SELECT * FROM referral_sprint_audit_logs ORDER BY created_at DESC LIMIT 100");
  const [[totals]]: any = await pool.query(
    `SELECT
       COUNT(*) as total_referrals,
       SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified_referrals,
       SUM(CASE WHEN reward_status = 'paid' THEN reward_amount ELSE 0 END) as referral_rewards_paid
     FROM referrals`
  );

  return {
    sprint_enabled: enabled,
    settings,
    sprints,
    active_sprint: activeSprint,
    leaderboard,
    history: history.map((row: any) => ({ ...row, display_name: maskedUser(row.user_id) })),
    team_rewards: teamRewards,
    teams,
    team_names: teamNames,
    milestones,
    events,
    abuse,
    audits,
    totals,
  };
}

export function channelUsernameFromSettings(settings: Map<string, string>) {
  const configuredNewsChannel = process.env.TELEGRAM_NEWS_CHANNEL || process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News";
  return cleanChannelUsername(getSetting(settings, "required_channel_username", configuredNewsChannel) || getSetting(settings, "required_channel_url", `https://t.me/${configuredNewsChannel.replace(/^@/, "")}`));
}
