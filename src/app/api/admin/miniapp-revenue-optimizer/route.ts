import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/adminAuth";
import { getMiniAppRevenueOptimizerReport } from "@/lib/miniappRevenueOptimizer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { response } = await requireAdminPermission("read");
  if (response) return response;

  try {
    const { searchParams } = new URL(request.url);
    const report = await getMiniAppRevenueOptimizerReport(Number(searchParams.get("limit") || 100));
    return NextResponse.json(report);
  } catch (error) {
    console.error("Admin Mini App Revenue Optimizer GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
