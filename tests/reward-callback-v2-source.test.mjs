import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const rewards = read("src/lib/miniappRewardEvents.ts");
const platform = read("src/lib/developerPlatform.ts");
const internalCompletion = read("src/app/api/miniapp/internal-ads/impression/route.ts");
const externalCompletion = read("src/app/api/sdk/miniapp/impression/route.ts");
const developerApi = read("src/app/api/publisher/developer/route.ts");
const developerUi = read("src/app/publisher/developer/page.tsx");
const developerDocs = read("src/app/docs/developers/page.tsx");
const developerDocsRedirect = read("src/app/docs/developer/page.tsx");
const miniappDocs = read("src/app/docs/publisher/miniapps/page.tsx");
const migration = read("db/migrations/20260727_0104_developer_webhook_v2_outbox.sql");

test("completion routes create reward events only behind the callback flag and caller transaction", () => {
  assert.match(internalCompletion, /if \(!productionRewardCallbacksEnabled\(\)\) return null/);
  assert.match(internalCompletion, /createRewardEvent\(\{\s*db: conn/);
  assert.match(internalCompletion, /status: "eligible"/);
  assert.match(internalCompletion, /verificationLevel: "ads_galaxy_validated"/);
  assert.match(internalCompletion, /if \(completed\)/);
  assert.match(externalCompletion, /if \(!productionRewardCallbacksEnabled\(\)\) return null/);
  assert.match(externalCompletion, /createRewardEvent\(\{\s*db: conn/);
  assert.match(externalCompletion, /status: "client_completed"/);
  assert.match(externalCompletion, /verificationLevel: "client_confirmed"/);
  assert.match(externalCompletion, /rewardEligible: false/);
});

test("event timestamps use database time and automatic webhook enqueue is transactional", () => {
  assert.match(rewards, /NOW\(\), DATE_ADD\(NOW\(\), INTERVAL 24 HOUR\)/);
  assert.match(platform, /export async function enqueueProductionRewardWebhook/);
  assert.match(platform, /db: PoolConnection/);
  assert.match(platform, /INSERT IGNORE INTO developer_webhook_deliveries/);
  assert.match(platform, /auto:\$\{webhook\.id\}:\$\{input\.event\.event_id\}:\$\{input\.eventType\}/);
  assert.match(internalCompletion, /eventType: "reward\.eligible"/);
  assert.match(rewards, /eventType: "reward\.claimed"/);
});

test("webhook v2 signs exact raw body with leased atomic delivery claims", () => {
  assert.match(platform, /`\$\{timestamp\}\.\$\{delivery\.event_id\}\.\$\{body\}`/);
  assert.match(platform, /body,\s*signal: AbortSignal\.timeout\(10_000\)/);
  assert.match(platform, /claim_expires_at = DATE_ADD\(NOW\(\), INTERVAL 5 MINUTE\)/);
  assert.match(platform, /WHERE d\.claim_token = \?/);
  assert.match(platform, /V2_RETRY_DELAYS_MINUTES = \[1, 5, 15, 60, 360\]/);
  assert.match(platform, /attempts >= 6/);
  assert.match(platform, /MAX_WEBHOOK_RESPONSE_BYTES = 64 \* 1024/);
  assert.match(platform, /response\.body\.getReader\(\)/);
  assert.match(platform, /reader\.cancel/);
  assert.doesNotMatch(platform, /response\.text\(\)/);
});

test("migration supports logical uniqueness, leases, history, and 24-hour rotation", () => {
  assert.match(migration, /UNIQUE KEY uniq_developer_webhook_delivery_logical/);
  assert.match(migration, /claim_token VARCHAR\(64\) NULL/);
  assert.match(migration, /manually_retried_from_id BIGINT UNSIGNED NULL/);
  assert.match(platform, /previous_secret_expires_at = DATE_ADD\(NOW\(\), INTERVAL 24 HOUR\)/);
  assert.match(platform, /manual:\$\{deliveryId\}:\$\{nextSequence\}/);
});

test("publisher actions enforce owned binding, rotation, and terminal retry", () => {
  assert.match(developerApi, /action === "bind_miniapp"/);
  assert.match(developerApi, /WHERE id = \? AND user_id = \? AND status = 'active'/);
  assert.match(developerApi, /action === "rotate_webhook_secret"/);
  assert.match(developerApi, /action === "retry_webhook_delivery"/);
  assert.match(platform, /d\.status = 'failed' AND d\.terminal_at IS NOT NULL/);
  assert.match(platform, /status IN \('pending', 'retrying'\)/);
  assert.match(platform, /db: conn/);
  assert.match(platform, /if \(ownsTransaction\) await conn\.commit\(\)/);
  assert.match(platform, /if \(ownsTransaction\) await conn\.rollback\(\)/);
  assert.match(developerUi, /Mini App bindings/);
  assert.match(developerUi, /Production webhook controls/);
});

test("public callback and Developer Center errors are allowlisted", () => {
  assert.match(internalCompletion, /publicInternalImpressionError/);
  assert.match(internalCompletion, /Failed to confirm internal ad impression/);
  assert.doesNotMatch(internalCompletion, /NextResponse\.json\(\{ error: message \}/);
  assert.match(developerApi, /PUBLIC_DEVELOPER_ACTION_ERRORS/);
  assert.match(developerApi, /publicDeveloperActionError/);
  assert.match(developerApi, /function publicDeveloperDashboardError/);
  assert.match(developerApi, /return "Failed to load developer data"/);
  assert.match(developerApi, /error: publicDeveloperDashboardError\(error\)/);
  assert.doesNotMatch(developerApi, /error: error\.message \|\| "Failed to load developer dashboard"/);
  assert.doesNotMatch(developerApi, /error: error\.message \|\| "Developer action failed"/);
});

test("documentation requires server verification and contains no fake backup origin", () => {
  assert.doesNotMatch(developerDocs + miniappDocs, /YOUR_BACKUP_ADSGALAXY_DOMAIN/);
  assert.doesNotMatch(miniappDocs, /Grant your in-app reward only after window\.showAdsGalaxy\(\) resolves/);
  assert.match(developerDocs, /signing input is timestamp .* event_id .* raw_body/);
  assert.match(developerDocs, /five minutes/);
  assert.match(developerDocs, /timingSafeEqual/);
  assert.match(developerDocs, /hash_equals/);
  assert.match(developerDocs, /compare_digest/);
});

test("singular developer documentation route permanently redirects to the canonical plural route", () => {
  assert.match(developerDocsRedirect, /import \{ permanentRedirect \} from "next\/navigation"/);
  assert.match(developerDocsRedirect, /permanentRedirect\("\/docs\/developers"\)/);
  assert.doesNotMatch(developerDocsRedirect, /"use client"|useRouter|window\.location/);
});
