import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const rewardLibrary = read("src/lib/miniappRewardEvents.ts");
const developerPlatform = read("src/lib/developerPlatform.ts");
const verifyRoute = read("src/app/api/v1/rewarded/verify/route.ts");
const claimRoute = read("src/app/api/v1/rewarded/claim/route.ts");
const lookupRoute = read("src/app/api/v1/rewarded/events/[event_id]/route.ts");
const migration = read("db/migrations/20260727_0103_production_miniapp_reward_events.sql");

test("production reward callbacks default disabled and accept only the approved enabled values", () => {
  assert.match(rewardLibrary, /process\.env\.PRODUCTION_REWARD_CALLBACKS_ENABLED/);
  assert.match(rewardLibrary, /value === "true" \|\| value === "1" \|\| value === "on"/);
  assert.doesNotMatch(rewardLibrary, /NEXT_PUBLIC_PRODUCTION_REWARD_CALLBACKS_ENABLED/);
});

test("developer authentication supports an optional private-key requirement without changing existing callers", () => {
  assert.match(developerPlatform, /requiredKeyType\?: "public" \| "private"/);
  assert.match(developerPlatform, /\} = \{\}\s*\)/);
  assert.match(developerPlatform, /keyType: String\(record\.key_type\)/);
  assert.match(claimRoute, /\{ requiredKeyType: "private" \}/);
  assert.match(lookupRoute, /\{ requiredKeyType: "private" \}/);
});

test("production verify remains unavailable while the feature flag is disabled", () => {
  assert.match(verifyRoute, /if \(!productionRewardCallbacksEnabled\(\)\)/);
  assert.match(verifyRoute, /statusCode: 501/);
  assert.match(verifyRoute, /context\.keyType !== "private"/);
  assert.match(verifyRoute, /requireApplicationMiniappScope/);
});

test("production verify does not reserve a sandbox transaction connection", () => {
  const productionBranch = verifyRoute.indexOf('if (context.mode === "production")');
  const sandboxConnection = verifyRoute.indexOf("conn = await pool.getConnection()");
  assert.ok(productionBranch >= 0);
  assert.ok(sandboxConnection > productionBranch);
  assert.match(verifyRoute, /conn\?\.release\(\)/);
});

test("claim requires an idempotency key and uses a locked transaction", () => {
  assert.match(claimRoute, /headers\.get\("idempotency-key"\)/);
  assert.match(rewardLibrary, /await conn\.beginTransaction\(\)/);
  assert.match(rewardLibrary, /miniapp_reward_events WHERE event_id = \? FOR UPDATE/);
  assert.match(rewardLibrary, /WHERE application_id = \? AND idempotency_key = \?/);
  assert.match(rewardLibrary, /response_payload/);
});

test("claim checks eligible, unexpired, unclaimed and unreversed state", () => {
  assert.match(rewardLibrary, /event\.status !== "eligible"/);
  assert.match(rewardLibrary, /event\.expires_at/);
  assert.match(rewardLibrary, /event\.claimed_at/);
  assert.match(rewardLibrary, /event\.reversed_at/);
  assert.match(rewardLibrary, /REWARD_ALREADY_CLAIMED/);
  assert.match(rewardLibrary, /REWARD_EXPIRED/);
  assert.match(rewardLibrary, /REWARD_REVERSED/);
  assert.match(rewardLibrary, /REWARD_NOT_ELIGIBLE/);
});

