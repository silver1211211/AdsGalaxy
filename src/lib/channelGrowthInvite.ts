/* eslint-disable @typescript-eslint/no-explicit-any -- Telegram and MySQL response bodies are validated at runtime */
import "server-only";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";
import { decryptPrivateInviteLink, encryptPrivateInviteLink } from "@/lib/privateInviteLinkVault";
import { growthInviteHash } from "@/lib/channelGrowth";

async function createTelegramInvite(chatId: number, postId: number) {
  const token=process.env.BOT_TOKEN; if(!token) throw new Error("Growth bot token unavailable");
  const response=await fetch(`https://api.telegram.org/bot${token}/createChatInviteLink`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,name:`AdsGalaxy growth delivery ${postId}`}),signal:AbortSignal.timeout(10_000)});
  const body=await response.json(); if(!response.ok||!body.ok||!body.result?.invite_link)throw new Error("Growth invite creation failed"); return String(body.result.invite_link);
}
export async function createGrowthDeliveryInvite(input:{campaignId:number;postId:number;sourceChannelId:number;sourcePublisherId:number;destinationChatId:number;destinationChannelId?:number|null}) {
  const existing=await pool.query<any[]>("SELECT invite_link_encrypted FROM channel_growth_invites WHERE campaign_post_id=? LIMIT 1",[input.postId]);
  if(existing[0][0]) throw new Error("Growth delivery invite already exists");
  const invite=await createTelegramInvite(input.destinationChatId,input.postId); const encrypted=encryptPrivateInviteLink(invite); if(!encrypted)throw new Error("Growth invite encryption unavailable");
  const [insert]=await pool.query<ResultSetHeader>(`INSERT INTO channel_growth_invites (campaign_id,campaign_post_id,source_channel_id,source_publisher_id,destination_channel_id,destination_chat_id,invite_link_hash,invite_link_encrypted) VALUES (?,?,?,?,?,?,?,?)`,[input.campaignId,input.postId,input.sourceChannelId,input.sourcePublisherId,input.destinationChannelId||null,input.destinationChatId,growthInviteHash(invite),encrypted]);
  return {id:Number(insert.insertId),url:invite};
}
export async function revokePendingGrowthInvites(limit=50){const [rows]=await pool.query<any[]>("SELECT id,destination_chat_id,invite_link_encrypted FROM channel_growth_invites WHERE status='revoke_pending' ORDER BY id LIMIT ?",[Math.min(100,Math.max(1,limit))]);let revoked=0;for(const row of rows){const url=decryptPrivateInviteLink(row.invite_link_encrypted);if(!url)continue;const token=process.env.BOT_TOKEN;if(!token)break;try{const response=await fetch(`https://api.telegram.org/bot${token}/revokeChatInviteLink`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:row.destination_chat_id,invite_link:url}),signal:AbortSignal.timeout(10_000)});if(response.ok){await pool.query("UPDATE channel_growth_invites SET status='revoked',revoked_at=NOW() WHERE id=? AND status='revoke_pending'",[row.id]);revoked++;}}catch{}}return {candidates:rows.length,revoked};}
