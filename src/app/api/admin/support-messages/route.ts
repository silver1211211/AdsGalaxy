import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/adminAuth";
import {
  getSupportMessageAdminSummary,
  renderSupportMessagePreview,
  setSupportMessageDryRun,
  setSupportMessagePaused,
  setSupportMessageRateLimits,
  startSupportMessageBackfill,
  updateSupportMessageBackfill,
  type SupportMessageType,
} from "@/lib/supportMessages";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireAdminPermission("read");
  if (response) return response;

  try {
    return NextResponse.json(await getSupportMessageAdminSummary());
  } catch (error) {
    console.error("Support message admin summary error", { error: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "Failed to load support message summary" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { response } = await requireAdminPermission("support");
  if (response) return response;

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    if (action === "pause") {
      return NextResponse.json(await setSupportMessagePaused(true));
    }
    if (action === "resume") {
      return NextResponse.json(await setSupportMessagePaused(false));
    }
    if (action === "enable_dry_run") {
      return NextResponse.json(await setSupportMessageDryRun(true));
    }
    if (action === "disable_dry_run") {
      return NextResponse.json(await setSupportMessageDryRun(false));
    }
    if (action === "set_limits") {
      return NextResponse.json(await setSupportMessageRateLimits({
        maxPerHour: body.max_per_hour === undefined ? undefined : Number(body.max_per_hour),
        maxPerDay: body.max_per_day === undefined ? undefined : Number(body.max_per_day),
      }));
    }
    if (action === "preview") {
      return NextResponse.json(await renderSupportMessagePreview(
        String(body.message_type || "") as SupportMessageType,
        body.user_id
      ));
    }
    if (action === "start_backfill") {
      return NextResponse.json(await startSupportMessageBackfill(
        String(body.message_type || "") as SupportMessageType,
        {
          batchSize: body.batch_size === undefined ? undefined : Number(body.batch_size),
          skipPermanentlyFailed: body.skip_permanently_failed !== false,
        }
      ));
    }
    if (action === "pause_backfill" || action === "resume_backfill" || action === "cancel_backfill") {
      return NextResponse.json(await updateSupportMessageBackfill(
        action === "pause_backfill" ? "pause" : action === "resume_backfill" ? "resume" : "cancel",
        body.run_id === undefined ? undefined : Number(body.run_id)
      ));
    }
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("Support message admin action error", { error: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "Failed to update support message settings" }, { status: 500 });
  }
}