test("claim handles database-clock expiry and duplicate-key races", () => {
  assert.match(rewardLibrary, /\(expires_at <= NOW\(\)\) AS claim_expired/);
  assert.match(rewardLibrary, /expiryResult\.affectedRows === 1/);
  assert.match(rewardLibrary, /status NOT IN \('claimed', 'reversed', 'expired'\)/);
  assert.match(rewardLibrary, /mysqlError\.code === "ER_DUP_ENTRY" \|\| mysqlError\.errno === 1062/);
  assert.match(rewardLibrary, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.doesNotMatch(rewardLibrary, /sqlMessage/);
  assert.doesNotMatch(rewardLibrary, /claimRewardEvent\([^)]*\)[\s\S]*claimRewardEvent\(/);
});

test("duplicate claim classification uses ordered current reads", () => {
  assert.match(
    rewardLibrary,
    /function loadClaimByIdempotencyForUpdate[\s\S]*WHERE application_id = \?[\s\S]*AND idempotency_key = \?[\s\S]*LIMIT 1\s+FOR UPDATE/
  );
  assert.match(
    rewardLibrary,
    /function loadClaimByRewardEventForUpdate[\s\S]*WHERE reward_event_id = \?[\s\S]*LIMIT 1\s+FOR UPDATE/
  );
  const duplicateCatch = rewardLibrary.indexOf("if (!isDuplicateEntry(error)) throw error", rewardLibrary.indexOf("export async function claimRewardEvent"));
  const idempotencyLookup = rewardLibrary.indexOf("loadClaimByIdempotencyForUpdate(", duplicateCatch);
  const storedResponse = rewardLibrary.indexOf("return parseStoredJson(idempotencyWinner.response_payload)", idempotencyLookup);
  const eventLookup = rewardLibrary.indexOf("loadClaimByRewardEventForUpdate(", idempotencyLookup);
  const alreadyClaimed = rewardLibrary.indexOf('REWARD_ALREADY_CLAIMED", "Reward event has already been claimed', eventLookup);
  assert.ok(duplicateCatch >= 0);
  assert.ok(idempotencyLookup > duplicateCatch);
  assert.ok(storedResponse > idempotencyLookup);
  assert.ok(eventLookup > storedResponse);
  assert.ok(alreadyClaimed > eventLookup);
});

test("event creation treats request uniqueness as authoritative and retries ID collisions", () => {
  assert.match(rewardLibrary, /REWARD_REQUEST_SCOPE_CONFLICT/);
  assert.match(rewardLibrary, /WHERE request_id = \? FOR UPDATE/);
  assert.match(rewardLibrary, /REWARD_EVENT_ID_GENERATION_FAILED/);
  assert.match(rewardLibrary, /if \(!isDuplicateEntry\(error\)\) throw error/);
});

test("reward and claim IDs use 24 random base64url bytes and database uniqueness", () => {
  assert.match(rewardLibrary, /crypto\.randomBytes\(24\)\.toString\("base64url"\)/);
  assert.match(rewardLibrary, /randomPublicId\("rwe"\)/);
  assert.match(rewardLibrary, /randomPublicId\("rwc"\)/);
  assert.match(migration, /UNIQUE KEY uniq_miniapp_reward_event_id \(event_id\)/);
  assert.match(migration, /UNIQUE KEY uniq_miniapp_reward_claim_public_id \(public_claim_id\)/);
  assert.match(migration, /UNIQUE KEY uniq_miniapp_reward_claim_event \(reward_event_id\)/);
  assert.match(migration, /UNIQUE KEY uniq_miniapp_reward_claim_idempotency \(application_id, idempotency_key\)/);
});

test("lookup and pending behavior require publisher-scoped Mini App ownership", () => {
  assert.match(lookupRoute, /requireApplicationMiniappScope/);
  assert.match(rewardLibrary, /m\.user_id = \?/);
  assert.match(rewardLibrary, /mr\.created_at >= DATE_SUB\(NOW\(\), INTERVAL 10 MINUTE\)/);
  assert.match(verifyRoute, /error_code: "EVENT_PENDING"/);
});

test("locked SDK runtime and mediation sources remain byte-identical", () => {
  const expected = new Map([
    ["src/app/sdk.js/route.ts", "a96c629adbdb575590811d6c160ac6cb31a93a59c8e49c41555809b18a9ddb78"],
    ["src/lib/miniappSdkRuntime.ts", "bd3da025098d8da1c1b86d3504e318d52e8deeb3bab48d5bdda74cf370ae3494"],
    ["src/lib/miniappMediationEngine.ts", "688144aede73261d2d49a621761d535ee0738d0086bd38f07149ee6f87fef3d6"],
  ]);
  for (const [path, hash] of expected) assert.equal(sha256(path), hash, path);
});
