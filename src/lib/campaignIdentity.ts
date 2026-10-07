import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = Pool | PoolConnection;

export function campaignPublicIdSql(alias = "c") {
  return `COALESCE(${alias}.public_id,${alias}.id)`;
}

export async function resolveCampaignPublicId(publicId: number, db: Db = pool) {
  const [rows] = await db.query<Array<RowDataPacket & { id: number; public_id: number }>>(
    `SELECT id,${campaignPublicIdSql("c")} public_id FROM campaigns c WHERE ${campaignPublicIdSql("c")}=? LIMIT 1`,
    [publicId],
  );
  return rows[0] || null;
}

export async function allocateCampaignPublicId(conn: PoolConnection, campaignId: number) {
  await conn.query("UPDATE campaign_public_id_sequence SET next_id=LAST_INSERT_ID(next_id+1) WHERE singleton=1");
  const [[row]] = await conn.query<Array<RowDataPacket & { allocated_id: number }>>("SELECT LAST_INSERT_ID()-1 allocated_id");
  const publicId = Number(row?.allocated_id || 0);
  if (!publicId) throw new Error("campaign_public_id_allocation_failed");
  await conn.query("UPDATE campaigns SET public_id=? WHERE id=? AND public_id IS NULL", [publicId,campaignId]);
  return publicId;
}
