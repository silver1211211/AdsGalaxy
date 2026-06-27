import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getAdminAdvertiserAnalytics, resolveIntelligenceRange } from "@/lib/advertiserIntelligence";

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const range = resolveIntelligenceRange(searchParams);
  const data = await getAdminAdvertiserAnalytics(range);
  return NextResponse.json(data);
}
