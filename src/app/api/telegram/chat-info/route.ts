import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { isValidPrivateInviteLink } from "@/lib/channelPrivacy";
import { resolvePrivateInviteLink } from "@/lib/telegramMtproto";

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

function permissionResponse(message: string) {
  return NextResponse.json({
    error: "PERMISSION_REQUIRED",
    message,
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
  };

  return messageByCode[code] || "Unable to verify private channel.";
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    await getAuthenticatedUser(initData);

    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");
    const inviteLink = searchParams.get("invite_link");
    const channelType = inviteLink ? "private" : "public";

    if (!username && !inviteLink) {
      return NextResponse.json({ error: "Username or invite link is required" }, { status: 400 });
    }

    if (inviteLink && !isValidPrivateInviteLink(inviteLink)) {
      return NextResponse.json({ error: "Invalid private invite link" }, { status: 400 });
    }

    const token = process.env.BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "Bot token not configured" }, { status: 500 });
    }

    // Resolve chat_id: @username for public, numeric -100... id for private.
    let chatId: string;
    let privateInviteMeta: { title: string; participantsCount: number | null } | null = null;
    if (inviteLink) {
      const resolved = await resolvePrivateInviteLink(inviteLink);
      if (!resolved.ok) {
        return NextResponse.json({ error: privateInviteError(resolved.code) }, { status: 400 });
      }
      chatId = resolved.chatId;
      privateInviteMeta = {
        title: resolved.title,
        participantsCount: resolved.participantsCount,
      };
    } else {
      chatId = username!.startsWith("@") ? username! : `@${username}`;
    }

    const data = await telegram(token, "getChat", { chat_id: chatId });

    if (!data.ok) {
      return NextResponse.json({
        error: inviteLink
          ? "Unable to access channel. Add AdsGalaxy Bot as administrator first, then use a valid private invite link."
          : data.description || "Invalid public username",
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
      return permissionResponse("Could not verify bot permissions. Is the bot added to the channel?");
    }

    const member = memberData.result;
    const isCreator = member.status === "creator";
    const isAdmin = member.status === "administrator" || isCreator;
    
    if (!isAdmin) {
      return permissionResponse("Bot is not an administrator. Please add AdsGalaxy Bot as an admin first.");
    }

    if (!isCreator && !member.can_post_messages) {
      return permissionResponse("Missing post message permission. Enable Post Messages for AdsGalaxy Bot.");
    }

    if (!isCreator && !member.can_delete_messages) {
      return permissionResponse("Missing delete message permission. Enable Delete Messages for AdsGalaxy Bot.");
    }

    if (channelType === "private" && !isCreator && !member.can_invite_users) {
      return permissionResponse("Missing add members permission. Enable Add Members for AdsGalaxy Bot. If Telegram does not allow automatic invite, add AdsGalaxy Tracking Account as a member of this private channel so AdsGalaxy can count post views.");
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

    return NextResponse.json({
      id: chat.id,
      title: chat.title || privateInviteMeta?.title || "Private Channel",
      username: channelType === "public" ? chat.username : null,
      channel_type: channelType,
      type: chat.type,
      subscriber_count: subscriberCount,
      permissions: {
        is_admin: true,
        can_post_messages: true,
        can_delete_messages: true,
        can_invite_users: channelType === "private" ? true : Boolean(member.can_invite_users),
      },
    });
  } catch (error: unknown) {
    console.error("Telegram API Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) === 403 ? 403 : 401 });
  }
}
