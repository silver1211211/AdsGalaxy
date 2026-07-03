import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json(
    { success: false, error: "Deprecated cron. Use /api/cron/delete-expired-posts." },
    { status: 410 }
  );
}
