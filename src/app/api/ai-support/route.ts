import crypto from "crypto";
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { GroupPilotError, groupPilotClearConversation, groupPilotGetConversation, groupPilotRespond } from "@/lib/groupPilot";

async function authenticated(request: Request) {
  return getAuthenticatedUserStatus(request.headers.get("x-telegram-init-data"), { request });
}

async function sessionFor(userId: number) {
  const [rows] = await pool.query("SELECT group_pilot_session_id FROM ai_support_sessions WHERE user_id = ? LIMIT 1", [userId]);
  const existing = (rows as Array<{ group_pilot_session_id: string }>)[0]?.group_pilot_session_id;
  if (existing) return existing;
  const sessionId = crypto.randomUUID();
  await pool.query("INSERT INTO ai_support_sessions (user_id, group_pilot_session_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)", [userId, sessionId]);
  const [created] = await pool.query("SELECT group_pilot_session_id FROM ai_support_sessions WHERE user_id = ? LIMIT 1", [userId]);
  return (created as Array<{ group_pilot_session_id: string }>)[0].group_pilot_session_id;
}

function failure(error: unknown) {
  if (error instanceof GroupPilotError) return NextResponse.json({ success: false, error: error.code }, { status: error.status });
  return NextResponse.json({ success: false, error: "AI_TEMPORARILY_UNAVAILABLE" }, { status: getAuthErrorStatus(error) === 401 ? 401 : 503 });
}

export async function GET(request: Request) {
  try { const user = await authenticated(request); return NextResponse.json({ success: true, ...(await groupPilotGetConversation(await sessionFor(Number(user.id)))) }); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await authenticated(request);
    const body = await request.json().catch(() => null) as { message?: unknown; requestId?: unknown } | null;
    if (!body || typeof body.message !== "string" || typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)) throw new GroupPilotError(422, "INVALID_REQUEST");
    const [cached] = await pool.query("SELECT response_json FROM ai_support_requests WHERE user_id = ? AND client_request_id = ? AND response_json IS NOT NULL LIMIT 1", [user.id, body.requestId]);
    const prior = (cached as Array<{ response_json: string }>)[0]?.response_json;
    if (prior) return NextResponse.json(JSON.parse(prior));
    await pool.query("INSERT IGNORE INTO ai_support_requests (user_id, client_request_id) VALUES (?, ?)", [user.id, body.requestId]);
    const result = await groupPilotRespond({ sessionId: await sessionFor(Number(user.id)), userId: `ads-galaxy-user-${user.id}`, message: body.message, idempotencyKey: body.requestId });
    await pool.query("UPDATE ai_support_requests SET response_json = ?, upstream_request_id = ? WHERE user_id = ? AND client_request_id = ?", [JSON.stringify(result), result.requestId, user.id, body.requestId]);
    return NextResponse.json(result);
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await authenticated(request); const sessionId = await sessionFor(Number(user.id));
    await groupPilotClearConversation(sessionId);
    await pool.query("UPDATE ai_support_sessions SET group_pilot_session_id = ?, updated_at = NOW() WHERE user_id = ?", [crypto.randomUUID(), user.id]);
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}
