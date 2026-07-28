import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import "./reward-callback-production-loader.mjs";

process.env.BOT_INTEGRATION_ENCRYPTION_KEY = "bot-integration-readiness-test-key-32-bytes-minimum";

const integration = await import("../src/lib/botIntegration.ts");
const diagnosticOwnership = await import("../src/lib/botIntegrationDiagnostic.ts");
const readiness = await import("../src/lib/botIntegrationReadiness.ts");
const route = readFileSync("src/app/api/publisher/bots/[id]/test-integration/route.ts", "utf8");

const successChecks = [
  "bot_approved",
  "encryption_config",
  "bot_token_storage",
  "integration_secret",
  "telegram_getme",
  "sdk_connected",
  "sdk_callback",
  "database_registration",
  "connection_state",
].map((key) => ({ key, status: "success" }));

async function configuredCredential() {
  let stored = null;
  const db = {
    async query(sql, params) {
      if (sql.includes("SELECT integration_secret_encrypted")) {
        return [[{
          integration_secret_encrypted: stored?.encrypted || null,
          integration_secret_hash: stored?.hash || null,
          webhook_url: null,
        }]];
      }
      if (sql.includes("UPDATE bots") && sql.includes("integration_secret_encrypted")) {
        stored = { encrypted: params[0], hash: params[1] };
        return [{ affectedRows: 1 }];
      }
      throw new Error("unexpected test query");
    },
  };
  await integration.ensureBotIntegration(db, "https://app.example", 17);
  return stored;
}

test("valid bot integration is ready without any Developer Center application or key", async () => {
  const stored = await configuredCredential();
  const diagnostic = integration.diagnoseBotIntegrationSecret(stored.encrypted, stored.hash);
  assert.equal(diagnostic.ok, true);
  assert.equal(diagnostic.message, "Bot integration secret is valid.");
  assert.equal(readiness.evaluateBotIntegrationReadiness(successChecks).ready, true);
  assert.doesNotMatch(route, /developer_applications|developer_api_keys|sdk_authentication/);
});

test("corrupted bot integration hash fails secret validation and readiness", async () => {
  const stored = await configuredCredential();
  const diagnostic = integration.diagnoseBotIntegrationSecret(stored.encrypted, "0".repeat(64));
  assert.deepEqual(diagnostic, {
    ok: false,
    message: "Bot integration credentials are invalid.",
  });
  const result = readiness.evaluateBotIntegrationReadiness(
    successChecks.map((item) => item.key === "integration_secret" ? { ...item, status: "failure" } : item)
  );
  assert.equal(result.ready, false);
  assert.ok(result.failedRequirements.includes("integration_secret"));
});

test("an unrelated Developer Center key cannot mask an invalid bot credential", () => {
  const result = readiness.evaluateBotIntegrationReadiness(
    successChecks.map((item) => item.key === "integration_secret" ? { ...item, status: "failure" } : item)
  );
  assert.equal(result.ready, false);
  assert.doesNotMatch(route, /developer_applications|developer_api_keys/);
});

test("missing bot integration returns a controlled failure", () => {
  assert.deepEqual(integration.diagnoseBotIntegrationSecret(null, null), {
    ok: false,
    message: "Bot integration is not configured.",
  });
});

test("cross-publisher diagnostics invoke production ownership logic and reveal no bot state", async () => {
  const botA = {
    id: 17,
    user_id: 101,
    bot_token_encrypted: "not-public",
    integration_secret_encrypted: "not-public",
    integration_secret_hash: "not-public",
  };
  const db = {
    async query(sql, values) {
      assert.match(sql, /WHERE id = \? AND user_id = \? AND is_deleted = FALSE/);
      const [botId, publisherId] = values;
      return [[botA].filter((bot) => bot.id === Number(botId) && bot.user_id === Number(publisherId)), {}];
    },
  };

  const result = await diagnosticOwnership.loadOwnedBotForIntegrationDiagnostic(db, botA.id, 202);
  assert.equal(result, null);
  assert.equal(JSON.stringify(result), "null");
  assert.match(route, /loadOwnedBotForIntegrationDiagnostic<BotRow>\(pool, id, user\.id\)/);
  assert.match(route, /if \(!bot\) return NextResponse\.json\(\{ error: "Bot not found" \}, \{ status: 404 \}\)/);
  assert.ok(route.indexOf("loadOwnedBotForIntegrationDiagnostic") < route.indexOf("const secretDiagnostic = diagnoseBotIntegrationSecret"));
});

test("public diagnostic output excludes credentials and sanitizes unexpected failures", async () => {
  const stored = await configuredCredential();
  const diagnostic = integration.diagnoseBotIntegrationSecret(stored.encrypted, stored.hash);
  const publicResult = JSON.stringify({ ok: diagnostic.ok, message: diagnostic.message });
  assert.equal(publicResult.includes(stored.encrypted), false);
  assert.equal(publicResult.includes(stored.hash), false);
  assert.doesNotMatch(route, /NextResponse\.json\(\{ error: error instanceof Error \? error\.message/);
  assert.match(route, /NextResponse\.json\(\{ error: "Integration diagnostic failed", checks \}/);
});
