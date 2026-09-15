/* eslint-disable @typescript-eslint/no-explicit-any -- Telegram update and MySQL row shapes are runtime-normalized */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { growthInviteHash, processGrowthMembershipEvent } from "@/lib/channelGrowth";

function authorized(request: NextRequest) {
  const expected = Buffer.from(String(process.env.BOT_TOKEN || ""));
  const supplied = Buffer.from(String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as any;
  const updateId=Number(body?.update_id), botId=Number(body?.bot_id), chatId=Number(body?.chat_id), userId=Number(body?.user_id);
  const eventType=body?.event_type === "chat_join_request" ? "chat_join_request" : "chat_member";
  if (![updateId,botId,chatId,userId].every(Number.isSafeInteger)) return NextResponse.json({error:"Invalid event"},{status:422});
  const inviteLink=String(body?.invite_link||""); let invite:any=null;
  if(inviteLink){const [rows]=await pool.query<Array<RowDataPacket & any>>("SELECT i.id,i.campaign_id,i.campaign_post_id,i.destination_chat_id,c.status campaign_status FROM channel_growth_invites i JOIN campaigns c ON c.id=i.campaign_id WHERE i.invite_link_hash=? AND i.status='active' LIMIT 1",[growthInviteHash(inviteLink)]);invite=rows[0]||null;}
  const [insert]=await pool.query<ResultSetHeader>(`INSERT IGNORE INTO channel_growth_membership_events (bot_id,update_id,invite_id,campaign_id,campaign_post_id,destination_chat_id,telegram_user_id,is_bot,old_status,new_status,event_type,event_at,campaign_valid_at_event) VALUES (?,?,?,?,?,?,?,?,?,?,?,FROM_UNIXTIME(?),?)`,[botId,updateId,invite?.id||null,invite?.campaign_id||null,invite?.campaign_post_id||null,chatId,userId,body?.is_bot?1:0,String(body?.old_status||""),String(body?.new_status||""),eventType,Math.max(0,Number(body?.event_date)||Math.floor(Date.now()/1000)),invite?.campaign_status==="active"?1:0]);
  if(insert.affectedRows===1) await processGrowthMembershipEvent(Number(insert.insertId)).catch(()=>undefined);
  return NextResponse.json({ok:true,duplicate:insert.affectedRows===0});
}
