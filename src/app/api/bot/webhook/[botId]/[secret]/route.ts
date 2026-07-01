import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { parsePublisherBotUpdate, verifyBotWebhookSecret } from "@/lib/botWebhook";

type BotCredentialRow = RowDataPacket & {
  id: number;
  bot_token: string;
  webhook_url: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ botId: string; secret: string }> }
) {
  const { botId, secret } = await params;
  const [bots] = await pool.query<BotCredentialRow[]>(
    "SELECT id, bot_token, webhook_url FROM bots WHERE id = ? AND is_deleted = FALSE LIMIT 1",
    [botId]
  );
  const bot = bots[0];

  if (!bot || !verifyBotWebhookSecret(bot.id, bot.bot_token, secret, bot.webhook_url)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const update = await request.json().catch(() => null);
  const parsed = parsePublisherBotUpdate(update);
  if (!parsed.updateId) {
    return NextResponse.json({ ok: true });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [dedupeResult] = await connection.query<ResultSetHeader>(
      "INSERT IGNORE INTO bot_webhook_updates (bot_id, update_id) VALUES (?, ?)",
      [bot.id, parsed.updateId]
    );

    if (dedupeResult.affectedRows === 0) {
      await connection.commit();
      return NextResponse.json({ ok: true });
    }

    if (parsed.userId) {
      await connection.query(
        `INSERT INTO bot_users (bot_id, user_id, chat_id, is_active, status, inactive_reason)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           user_id = VALUES(user_id),
           is_active = VALUES(is_active),
           status = VALUES(status),
           inactive_reason = VALUES(inactive_reason)`,
        [
          bot.id,
          parsed.userId,
          parsed.userId,
          !parsed.isInactive,
          parsed.isInactive ? "blocked_bot" : "active",
          parsed.isInactive ? "User blocked or removed the bot." : null,
        ]
      );
    }

    await connection.query("UPDATE bots SET webhook_last_update_at = NOW() WHERE id = ?", [bot.id]);
    await connection.commit();
    return NextResponse.json({ ok: true });
  } catch {
    await connection.rollback();
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    connection.release();
  }
}
