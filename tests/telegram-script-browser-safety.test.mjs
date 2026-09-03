import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const telegramScript = readFileSync("src/components/shared/TelegramScript.tsx", "utf8");
const rootLayout = readFileSync("src/app/layout.tsx", "utf8");

test("Telegram SDK loads before hydration so in-app reloads can recover initData", () => {
  assert.match(rootLayout, /import Script from "next\/script"/);
  assert.match(rootLayout, /id="telegram-web-app-js"[\s\S]*src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"[\s\S]*strategy="beforeInteractive"/);
  assert.doesNotMatch(telegramScript, /document\.createElement\("script"\)/);
});

test("ordinary browser pages do not trigger Telegram-only preparation or version reloads", () => {
  assert.match(telegramScript, /if \(!isTelegramMiniApp\(\)\) return;/);
  const guard = telegramScript.indexOf("if (!isTelegramMiniApp()) return;");
  assert.ok(guard < telegramScript.indexOf("ensureFreshAppVersion();"));
});
