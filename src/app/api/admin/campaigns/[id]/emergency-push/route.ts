import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { ALL_CATEGORIES } from "@/lib/campaignCategories";
import { deleteCampaignPosts, type CampaignPostDeletionSummary } from "@/lib/campaignPostDeletion";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const MAX_EMERGENCY_CHANNELS = 1000;
const ACTIVE_POST_STATUSES = ["active", "posted", "sent"];
const VALID_MODES = new Set(["fill_empty_slots", "replace_everything"]);

type EmergencyMode = "fill_empty_slots" | "replace_everything";

type CampaignRow = RowDataPacket & {
  id: number;
  user_id: number;
  name: string;
  status: string;
  budget: string | number;
  category: string;
  continents: string;
  parse_mode: string;
  type: string;
  link: string;
  button_text: string;
  message_text: string;
  image_url: string | null;
};

type ChannelRow = RowDataPacket & {
  id: number;
  user_id: number;
  chat_id: string;
  username: string;
  categories: string | string[] | null;
  audience_continents: string | string[] | null;
};

type EmergencySchema = {
  hasPostDeletedAtColumn: boolean;
  hasPostSlotColumns: boolean;
  hasCampaignDeliveryEvents: boolean;
};

type ColumnRow = RowDataPacket & {
  TABLE_NAME: string;
  COLUMN_NAME: string | null;
};

type IdRow = RowDataPacket & {
  id: number;
};

type TelegramSendResponse = {
  ok?: boolean;
  description?: string;
  result?: {
    message_id?: number;
  };
};

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);

  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeTarget(value: string) {
  return value.toLowerCase().replace(/[_\s-]+/g, "");
}

function campaignMatchesChannel(campaign: CampaignRow, channel: ChannelRow) {
  const channelCategories = parseJsonArray(channel.categories);
  const categoryMatches = campaign.category === ALL_CATEGORIES || channelCategories.includes(campaign.category);

  if (!categoryMatches) return false;

  const campaignContinents = parseJsonArray(campaign.continents).map(normalizeTarget);
  const channelContinents = parseJsonArray(channel.audience_continents).map(normalizeTarget);

  return campaignContinents.includes("global")
    || channelContinents.includes("global")
    || campaignContinents.some((continent) => channelContinents.includes(continent));
}

async function getEmergencySchema(): Promise<EmergencySchema> {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'campaign_posts' AND COLUMN_NAME IN ('posting_slot_date', 'posting_slot_time', 'deleted_at'))
        OR (TABLE_NAME = 'campaign_delivery_events')
      )
  `);

  const columns = new Set(rows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const tables = new Set(rows.map((row) => row.TABLE_NAME));

  return {
    hasPostDeletedAtColumn: columns.has("campaign_posts.deleted_at"),
    hasPostSlotColumns: columns.has("campaign_posts.posting_slot_date") && columns.has("campaign_posts.posting_slot_time"),
    hasCampaignDeliveryEvents: tables.has("campaign_delivery_events"),
  };
}

function getActiveUndeletedCondition(schema: EmergencySchema, alias = "cp") {
  return schema.hasPostDeletedAtColumn
    ? `${alias}.status IN (?) AND ${alias}.deleted_at IS NULL`
    : `${alias}.status IN (?)`;
}

async function recordDeliveryEvent(
  enabled: boolean,
  campaignId: number,
  channelId: number,
  postId: number | null,
  eventType: string,
  metadata: Record<string, unknown>
) {
  if (!enabled) return;

  try {
    await pool.query(`
      INSERT INTO campaign_delivery_events (campaign_id, channel_id, campaign_post_id, event_type, score, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [campaignId, channelId, postId, eventType, null, JSON.stringify(metadata)]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown delivery event error";
    console.warn("Failed to record emergency push delivery event", {
      campaign_id: campaignId,
      channel_id: channelId,
      event_type: eventType,
      error: message,
    });
  }
}

