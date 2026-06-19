import { NextResponse } from "next/server";
import { deleteCampaignPosts } from "@/lib/campaignPostDeletion";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const summary = await deleteCampaignPosts({
      olderThan24Hours: true,
      batchSize: 30,
      batchDelayMs: 500,
    });

    return NextResponse.json({
      success: true,
      processed: summary.total,
      deleted: summary.deleted,
      failed: summary.failed,
      failedIds: summary.failedIds,
      details: summary.details,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Cron Cleanup Posts Error:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
