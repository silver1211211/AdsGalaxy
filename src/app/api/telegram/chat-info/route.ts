import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    await getAuthenticatedUser(initData);

    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");

    if (!username) {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }

    const token = process.env.BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "Bot token not configured" }, { status: 500 });
    }

    // Ensure username starts with @
    const chatUsername = username.startsWith("@") ? username : `@${username}`;

    const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatUsername}`);
    const data = await response.json();

    if (!data.ok) {
      return NextResponse.json({ error: data.description || "Failed to fetch chat info" }, { status: 404 });
    }

    const chat = data.result;

    // Check permissions
    const botId = token.split(":")[0];
    const memberRes = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${chat.id}&user_id=${botId}`);
    const memberData = await memberRes.json();

    if (!memberData.ok) {
      return NextResponse.json({ error: "Could not verify bot permissions. Is the bot added to the channel?" }, { status: 400 });
    }

    const member = memberData.result;
    const isAdmin = member.status === "administrator" || member.status === "creator";
    
    if (!isAdmin) {
      return NextResponse.json({ 
        error: "PERMISSION_REQUIRED", 
        message: "Our bot is not an admin on your channel. Please add it as an admin first." 
      }, { status: 400 });
    }

    if (!member.can_post_messages || !member.can_delete_messages) {
      return NextResponse.json({ 
        error: "PERMISSION_REQUIRED", 
        message: "Bot is admin but lacks 'Post Messages' and 'Delete Messages' permissions. Please enable them." 
      }, { status: 400 });
    }

    // Check if it's a group or supergroup
    if (chat.type === "group" || chat.type === "supergroup") {
      return NextResponse.json({ error: "Group/Supergroup not allowed. Only channels are supported." }, { status: 400 });
    }

    if (chat.type !== "channel") {
      return NextResponse.json({ error: "Only channels are allowed." }, { status: 400 });
    }

    return NextResponse.json({
      id: chat.id,
      title: chat.title,
      username: chat.username,
      type: chat.type,
    });
  } catch (error: any) {
    console.error("Telegram API Error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 401 });
  }
}
