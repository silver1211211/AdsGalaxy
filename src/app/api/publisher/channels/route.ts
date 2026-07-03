import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizePostingTimes, normalizePostsPerDay } from "@/lib/postingTimes";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import {
  inferChannelType,
  getChannelPrivacySchema,
  hashInviteLink,
  normalizePrivateInviteLink,
  normalizePublicChannelUsername,
} from "@/lib/channelPrivacy";
import { resolvePrivateInviteLink } from "@/lib/telegramMtproto";
import { getTrackingAccountUsernames } from "@/lib/privateChannelTrackingOnboarding";
import { encryptPrivateInviteLink } from "@/lib/privateInviteLinkVault";
import {
  inspectPrivateChannelVerificationToken,
  type PrivateChannelTokenInspection,
} from "@/lib/privateChannelVerificationToken";
import { logPrivateChannelDiagnostic } from "@/lib/privateChannelDiagnostics";
import { notifyChannelSubmitted } from "@/lib/publisherNotifications";

type SettingRow = RowDataPacket & { value?: string | number | null };
type ExistingChannelRow = RowDataPacket & { id: number; user_id: number; is_deleted: boolean | number };

async function hasPostingTimesColumn() {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'channels'
      AND COLUMN_NAME = 'posting_times'
    LIMIT 1
  `);

  return rows.length > 0;
}

async function tableExists(tableName: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  return rows.length > 0;
}

async function columnExists(tableName: string, columnName: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function telegram(token: string, method: string, body: Record<string, unknown>) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  } catch (error) {
    console.error(`Telegram ${method} request failed:`, error);
    return { ok: false, description: "Unable to reach Telegram. Please try again." };
  }
}

function privateInviteError(code: string) {
  const messageByCode: Record<string, string> = {
    missing_api_id: "Private channel verification is not configured.",
    missing_api_hash: "Private channel verification is not configured.",
    missing_account_sessions: "Private channel verification is not configured.",
    invalid_invite_link: "Invalid private invite link.",
    invite_hash_empty: "Invalid private invite link.",
    invite_hash_expired: "This private invite link has expired.",
    invite_hash_invalid: "Invalid private invite link.",
    join_request_required: "This invite requires manual approval. Use an invite link that lets AdsGalaxy access the channel.",
    channel_private: "Unable to access this private channel. Add AdsGalaxy Bot as administrator and use a valid invite link.",
    all_accounts_failed: "Unable to access this private channel. Add AdsGalaxy Bot as administrator and use a valid invite link.",
  };

  return messageByCode[code] || "Unable to verify private channel.";
}

function withManualTrackingUsernames(rows: Array<RowDataPacket & Record<string, unknown>>) {
  const manualUsernames = getTrackingAccountUsernames();
  return rows.map((row) => {
    const safeRow = { ...row };
    delete safeRow.private_invite_link_encrypted;
    if (row.channel_type === "private" && row.tracking_account_status === "pending_manual") {
      return { ...safeRow, tracking_manual_usernames: manualUsernames };
    }
    return safeRow;
  });
}

function addTrackingColumns(
  columns: string[],
  params: unknown[],
  channelType: "public" | "private",
  schema: Awaited<ReturnType<typeof getChannelPrivacySchema>>
) {
  if (schema.hasTrackingAccountStatus) {
    columns.push("tracking_account_status = ?");
    params.push(channelType === "private" ? "pending_manual" : "not_required");
  }
  if (schema.hasTrackingAccount) {
    columns.push("tracking_account = NULL");
  }
  if (schema.hasTrackingAccountMemberStatus) {
    columns.push("tracking_account_member_status = NULL");
  }
  if (schema.hasTrackingAccountAssignedAt) {
    columns.push("tracking_account_assigned_at = NULL");
  }
  if (schema.hasTrackingAccountLastSuccessAt) {
    columns.push("tracking_account_last_success_at = NULL");
  }
  if (schema.hasTrackingAccountLastFailureAt) {
    columns.push("tracking_account_last_failure_at = NULL");
  }
  if (schema.hasTrackingAccountFailureReason) {
    columns.push("tracking_account_failure_reason = NULL");
  }
}

function addTrackingInsertColumns(
  columns: string[],
  params: unknown[],
  channelType: "public" | "private",
  schema: Awaited<ReturnType<typeof getChannelPrivacySchema>>
) {
  if (schema.hasTrackingAccountStatus) {
    columns.push("tracking_account_status");
    params.push(channelType === "private" ? "pending_manual" : "not_required");
  }
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const [hasCampaignClicks, hasAdSettlements, hasAdSettlementsViews, hasCampaignPosts, hasCampaignPostViews,
      hasClickReward, hasClickChannelId, hasViewReward, hasViewChannelId, hasUpdatedAt] = await Promise.all([
      tableExists("campaign_clicks"),
      tableExists("ad_settlements"),
      tableExists("ad_settlements_views"),
      tableExists("campaign_posts"),
      columnExists("campaign_posts", "views"),
      columnExists("ad_settlements", "publisher_reward"),
      columnExists("ad_settlements", "channel_id"),
      columnExists("ad_settlements_views", "publisher_reward"),
      columnExists("ad_settlements_views", "channel_id"),
      columnExists("channels", "updated_at"),
    ]);
    const totalImpressionsExpr = hasCampaignPosts && hasCampaignPostViews
      ? "COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.channel_id = c.id), 0)"
      : "0";
    const totalClicksExpr = hasCampaignClicks && hasCampaignPosts
      ? `COALESCE((
          SELECT COUNT(*)
          FROM campaign_clicks cc
          JOIN campaign_posts cp ON cp.id = cc.post_id
          WHERE cp.channel_id = c.id
        ), 0)`
      : "0";
    const clickRevenueExpr = hasAdSettlements && hasClickReward && hasClickChannelId
      ? "COALESCE((SELECT SUM(s.publisher_reward) FROM ad_settlements s WHERE s.channel_id = c.id), 0)"
      : "0";
    const viewRevenueExpr = hasAdSettlementsViews && hasViewReward && (hasViewChannelId || hasCampaignPosts)
      ? hasViewChannelId
        ? "COALESCE((SELECT SUM(sv.publisher_reward) FROM ad_settlements_views sv WHERE sv.channel_id = c.id), 0)"
        : "COALESCE((SELECT SUM(sv.publisher_reward) FROM ad_settlements_views sv JOIN campaign_posts cpv ON cpv.id = sv.post_id WHERE cpv.channel_id = c.id), 0)"
      : "0";

    const [rows] = await pool.query<Array<RowDataPacket & Record<string, unknown>>>(
      `SELECT
        c.id,
        c.chat_id,
        c.username,
        c.channel_type,
        c.view_tracking_status,
        c.tracking_account_status,
        c.tracking_account,
        c.title,
        c.subscriber_count,
        c.posts_per_day,
        c.posting_times,
        c.audience_continents,
        c.categories,
        c.status,
        c.paused_reason,
        c.suggested_fix,
        c.failure_reason,
        c.marketplace_visible,
        c.created_at,
        ${hasUpdatedAt ? "c.updated_at" : "c.created_at"} as updated_at,
        ${totalImpressionsExpr} as total_impressions,
        ${totalClicksExpr} as total_clicks,
        (${clickRevenueExpr} + ${viewRevenueExpr}) as total_revenue
       FROM channels c
       WHERE c.user_id = ? AND c.is_deleted = FALSE
       ORDER BY c.created_at DESC`,
      [user.id]
    );
    return NextResponse.json(withManualTrackingUsernames(rows));
  } catch (error: unknown) {
    console.error("API Error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch channels";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const body = await request.json();
    const {
      chat_id,
      username,
      title,
      posts_per_day,
      audience_continents,
      categories,
      posting_times,
      channel_type,
      invite_link,
      verification_token,
      subscriber_count,
    } = body;
    const normalizedTitle = String(title ?? "").trim();
    const normalizedChannelType = inferChannelType({ channelType: channel_type, inviteLink: invite_link, username });
    if (!normalizedChannelType) {
      return NextResponse.json({ error: "Channel type could not be determined. Use a public username or a private invite link." }, { status: 400 });
    }

    const normalizedPrivateInviteLink = normalizedChannelType === "private" ? normalizePrivateInviteLink(invite_link) : null;
    const normalizedInviteHash = normalizedChannelType === "private" ? hashInviteLink(normalizedPrivateInviteLink) : null;
    let normalizedUsername = normalizedChannelType === "public" ? normalizePublicChannelUsername(username) : null;
    let resolvedChatId = String(chat_id || "").trim();
    let privateSubscriberCount = Number.isFinite(Number(subscriber_count)) ? Number(subscriber_count) : null;
    let tokenInspection: PrivateChannelTokenInspection | null = null;

    if (normalizedChannelType === "private" && !normalizedPrivateInviteLink) {
      logPrivateChannelDiagnostic("channel_submit_rejected", {
        token_received: Boolean(verification_token),
        token_valid: false,
        token_error_code: "normalized_invite_invalid",
        token_has_chat_id: false,
        digest_match: false,
        submit_channel_type: "private",
        normalized_input_type: "invalid_private_invite",
        final_reject_reason: "invalid_private_invite",
      });
      return NextResponse.json({ error: "Invalid private invite link" }, { status: 400 });
    }

    if (normalizedChannelType === "public" && !normalizedUsername) {
      return NextResponse.json({ error: "Public channel username is required" }, { status: 400 });
    }

    if (normalizedTitle.length < 3) {
      return NextResponse.json({ error: "Channel name must be at least 3 characters." }, { status: 400 });
    }

    if (normalizedTitle.length > 50) {
      return NextResponse.json({ error: "Channel name must be at most 50 characters." }, { status: 400 });
    }

    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ error: "Bot token not configured" }, { status: 500 });
    }

    if (normalizedChannelType === "private") {
      tokenInspection = inspectPrivateChannelVerificationToken(
        verification_token,
        normalizedPrivateInviteLink,
        resolvedChatId
      );
      logPrivateChannelDiagnostic("channel_submit_token_checked", {
        token_received: tokenInspection.tokenReceived,
        token_valid: tokenInspection.valid,
        token_error_code: tokenInspection.errorCode,
        token_has_chat_id: tokenInspection.tokenHasChatId,
        digest_match: tokenInspection.digestMatch,
        submit_channel_type: "private",
        normalized_input_type: "private_invite",
        final_reject_reason: tokenInspection.valid ? "none" : "token_fallback_required",
      });

      if (tokenInspection.valid && tokenInspection.chatId) {
        resolvedChatId = tokenInspection.chatId;
      } else {
        const resolved = await resolvePrivateInviteLink(normalizedPrivateInviteLink!);
        if (!resolved.ok) {
          logPrivateChannelDiagnostic("channel_submit_rejected", {
            token_received: tokenInspection.tokenReceived,
            token_valid: tokenInspection.valid,
            token_error_code: tokenInspection.errorCode,
            token_has_chat_id: tokenInspection.tokenHasChatId,
            digest_match: tokenInspection.digestMatch,
            submit_channel_type: "private",
            normalized_input_type: "private_invite",
            final_reject_reason: `invite_resolution_${resolved.code}`,
          });
          return NextResponse.json({ error: privateInviteError(resolved.code) }, { status: 400 });
        }

        resolvedChatId = resolved.chatId;
        privateSubscriberCount = resolved.participantsCount;
      }
    }

    const normalizedPostsPerDay = normalizePostsPerDay(posts_per_day);
    const normalizedPostingTimes = normalizePostingTimes(posting_times, normalizedPostsPerDay);
    const canStorePostingTimes = await hasPostingTimesColumn();
    const privacySchema = await getChannelPrivacySchema();
    const encryptedPrivateInviteLink = normalizedChannelType === "private"
      ? encryptPrivateInviteLink(normalizedPrivateInviteLink)
      : null;

    if (normalizedChannelType === "private" && (!privacySchema.hasPrivateInviteLinkEncrypted || !encryptedPrivateInviteLink)) {
      logPrivateChannelDiagnostic("channel_submit_rejected", {
        token_received: tokenInspection?.tokenReceived ?? Boolean(verification_token),
        token_valid: tokenInspection?.valid ?? false,
        token_error_code: tokenInspection?.errorCode ?? "not_checked",
        token_has_chat_id: tokenInspection?.tokenHasChatId ?? false,
        digest_match: tokenInspection?.digestMatch ?? false,
        submit_channel_type: "private",
        normalized_input_type: "private_invite",
        final_reject_reason: "private_invite_storage_unavailable",
      });
      return NextResponse.json(
        {
          error: "Private channel storage is not configured. Please contact support.",
          code: "PRIVATE_INVITE_STORAGE_UNAVAILABLE",
        },
        { status: 503 }
      );
    }

    if (!canStorePostingTimes) {
      console.warn("channels.posting_times column is missing; channel posting times will use runtime defaults");
    }

    // 1. Get minimum subscribers requirement from settings
    const [settings] = await pool.query<SettingRow[]>("SELECT value FROM settings WHERE `key` = 'min_subscribers'");
    const minSubscribers = parseInt(String(settings[0]?.value || "0"));

    // 2. Verify Telegram access and fetch current member count.
    const chatData = await telegram(botToken, "getChat", { chat_id: resolvedChatId });
    if (!chatData.ok) {
      return NextResponse.json({ error: chatData.description || "Failed to verify channel access. Make sure the bot is an admin." }, { status: 400 });
    }

    if (chatData.result?.type !== "channel") {
      return NextResponse.json({ error: "Only channels are allowed." }, { status: 400 });
    }

    const telegramUsername = String(chatData.result?.username || "").replace(/^@/, "").trim() || null;
    if (normalizedChannelType === "public") {
      normalizedUsername = telegramUsername || normalizedUsername;
      if (!normalizedUsername) {
        return NextResponse.json({ error: "Public channel username is required" }, { status: 400 });
      }
      resolvedChatId = String(chatData.result.id);
    } else {
      normalizedUsername = telegramUsername;
      resolvedChatId = String(chatData.result.id || resolvedChatId);
    }

    const tgData = await telegram(botToken, "getChatMemberCount", { chat_id: resolvedChatId });

    if (!tgData.ok && privateSubscriberCount === null) {
      return NextResponse.json({ error: "Failed to verify channel member count. Make sure the bot is an admin." }, { status: 400 });
    }

    const subscriberCount = tgData.ok ? Number(tgData.result || 0) : Number(privateSubscriberCount || 0);

    if (subscriberCount < minSubscribers) {
      return NextResponse.json({ 
        error: `Channel must have at least ${minSubscribers} subscribers. Current: ${subscriberCount}` 
      }, { status: 400 });
    }

    // 3. Check if channel already exists
    const [existing] = await pool.query<ExistingChannelRow[]>(
      "SELECT id, user_id, is_deleted FROM channels WHERE chat_id = ?",
      [resolvedChatId]
    );

    if (existing.length > 0) {
      const channel = existing[0];
      
      if (channel.user_id !== user.id) {
        return NextResponse.json({ error: "This channel is already registered by another user" }, { status: 400 });
      }

      // If it exists and NOT deleted, don't allow adding again
      if (!channel.is_deleted) {
        return NextResponse.json({ error: "This channel is already active in your dashboard." }, { status: 400 });
      }

      // If it belongs to same user and IS deleted, reactivate/update it
      const updateColumns = [
        "username = ?",
        "title = ?",
        "subscriber_count = ?",
        "posts_per_day = ?",
        "audience_continents = ?",
        "categories = ?",
        "is_deleted = FALSE",
        "status = 'pending'",
        "paused_reason = NULL",
        "suggested_fix = NULL",
        "failure_reason = NULL",
        "health_status = NULL",
        "auto_paused_at = NULL"
      ];
      const updateParams = [
        normalizedUsername,
        normalizedTitle,
        subscriberCount,
        normalizedPostsPerDay,
        JSON.stringify(audience_continents),
        JSON.stringify(categories || [])
      ];

      if (canStorePostingTimes) {
        updateColumns.splice(6, 0, "posting_times = ?");
        updateParams.push(JSON.stringify(normalizedPostingTimes));
      }

      if (privacySchema.hasChannelType) {
        updateColumns.push("channel_type = ?");
        updateParams.push(normalizedChannelType);
      }

      if (privacySchema.hasInviteLinkHash) {
        updateColumns.push("invite_link_hash = ?");
        updateParams.push(normalizedInviteHash);
      }

      if (privacySchema.hasPrivateInviteLinkEncrypted) {
        updateColumns.push("private_invite_link_encrypted = ?");
        updateParams.push(encryptedPrivateInviteLink);
      }

      if (privacySchema.hasViewTrackingStatus) {
        updateColumns.push("view_tracking_status = ?");
        updateParams.push(normalizedChannelType === "private" ? "limited" : "available");
      }

      addTrackingColumns(updateColumns, updateParams, normalizedChannelType, privacySchema);

      updateParams.push(channel.id);

      await pool.query(
        `UPDATE channels SET ${updateColumns.join(", ")} WHERE id = ?`,
        updateParams
      );

      if (normalizedChannelType === "private") {
        logPrivateChannelDiagnostic("channel_submit_persisted", {
          token_received: tokenInspection?.tokenReceived ?? Boolean(verification_token),
          token_valid: tokenInspection?.valid ?? false,
          token_error_code: tokenInspection?.errorCode ?? "not_checked",
          token_has_chat_id: tokenInspection?.tokenHasChatId ?? false,
          digest_match: tokenInspection?.digestMatch ?? false,
          submit_channel_type: "private",
          normalized_input_type: "private_invite",
          final_reject_reason: "none",
        });
      }

      await notifyChannelSubmitted(user.telegram_id, channel.id, normalizedTitle);

      return NextResponse.json({
        success: true,
        id: channel.id,
        message: "Channel reactivated and updated",
      });
    }

    // 4. Insert new channel
    const insertColumns = [
      "user_id",
      "chat_id",
      "username",
      "title",
      "subscriber_count",
      "posts_per_day",
      "audience_continents",
      "categories",
      "status"
    ];
    const insertParams = [
      user.id,
      resolvedChatId,
      normalizedUsername,
      normalizedTitle,
      subscriberCount,
      normalizedPostsPerDay,
      JSON.stringify(audience_continents),
      JSON.stringify(categories || []),
      "pending"
    ];

    if (canStorePostingTimes) {
      insertColumns.splice(8, 0, "posting_times");
      insertParams.splice(8, 0, JSON.stringify(normalizedPostingTimes));
    }

    if (privacySchema.hasChannelType) {
      insertColumns.push("channel_type");
      insertParams.push(normalizedChannelType);
    }

    if (privacySchema.hasInviteLinkHash) {
      insertColumns.push("invite_link_hash");
      insertParams.push(normalizedInviteHash);
    }

    if (privacySchema.hasPrivateInviteLinkEncrypted) {
      insertColumns.push("private_invite_link_encrypted");
      insertParams.push(encryptedPrivateInviteLink);
    }

    if (privacySchema.hasViewTrackingStatus) {
      insertColumns.push("view_tracking_status");
      insertParams.push(normalizedChannelType === "private" ? "limited" : "available");
    }

    addTrackingInsertColumns(insertColumns, insertParams, normalizedChannelType, privacySchema);

    const placeholders = insertColumns.map(() => "?").join(", ");
    const [result] = await pool.query(
      `INSERT INTO channels (${insertColumns.join(", ")}) VALUES (${placeholders})`,
      insertParams
    ) as [ResultSetHeader, unknown];

    if (normalizedChannelType === "private") {
      logPrivateChannelDiagnostic("channel_submit_persisted", {
        token_received: tokenInspection?.tokenReceived ?? Boolean(verification_token),
        token_valid: tokenInspection?.valid ?? false,
        token_error_code: tokenInspection?.errorCode ?? "not_checked",
        token_has_chat_id: tokenInspection?.tokenHasChatId ?? false,
        digest_match: tokenInspection?.digestMatch ?? false,
        submit_channel_type: "private",
        normalized_input_type: "private_invite",
        final_reject_reason: "none",
      });
    }

    await notifyChannelSubmitted(user.telegram_id, result.insertId, normalizedTitle);

    return NextResponse.json({ success: true, id: result.insertId });
  } catch (error: unknown) {
    console.error("API Error:", error);
    const message = error instanceof Error ? error.message : "Failed to add channel";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}
