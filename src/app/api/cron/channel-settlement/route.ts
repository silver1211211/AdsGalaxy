import { NextRequest, NextResponse } from "next/server";
import { settleChannelCampaigns } from "@/lib/channelSettlement";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { settlePendingChannelPublisherCredits } from "@/lib/channelFastBilling";
import { isUnifiedSettlementActive } from "@/lib/channelUnifiedSettlement";
import pool from "@/lib/db";
import { isCpcPrioritySchedulerEnabled, runCpcPriorityRewardSchedule } from "@/lib/channelCpcPriorityScheduler";
import {
  assertCpmWindowRuntimeReady,
  isCpmWindowSchedulerEnabled,
  runCpmWindowSchedule,
} from "@/lib/channelCpmWindowScheduler";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("channel-settlement", 1800);
  if (!lock) return NextResponse.json({ success: false, message: "Channel settlement is already running" }, { status: 409 });

  try {
    // Fail before ordinary channel settlement if CPM window mode lacks its
    // required schema or the unified writer that keeps pending money locked.
    const cpmWindowsEnabled = isCpmWindowSchedulerEnabled();
    if (cpmWindowsEnabled) await assertCpmWindowRuntimeReady(pool);
    const pending = await settlePendingChannelPublisherCredits();
    const result = await settleChannelCampaigns();
    console.info("Channel settlement batch complete", result);
    // Dormant until the separate scheduler flag and all financial flags are enabled.
    const priority = isCpcPrioritySchedulerEnabled()
      ? await runCpcPriorityRewardSchedule(pool, { asOfEpoch: Math.floor(Date.now() / 1000) })
      : null;
    if (priority) console.info("CPC priority schedule batch complete", priority);
    const cpmWindows = cpmWindowsEnabled ? await runCpmWindowSchedule(pool) : null;
    if (cpmWindows) console.info("CPM window schedule batch complete", cpmWindows);
    const canonicalFailures = isUnifiedSettlementActive() && (result.failedPosts > 0 || pending.failed > 0 || pending.missingPolicy > 0);
    const priorityFailures = priority?.outcomes.some((item) => item.status === "failed" || item.status === "blocked") ?? false;
    const cpmFailures = cpmWindows !== null &&
      (cpmWindows.failures > 0 || cpmWindows.blocked > 0 || cpmWindows.lateReview > 0 ||
        !cpmWindows.cursorPersisted || cpmWindows.status !== "completed");
    return NextResponse.json(
      { success: !canonicalFailures && !priorityFailures && !cpmFailures, fastDebitPublisherSettlement: pending, ...result,
        ...(priority ? { cpcPrioritySchedule: priority } : {}),
        ...(cpmWindows ? { cpmWindowSchedule: cpmWindows } : {}) },
      { status: canonicalFailures || priorityFailures || cpmFailures ? 503 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "channel_settlement_failed";
    console.error("Channel settlement cron failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: message.startsWith("cpm_window_") ? 503 : 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
