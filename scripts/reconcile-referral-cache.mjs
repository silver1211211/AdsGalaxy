import mysql from "mysql2/promise";
import { applyReferralCacheRepair, inspectReferralCache } from "../src/lib/referralCacheReconciliation.ts";

const userArg = process.argv.find((value) => value.startsWith("--user-id="));
const userId = Number(userArg?.split("=")[1]);
const apply = process.argv.includes("--apply");
if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("--user-id=<exact numeric id> is required");
if (apply && userId !== 78930) throw new Error("apply is approved only for exact user 78930");

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  decimalNumbers: false,
});
try {
  await db.beginTransaction();
  const report = apply
    ? { mode: "apply", ...(await applyReferralCacheRepair(db, userId)) }
    : { mode: "dry-run", ...(await inspectReferralCache(db, userId)) };
  if (apply) await db.commit(); else await db.rollback();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.end();
}
