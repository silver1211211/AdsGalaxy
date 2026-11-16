import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import type { ResultSetHeader,RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
export async function GET(request:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  if(!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return NextResponse.json({error:"Not found"},{status:404});
  const [rows]=await pool.query<Array<RowDataPacket & {id:number;destination:string|null}>>(
    `SELECT tp.id,COALESCE(tp.approved_destination_url,
       CASE WHEN c.status='active' AND c.pending_creative_revision_id IS NULL
         AND c.approved_creative_revision_id IS NULL THEN c.link ELSE NULL END) destination
     FROM teaser_placements tp JOIN campaigns c ON c.id=tp.campaign_id
     WHERE tp.tracking_token=? AND tp.status IN ('active','removal_pending','removing','failed')
       AND tp.removed_at IS NULL AND tp.inserted_at IS NOT NULL
       AND (c.status='active' OR (c.status='pending' AND c.approved_creative_revision_id IS NOT NULL
         AND c.pending_creative_revision_id IS NOT NULL AND c.status_before_creative_review='active')
         OR (c.status='paused' AND c.pause_reason='moderation_cleanup'
           AND c.approved_creative_revision_id IS NOT NULL))
       AND (tp.expires_at IS NULL OR tp.expires_at>UTC_TIMESTAMP()) LIMIT 1`, [token]);
  if(!rows.length) return NextResponse.json({error:"Not found"},{status:404});
  if(!rows[0].destination) return NextResponse.json({error:"Approved destination unavailable"},{status:410});
  let destination:URL;
  try { destination=new URL(String(rows[0].destination)); }
  catch { return NextResponse.json({error:"Destination unavailable"},{status:410}); }
  if(!["https:","http:"].includes(destination.protocol)) return NextResponse.json({error:"Destination unavailable"},{status:410});
  const forwarded=String(request.headers.get("x-forwarded-for")||"").split(",")[0].trim();const fingerprint=createHash("sha256").update(`${forwarded}|${request.headers.get("user-agent")||""}`).digest("hex");
  const [claim]=await pool.query<ResultSetHeader>("INSERT IGNORE INTO teaser_clicks(placement_id,fingerprint,bucket_start) VALUES(?,?,FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP()/600)*600))",[rows[0].id,fingerprint]);if(claim.affectedRows===1)await pool.query("UPDATE teaser_placements SET clicks=clicks+1 WHERE id=?",[rows[0].id]);
  return NextResponse.redirect(destination,302);
}
