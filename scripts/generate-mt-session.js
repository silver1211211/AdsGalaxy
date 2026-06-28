const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env" });

const input = require("input");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

function getAccountNumber() {
  const accountArg = process.argv.find((arg) => arg.startsWith("--account="));
  const account = accountArg ? accountArg.split("=")[1] : "";

  if (account !== "1" && account !== "2") {
    throw new Error("Usage: node scripts/generate-mt-session.js --account=1|2");
  }

  return account;
}

async function main() {
  const account = getAccountNumber();
  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || "", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";

  if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env before running this script.");
  }

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => input.text(`Telegram phone number for tracking account ${account}:`),
    password: async () => input.password("Two-step password, if enabled:"),
    phoneCode: async () => input.text("Login code:"),
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error || "Unknown error");
      console.error(`Telegram login error: ${message}`);
    },
  });

  const session = client.session.save();
  const outputPath = path.join(process.cwd(), `.telegram-mt-session-${account}`);
  fs.writeFileSync(outputPath, `${session}\n`, { encoding: "utf8", mode: 0o600 });

  await client.disconnect();

  console.log(`MTProto session generated successfully for tracking account ${account}.`);
  console.log(`Saved to ${outputPath}`);
  console.log(`Copy the single-line file contents to TELEGRAM_MT_ACCOUNT_${account}_SESSION in your secret store.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  console.error(`Failed to generate MTProto session: ${message}`);
  process.exit(1);
});
