import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "This legacy endpoint is disabled; use the per-bot Integration URL" }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "This legacy endpoint is disabled; use the per-bot Integration URL" }, { status: 410 });
}
