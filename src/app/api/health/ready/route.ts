import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

async function safeText(file: string) {
  try { return (await readFile(file, "utf8")).trim() || null; } catch { return null; }
}

export async function GET() {
  const started = Date.now();
  let database = "ok";
  try { await pool.query("SELECT 1"); } catch { database = "unavailable"; }
  const cwd = process.cwd();
  const buildId = process.env.ADSGALAXY_BUILD_ID || await safeText(path.join(cwd, ".next", "BUILD_ID"));
  let metadata: { git_revision?: string; release_id?: string } = {};
  try { metadata = JSON.parse(await readFile(path.join(cwd, "release-metadata.json"), "utf8")); } catch { /* legacy release */ }
  const healthy = database === "ok" && Boolean(buildId);
  return NextResponse.json({
    status: healthy ? "ready" : "not_ready",
    database,
    build_id: buildId,
    git_revision: process.env.ADSGALAXY_GIT_REVISION || metadata.git_revision || null,
    release_id: process.env.ADSGALAXY_RELEASE_ID || metadata.release_id || null,
    duration_ms: Date.now() - started,
  }, { status: healthy ? 200 : 503 });
}
