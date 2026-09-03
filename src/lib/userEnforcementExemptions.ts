import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
type Db = typeof pool | PoolConnection;
export const PUBLISHER_TRUST_SCOPE = "publisher_trust_auto_ban";
export async function hasActiveUserEnforcementExemption(db: Db, userId: number, scope=PUBLISHER_TRUST_SCOPE) {
  const [tables] = await db.query<RowDataPacket[]>("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_enforcement_exemptions' LIMIT 1");
  if (!tables.length) return false;
  const [rows] = await db.query<RowDataPacket[]>(`SELECT id FROM user_enforcement_exemptions WHERE user_id=? AND scope=? AND active=1 AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP()) LIMIT 1`,[userId,scope]);
  return rows.length>0;
}
export async function setUserEnforcementExemption(input:{db?:Db;userId:number;scope?:string;exemptionType:string;reason:string;adminId?:number|null;expiresAt?:string|null;active?:boolean}) {
  const db=input.db||pool;
  await db.query(`INSERT INTO user_enforcement_exemptions (user_id,scope,exemption_type,reason,created_by,expires_at,active)
    VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE exemption_type=VALUES(exemption_type),reason=VALUES(reason),updated_by=VALUES(created_by),expires_at=VALUES(expires_at),active=VALUES(active),updated_at=UTC_TIMESTAMP()`,
    [input.userId,input.scope||PUBLISHER_TRUST_SCOPE,input.exemptionType,input.reason,input.adminId||null,input.expiresAt||null,input.active===false?0:1]);
}