async function hasActiveUndeletedPost(channelId: number, schema: EmergencySchema) {
  const [rows] = await pool.query<IdRow[]>(`
    SELECT id
    FROM campaign_posts cp
    WHERE cp.channel_id = ?
      AND ${getActiveUndeletedCondition(schema)}
    LIMIT 1
  `, [channelId, ACTIVE_POST_STATUSES]);

  return rows.length > 0;
}

async function getEligibleChannels(campaign: CampaignRow, schema: EmergencySchema, mode: EmergencyMode) {
  const activeCondition = getActiveUndeletedCondition(schema);
  const emptySlotCondition = mode === "fill_empty_slots"
    ? `AND NOT EXISTS (
        SELECT 1 FROM campaign_posts cp
        WHERE cp.channel_id = c.id
          AND ${activeCondition}
      )`
    : "";
  const duplicateCondition = mode === "fill_empty_slots"
    ? `AND NOT EXISTS (
        SELECT 1 FROM campaign_posts cp
        WHERE cp.campaign_id = ?
          AND cp.channel_id = c.id
          AND cp.created_at > NOW() - INTERVAL 24 HOUR
      )`
    : "";

  const [channels] = await pool.query<ChannelRow[]>(`
    SELECT c.*
    FROM channels c
    WHERE c.status = 'active'
      AND c.is_deleted = FALSE
      AND c.chat_id IS NOT NULL
      AND c.chat_id != ''
      ${emptySlotCondition}
      ${duplicateCondition}
    ORDER BY c.id ASC
    LIMIT ?
  `, mode === "fill_empty_slots"
    ? [ACTIVE_POST_STATUSES, campaign.id, MAX_EMERGENCY_CHANNELS + 1]
    : [MAX_EMERGENCY_CHANNELS + 1]
  );

  const filtered = channels.filter((channel) => {
    if (campaign.user_id === channel.user_id) return false;
    return campaignMatchesChannel(campaign, channel);
  });

  return {
    eligibleChannels: filtered.slice(0, MAX_EMERGENCY_CHANNELS),
    skippedByLimit: Math.max(0, filtered.length - MAX_EMERGENCY_CHANNELS),
  };
}

function getEmergencySlot() {
  const now = new Date();
  const postingSlotDate = now.toISOString().slice(0, 10);
  const postingSlotTime = now.toTimeString().slice(0, 8);

  return { postingSlotDate, postingSlotTime };
}

async function postCampaignToChannel(options: {
  campaign: CampaignRow;
  channel: ChannelRow;
  schema: EmergencySchema;
  requestOrigin: string;
}) {
  const { campaign, channel, schema, requestOrigin } = options;
  const slot = getEmergencySlot();
  const insertColumns = ["campaign_id", "channel_id", "channel_username", "status"];
  const insertParams: Array<number | string | null> = [campaign.id, channel.id, channel.username, "active"];

  if (schema.hasPostSlotColumns) {
    insertColumns.push("posting_slot_date", "posting_slot_time");
    insertParams.push(slot.postingSlotDate, slot.postingSlotTime);
  }

  const insertPlaceholders = insertColumns.map(() => "?").join(", ");
  const [insertPost] = await pool.query<ResultSetHeader>(
    `INSERT INTO campaign_posts (${insertColumns.join(", ")}) VALUES (${insertPlaceholders})`,
    insertParams
  );

  const postId = insertPost.insertId;
  const parseModeMap: Record<string, string | undefined> = { html: "HTML", markdown: "MarkdownV2", none: undefined };
  const parseMode = parseModeMap[campaign.parse_mode] || "HTML";
  const domain = process.env.DOMAIN;
  const host = domain ? `https://${domain}` : (process.env.NEXT_PUBLIC_APP_URL || requestOrigin);
  const buttonUrl = campaign.type === "clicks"
    ? `${host}/api/clicks/${campaign.id}/${postId}`
    : campaign.link;

  const replyMarkup = {
    inline_keyboard: [
      [{ text: campaign.button_text, url: buttonUrl }],
      [{ text: "Advertise with Ads galaxy", url: "https://t.me/Ads_Galaxy_bot?start=advertise" }],
    ],
  };

  const result = await sendTelegramMessage(channel.chat_id, campaign.message_text, {
    photo: campaign.image_url,
    parse_mode: parseMode,
    reply_markup: replyMarkup,
  }) as TelegramSendResponse | undefined;

  if (result?.ok && result.result?.message_id) {
    await pool.query("UPDATE campaign_posts SET message_id = ? WHERE id = ?", [result.result.message_id, postId]);
    await recordDeliveryEvent(schema.hasCampaignDeliveryEvents, campaign.id, channel.id, postId, "emergency_posted", {
      mode: "emergency_push",
    });
    return { ok: true, postId, messageId: result.result.message_id };
  }

  await pool.query("DELETE FROM campaign_posts WHERE id = ?", [postId]);
  await recordDeliveryEvent(schema.hasCampaignDeliveryEvents, campaign.id, channel.id, postId, "emergency_send_failed", {
    reason: result?.description || "Telegram send failed",
  });

  return { ok: false, postId, reason: result?.description || "Telegram send failed" };
}

