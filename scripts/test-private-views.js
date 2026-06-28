require("dotenv").config({ path: ".env" });

const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

function getSafeTelegramError(error) {
  const errorMessage = error && typeof error.errorMessage === "string" ? error.errorMessage : "";
  const code = error && (error.code || error.errorCode) ? String(error.code || error.errorCode) : "";
  const message = error instanceof Error ? error.message : String(error || "Unknown error");

  return {
    code: code || "unknown",
    error: errorMessage || message,
  };
}

async function main() {
  const account = getArg("account");
  const chat = getArg("chat");
  const messageId = Number.parseInt(getArg("message"), 10);

  if (account !== "1" && account !== "2") {
    throw new Error("Usage: node scripts/test-private-views.js --account=1|2 --chat=<chat_id_or_username> --message=<message_id>");
  }
  if (!chat || !Number.isFinite(messageId) || messageId <= 0) {
    throw new Error("Provide --chat and a positive numeric --message.");
  }

  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || "", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  const session = process.env[`TELEGRAM_MT_ACCOUNT_${account}_SESSION`] || "";

  if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash || !session) {
    throw new Error(`Set TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_MT_ACCOUNT_${account}_SESSION before testing.`);
  }

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
  });

  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      throw new Error("session_unauthorized");
    }

    const peer = await client.getInputEntity(chat);
    const result = await client.invoke(
      new Api.messages.GetMessagesViews({
        peer,
        id: [messageId],
        increment: false,
      })
    );

    console.log(`Private view test succeeded for tracking account ${account}.`);
    console.log(`Views: ${Number(result.views[0]?.views || 0)}`);
    console.log("If this account was only a normal channel member during the test, member-only access is verified for this channel.");
  } catch (error) {
    const safeError = getSafeTelegramError(error);
    console.error(`Private view test failed for tracking account ${account}.`);
    console.error(`Telegram error code: ${safeError.code}`);
    console.error(`Telegram error: ${safeError.error}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  console.error(`Failed to run private view test: ${message}`);
  process.exit(1);
});
