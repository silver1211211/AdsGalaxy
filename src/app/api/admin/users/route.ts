import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { ADVERTISER_TRUST_LEVELS, normalizeAdvertiserTrustLevel } from "@/lib/advertiserTrust";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { setUserEnforcementExemption } from "@/lib/userEnforcementExemptions";
import { parseAdminPagination } from "@/lib/adminPagination";

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

async function getUserColumns() {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
  `);

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const { page, limit, offset } = parseAdminPagination(searchParams, { defaultLimit: 10 });
  const search = searchParams.get("search") || "";
  const trustFilter = normalizeAdvertiserTrustLevel(searchParams.get("trust") || "all");
  const rawTrustFilter = searchParams.get("trust") || "all";

  try {
    const columns = await getUserColumns();
    const statusExpr = columns.has("status")
      ? "status"
      : columns.has("is_banned")
        ? "IF(COALESCE(is_banned, 0) = 1, 'banned', 'active')"
        : "'active'";
    const bannedAtExpr = columns.has("banned_at") ? "banned_at" : "NULL";
    const banReasonExpr = columns.has("ban_reason") ? "ban_reason" : "NULL";
    const trustExpr = columns.has("advertiser_trust_level") ? "advertiser_trust_level" : "'new'";
    const publisherTrustExpr = columns.has("publisher_trust_score") ? "publisher_trust_score" : "60";
    const publisherRiskExpr = columns.has("publisher_risk_score") ? "publisher_risk_score" : "0";
    const trustUpdatedExpr = columns.has("advertiser_trust_updated_at") ? "advertiser_trust_updated_at" : "NULL";
    const trustNoteExpr = columns.has("advertiser_trust_note") ? "advertiser_trust_note" : "NULL";

    let query = `
      SELECT id, telegram_id, first_name, last_name, username, balance_locked, balance_available,
        ad_balance, created_at, ${statusExpr} as status,
        CASE WHEN ${statusExpr} = 'banned' THEN 1 ELSE 0 END as is_banned,
        ${bannedAtExpr} as banned_at,
        ${banReasonExpr} as ban_reason,
        ${trustExpr} as advertiser_trust_level,
        ${publisherTrustExpr} as publisher_trust_score,
        ${publisherRiskExpr} as publisher_risk_score,
        ${trustUpdatedExpr} as advertiser_trust_updated_at,
        ${trustNoteExpr} as advertiser_trust_note
      FROM users
    `;
    let countQuery = "SELECT COUNT(*) as total FROM users";
    const queryParams: Array<string | number> = [];
    const countParams: string[] = [];

    const whereParts: string[] = [];
    if (rawTrustFilter !== "all") {
      whereParts.push(`${trustExpr} = ?`);
      queryParams.push(trustFilter);
      countParams.push(trustFilter);
    }

    if (search) {
      const searchPattern = `%${search}%`;
      whereParts.push("(username LIKE ? OR telegram_id LIKE ? OR first_name LIKE ? OR last_name LIKE ?)");
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (whereParts.length > 0) {
      const where = ` WHERE ${whereParts.join(" AND ")}`;
      query += where;
      countQuery += where;
    }

    query += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const [[rows], [countRows]] = await Promise.all([
      pool.query<RowDataPacket[]>(query, [...queryParams, limit, offset]),
      pool.query<Array<RowDataPacket & { total: number }>>(countQuery, countParams),
    ]);
    const countRow = countRows[0] || { total: 0 };
    const userIds = rows.map((row) => Number(row.id)).filter(Number.isSafeInteger);
    let users = rows;

    if (userIds.length > 0) {
      const [[discountRows], [campaignRows], [miniAppRows], [spendRows]] = await Promise.all([
        pool.query<RowDataPacket[]>(
          `SELECT user_id, cpm_discount, cpc_discount, expires_at,
             CASE WHEN expires_at > UTC_TIMESTAMP() THEN 1 ELSE 0 END AS is_active
           FROM advertiser_rate_discounts WHERE user_id IN (?)`,
          [userIds]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT user_id, COUNT(*) AS total,
             SUM(status IN ('active','completed','budget_exhausted')) AS approved,
             SUM(status = 'rejected') AS rejected
           FROM campaigns WHERE user_id IN (?) GROUP BY user_id`,
          [userIds]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT advertiser_id AS user_id, COUNT(*) AS total,
             SUM(status IN ('approved','completed')) AS approved,
             SUM(status = 'rejected') AS rejected
           FROM miniapp_rewarded_campaigns WHERE advertiser_id IN (?) GROUP BY advertiser_id`,
          [userIds]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT user_id, COALESCE(SUM(amount), 0) AS total_spend
           FROM advertiser_transactions WHERE user_id IN (?) AND type='debit' GROUP BY user_id`,
          [userIds]
        ),
      ]);
      const byUser = <T extends RowDataPacket>(items: T[]) => new Map(items.map((item) => [Number(item.user_id), item]));
      const discounts = byUser(discountRows);
      const campaigns = byUser(campaignRows);
      const miniApps = byUser(miniAppRows);
      const spend = byUser(spendRows);
      users = rows.map((row) => {
        const userId = Number(row.id);
        const discount = discounts.get(userId);
        const standard = campaigns.get(userId);
        const miniApp = miniApps.get(userId);
        return {
          ...row,
          advertiser_cpm_discount: discount?.cpm_discount || 0,
          advertiser_cpc_discount: discount?.cpc_discount || 0,
          advertiser_discount_expires_at: discount?.expires_at || null,
          advertiser_discount_active: Number(discount?.is_active || 0),
          advertiser_total_campaigns: Number(standard?.total || 0) + Number(miniApp?.total || 0),
          advertiser_approved_campaigns: Number(standard?.approved || 0) + Number(miniApp?.approved || 0),
          advertiser_rejected_campaigns: Number(standard?.rejected || 0) + Number(miniApp?.rejected || 0),
          advertiser_total_spend: spend.get(userId)?.total_spend || 0,
        };
      });
    }
    return NextResponse.json({
      users,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: unknown) {
    console.error("Admin Users API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;

  const conn = await pool.getConnection();

  try {
    const { id, balance_locked, balance_available, ad_balance, action, reason, trust_level,
      unban_disposition, exemption_type, exemption_expires_at, discount_cpm_enabled,
      discount_cpc_enabled, cpm_discount, cpc_discount, discount_expires_at } = await request.json();

    if (!id) return NextResponse.json({ error: "User ID required" }, { status: 400 });

    const [beforeRows] = await conn.query<RowDataPacket[]>(
      "SELECT balance_locked, balance_available, ad_balance, status, advertiser_trust_level, publisher_trust_score FROM users WHERE id = ? LIMIT 1",
      [id]
    );
    const before = beforeRows[0];
    if (!before) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const audit = (auditAction: string, metadata: Record<string, unknown>) => recordAdminActionAudit({
      adminId: admin?.id,
      action: auditAction,
      entityType: "user",
      entityId: id,
      reason: reason || auditAction,
      metadata,
    });

    if (action === "ban") {
      await conn.query(
        "UPDATE users SET status = 'banned', is_banned = 1, banned_at = NOW(), ban_reason = ? WHERE id = ?",
        [reason || "Admin ban", id]
      );
      await audit("publisher_ban", { previous_status: before.status, new_status: "banned" });
      return NextResponse.json({ success: true });
    }

    if (action === "unban") {
      const disposition = String(unban_disposition || "trust_remediation");
      if (!["enforcement_exemption", "trust_remediation", "no_remediation"].includes(disposition)) {
        return NextResponse.json({ error: "A valid unban disposition is required" }, { status: 400 });
      }
      if ((disposition === "enforcement_exemption" || disposition === "no_remediation") && !String(reason || "").trim()) {
        return NextResponse.json({ error: "An admin reason is required for this unban disposition" }, { status: 400 });
      }
      if (disposition === "enforcement_exemption" && !String(exemption_type || "").trim()) {
        return NextResponse.json({ error: "Exemption type is required" }, { status: 400 });
      }
      const resetTrust = disposition === "trust_remediation";
      await conn.beginTransaction();
      await conn.query(
        `UPDATE users SET status='active',is_banned=0,banned_at=NULL,ban_reason=NULL,
          publisher_trust_score=CASE WHEN ? THEN 60 ELSE publisher_trust_score END WHERE id=?`,
        [resetTrust ? 1 : 0, id]
      );
      await setUserEnforcementExemption({
        db: conn,
        userId: Number(id),
        exemptionType: disposition === "enforcement_exemption" ? String(exemption_type) : "none",
        reason: String(reason || (resetTrust ? "Trust remediated to platform default" : "Exemption disabled")),
        adminId: admin?.id,
        expiresAt: disposition === "enforcement_exemption" ? exemption_expires_at || null : null,
        active: disposition === "enforcement_exemption",
      });
      await conn.query(
        `UPDATE channels SET status='active',paused_reason=NULL,auto_paused_at=NULL
         WHERE user_id=? AND is_deleted=FALSE AND status='paused' AND paused_reason='fraudulent_or_low_quality_traffic'`,
        [id]
      );
      await conn.commit();
      await audit("publisher_unban", {
        previous_status: before.status,
        new_status: "active",
        previous_publisher_trust_score: Number(before.publisher_trust_score ?? 60),
        new_publisher_trust_score: resetTrust ? 60 : Number(before.publisher_trust_score ?? 60),
        unban_disposition: disposition,
        enforcement_exemption: disposition === "enforcement_exemption" ? {
          exemption_type: String(exemption_type),
          expires_at: exemption_expires_at || null,
        } : null,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "set_advertiser_trust") {
      const level = normalizeAdvertiserTrustLevel(trust_level);
      if (!ADVERTISER_TRUST_LEVELS.includes(level)) {
        return NextResponse.json({ error: "Invalid advertiser trust level" }, { status: 400 });
      }
      await conn.query(
        "UPDATE users SET advertiser_trust_level = ?, advertiser_trust_updated_at = NOW(), advertiser_trust_note = ? WHERE id = ?",
        [level, reason || null, id]
      );
      if (level === "restricted") {
        await conn.query("UPDATE campaigns SET status = 'paused' WHERE user_id = ? AND status = 'active'", [id]);
        await conn.query("UPDATE miniapp_rewarded_campaigns SET status = 'paused' WHERE advertiser_id = ? AND status = 'approved'", [id]);
      }
      await audit("advertiser_trust_change", { previous_level: before.advertiser_trust_level, new_level: level });
      return NextResponse.json({ success: true });
    }

    if (action === "set_advertiser_discount") {
      const cpmEnabled = Boolean(discount_cpm_enabled);
      const cpcEnabled = Boolean(discount_cpc_enabled);
      const cpmAmount = cpmEnabled ? Number(cpm_discount) : 0;
      const cpcAmount = cpcEnabled ? Number(cpc_discount) : 0;
      if ((cpmEnabled && (!Number.isFinite(cpmAmount) || cpmAmount <= 0 || cpmAmount > 1000))
        || (cpcEnabled && (!Number.isFinite(cpcAmount) || cpcAmount <= 0 || cpcAmount > 1000))) {
        return NextResponse.json({ error: "Discounts must be greater than $0 and no more than $1,000 per 1,000 events" }, { status: 400 });
      }

      const [previousRows] = await conn.query<RowDataPacket[]>(
        "SELECT cpm_discount,cpc_discount,expires_at FROM advertiser_rate_discounts WHERE user_id=? LIMIT 1",
        [id],
      );
      if (!cpmEnabled && !cpcEnabled) {
        await conn.query("DELETE FROM advertiser_rate_discounts WHERE user_id=?", [id]);
        await audit("advertiser_discount_disabled", { previous: previousRows[0] || null });
        return NextResponse.json({ success: true });
      }

      const expiresAt = new Date(String(discount_expires_at || ""));
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        return NextResponse.json({ error: "Select a future discount expiry" }, { status: 400 });
      }
      await conn.query(
        `INSERT INTO advertiser_rate_discounts
          (user_id,cpm_discount,cpc_discount,expires_at,updated_by_admin_id)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE cpm_discount=VALUES(cpm_discount),cpc_discount=VALUES(cpc_discount),
           expires_at=VALUES(expires_at),updated_by_admin_id=VALUES(updated_by_admin_id)`,
        [id, cpmAmount, cpcAmount, expiresAt.toISOString().slice(0, 19).replace("T", " "), admin?.id || null],
      );
      await audit("advertiser_discount_updated", {
        previous: previousRows[0] || null,
        next: { cpm_discount: cpmAmount, cpc_discount: cpcAmount, expires_at: expiresAt.toISOString() },
      });
      return NextResponse.json({ success: true });
    }

    const nextBalances = [balance_locked, balance_available, ad_balance].map(Number);
    if (nextBalances.some((value) => !Number.isFinite(value) || value < 0)) {
      return NextResponse.json({ error: "Balances must be finite, non-negative numbers" }, { status: 400 });
    }

    await conn.query(
      "UPDATE users SET balance_locked = ?, balance_available = ?, ad_balance = ? WHERE id = ?",
      [...nextBalances, id]
    );

    await audit("user_balance_adjustment", {
      previous: { balance_locked: before.balance_locked, balance_available: before.balance_available, ad_balance: before.ad_balance },
      next: { balance_locked: nextBalances[0], balance_available: nextBalances[1], ad_balance: nextBalances[2] },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    await conn.rollback().catch(() => undefined);
    console.error("Admin Users Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  } finally {
    conn.release();
  }
}
