import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

type BotRow = RowDataPacket & { id: number; bot_token: string; bot_token_encrypted: string | null };
type ExistingUserRow = RowDataPacket & { id: number };
type AuditRow = RowDataPacket & { id: number; admin_id: number | null; admin_username: string | null; metadata: unknown; created_at: string };

const MAX_IDS_PER_IMPORT = 5000;

function parseIds(value: unknown) {
  const tokens = String(value || "").split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  const unique = [...new Set(tokens)];
  return {
    submitted: tokens.length,
    unique: unique.length,
    duplicateInput: tokens.length - unique.length,
    validFormat: unique.filter((id) => /^[1-9]\d{4,19}$/.test(id)),
    invalidFormat: unique.filter((id) => !/^[1-9]\d{4,19}$/.test(id)),
  };
}

async function botUserColumns() {
  const [rows] = await pool.query<Array<RowDataPacket & { COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users'`
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function storeUser(connection: PoolConnection, columns: Set<string>, botId: number, user: { id: string; username: string | null; firstName: string | null }) {
  const [existingRows] = await connection.query<ExistingUserRow[]>(
    "SELECT id FROM bot_users WHERE bot_id = ? AND (user_id = ? OR chat_id = ?) ORDER BY id ASC LIMIT 1 FOR UPDATE",
    [botId, user.id, user.id]
  );
  const existing = existingRows[0];
  if (existing) return "existing" as const;
  const names = ["bot_id", "user_id", "chat_id"];
  const placeholders = ["?", "?", "?"];
  const insertValues: unknown[] = [botId, user.id, user.id];
  const addValue = (column: string, value: unknown) => {
    if (!columns.has(column)) return;
    names.push(column); placeholders.push("?"); insertValues.push(value);
  };
  addValue("telegram_username", user.username);
  addValue("telegram_first_name", user.firstName);
  addValue("username", user.username);
  addValue("first_name", user.firstName);
  if (columns.has("first_seen_at")) { names.push("first_seen_at"); placeholders.push("NOW()"); }
  if (columns.has("last_seen_at")) { names.push("last_seen_at"); placeholders.push("NOW()"); }
  addValue("source", "manual_admin");
  addValue("is_active", false);
  addValue("status", "pending_verification");
  await connection.query(`INSERT INTO bot_users (${names.join(", ")}) VALUES (${placeholders.join(", ")})`, insertValues);
  return "added" as const;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdminPermission("read");
  if (response) return response;
  const { id } = await params;
  const [rows] = await pool.query<AuditRow[]>(
    `SELECT audit.id, audit.admin_id, admins.username AS admin_username, audit.metadata, audit.created_at
     FROM admin_action_audits audit
     LEFT JOIN admins ON admins.id = audit.admin_id
     WHERE audit.action = 'bot_manual_user_import' AND audit.entity_type = 'bot' AND audit.entity_id = ?
     ORDER BY audit.id DESC LIMIT 10`,
    [id]
  );
  return NextResponse.json({ history: rows });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { user_ids?: unknown; dry_run?: boolean };
  const parsed = parseIds(body.user_ids);
  if (parsed.submitted === 0) return NextResponse.json({ error: "Enter at least one Telegram user ID" }, { status: 400 });
  if (parsed.unique > MAX_IDS_PER_IMPORT) return NextResponse.json({ error: `Maximum ${MAX_IDS_PER_IMPORT} unique IDs per import` }, { status: 400 });

  const [bots] = await pool.query<BotRow[]>("SELECT id, bot_token, bot_token_encrypted FROM bots WHERE id = ? AND is_deleted = FALSE LIMIT 1", [id]);
  const bot = bots[0];
  if (!bot) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

  const failed: Array<{ id: string; reason: string }> = parsed.invalidFormat.map((invalidId) => ({ id: invalidId, reason: "ID must be a positive 5-20 digit Telegram user ID" }));
  const verified = parsed.validFormat.map((userId) => ({ id: userId, username: null, firstName: null }));

  if (body.dry_run) {
    return NextResponse.json({
      success: true,
      dry_run: true,
      total_submitted: parsed.submitted,
      unique_submitted: parsed.unique,
      duplicate_input: parsed.duplicateInput,
      valid: verified.length,
      invalid: failed.length,
      failed_ids: failed,
    });
  }

  let added = 0;
  let updated = 0;
  const columns = await botUserColumns();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const user of verified) {
      try {
        const result = await storeUser(connection, columns, bot.id, user);
        if (result === "added") added += 1;
        else updated += 1;
      } catch (error) {
        failed.push({ id: user.id, reason: error instanceof Error ? error.message.slice(0, 200) : "Database update failed" });
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const result = {
    total_submitted: parsed.submitted,
    unique_submitted: parsed.unique,
    valid: verified.length,
    added,
    updated,
    invalid: failed.length,
    duplicate: parsed.duplicateInput + updated,
    duplicate_input: parsed.duplicateInput,
    failed_ids: failed,
  };
  await recordAdminActionAudit({
    adminId: admin?.id,
    action: "bot_manual_user_import",
    entityType: "bot",
    entityId: bot.id,
    reason: "manual_admin_user_import",
    metadata: result,
  });
  return NextResponse.json({ success: true, ...result });
}
