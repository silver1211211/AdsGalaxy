import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/adminAuth";
import pool from "@/lib/db";
import { composeHtml, validateButtonUrl } from "@/lib/platformBroadcast";
import { sendTelegramMessage } from "@/lib/telegram";

export async function POST(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous"); if (response) return response;
  const body = await request.json(); const target = String(body.telegram_id || admin?.telegram_id || "").trim();
  if (!/^[1-9][0-9]{4,19}$/.test(target)) return NextResponse.json({ error: "Select a valid trusted platform user." }, { status: 400 });
  const [users]: any = await pool.query("SELECT id FROM users WHERE telegram_id=? AND COALESCE(LOWER(status),'active') NOT IN ('banned','deleted','blocked','deactivated') LIMIT 1", [target]);
  if (!users.length) return NextResponse.json({ error: "Trusted recipient is not an eligible AdsGalaxy user." }, { status: 400 });
  const html = composeHtml(String(body.title || ""), Boolean(body.title_bold), String(body.message || ""));
  if (!html || html.length > 4096) return NextResponse.json({ error: "Invalid message length." }, { status: 400 });
  const url = validateButtonUrl(body.button_url); if (body.button_url && !url) return NextResponse.json({ error: "Invalid CTA URL." }, { status: 400 });
  const result = await sendTelegramMessage(target, html, { parse_mode: "HTML", photo: body.image_path || undefined, reply_markup: body.button_text && url ? { inline_keyboard: [[{ text: String(body.button_text), url }]] } : undefined });
  return result?.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result?.description || "Telegram test send failed." }, { status: 502 });
}