async function deleteAllActivePostsSafely(): Promise<CampaignPostDeletionSummary> {
  try {
    return await deleteCampaignPosts({});
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Emergency global post deletion failed";
    console.warn("Emergency global post deletion failed", { error: message });
    return {
      total: 0,
      deleted: 0,
      failed: 1,
      failedIds: [],
      details: [{ id: 0, status: "error", reason: message }],
    };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const mode = body.mode as EmergencyMode;

  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: "Invalid emergency push mode" }, { status: 400 });
  }

  if (mode === "replace_everything" && body.confirmation !== "CONFIRM") {
    return NextResponse.json({ error: "Type CONFIRM to run Replace Everything" }, { status: 400 });
  }

  try {
    const [campaignRows] = await pool.query<CampaignRow[]>("SELECT * FROM campaigns WHERE id = ?", [id]);

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaignRows[0] as CampaignRow;

    if (campaign.status !== "active") {
      return NextResponse.json({ error: "Only active campaigns can be emergency pushed" }, { status: 400 });
    }

    if (parseFloat(String(campaign.budget || "0")) <= 0) {
      return NextResponse.json({ error: "Campaign budget must be greater than 0" }, { status: 400 });
    }

    if (!campaign.message_text || !campaign.button_text || !campaign.link) {
      return NextResponse.json({ error: "Campaign must have message text, button text, and link before emergency push" }, { status: 400 });
    }

    const schema = await getEmergencySchema();
    const deleteSummary = mode === "replace_everything"
      ? await deleteAllActivePostsSafely()
      : null;
    const { eligibleChannels, skippedByLimit } = await getEligibleChannels(campaign, schema, mode);
    const failedChannels: Array<{ channelId: number; reason: string }> = [];
    let attempted = 0;
    let posted = 0;
    let skipped = skippedByLimit;

    for (const channel of eligibleChannels) {
      if (await hasActiveUndeletedPost(channel.id, schema)) {
        skipped++;
        failedChannels.push({ channelId: channel.id, reason: "active_undeleted_post_exists" });
        continue;
      }

      attempted++;

      try {
        const result = await postCampaignToChannel({
          campaign,
          channel,
          schema,
          requestOrigin: new URL(request.url).origin,
        });

        if (result.ok) {
          posted++;
        } else {
          failedChannels.push({ channelId: channel.id, reason: result.reason || "Telegram send failed" });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Emergency post failed";
        failedChannels.push({ channelId: channel.id, reason: message });
      }
    }

    const failed = failedChannels.filter((channel) => channel.reason !== "active_undeleted_post_exists").length;

    await recordAdminActionAudit({
      action: "emergency_push",
      entityType: "campaign",
      entityId: campaign.id,
      reason: mode,
      metadata: {
        mode,
        eligible_channels: eligibleChannels.length,
        attempted,
        success: posted,
        failed,
        skipped,
        delete_summary: deleteSummary,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      mode,
      campaignId: campaign.id,
      eligibleChannels: eligibleChannels.length,
      attempted,
      posted,
      failed,
      skipped,
      deleteSummary,
      failedChannels,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Admin Emergency Push Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
