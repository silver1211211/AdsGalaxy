import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedAdmin, requireAdminPermission } from "@/lib/adminAuth";
import { recordAutomationAudit } from "@/lib/approvalAutomation";

type CheckRow = RowDataPacket & { id: number; publisher_id: number; inventory_type: string | null; inventory_id: number | null };

export async function GET(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const countOnly = new URL(request.url).searchParams.get("count") === "1";
  const [[summary]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) unresolved,
       SUM(risk_level='critical') critical,
       SUM(risk_level='high') high_risk
     FROM publisher_review_queue WHERE status='open'`
  );
  if (countOnly) return NextResponse.json({ unresolved: Number(summary?.unresolved || 0) });

  const [cases] = await pool.query<RowDataPacket[]>(
    `SELECT q.*,u.username,u.telegram_id,u.status publisher_status,u.is_banned,
       u.publisher_trust_score,u.publisher_risk_score,u.balance_available,u.balance_locked,
       ch.title channel_title,ch.username channel_username,ch.status channel_status,
       ch.health_status,ch.subscriber_count,ch.settlement_excluded_until,ch.settlement_exclusion_reason,
       (SELECT COUNT(*) FROM channel_fraud_incidents i
         WHERE i.publisher_id=q.publisher_id AND i.status='open'
           AND (q.inventory_id IS NULL OR i.channel_id=q.inventory_id)) open_incidents,
       (SELECT MAX(i.last_seen_at) FROM channel_fraud_incidents i
         WHERE i.publisher_id=q.publisher_id AND i.status='open'
           AND (q.inventory_id IS NULL OR i.channel_id=q.inventory_id)) latest_incident_at
     FROM publisher_review_queue q
     JOIN users u ON u.id=q.publisher_id
     LEFT JOIN channels ch ON q.inventory_type='channel' AND ch.id=q.inventory_id
     WHERE q.status='open'
     ORDER BY FIELD(q.risk_level,'critical','high','medium','low') ASC,q.created_at ASC
     LIMIT 250`
  );
  const [recent] = await pool.query<RowDataPacket[]>(
    `SELECT q.id,q.publisher_id,q.inventory_type,q.inventory_id,q.risk_level,q.reason,q.status,
       q.reviewed_at,q.reviewed_by,u.username
     FROM publisher_review_queue q JOIN users u ON u.id=q.publisher_id
     WHERE q.status<>'open' ORDER BY q.reviewed_at DESC LIMIT 50`
  );
  return NextResponse.json({ summary, cases, recent });
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;
  const body = await request.json().catch(() => ({}));
  const caseId = Number(body.case_id);
  const action = String(body.action || "");
  const note = String(body.note || "").trim().slice(0, 500);
  if (!Number.isInteger(caseId) || caseId <= 0) return NextResponse.json({ error: "Invalid case" }, { status: 400 });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<CheckRow[]>(
      "SELECT * FROM publisher_review_queue WHERE id=? AND status='open' LIMIT 1 FOR UPDATE",
      [caseId]
    );
    const item = rows[0];
    if (!item) {
      await connection.rollback();
      return NextResponse.json({ error: "Open review case not found" }, { status: 404 });
    }

    if (action === "clear" || action === "false_positive") {
      const nextStatus = action === "false_positive" ? "false_positive" : "cleared";
      await connection.query("UPDATE publisher_review_queue SET status=?,reviewed_at=NOW(),reviewed_by=? WHERE id=?", [nextStatus, admin?.id, caseId]);
      if (item.inventory_type === "channel" && item.inventory_id) {
        await connection.query("UPDATE channels SET under_review=0 WHERE id=?", [item.inventory_id]);
        if (action === "false_positive") {
          await connection.query("UPDATE channel_fraud_incidents SET status='false_positive',reviewed_at=NOW(),reviewed_by=?,review_note=? WHERE channel_id=? AND status='open'", [admin?.id, note || "Admin marked review case false positive", item.inventory_id]);
          await connection.query("UPDATE channel_fraud_events SET false_positive_at=NOW(),false_positive_by=?,false_positive_reason=? WHERE channel_id=? AND false_positive_at IS NULL", [admin?.id, note || "Admin marked review case false positive", item.inventory_id]);
        }
      }
    } else if (action === "hold_settlement" && item.inventory_type === "channel" && item.inventory_id) {
      await connection.query("UPDATE channels SET under_review=1,settlement_excluded_until=DATE_ADD(NOW(),INTERVAL 7 DAY),settlement_exclusion_reason=? WHERE id=?", [note || "Admin Check review hold", item.inventory_id]);
    } else if (action === "release_settlement" && item.inventory_type === "channel" && item.inventory_id) {
      await connection.query("UPDATE channels SET settlement_excluded_until=NULL,settlement_exclusion_reason=NULL WHERE id=?", [item.inventory_id]);
    } else if (action === "suspend_publisher") {
      await connection.query(`INSERT INTO automation_suspensions
        (entity_type,entity_id,scope,status,reason,suspended_until,created_by,created_by_id)
        VALUES ('publisher',?,'temporary','active',?,DATE_ADD(NOW(),INTERVAL 7 DAY),'admin',?)`,
        [item.publisher_id, note || "Manual Admin Check suspension", admin?.id]);
      await connection.query("UPDATE users SET automation_suspension_status='temporary',automation_suspended_until=DATE_ADD(NOW(),INTERVAL 7 DAY) WHERE id=?", [item.publisher_id]);
    } else if (action === "ban_publisher") {
      await connection.query("UPDATE users SET status='banned',is_banned=1,banned_at=NOW(),ban_reason=? WHERE id=?", [note || "Manual Admin Check ban", item.publisher_id]);
      await connection.query("UPDATE publisher_review_queue SET status='banned',reviewed_at=NOW(),reviewed_by=? WHERE id=?", [admin?.id, caseId]);
    } else {
      await connection.rollback();
      return NextResponse.json({ error: "Invalid action for this case" }, { status: 400 });
    }
    await connection.commit();
    await recordAutomationAudit({ actorType: "admin", actorId: Number(admin?.id || 0), action: `admin_check_${action}`, entityType: "publisher_review", entityId: caseId, reason: note || action, metadata: { publisher_id: item.publisher_id, inventory_type: item.inventory_type, inventory_id: item.inventory_id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    console.error("Admin Check action failed", { case_id: caseId, action, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Admin Check action failed" }, { status: 500 });
  } finally {
    connection.release();
  }
}
