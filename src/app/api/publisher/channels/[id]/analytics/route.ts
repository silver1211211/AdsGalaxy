import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { buildChannelAnalyticsReport, databaseToday, resolveChannelAnalyticsRange } from "@/lib/channelReports";
import { metricNumber } from "@/lib/statFormulas";

export const dynamic = "force-dynamic";

type OwnedChannelRow = RowDataPacket & {
  id: number;
  chat_id: string;
  subscriber_count: number | null;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { id } = await params;
    const [channels] = await pool.query<OwnedChannelRow[]>(
      "SELECT id, chat_id, subscriber_count FROM channels WHERE id = ? AND user_id = ? AND is_deleted = FALSE LIMIT 1",
      [id, user.id]
    );
    const channel = channels[0];
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const today = await databaseToday();
    const range = resolveChannelAnalyticsRange(new URL(request.url), today);
    const report = await buildChannelAnalyticsReport(channel.id, range);

    return NextResponse.json({
      channel_id: channel.id,
      subscriber_count: metricNumber(channel.subscriber_count),
      ...report,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load channel analytics";
    console.error("GET Channel Analytics Error:", message);
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}
