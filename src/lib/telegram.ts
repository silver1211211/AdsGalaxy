export const SAFE_TELEGRAM_PARSE_MODE = undefined;

export async function sendTelegramMessage(chatId: string | number, text: string, options: any = {}) {
  const token = options.token || process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is not defined");
    return;
  }

  const { parse_mode = SAFE_TELEGRAM_PARSE_MODE, reply_markup, photo } = options;

  try {
    const endpoint = photo ? "sendPhoto" : "sendMessage";
    
    // If photo is a Buffer, we must use FormData
    if (photo && Buffer.isBuffer(photo)) {
      const formData = new FormData();
      formData.append("chat_id", chatId.toString());
      formData.append("caption", text);
      if (parse_mode) formData.append("parse_mode", parse_mode);
      if (reply_markup) formData.append("reply_markup", typeof reply_markup === 'string' ? reply_markup : JSON.stringify(reply_markup));
      
      const blob = new Blob([new Uint8Array(photo)]);
      formData.append("photo", blob, "photo.jpg");

      const res = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
        method: "POST",
        body: formData,
      });
      return await res.json();
    }

    // Default JSON for text or URL-based photos
    const body: any = {
      chat_id: chatId,
      ...(photo ? { photo, caption: text } : { text }),
      ...(reply_markup ? { reply_markup } : {}),
    };
    if (parse_mode) body.parse_mode = parse_mode;

    const res = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    const data = await res.json();
    if (!data.ok) {
      console.error(`Telegram ${endpoint} Error:`, data.description);
    }
    return data;
  } catch (error) {
    console.error("Telegram Fetch Error:", error);
  }
}

export async function deleteTelegramMessage(chatId: string | number, messageId: number, options: any = {}) {
  const token = options.token || process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is not defined");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
      }),
    });
    
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Telegram Delete Error:", error);
  }
}
