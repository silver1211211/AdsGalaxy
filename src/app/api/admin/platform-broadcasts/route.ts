import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { audit, composeHtml, countEligibleRecipients, discoverRecipients, getBroadcastDashboard, parseBroadcastTarget, validateButtonUrl } from "@/lib/platformBroadcast";

export async function GET(request: Request) {
  const { response } = await requireAdminPermission("read"); if (response) return response;
  const url = new URL(request.url);
  if (url.searchParams.get("preview") === "1") {
    try {
      const target = parseBroadcastTarget(Object.fromEntries(url.searchParams));
      const count = await countEligibleRecipients(target.targetSince, target.targetType);
      return NextResponse.json({ count, target_since: target.targetSince?.toISOString() || null });
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid recipient filter." }, { status: 400 }); }
  }
  return NextResponse.json({ broadcasts: await getBroadcastDashboard() });
}

export async function POST(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous"); if (response) return response;
  const body = await request.json();
  let target;
  try { target = parseBroadcastTarget(body); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid recipient filter." }, { status: 400 }); }
  const title = String(body.title || "").trim(); const message = String(body.message || "").trim();
  if (!message || message.length > 4000 || title.length > 255) return NextResponse.json({ error: "Message is required and must fit Telegram limits." }, { status: 400 });
  const buttonText = String(body.button_text || "").trim(); const rawUrl = String(body.button_url || "").trim(); const buttonUrl = validateButtonUrl(rawUrl);
  if ((buttonText && !buttonUrl) || (!buttonText && rawUrl) || buttonText.length > 80) return NextResponse.json({ error: "Provide valid CTA text and an http, https, or tg URL." }, { status: 400 });
  if (body.confirm !== "BROADCAST_RECIPIENTS") return NextResponse.json({ error: "Explicit broadcast confirmation is required." }, { status: 400 });
  const html = composeHtml(title, Boolean(body.title_bold), message);
  if (html.length > 4096) return NextResponse.json({ error: "Formatted message is too long." }, { status: 400 });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result]: any = await connection.query(`INSERT INTO platform_broadcasts
      (title,title_bold,message_text,message_html,image_path,button_text,button_url,target_type,target_value,target_unit,target_since,status,created_by_admin_id,queued_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'queued',?,NOW())`, [title || null, body.title_bold ? 1 : 0, message, html, body.image_path || null, buttonText || null, buttonUrl, target.targetType, target.targetValue, target.targetUnit, target.targetSince, admin!.id]);
    await discoverRecipients(result.insertId, connection); await connection.commit();
    await audit(result.insertId, "send_requested", admin!.id, { target: target.targetType, value: target.targetValue, unit: target.targetUnit, since: target.targetSince });
    return NextResponse.json({ id: result.insertId, status: "queued" }, { status: 202 });
  } catch (error) { await connection.rollback(); console.error(error); return NextResponse.json({ error: "Could not queue broadcast." }, { status: 500 }); }
  finally { connection.release(); }
}
