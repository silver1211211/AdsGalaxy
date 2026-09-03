import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const sdk = read("src/app/sdk.js/route.ts");
const details = read("src/components/publisher/MiniAppDetailsScreen.tsx");
const panel = read("src/components/publisher/MiniAppRewardCallbackPanel.tsx");
const route = read("src/app/api/publisher/miniapps/[id]/reward-callback/route.ts");
const direct = read("src/lib/miniappDirectRewardCallbacks.ts");
const internal = read("src/app/api/miniapp/internal-ads/impression/route.ts");
const rewards = read("src/lib/miniappRewardEvents.ts");
const outbox = read("src/lib/developerPlatform.ts");
const migration = read("db/migrations/20260801_0109_direct_miniapp_reward_callbacks.sql");
const publisherDocs = read("src/app/docs/publisher/miniapps/page.tsx");
const developerDocs = read("src/app/docs/developers/page.tsx");
const examples = read("src/lib/miniappIntegrationExamples.ts");
const transport = read("src/lib/directCallbackTransport.mjs");
const deploy = read("deploy-vps.sh");

test("basic integration has canonical numeric script and no key", () => {
  assert.match(examples, /sdk\.js\?id=YOUR_NUMERIC_MINI_APP_ID/);
  assert.match(examples, /window\.showAdsGalaxy\(\).*\.then\(function \(result\)/s);
  assert.doesNotMatch(details, /x-api-key|agx_priv/);
});

test("no-argument and options SDK calls remain supported", () => {
  assert.match(sdk, /window\.showAdsGalaxy=function\(options,onSuccess,onError\)/);
  assert.match(sdk, /DEFAULT_MINIAPP_ID=u\.searchParams\.get\("id"\)\|\|DEFAULT_MINIAPP_ID/);
  assert.match(details, /canonicalMiniappDisplayExample/);
  assert.doesNotMatch(details, /showAdsGalaxy\(\{ miniappId/);
});

test("internal SDK success waits for confirmation and rejects failures", () => {
  assert.match(sdk, /track\(\{event_type:"completed".*\}\)\.then\(function\(result\)/);
  assert.match(sdk, /if\(!result\|\|!result\.event_id\)throw sdkError/);
  assert.match(sdk, /reject\(error&&error\.code\?error:sdkError/);
  assert.match(sdk, /event_id:result\.event_id,completed:true,reward_eligible:true,status:"completed"/);
});

test("reward events are request-id idempotent and Developer application is optional", () => {
  assert.match(rewards, /UNIQUE|existing = await getRewardEventByRequestId/);
  assert.match(rewards, /applicationId: number \| null/);
  assert.match(internal, /applicationId: binding \? Number\(binding\.application_id\) : null/);
  assert.match(internal, /if \(binding && productionRewardCallbacksEnabled\(\)\)/);
});

test("direct callback enqueue is flag gated and transaction scoped", () => {
  assert.match(direct, /process\.env\.MINIAPP_DIRECT_REWARD_CALLBACKS_ENABLED === "true"/);
  assert.match(direct, /db: PoolConnection/);
  assert.match(internal, /await enqueueDirectMiniappRewardCallback\(\{/);
  assert.match(internal, /await conn\.commit\(\)/);
});

test("disabled direct delivery rows remain unleased while Developer deliveries continue", () => {
  assert.match(outbox, /AND \(\? = 1 OR miniapp_reward_callback_id IS NULL\)/);
  assert.match(outbox, /claimWebhookDeliveryBatch\(directCallbacksEnabled\)/);
  assert.match(outbox, /directMiniappRewardCallbacksEnabled\(\)/);
});

test("callback payload contains only approved fields and verified user identity", () => {
  const payload = direct.match(/const payload = \{([\s\S]*?)\n  \};/)?.[1] || "";
  for (const field of ["event_id", "request_id", "mini_app_id", "user_id", "status", "completed_at"]) assert.match(payload, new RegExp(field));
  assert.doesNotMatch(payload, /advertiser|campaign|price|secret|api_key/);
  assert.match(internal, /verifiedTelegramUserId: input\.telegramUserId/);
  assert.match(internal, /requireMiniappTrackingUser/);
});

test("outbox preserves body and event id while signing each attempt timestamp", () => {
  assert.match(direct, /logicalKey = `direct:\$\{callback\.id\}:\$\{input\.event\.event_id\}:reward\.eligible`/);
  assert.match(outbox, /const body = isV2[\s\S]*JSON\.stringify\(payload\)/);
  assert.match(outbox, /`\$\{timestamp\}\.\$\{delivery\.event_id\}\.\$\{body\}`/);
  assert.match(outbox, /response\.ok/);
  assert.match(outbox, /V2_RETRY_DELAYS_MINUTES = \[1, 5, 15, 60, 360\]/);
});

test("configuration enforces ownership and safe HTTPS URLs", () => {
  assert.match(route, /WHERE id = \? AND user_id = \? AND is_deleted = FALSE/);
  assert.match(transport, /url\.protocol !== "https:"/);
  assert.match(transport, /url\.username \|\| url\.password/);
  assert.match(transport, /localhost|private or reserved/);
});

test("secret is one-time output and rotation overlaps for 24 hours", () => {
  assert.doesNotMatch(route.match(/export async function GET[\s\S]*?export async function PUT/)?.[0] || "", /signing_secret:/);
  assert.match(route, /signing_secret: secret, secret_version: 1, secret_returned: true/);
  assert.match(route, /previous_secret_expires_at = DATE_ADD\(NOW\(\), INTERVAL 24 HOUR\)/);
  assert.match(route, /previous_secret_overlap_hours: 24/);
  assert.match(direct, /crypto\.randomBytes\(32\)/);
});

test("disable retains history and UI never sends publisher to Developer Center", () => {
  assert.match(route, /UPDATE miniapp_reward_callbacks SET status = 'disabled'/);
  assert.doesNotMatch(route, /DELETE FROM miniapp_reward_callbacks/);
  assert.match(panel, /Store event_id uniquely and credit the user only once/);
  assert.doesNotMatch(panel, /Developer Center/);
});

test("API and UI distinguish configured, platform, and effective callback status", () => {
  assert.match(route, /configured_status/);
  assert.match(route, /platform_enabled/);
  assert.match(route, /effective_status/);
  assert.match(panel, /Saved — callback delivery is not currently enabled by the platform/);
  assert.doesNotMatch(route, /MINIAPP_DIRECT_REWARD_CALLBACKS_ENABLED/);
});

test("migration is additive and outbox supports either destination", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS miniapp_reward_callbacks/);
  assert.match(migration, /UNIQUE KEY uniq_miniapp_reward_callback_miniapp/);
  assert.match(migration, /miniapp_reward_callback_id BIGINT UNSIGNED NULL/);
  assert.doesNotMatch(migration, /\bDROP\b|\b(balance|allocation|withdrawal)s?\b/i);
  assert.match(outbox, /LEFT JOIN developer_webhooks/);
  assert.match(outbox, /LEFT JOIN miniapp_reward_callbacks/);
  assert.match(deploy, /20260801_0109_direct_miniapp_reward_callbacks\.sql/);
});

test("missing callback schema is safe and cannot look disabled by the publisher", () => {
  assert.match(route, /CALLBACK_SCHEMA_NOT_READY/);
  assert.match(route, /INFORMATION_SCHEMA\.TABLES/);
  assert.match(route, /CALLBACK_REQUEST_FAILED/);
  assert.doesNotMatch(route, /\{ error: err\.message/);
  assert.match(panel, /schema_unavailable/);
  assert.match(panel, /Unavailable — callback database setup is pending/);
});

test("basic docs separate optional advanced APIs", () => {
  assert.match(publisherDocs, /Advanced Developer APIs/);
  assert.match(developerDocs, /These APIs are not required to load the Mini App SDK, display ads, handle SDK errors, or receive a direct Mini App reward callback/);
  assert.match(publisherDocs, /Do not credit a valuable wallet from browser code alone/);
  assert.match(publisherDocs, /insert event_id uniquely and credit in one database transaction/);
});
