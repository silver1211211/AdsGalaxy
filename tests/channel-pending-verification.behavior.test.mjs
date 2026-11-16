import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync("src/lib/channelEligibility.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const base = { context:"ad_delivery", status:"active", is_deleted:0, channel_type:"public", chat_id:"-1001234567890", username:"validchannel", subscriber_count:1000, minimum_subscribers:100, marketplace_admin_status:"approved", publisher_status:"active", bot_member_status:"administrator", bot_can_post:1 };
test("administrator sees pending and failed status over stale healthy access", () => {
  const page=readFileSync("src/app/admin/channels/page.tsx", "utf8");
  const begin=page.indexOf("function telegramState(");
  const end=page.indexOf("\nfunction TelegramStateBadge(",begin);
  assert.ok(begin >= 0 && end > begin);
  const code=ts.transpileModule(page.slice(begin,end)+"\nexports.telegramState=telegramState;", {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const ui={}; vm.runInNewContext(code,{exports:ui});
  assert.equal(ui.telegramState({telegram_access_state:"healthy",telegram_verification_state:"pending_verification"}).label,"Verification pending");
  assert.equal(ui.telegramState({telegram_access_state:"healthy",telegram_verification_state:"verification_failed"}).label,"Verification failed");
  assert.equal(ui.telegramState({telegram_access_state:"healthy",telegram_verification_state:"healthy"}).label,"Telegram healthy");
});
