import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import {
  normalizePrivateInviteLink,
  normalizePublicChannelUsername,
} from "@/lib/telegramChannelInput";
import { resolvePrivateInviteLink } from "@/lib/telegramMtproto";
import { createPrivateChannelVerificationToken } from "@/lib/privateChannelVerificationToken";
import { logPrivateChannelDiagnostic } from "@/lib/privateChannelDiagnostics";

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

type PermissionSnapshot = {
  is_admin?: boolean;
  can_post_messages?: boolean;
  can_delete_messages?: boolean;
  can_invite_users?: boolean;
  can_access?: boolean;
};

function permissionResponse(message: string, permissions: PermissionSnapshot = {}) {
  return NextResponse.json({
    error: "PERMISSION_REQUIRED",
    message,
    permissions,
  }, { status: 400 });
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
    verification_timeout: "Private channel verification timed out. We will retry automatically.",
    network_error: "Telegram is temporarily unreachable. We will retry automatically.",
  };

  return messageByCode[code] || "Unable to verify private channel.";
}

type ChatInfoInput = {
  username: string | null;
  inviteLink: string | null;
};

async function verifyChatInfo(request: Request, input: ChatInfoInput) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    await getAuthenticatedUser(initData);

    const { username, inviteLink } = input;
    const hasInviteInput = Boolean(String(inviteLink || "").trim());
    const channelType = hasInviteInput ? "private" : "public";
    const normalizedInviteLink = hasInviteInput ? normalizePrivateInviteLink(inviteLink) : null;
    const normalizedUsername = channelType === "public" ? normalizePublicChannelUsername(username) : null;

    if (!username && !inviteLink) {
      return NextResponse.json({ error: "Username or invite link is required" }, { status: 400 });
    }

    if (hasInviteInput && !normalizedInviteLink) {
      logPrivateChannelDiagnostic("chat_info_rejected", {
        token_received: false,
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

    if (channelType === "public" && !normalizedUsername) {
      return NextResponse.json({ error: "Invalid public channel username" }, { status: 400 });
    }

    const token = process.env.BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "Bot token not configured" }, { status: 500 });
    }

    // Resolve chat_id: @username for public, numeric -100... id for private.
    let chatId: string;
    let privateInviteMeta: { title: string; participantsCount: number | null } | null = null;
    if (normalizedInviteLink) {
      const resolved = await resolvePrivateInviteLink(normalizedInviteLink);
      if (!resolved.ok) {
        logPrivateChannelDiagnostic("chat_info_rejected", {
          token_received: false,
          token_valid: false,
          token_error_code: "not_created",
          token_has_chat_id: false,
          digest_match: false,
          submit_channel_type: "private",
          normalized_input_type: "private_invite",
          final_reject_reason: `invite_resolution_${resolved.code}`,
        });
        return NextResponse.json({ error: privateInviteError(resolved.code) }, { status: 400 });
      }
      chatId = resolved.chatId;
      privateInviteMeta = {
        title: resolved.title,
        participantsCount: resolved.participantsCount,
      };
    } else {
      chatId = `@${normalizedUsername}`;
    }

    const data = await telegram(token, "getChat", { chat_id: chatId });

    if (!data.ok) {
      if (channelType === "private") {
        return permissionResponse(
          "AdsGalaxy Bot cannot access this private channel yet. Add it as an administrator and try again.",
          { can_access: false }
        );
      }

      return NextResponse.json({
        error: data.description || "Invalid public username",
      }, { status: 404 });
    }

    const chat = data.result;

    // Check permissions
    const meData = await telegram(token, "getMe", {});
    if (!meData.ok) {
      return NextResponse.json({ error: "Unable to identify AdsGalaxy Bot" }, { status: 500 });
    }

    const memberData = await telegram(token, "getChatMember", { chat_id: chat.id, user_id: meData.result.id });

    if (!memberData.ok) {
      return permissionResponse("Could not verify bot permissions. Is the bot added to the channel?", { can_access: true });
    }

    const member = memberData.result;
    const isCreator = member.status === "creator";
    const isAdmin = member.status === "administrator" || isCreator;
    const permissions: PermissionSnapshot = {
      is_admin: isAdmin,
      can_post_messages: isCreator || member.can_post_messages === true,
      can_delete_messages: isCreator || member.can_delete_messages === true,
      can_invite_users: isCreator || member.can_invite_users === true,
      can_access: true,
    };
    
    if (!isAdmin) {
      return permissionResponse("Bot is not an administrator. Please add AdsGalaxy Bot as an admin first.", permissions);
    }

    if (!permissions.can_post_messages) {
      return permissionResponse("Missing post message permission. Enable Post Messages for AdsGalaxy Bot.", permissions);
    }

    if (!permissions.can_delete_messages) {
      return permissionResponse("Missing delete message permission. Enable Delete Messages for AdsGalaxy Bot.", permissions);
    }

    if (channelType === "private" && !permissions.can_invite_users) {
      return permissionResponse("Missing add members permission. Enable Add Members for AdsGalaxy Bot.", permissions);
    }

    // Check if it's a group or supergroup
    if (chat.type === "group" || chat.type === "supergroup") {
      return NextResponse.json({ error: "Group/Supergroup not allowed. Only channels are supported." }, { status: 400 });
    }

    if (chat.type !== "channel") {
      return NextResponse.json({ error: "Only channels are allowed." }, { status: 400 });
    }

    const countData = await telegram(token, "getChatMemberCount", { chat_id: chat.id });
    const subscriberCount = countData.ok
      ? Number(countData.result || 0)
      : privateInviteMeta?.participantsCount ?? null;

    const verificationToken = normalizedInviteLink
      ? createPrivateChannelVerificationToken(chat.id, normalizedInviteLink)
      : null;

    if (channelType === "private") {
      logPrivateChannelDiagnostic("chat_info_verified", {
        token_received: false,
        token_valid: Boolean(verificationToken),
        token_error_code: verificationToken ? "none" : "token_generation_failed",
        token_has_chat_id: Boolean(chat.id),
        digest_match: Boolean(verificationToken),
        submit_channel_type: "private",
        normalized_input_type: "private_invite",
        final_reject_reason: verificationToken ? "none" : "token_generation_failed",
      });
    }

    return NextResponse.json({
      id: chat.id,
      title: chat.title || privateInviteMeta?.title || "Private Channel",
      username: channelType === "public" ? chat.username : null,
      channel_type: channelType,
      type: chat.type,
      subscriber_count: subscriberCount,
      permissions,
      verification_token: verificationToken,
    });
  } catch (error: unknown) {
    console.error("Telegram API Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) === 403 ? 403 : 401 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return verifyChatInfo(request, {
    username: searchParams.get("username"),
    inviteLink: null,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return verifyChatInfo(request, {
    username: typeof body.username === "string" ? body.username : null,
    inviteLink: typeof body.invite_link === "string" ? body.invite_link : null,
  });
}
