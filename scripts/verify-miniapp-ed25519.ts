import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  assertTelegramSdkUserMatches,
  TelegramSdkAuthError,
  verifyTelegramThirdPartyInitData,
} from "../src/lib/telegramThirdPartyInitData.ts";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const botId = "123456789";
const user = JSON.stringify({ id: 987654321, first_name: "SDK", username: "sdk_viewer" });

function signedInitData(authDate: number, signingBotId = botId) {
  const fields = [["auth_date", String(authDate)], ["query_id", "fixture-query"], ["user", user]] as const;
  const check = `${signingBotId}:WebAppData\n${fields.map(([key, value]) => `${key}=${value}`).join("\n")}`;
  const signature = crypto.sign(null, Buffer.from(check), privateKey).toString("base64url");
  const params = new URLSearchParams();
  for (const [key, value] of fields) params.set(key, value);
  params.set("hash", "not-used-by-ed25519");
  params.set("signature", signature);
  return params.toString();
}

function expectCode(code: string, action: () => unknown) {
  assert.throws(action, (error: unknown) => error instanceof TelegramSdkAuthError && error.code === code);
}

const now = 2_000_000_000;
const valid = verifyTelegramThirdPartyInitData(signedInitData(now), botId, { nowSeconds: now, publicKeyHex });
assert.equal(valid.telegramUserId, "987654321");
expectCode("INVALID_INIT_DATA", () => verifyTelegramThirdPartyInitData(signedInitData(now), "123456780", { nowSeconds: now, publicKeyHex }));
expectCode("INIT_DATA_EXPIRED", () => verifyTelegramThirdPartyInitData(signedInitData(now - 86_401), botId, { nowSeconds: now, publicKeyHex }));
expectCode("TELEGRAM_SIGNATURE_MISSING", () => verifyTelegramThirdPartyInitData(`auth_date=${now}&user=${encodeURIComponent(user)}`, botId, { nowSeconds: now, publicKeyHex }));
expectCode("USER_MISMATCH", () => assertTelegramSdkUserMatches("111111111", valid.telegramUserId));

console.log("Mini App Ed25519 checks passed: valid, wrong bot ID, expired, missing signature, and user mismatch.");
