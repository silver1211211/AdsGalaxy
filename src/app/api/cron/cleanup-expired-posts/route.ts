import { NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { cleanupExpiredChannelPosts } from "@/lib/expiredChannelCleanup";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("cleanup-expired-posts", 1800);
  if (!lock) return NextResponse.json({ success: false, message: "Expired post cleanup is already running" }, { status: 409 });
  try {
    const result = await cleanupExpiredChannelPosts();
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "cleanup_expired_posts_failed";
    console.error("Expired post cleanup failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
