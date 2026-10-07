import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { persistTelegramMembershipUpdate } from "@/lib/telegramChannelAccess";

function validSecretToken(req: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();
  const supplied = req.headers.get("x-telegram-bot-api-secret-token")?.trim();
  if (!expected || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function POST(req: NextRequest) {
  if (!validSecretToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const update = await req.json();

    // Telegram sends various updates. 
    // Note: Bot API does NOT natively send a webhook when a message is deleted by a user.
    // However, we can handle other status changes here.

    if (update.my_chat_member) {
      const { chat, new_chat_member } = update.my_chat_member;
      const chatId = Number(chat?.id);
      const username = String(chat?.username || "").replace(/^@/, "").trim() || null;
      const actorTelegramId = Number(update.my_chat_member?.from?.id || 0);
      let channelId: number | null = null;

      if (Number.isSafeInteger(chatId)) {
        const [byChat] = await pool.query<Array<RowDataPacket & { id: number }>>(
          "SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? ORDER BY id DESC LIMIT 1",
          [chatId]
        );
        channelId = byChat[0]?.id || null;
      }
      if (!channelId && username) {
        const [byUsername] = await pool.query<Array<RowDataPacket & { id: number }>>(
          `SELECT id FROM channels
           WHERE is_deleted=FALSE AND LOWER(username)=LOWER(?)
             AND (chat_id IS NULL OR chat_id=0 OR chat_id=?)
           ORDER BY id DESC LIMIT 1`,
          [username, chatId]
        );
        channelId = byUsername[0]?.id || null;
      }
      if (!channelId && actorTelegramId) {
        const [byOwner] = await pool.query<Array<RowDataPacket & { id: number }>>(
          `SELECT c.id FROM channels c JOIN users u ON u.id=c.user_id
           WHERE c.is_deleted=FALSE AND c.status='pending' AND c.channel_type='private'
             AND (c.chat_id IS NULL OR c.chat_id=0) AND u.telegram_id=?
           ORDER BY c.id DESC LIMIT 2`,
          [actorTelegramId]
        );
        if (byOwner.length === 1) channelId = byOwner[0].id;
      }

      if (channelId && Number.isSafeInteger(chatId)) {
        const status = String(new_chat_member?.status || "unknown");
        await persistTelegramMembershipUpdate({
          channelId,
          source: "webhook",
          autoPauseActive: true,
          chatId,
          username,
          title: String(chat?.title || "").slice(0, 255),
          channelType: String(chat?.type || (username ? "channel" : "private")),
          status,
          canPostMessages: new_chat_member?.can_post_messages,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
