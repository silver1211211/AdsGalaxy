import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const telegramScript = readFileSync("src/components/shared/TelegramScript.tsx", "utf8");

test("ordinary browser pages do not load Telegram SDK or trigger version reloads", () => {
  assert.match(telegramScript, /if \(!isTelegramMiniApp\(\)\) return;/);
  const guard = telegramScript.indexOf("if (!isTelegramMiniApp()) return;");
  assert.ok(guard < telegramScript.indexOf("ensureFreshAppVersion();"));
  assert.ok(guard < telegramScript.indexOf('script.src = "https://telegram.org/js/telegram-web-app.js"'));
});
