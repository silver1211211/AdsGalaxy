import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireCronSecret } from "@/lib/cronSecurity";
import { processGrowthMembershipEvent } from "@/lib/channelGrowth";
import { revokePendingGrowthInvites } from "@/lib/channelGrowthInvite";
export async function GET(request:NextRequest){const denied=requireCronSecret(request);if(denied)return denied;const [rows]=await pool.query<Array<RowDataPacket & {id:number}>>("SELECT id FROM channel_growth_membership_events WHERE processing_status='pending' ORDER BY id LIMIT 100");let processed=0,failed=0;for(const row of rows){try{await processGrowthMembershipEvent(Number(row.id));processed++;}catch{failed++;}}const invites=await revokePendingGrowthInvites();return NextResponse.json({ok:true,candidates:rows.length,processed,failed,invites});}
