export async function sendTelegramMessage(chatId: string | number, text: string, options: any = {}) {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is not defined");
    return;
  }

  const { parse_mode = "HTML", reply_markup, photo } = options;

  try {
    const endpoint = photo ? "sendPhoto" : "sendMessage";
    const body: any = {
      chat_id: chatId,
      parse_mode,
      ...(photo ? { photo, caption: text } : { text }),
      ...(reply_markup ? { reply_markup } : {}),
    };

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
