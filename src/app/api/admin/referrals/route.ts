import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy referral query payload is dynamically shaped */
import pool from "@/lib/db";
import { getAuthenticatedAdmin, requireAdminPermission } from "@/lib/adminAuth";
import {
  ensureActiveReferralSprint,
  finalizeExpiredReferralSprints,
  getAdminReferralGrowthData,
  notifyReferralAudience,
  recordReferralSprintAudit,
  settlePendingReferralRewards,
} from "@/lib/referralSprint";

function clean(value: unknown) {
  return String(value || "").trim();
}

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

export async function GET(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const data = await getAdminReferralGrowthData();
    if (searchParams.get("export") === "rankings") {
      const lines = [
        "rank,masked_user,verified_referrals,rewards",
        ...data.leaderboard.map((row: any) => `${row.rank},${row.display_name},${row.referral_count},${row.referral_rewards}`),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=referral-rankings.csv",
        },
      });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Admin Referrals GET Error:", error);
    return NextResponse.json({ error: error.message || "Failed to load referral growth data" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;

  try {
    const body = await request.json();
    const action = clean(body.action);

    if (action === "toggle_sprint") {
      const enabled = body.enabled ? "1" : "0";
      await pool.query(
        `INSERT INTO referral_growth_settings (\`key\`, value, description)
         VALUES ('referral_sprint_enabled', ?, 'Enable Referral Sprint, Team League, Team Rewards, and growth UI')
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [enabled]
      );
      if (enabled === "0") {
        await pool.query("UPDATE referral_sprints SET status = 'paused' WHERE status = 'active'");
      } else {
        await ensureActiveReferralSprint();
      }
      await recordReferralSprintAudit({
        actorType: "admin",
        actorId: admin.id,
        action: enabled === "1" ? "sprint_enabled" : "sprint_disabled",
        entityType: "referral_growth_setting",
        reason: "admin_toggle",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "update_setting") {
      await pool.query(
        `INSERT INTO referral_growth_settings (\`key\`, value, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), description = VALUES(description)`,
        [clean(body.key), clean(body.value), clean(body.description)]
      );
      if (clean(body.key) === "required_channel_url") {
        const username = clean(body.value).replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").replace(/\/$/, "");
        await pool.query(
          `INSERT INTO referral_growth_settings (\`key\`, value, description)
           VALUES ('required_channel_username', ?, 'Telegram username used for membership verification')
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [username]
        );
      }
      await recordReferralSprintAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "setting_update",
        entityType: "referral_growth_setting",
        reason: clean(body.key),
        metadata: body,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "start_sprint") {
      const duration = Math.max(1, Number(body.duration_days || 14));
      const first = toNumber(body.first_place_reward);
      const second = toNumber(body.second_place_reward);
      const third = toNumber(body.third_place_reward);
      const teamFirst = toNumber(body.best_team_reward || body.team_best_reward || 15);
      const teamSecond = toNumber(body.second_team_reward || body.team_second_reward || 8);
      const teamThird = toNumber(body.third_team_reward || body.team_third_reward || 4);
      const autoRestart = body.auto_restart ? 1 : 0;
      await pool.query(
        `INSERT INTO referral_growth_settings (\`key\`, value, description)
         VALUES ('referral_sprint_enabled', '1', 'Enable Referral Sprint, Team League, Team Rewards, and growth UI')
         ON DUPLICATE KEY UPDATE value = VALUES(value)`
      );
      await pool.query("UPDATE referral_sprints SET status = 'archived', archived_at = NOW() WHERE status = 'active'");
      const [result]: any = await pool.query(
        `INSERT INTO referral_sprints
          (name, status, starts_at, ends_at, duration_days, first_place_reward, second_place_reward, third_place_reward, best_team_reward, second_team_reward, third_team_reward, auto_restart)
         VALUES (?, 'active', NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [clean(body.name) || "Referral Sprint", duration, duration, first, second, third, teamFirst, teamSecond, teamThird, autoRestart]
      );
      await recordReferralSprintAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "sprint_started",
        entityType: "referral_sprint",
        entityId: Number(result.insertId),
        reason: "manual_admin_start",
        metadata: body,
      });
      await notifyReferralAudience(`Referral Sprint started\n\nInvite friends, earn verified referral rewards, and compete for bonus rewards. This sprint ends in ${duration} days.`, Number(result.insertId));
      return NextResponse.json({ success: true });
    }

    if (action === "reset_sprint") {
      await pool.query("UPDATE referral_sprints SET status = 'archived', archived_at = NOW() WHERE status = 'active'");
      await ensureActiveReferralSprint();
      await recordReferralSprintAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "sprint_reset",
        entityType: "referral_sprint",
        reason: "manual_admin_reset",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "save_milestone") {
      const id = Number(body.id || 0);
      const payload = [
        clean(body.scope) || "user",
        Math.max(1, Number(body.threshold_count || 1)),
        clean(body.reward_type) || "withdrawable_balance",
        toNumber(body.reward_amount),
        clean(body.reward_label),
        clean(body.status) || "active",
      ];
      if (id > 0) {
        await pool.query(
          "UPDATE referral_milestones SET scope = ?, threshold_count = ?, reward_type = ?, reward_amount = ?, reward_label = ?, status = ? WHERE id = ?",
          [...payload, id]
        );
      } else {
        await pool.query(
          "INSERT INTO referral_milestones (scope, threshold_count, reward_type, reward_amount, reward_label, status) VALUES (?, ?, ?, ?, ?, ?)",
          payload
        );
      }
      await recordReferralSprintAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "milestone_saved",
        entityType: "referral_milestone",
        entityId: id || null,
        metadata: body,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "add_team_name") {
      await pool.query("INSERT IGNORE INTO referral_team_name_pool (name) VALUES (?)", [clean(body.name)]);
      await recordReferralSprintAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "team_name_added",
        entityType: "referral_team_name",
        reason: clean(body.name),
      });
      return NextResponse.json({ success: true });
    }

    if (action === "create_event") {
      await pool.query(
        `INSERT INTO referral_growth_events
          (name, event_type, team_id, multiplier, starts_at, ends_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          clean(body.name) || "Referral Boost",
          clean(body.event_type) || "referral_reward_multiplier",
          body.team_id ? Number(body.team_id) : null,
          Math.max(1, toNumber(body.multiplier || 1)),
          clean(body.starts_at),
          clean(body.ends_at),
          clean(body.status) || "active",
        ]
      );
      await recordReferralSprintAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "growth_event_created",
        entityType: "referral_growth_event",
        reason: clean(body.name),
        metadata: body,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "finalize_sprints") {
      const settlement = await settlePendingReferralRewards({ actorId: admin.id });
      const result = await finalizeExpiredReferralSprints(admin.id);
      await ensureActiveReferralSprint();
      return NextResponse.json({ success: true, settlement, result });
    }

    if (action === "settle_referrals") {
      const result = await settlePendingReferralRewards({ settlementDate: clean(body.settlement_date) || undefined, actorId: admin.id });
      return NextResponse.json({ success: true, result });
    }

    if (action === "review_abuse") {
      await pool.query(
        "UPDATE referral_abuse_flags SET status = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?",
        [clean(body.status) || "reviewed", admin.id, Number(body.id)]
      );
      await recordReferralSprintAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "abuse_flag_reviewed",
        entityType: "referral_abuse_flag",
        entityId: Number(body.id),
        reason: clean(body.status),
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin Referrals PATCH Error:", error);
    return NextResponse.json({ error: error.message || "Referral growth action failed" }, { status: 500 });
  }
}
