import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config({path:fs.existsSync(".env.production")?".env.production":".env",quiet:true});
const schema="adsfusion_teaser_test_20260910";
test("historical candidate migration is additive, idempotent, and balance-free in isolated MariaDB",async()=>{
 assert.equal(process.env.FINANCIAL_EVENT_TEST_SCHEMA,schema,"explicit isolated schema opt-in required");
 const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASS,database:schema,multipleStatements:true});
 try{
  const [[identity]]=await db.query("SELECT DATABASE() schema_name");
  assert.equal(identity.schema_name,schema);
  const [existing]=await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()");
  assert.equal(existing.length,0,"isolated schema must be empty");
  const migration=fs.readFileSync("db/migrations/20261101_0801_historical_financial_evidence_candidates.sql","utf8");
  assert.doesNotMatch(migration,/UPDATE users|ALTER TABLE users|DELETE FROM users/i);
  await db.query(migration);
  await db.query(migration);
  await db.query(`INSERT INTO historical_financial_evidence_candidates
    (source_event_key,user_id,source_table,source_record_id,amount,provenance_quality,missing_evidence,source_row_sha256)
    VALUES ('legacy:channel:click:42',7,'ad_settlements',42,'2.00000000','source_row','review needed',?)`,["a".repeat(64)]);
  await assert.rejects(db.query(`INSERT INTO historical_financial_evidence_candidates
    (source_event_key,user_id,source_table,source_record_id,amount,provenance_quality,missing_evidence,source_row_sha256)
    VALUES ('legacy:channel:click:42',7,'ad_settlements',42,'2.00000000','source_row','review needed',?)`,["a".repeat(64)]),/Duplicate entry|ER_DUP_ENTRY/);
  const [[row]]=await db.query("SELECT amount,verification_confidence,review_status FROM historical_financial_evidence_candidates WHERE source_event_key='legacy:channel:click:42'");
  assert.equal(row.amount,"2.00000000");
  assert.equal(row.verification_confidence,"unverified");
  assert.equal(row.review_status,"candidate");
 }finally{
  await db.query("DROP TABLE IF EXISTS historical_financial_evidence_candidates");
  await db.end();
 }
});
