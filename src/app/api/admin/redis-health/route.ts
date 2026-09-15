import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getRedisHealth } from "@/lib/redis";

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getRedisHealth(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
