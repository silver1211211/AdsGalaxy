#!/usr/bin/env node
/* Read-only by default. It never executes migration SQL. */
import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import "dotenv/config";

const applyBaseline = process.argv.includes("--apply-baseline");
if (applyBaseline && process.env.ADSGALAXY_EXPLICIT_SCHEMA_BASELINE !== "1") throw new Error("refusing_baseline_without_ADSGALAXY_EXPLICIT_SCHEMA_BASELINE=1");
const names = (await readdir("db/migrations")).filter((name) => name.endsWith(".sql")).sort();
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME });
try {
  const [ledger] = await db.query("SELECT migration_name, checksum_sha256 FROM adsfusion_schema_migrations");
  const applied = new Map(ledger.map((row) => [String(row.migration_name), String(row.checksum_sha256 || "")]));
  const report = [];
  for (const name of names) {
    const source = await readFile(`db/migrations/${name}`, "utf8"); const checksum = crypto.createHash("sha256").update(source).digest("hex");
    if (applied.has(name)) {
      const recorded = applied.get(name) || "";
      const isSha256 = /^[a-f0-9]{64}$/i.test(recorded);
      if (isSha256 && recorded !== checksum) {
        throw new Error(`checksum_mismatch:${name}`);
      }
      report.push({
        name,
        state: "APPLIED",
        checksum_verified: isSha256,
        ledger_value: isSha256 ? recorded : "legacy_baseline"
      });
      continue;
    }
    if (/0150_/.test(name)) { report.push({ name, state: "PROTECTED_SPECIAL_CASE" }); continue; }
    const tables = [...source.matchAll(/(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE)\s+`?([a-zA-Z0-9_]+)/gi)].map((m) => m[1]);
    const total = tables.length ? Number((await db.query("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?)", [tables]))[0][0].total) : 0;
    // Tables are only a safe first fingerprint. A human-reviewed baseline must add
    // column/index fingerprints before it may write any ledger record.
    const state = !tables.length ? "UNKNOWN" : total === 0 ? "MISSING" : total < tables.length ? "PARTIALLY_PRESENT" : "ALREADY_PRESENT_AND_COMPATIBLE";
    report.push({ name, state, tables, source_checksum: checksum });
  }
  console.log(JSON.stringify({ dry_run: !applyBaseline, report }, null, 2));
  if (applyBaseline) throw new Error("baseline write intentionally requires a reviewed, schema-fingerprint-specific implementation; this tool will not write a ledger row automatically");
} finally { await db.end(); }
