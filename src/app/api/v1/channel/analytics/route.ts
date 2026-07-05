/* eslint-disable @typescript-eslint/no-explicit-any -- developer API context is a legacy untyped payload */
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { buildChannelAnalyticsReport, databaseToday, resolveChannelAnalyticsRange } from "@/lib/channelReports";
import { logDeveloperApiRequest, validateDeveloperApiRequest } from "@/lib/developerPlatform";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reporting", "/api/v1/channel/analytics");
    const body = await request.json().catch(() => ({}));
    const channelId = clean(body.channel_id);
    if (!channelId) {
      throw Object.assign(new Error("channel_id is required"), { statusCode: 400 });
    }

    const [channels] = await pool.query<Array<RowDataPacket & { id: number; subscriber_count: number | string | null }>>(
      `SELECT id, subscriber_count
       FROM channels
       WHERE user_id = ? AND is_deleted = FALSE AND (CAST(id AS CHAR) = ? OR chat_id = ?)
       LIMIT 1`,
      [context.userId, channelId, channelId]
    );
    const channel = channels[0];
    if (!channel) {
      throw Object.assign(new Error("Channel not found for this API key"), { statusCode: 404 });
    }

    const today = await databaseToday();
    const url = new URL(request.url);
    if (body.range && !url.searchParams.has("range")) url.searchParams.set("range", clean(body.range));
    if (body.start && !url.searchParams.has("start")) url.searchParams.set("start", clean(body.start));
    if (body.end && !url.searchParams.has("end")) url.searchParams.set("end", clean(body.end));
    if (body.date && !url.searchParams.has("date")) url.searchParams.set("date", clean(body.date));

    const range = resolveChannelAnalyticsRange(url, today);
    const report = await buildChannelAnalyticsReport(channel.id, range);
    const payload = {
      channel_id: channel.id,
      requested_channel_id: channelId,
      campaign_id: clean(body.campaign_id) || null,
      sandbox: context.mode !== "production",
      ...report,
    };

    await logDeveloperApiRequest(context, request, 200, true, { channel_id: channel.id, range: payload.range, data_available: payload.data_available });
    return NextResponse.json({ success: true, api_version: "v1", analytics: payload });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: error.message || "Channel analytics failed" }, { status });
  }
}
