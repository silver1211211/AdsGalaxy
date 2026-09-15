import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { normalizeAuthorityCountry, normalizeAuthorityLanguage } from "@/lib/channelTargetingClassification";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, admin } = await requireAdminPermission("operate"); if (response) return response;
  const { id } = await params; const channelId=Number(id); const body=await request.json().catch(()=>null) as { country?:unknown; language?:unknown; action?:unknown }|null;
  if(!Number.isSafeInteger(channelId)||channelId<1)return NextResponse.json({error:"Invalid channel"},{status:400});
  const [channelRows]=await pool.query<RowDataPacket[]>("SELECT id FROM channels WHERE id=? AND is_deleted=0 LIMIT 1",[channelId]);
  if(!channelRows[0])return NextResponse.json({error:"Channel not found"},{status:404});
  const clear=body?.action==="clear_targeting_override";
  const country=normalizeAuthorityCountry(body?.country),language=normalizeAuthorityLanguage(body?.language);
  if(!clear&&!country&&!language)return NextResponse.json({error:"A normalized country or language is required"},{status:400});
  await pool.query(`INSERT INTO channel_geo_classifications (channel_id,confidence,source,reason,status,classified_at)
    VALUES (?,'unknown','admin_targeting_override','Created for targeting override','current',UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE channel_id=VALUES(channel_id)`,[channelId]);
  if(clear){await pool.query("UPDATE channel_geo_classifications SET country_source=NULL,language_source=NULL,targeting_override_by=NULL,targeting_override_at=NULL WHERE channel_id=?",[channelId]);return NextResponse.json({success:true,cleared:true});}
  await pool.query(`UPDATE channel_geo_classifications SET authoritative_country_code=COALESCE(?,authoritative_country_code),country_confidence=IF(? IS NULL,country_confidence,1),country_source=IF(? IS NULL,country_source,'manual_admin'),country_classified_at=IF(? IS NULL,country_classified_at,UTC_TIMESTAMP()),authoritative_language_code=COALESCE(?,authoritative_language_code),language_confidence=IF(? IS NULL,language_confidence,1),language_source=IF(? IS NULL,language_source,'manual_admin'),language_classified_at=IF(? IS NULL,language_classified_at,UTC_TIMESTAMP()),targeting_override_by=?,targeting_override_at=UTC_TIMESTAMP() WHERE channel_id=?`,[country,country,country,country,language,language,language,language,admin?.id??null,channelId]);
  return NextResponse.json({success:true,country,language});
}
